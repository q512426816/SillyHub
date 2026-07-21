"""problem 子域 service。

职责:
- 问题清单 CRUD (PpmProblemList)
- 问题变更 CRUD (PpmProblemChange) — deprecated 模块 (D-005)，前端入口已停用
- 问题清单 3 态执行流 (2026-07-20 简化，对齐任务计划)：
  - ``start_problem``   : 新建 → 进行中，建 in-flight TaskExecute(status=DOING)
  - ``execute_problem`` : 收口 in-flight TaskExecute(status=END)；
                          action=submit → 回新建 (可重复执行)，
                          action=complete → 已完成 (终态)
  - 跨天校验 (actual_start.date != actual_end.date → 422，前端拆逐天)
- 问题变更审批流 (``next_change`` / ``reject_change``) 保留 deprecated 调用
  (ProblemChangeStatus / CHANGE_NODE_NEXT / compute_change_next_node)。

平台级,无 workspace 过滤 (D-001@v1)。

设计依据:change 2026-07-20-problem-list-align-task-plan design.md §5/§8 +
decisions.md D-001~D-006 + ``tasks/task-03.md``；镜像
``app/modules/ppm/task/service.py`` start/execute_plan 两段式。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.ppm.common.crud import (
    Page,
    PageReq,
    apply_pagination,
    apply_sort,
    count_total,
)
from app.modules.ppm.common.data_scope import (
    can_operate_problem,
    is_super_admin,
    manager_project_ids,
    problem_operable,
    problem_scope_clause,
)
from app.modules.ppm.common.fsm import assert_transition
from app.modules.ppm.problem.fsm import (
    CHANGE_TRANSITIONS,
    NODE_NAMES,
    NODE_TO_ROLE,
    ProblemChangeStatus,
    ProblemNode,
    ProblemStatus,
    compute_change_next_node,
    is_change_audit_node,
)
from app.modules.ppm.problem.model import (
    PpmProblemChange,
    PpmProblemChangeProcessLog,
    PpmProblemChangeProcessTask,
    PpmProblemList,
    PpmProblemListProcessLog,
    PpmProblemListProcessTask,
)
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.ppm.task.model import TaskExecute

log = get_logger(__name__)


# TaskExecute 生命周期状态码 (镜像 ``app/modules/ppm/task/service.py`` STATUS_*，
# 问题清单 start/execute 复用同一张 ppm_task_execute 表，problem_task_id 关联)。
STATUS_DOING = "30"  # 处置中 (start 建的 in-flight 记录)
STATUS_END = "90"  # 已完成 (execute 收口)


# ===========================================================================
# 错误类型
# ===========================================================================


class ProblemError(AppError):
    """problem 子域通用业务错误。"""

    code = "PPM_PROBLEM_ERROR"
    http_status = 400


class ProblemNotFound(AppError):
    """problem 子域资源不存在 (404)。"""

    code = "HTTP_404_PPM_PROBLEM_NOT_FOUND"
    http_status = 404


class ProblemForbidden(AppError):
    """problem 子域无权操作 (403) — 编辑/删除越权(非创建人/非本项目经理/非责任人/非超管)。"""

    code = "HTTP_403_PPM_PROBLEM_FORBIDDEN"
    http_status = 403


class ProblemPendingAssignment(ProblemError):
    """流程挂起 —— 项目缺少该角色成员,待指派 (X-003 fallback)。

    流程已推进到下一节点但 ``now_handle_user`` 为空,前端需提示管理员
    补充项目角色成员或手动指派处理人。
    """

    code = "PPM_PROBLEM_PENDING_ASSIGNMENT"
    http_status = 200  # 非 4xx:业务上成功推进,只是缺人待指派


def _now() -> datetime:
    return datetime.now(UTC)


def _is_uuid_str(value: str) -> bool:
    """判断字符串是否为合法 UUID (audit_context.actor_id 需 UUID 或 None)。"""
    try:
        uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return True


def _safe_uuid(value: str | uuid.UUID | None) -> uuid.UUID | None:
    """字符串/UUID → uuid.UUID,失败返回 None。

    用于把外部传入的 actor_id / next_user_id (可能是逗号列表等脏值,
    migration 202607220900 已把这些残留降级为 NULL) 容错转成 ORM 的 UUID 字段。
    """
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return None


# ===========================================================================
# 通用 CRUD helper (字段差异大但形状一致,抽出复用)
# ===========================================================================


class _Crud[T]:
    """泛型 CRUD helper — 封装 create/get/list(paged)/update/delete。"""

    def __init__(self, session: AsyncSession, model: type[T]) -> None:
        self._session = session
        self._model = model

    async def get(self, item_id: uuid.UUID) -> T:
        obj = await self._session.get(self._model, item_id)
        if obj is None:
            raise ProblemNotFound(f"{self._model.__name__} '{item_id}' 不存在")
        return obj

    async def create(self, data: dict[str, Any]) -> T:
        obj = self._model(id=uuid.uuid4(), **data)
        obj = self._touch(obj)
        self._session.add(obj)
        await self._session.commit()
        await self._session.refresh(obj)
        return obj

    async def update(self, item_id: uuid.UUID, data: dict[str, Any]) -> T:
        obj = await self.get(item_id)
        for k, v in data.items():
            setattr(obj, k, v)
        obj = self._touch(obj)
        await self._session.commit()
        await self._session.refresh(obj)
        return obj

    async def delete(self, item_id: uuid.UUID) -> None:
        obj = await self.get(item_id)
        await self._session.delete(obj)
        await self._session.commit()

    async def list_paged(
        self,
        *,
        where_clauses: list[Any] | None = None,
        req: PageReq,
        allowed_sort: set[str],
    ) -> Page[T]:
        stmt: Select[Any] = select(self._model)
        for clause in where_clauses or []:
            stmt = stmt.where(clause)
        total = await count_total(self._session, stmt)
        stmt = apply_sort(
            stmt,
            self._model,
            req.order_by,
            allowed_sort,
            req.order,
        )
        stmt = apply_pagination(stmt, req)
        rows = (await self._session.execute(stmt)).scalars().all()
        return Page[Any].build(items=list(rows), total=total, req=req)

    def _touch(self, obj: T) -> T:
        """刷新 updated_at。"""
        if hasattr(obj, "updated_at"):
            obj.updated_at = _now()
        return obj


# ===========================================================================
# ProblemService
# ===========================================================================


class ProblemService:
    """problem 子域统一 service 入口 (问题清单 + 变更 + 4 节点审批流)。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------
    # 问题清单 CRUD
    # ------------------------------------------------------------------

    async def list_problems(
        self,
        req: PageReq,
        *,
        keyword: str | None = None,
        status_list: list[str] | None = None,
        project_id: uuid.UUID | None = None,
        pro_type: str | None = None,
        is_urgent: str | None = None,
        find_time_start: datetime | None = None,
        find_time_end: datetime | None = None,
        duty_user_id: uuid.UUID | None = None,
        user: User | None = None,
    ) -> Page[PpmProblemList]:
        """分页列表(支持服务端过滤)。3 态简化后 effective_status = status。

        过滤参数(全部可选,AND 组合):
        - keyword:模糊匹配 project_name/model_name/pro_desc/func_name/duty_user_name/find_by
        - status_list:status in (...)
        - project_id:精确匹配
        - pro_type:精确匹配 (bug/change/...)
        - is_urgent:精确匹配 ("1"/"0")
        - find_time_start/find_time_time:find_time 闭区间
        """
        clauses: list[Any] = []
        if keyword:
            kw = f"%{keyword}%"
            clauses.append(
                or_(
                    PpmProblemList.project_name.ilike(kw),
                    PpmProblemList.model_name.ilike(kw),
                    PpmProblemList.pro_desc.ilike(kw),
                    PpmProblemList.func_name.ilike(kw),
                    PpmProblemList.duty_user_name.ilike(kw),
                    PpmProblemList.find_by.ilike(kw),
                )
            )
        if status_list:
            clauses.append(PpmProblemList.status.in_(status_list))
        if project_id:
            clauses.append(PpmProblemList.project_id == project_id)
        if pro_type:
            clauses.append(PpmProblemList.pro_type == pro_type)
        if is_urgent:
            clauses.append(PpmProblemList.is_urgent == is_urgent)
        if find_time_start:
            clauses.append(PpmProblemList.find_time >= find_time_start)
        if find_time_end:
            clauses.append(PpmProblemList.find_time <= find_time_end)
        if duty_user_id:
            clauses.append(PpmProblemList.duty_user_id == duty_user_id)
        # 数据范围过滤 (2026-07-18-ppm-data-scope D-007):user 非空时按角色收敛可见问题
        if user is not None:
            scope = await problem_scope_clause(self._session, user)
            if scope is not None:
                clauses.append(scope)
        return await _Crud(self._session, PpmProblemList).list_paged(
            req=req,
            allowed_sort={"created_at", "find_time", "status"},
            where_clauses=clauses or None,
        )

    async def create_problem(
        self,
        data: dict[str, Any],
        *,
        created_by: uuid.UUID | None = None,
    ) -> PpmProblemList:
        """创建问题清单 (3 态简化，新建即「新建」态)。

        对齐任务计划：新建 = 「新建」态，由后续 ``start_problem`` 推进到「进行中」。
        不再有 submit/审批分支 (2026-07-20 简化)。

        ``created_by`` 写入创建人 (2026-07-20 权限改造),作为编辑/删除放行依据。
        """
        data.setdefault("status", ProblemStatus.NEW.value)
        if created_by is not None:
            data.setdefault("created_by", created_by)
        await self._backfill_names(data)
        return await _Crud(self._session, PpmProblemList).create(data)

    async def list_problems_by_date_range(
        self,
        start: datetime,
        end: datetime,
    ) -> list[PpmProblemList]:
        """按 find_time 区间过滤问题清单 (task-06 / FR-06)。

        - 反向区间 (start > end) 内部自动 swap,不报错
        - find_time 为空的问题不返回 (无发现时间,不纳入区间统计)
        - 按 find_time 倒序返回

        设计依据:tasks/task-06.md §实现要求 2 + §边界处理 1/2/7。
        """
        lo, hi = (start, end) if start <= end else (end, start)
        stmt = (
            select(PpmProblemList)
            .where(PpmProblemList.find_time.is_not(None))
            .where(PpmProblemList.find_time >= lo)
            .where(PpmProblemList.find_time <= hi)
            .order_by(PpmProblemList.find_time.desc())
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def get_problem(self, item_id: uuid.UUID) -> PpmProblemList:
        return await _Crud(self._session, PpmProblemList).get(item_id)

    async def update_problem(
        self, item_id: uuid.UUID, data: dict[str, Any], *, user: User
    ) -> PpmProblemList:
        obj = await self.get_problem(item_id)
        await self._assert_can_operate(obj, user)
        return await _Crud(self._session, PpmProblemList).update(item_id, data)

    async def delete_problem(self, item_id: uuid.UUID, *, user: User) -> None:
        obj = await self.get_problem(item_id)
        await self._assert_can_operate(obj, user)
        await _Crud(self._session, PpmProblemList).delete(item_id)

    async def _assert_can_operate(self, problem: PpmProblemList, user: User) -> None:
        """越权 → ProblemForbidden (403)。放行条件见 ``can_operate_problem``。"""
        if not await can_operate_problem(self._session, user, problem):
            raise ProblemForbidden(
                "无权操作该问题(仅创建人/本项目经理/责任人/超管可编辑删除)",
                details={"problem_id": str(problem.id)},
            )

    async def compute_can_operate(
        self, problems: list[PpmProblemList], user: User
    ) -> dict[uuid.UUID, bool]:
        """批量计算各问题的编辑/删除放行 (超管‖创建人‖本项目经理‖责任人)。

        供列表/详情响应填充 ``can_edit``/``can_delete``。批量:超管/经理项目集
        各查一次后逐条本地判断,避免逐条 await 的 N+1。
        """
        if not problems:
            return {}
        if await is_super_admin(self._session, user):
            return {p.id: True for p in problems}
        manager_pids = await manager_project_ids(self._session, user)
        return {p.id: problem_operable(p, user.id, manager_pids) for p in problems}

    # ------------------------------------------------------------------
    # 问题变更 CRUD
    # ------------------------------------------------------------------

    async def list_changes(
        self,
        req: PageReq,
        *,
        keyword: str | None = None,
        status_list: list[str] | None = None,
        created_at_start: datetime | None = None,
        created_at_end: datetime | None = None,
    ) -> Page[PpmProblemChange]:
        """分页列表(支持服务端过滤)。

        过滤参数(全部可选,AND 组合):
        - keyword:模糊匹配 project_name/model_name/pro_desc/change_reason
        - status_list:status in (...)
        - created_at_start/created_at_end:created_at 闭区间
        """
        clauses: list[Any] = []
        if keyword:
            kw = f"%{keyword}%"
            clauses.append(
                or_(
                    PpmProblemChange.project_name.ilike(kw),
                    PpmProblemChange.model_name.ilike(kw),
                    PpmProblemChange.pro_desc.ilike(kw),
                    PpmProblemChange.change_reason.ilike(kw),
                )
            )
        if status_list:
            clauses.append(PpmProblemChange.status.in_(status_list))
        if created_at_start:
            clauses.append(PpmProblemChange.created_at >= created_at_start)
        if created_at_end:
            clauses.append(PpmProblemChange.created_at <= created_at_end)
        return await _Crud(self._session, PpmProblemChange).list_paged(
            req=req,
            allowed_sort={"created_at", "status"},
            where_clauses=clauses or None,
        )

    async def create_change(self, data: dict[str, Any]) -> PpmProblemChange:
        data.setdefault("status", ProblemChangeStatus.AUDITING.value)
        await self._backfill_names(data)
        return await _Crud(self._session, PpmProblemChange).create(data)

    async def _backfill_names(self, data: dict[str, Any]) -> None:
        """创建/变更落库前补 project_name + duty_user_name（仅当为空时）。

        前端 PpmUserSelect 的 onChange 只回传 id 不回传 label，提交 payload
        的 project_name/duty_user_name 恒为 null，导致列表"项目"/"责任人"列
        回退显示 UUID。此处按 id 反查补全；历史 migrate 数据带 name 不受
        影响（仅空时补，不覆盖已传入值）。
        """
        if not data.get("project_name") and data.get("project_id"):
            proj_id = _safe_uuid(data["project_id"])
            if proj_id is not None:
                proj = await self._session.get(PpmProjectMaintenance, proj_id)
                if proj is not None:
                    data["project_name"] = proj.project_name
        if not data.get("duty_user_name") and data.get("duty_user_id"):
            duty_id = _safe_uuid(data["duty_user_id"])
            if duty_id is not None:
                user = await self._session.get(User, duty_id)
                if user is not None:
                    data["duty_user_name"] = user.display_name

    async def get_change(self, item_id: uuid.UUID) -> PpmProblemChange:
        return await _Crud(self._session, PpmProblemChange).get(item_id)

    async def update_change(self, item_id: uuid.UUID, data: dict[str, Any]) -> PpmProblemChange:
        return await _Crud(self._session, PpmProblemChange).update(item_id, data)

    async def delete_change(self, item_id: uuid.UUID) -> None:
        await _Crud(self._session, PpmProblemChange).delete(item_id)

    async def list_changes_by_resource(self, resource_id: str) -> list[PpmProblemChange]:
        """列出某问题清单的全部变更 (按创建时间)。"""
        stmt = (
            select(PpmProblemChange)
            .where(PpmProblemChange.resource_id == _safe_uuid(resource_id))
            .order_by(PpmProblemChange.created_at)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    # ------------------------------------------------------------------
    # 问题清单执行流 (3 态，对齐任务计划)
    # ------------------------------------------------------------------

    async def start_problem(
        self,
        problem_id: uuid.UUID,
        *,
        execute_user_id: uuid.UUID | None = None,
        actual_start_time: datetime | None = None,
    ) -> TaskExecute:
        """启动问题 (新建 → 进行中)：建一条 in-flight TaskExecute 并记录 actual_start_time。

        对齐 ``task/service.py`` start：多次执行每次「开始」产生一条独立
        TaskExecute (1 problem : N execute)，``actual_start_time`` 可选
        (前端跨天拆分补填时传指定日期，默认 now)。返回的 ``id`` 作为后续
        ``execute_problem`` 的 ``task_execute_id``。

        - 仅「新建」态可开始 (进行中已有 in-flight 记录，不可重复开始)
        - problem_task_id 关联 (与 plan_task_id 互斥，见 TaskExecute 模型)
        """
        problem = await self.get_problem(problem_id)
        if problem.status != ProblemStatus.NEW.value:
            raise ProblemError(
                f"仅「新建」状态可开始 (current={problem.status})",
                details={"problem_id": str(problem.id), "status": problem.status},
            )
        now = _now()
        start_time = actual_start_time or now
        exc = TaskExecute(
            id=uuid.uuid4(),
            problem_task_id=problem.id,
            execute_user_id=execute_user_id,
            actual_start_time=start_time,
            status=STATUS_DOING,
            current_user_id=execute_user_id,
        )
        self._session.add(exc)
        problem.status = ProblemStatus.DOING.value
        if problem.plan_start_time is None:
            problem.plan_start_time = start_time
        problem.updated_at = now
        await self._session.commit()
        await self._session.refresh(exc)
        await self._session.refresh(problem)
        log.info(
            "problem_started",
            problem_id=str(problem.id),
            task_execute_id=str(exc.id),
        )
        return exc

    async def execute_problem(
        self,
        problem_id: uuid.UUID,
        *,
        task_execute_id: uuid.UUID,
        action: str,
        execute_info: str | None = None,
        time_spent: float | None = None,
        actual_start_time: datetime | None = None,
        actual_end_time: datetime | None = None,
        execute_user_id: uuid.UUID | None = None,
    ) -> PpmProblemList:
        """执行问题：单事务收口 in-flight TaskExecute 并推进 3 态状态机。

        对齐 ``task/service.py`` execute_plan：
        - ``action="complete"`` → 收口 in-flight 记录 status=END + problem「已完成」(终态)
        - ``action="submit"`` → 收口 in-flight 记录 status=END + problem 回「新建」
          (可再次 start，支持重复执行)

        ``task_execute_id`` 必填 (start_problem 创建的 in-flight 记录)。
        跨天校验 (actual_start.date != actual_end.date → 422，前端拆逐天)。
        累加 problem.time_spent + 追加 problem.handle_info (源语义)。

        Returns:
            收口后的 :class:`PpmProblemList` (前端刷新问题新状态)。
        """
        problem = await self.get_problem(problem_id)
        if problem.status != ProblemStatus.DOING.value:
            raise ProblemError(
                f"仅「进行中」状态可执行 (current={problem.status})",
                details={"problem_id": str(problem.id), "status": problem.status},
            )
        now = _now()
        exc = await self._session.get(TaskExecute, task_execute_id)
        if exc is None:
            raise ProblemError(
                f"TaskExecute '{task_execute_id}' 不存在",
                details={"task_execute_id": str(task_execute_id)},
            )
        if exc.problem_task_id != problem.id:
            raise ProblemError(
                "task_execute_id 与 problem_id 不匹配",
                details={
                    "problem_id": str(problem.id),
                    "task_execute_id": str(task_execute_id),
                },
            )
        # 强制回填 actual_end_time (让新录入有 actual 区间，日历求和才能显示)
        exc.actual_end_time = actual_end_time or now

        # 跨天校验 (start 写 actual_start, execute 写 actual_end, 跨两次请求)
        if (
            exc.actual_start_time is not None
            and exc.actual_start_time.date() != exc.actual_end_time.date()
        ):
            raise ProblemError(
                "执行起止时间不可跨天，请拆成每天单独填报",
                details={
                    "actual_start_time": exc.actual_start_time.isoformat(),
                    "actual_end_time": exc.actual_end_time.isoformat(),
                },
            )

        # 同步执行信息
        if execute_info is not None:
            exc.execute_info = execute_info
        if time_spent is not None:
            exc.time_spent = time_spent
        if actual_start_time is not None:
            exc.actual_start_time = actual_start_time
        if execute_user_id is not None:
            exc.execute_user_id = execute_user_id
            exc.current_user_id = execute_user_id

        # 收口 in-flight 记录 (终态 END 不可重复收口)
        self._assert_execute_transition(exc.status)
        exc.status = STATUS_END
        exc.updated_at = now

        # action 分支：complete→已完成；submit→回新建 (支持再次 start 重复执行)
        if action == "complete":
            problem.status = ProblemStatus.CLOSED.value
            problem.real_end_time = exc.actual_end_time
            problem.now_handle_user = None
            problem.now_handle_user_name = None
        else:  # submit
            problem.status = ProblemStatus.NEW.value

        # 累加 time_spent + 追加 handle_info (源语义)
        if time_spent is not None:
            base = float(problem.time_spent or 0)
            problem.time_spent = base + time_spent
        if execute_info:
            stamp = now.strftime("%Y-%m-%d %H:%M:%S")
            prefix = f"【{stamp}】{execute_info}"
            problem.handle_info = (
                f"{prefix}\n{problem.handle_info}" if problem.handle_info else prefix
            )
        problem.updated_at = now

        await self._session.commit()
        await self._session.refresh(exc)
        await self._session.refresh(problem)
        log.info(
            "problem_executed",
            problem_id=str(problem.id),
            task_execute_id=str(exc.id),
            status=exc.status,
            action=action,
        )
        return problem

    @staticmethod
    def _assert_execute_transition(current: str) -> None:
        """校验 TaskExecute 状态迁移合法性 (终态 END 不可再迁移)。"""
        if current == STATUS_END:
            raise ProblemError(
                f"TaskExecute 已收口 (status={current})，不可重复执行",
                details={"current": current},
            )

    # ------------------------------------------------------------------
    # 流程查询
    # ------------------------------------------------------------------

    async def list_list_tasks(self, business_id: str) -> list[PpmProblemListProcessTask]:
        stmt = (
            select(PpmProblemListProcessTask)
            .where(PpmProblemListProcessTask.business_id == _safe_uuid(business_id))
            .order_by(PpmProblemListProcessTask.created_at)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def list_list_logs(self, business_id: str) -> list[PpmProblemListProcessLog]:
        stmt = (
            select(PpmProblemListProcessLog)
            .where(PpmProblemListProcessLog.business_id == _safe_uuid(business_id))
            .order_by(PpmProblemListProcessLog.created_at)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def list_change_logs(self, business_id: str) -> list[PpmProblemChangeProcessLog]:
        stmt = (
            select(PpmProblemChangeProcessLog)
            .where(PpmProblemChangeProcessLog.business_id == business_id)
            .order_by(PpmProblemChangeProcessLog.created_at)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def list_change_tasks(self, business_id: str) -> list[PpmProblemChangeProcessTask]:
        """变更流在办任务查询 (删旧插新模式下,通常 0 或 1 行)。"""
        stmt = (
            select(PpmProblemChangeProcessTask)
            .where(PpmProblemChangeProcessTask.business_id == business_id)
            .order_by(PpmProblemChangeProcessTask.created_at)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    # ------------------------------------------------------------------
    # 变更审批流:next_change / reject_change (对应源 ProChangeProcesssExecutor)
    # ------------------------------------------------------------------
    # 变更流与问题主流同构 (4 节点链 + bug 跳部门经理),但驱动的是
    # ``PpmProblemChange`` 而非 ``PpmProblemList``:
    # - 节点链:申请(10) → 开发经理(20) → 项目经理(30) → 部门经理(40) → 结束
    # - bug 在 30 直接结束 (跳过 40),复用 ``compute_change_next_node``
    # - 结束后 status=2 已完成 (ProblemChangeStatus.CLOSED),非问题流的处置中
    # - reject 仅审核节点 (20/30/40) 可驳回 → status=3 已作废

    async def next_change(
        self,
        change_id: uuid.UUID,
        *,
        actor_id: str,
        actor_name: str | None,
        comment: str | None = None,
    ) -> PpmProblemChange:
        """推进变更到下一节点。

        - 终态 (已完成 2 / 已作废 3) 再推进 → ProblemError (边界 5 幂等失败)
        - 下一节点为 None (结束):status=2 已完成,now_handle_user=验证人 (audit_user_id)
        - 下一节点对应角色查 ppm_project_member,缺失 → now_handle_user=None +
          抛 ProblemPendingAssignment (X-003 fallback,now_node 仍推进)
        - bug 类型在 Node30 直接结束,跳过部门经理 40

        每次推进:写 ChangeProcessLog + 删旧插新 ChangeProcessTask +
        注入 ``session.info["audit_context"]`` 触发 audit_hooks。
        """
        change = await self.get_change(change_id)
        # 终态保护:已完成 / 已作废不可再推进
        if change.status != ProblemChangeStatus.AUDITING.value:
            raise ProblemError(
                f"变更当前状态 {change.status} 不可推进 (仅审核中 1 可推进)",
                details={"change_id": str(change.id), "status": change.status},
            )
        current_node = change.now_node or ProblemNode.APPLY.value
        next_node = compute_change_next_node(current_node, change.pro_type)
        current_node_name = NODE_NAMES.get(current_node, str(current_node))

        # 注入审计上下文 (D-012:audit_hooks 自动写 audit_logs)
        self._session.info["audit_context"] = {
            "actor_id": uuid.UUID(actor_id) if _is_uuid_str(actor_id) else None,
            "workspace_id": None,
        }

        if next_node is None:
            # 结束节点 → 已完成 (2)
            assert_transition(
                ProblemChangeStatus(change.status),
                ProblemChangeStatus.CLOSED,
                CHANGE_TRANSITIONS,
                entity="problem_change",
                entity_id=change.id,
            )
            # now_handle_user 是 String 列,audit_user_id 已是 UUID,str() 化。
            next_handle_user = str(change.audit_user_id) if change.audit_user_id else None
            next_handle_user_name = change.audit_user_name
            next_node_name = "已完成"
            change.status = ProblemChangeStatus.CLOSED.value
            change.now_node = None
        else:
            # 审核节点 → 找该角色成员
            role = NODE_TO_ROLE.get(next_node)
            members = await self._find_role_members(change.project_id or "", role or "")
            next_handle_user = ",".join(str(m.user_id) for m in members) or None
            next_handle_user_name = ",".join(filter(None, (m.user_name for m in members))) or None
            next_node_name = NODE_NAMES.get(next_node, str(next_node))
            change.now_node = next_node

        change.now_handle_user = next_handle_user
        change.now_handle_user_name = next_handle_user_name
        change.updated_at = _now()
        await self._session.commit()
        await self._session.refresh(change)

        # ChangeProcessTask:删旧插新
        await self._replace_change_task(
            business_id=str(change.id),
            node_key=str(next_node) if next_node is not None else "end",
            node_name=next_node_name,
            handle_user=next_handle_user,
            handle_user_name=next_handle_user_name,
        )

        # ChangeProcessLog
        handle_info = self._build_handle_info(
            "next", actor_name, current_node_name, next_node_name, next_handle_user_name
        )
        await self._write_change_log(
            business_id=str(change.id),
            node_key=str(current_node),
            actor_id=actor_id,
            actor_name=actor_name,
            handle_info=handle_info,
            next_user_id=next_handle_user,
            next_user_name=next_handle_user_name,
            comment=comment,
        )

        log.info(
            "problem_change_next",
            change_id=str(change.id),
            from_node=current_node,
            to_node=next_node,
            status=change.status,
            actor=actor_id,
        )

        # 清理审计上下文,避免污染后续同会话操作
        self._session.info.pop("audit_context", None)

        # X-003 fallback:推进成功但缺处理人 → 标记待指派
        if next_node is not None and not next_handle_user:
            raise ProblemPendingAssignment(
                f"项目缺少「{NODE_TO_ROLE.get(next_node, '')}」,变更流程已推进到"
                f"{next_node_name}节点,待指派处理人",
                details={
                    "change_id": str(change.id),
                    "pending_node": next_node,
                    "pending_role": NODE_TO_ROLE.get(next_node),
                },
            )
        return change

    async def reject_change(
        self,
        change_id: uuid.UUID,
        *,
        actor_id: str,
        actor_name: str | None,
        comment: str | None = None,
    ) -> PpmProblemChange:
        """驳回变更 → status=3 已作废。

        仅审核节点 (20/30/40) 可驳回;申请节点 (10) reject 抛 ProblemError。
        驳回后清空所有在办 ChangeProcessTask。
        """
        change = await self.get_change(change_id)
        current_node = change.now_node or ProblemNode.APPLY.value
        if not is_change_audit_node(current_node):
            raise ProblemError(
                f"当前节点 {current_node} 不可驳回 (仅审核节点 20/30/40 可驳回)",
                details={"change_id": str(change.id), "current_node": current_node},
            )
        assert_transition(
            ProblemChangeStatus(change.status),
            ProblemChangeStatus.BACK,
            CHANGE_TRANSITIONS,
            entity="problem_change",
            entity_id=change.id,
        )

        # 注入审计上下文 (D-012)
        self._session.info["audit_context"] = {
            "actor_id": uuid.UUID(actor_id) if _is_uuid_str(actor_id) else None,
            "workspace_id": None,
        }

        current_node_name = NODE_NAMES.get(current_node, str(current_node))
        change.status = ProblemChangeStatus.BACK.value
        change.now_node = None
        change.now_handle_user = None
        change.now_handle_user_name = None
        change.updated_at = _now()
        await self._session.commit()
        await self._session.refresh(change)

        # 清空所有在办任务 (驳回无下一步任务)
        await self._session.execute(
            delete(PpmProblemChangeProcessTask).where(
                PpmProblemChangeProcessTask.business_id == str(change.id)
            )
        )
        await self._session.commit()

        handle_info = self._build_handle_info("reject", actor_name, current_node_name, None, None)
        await self._write_change_log(
            business_id=str(change.id),
            node_key=str(current_node),
            actor_id=actor_id,
            actor_name=actor_name,
            handle_info=handle_info,
            next_user_id=None,
            next_user_name=None,
            comment=comment,
        )

        self._session.info.pop("audit_context", None)
        log.info(
            "problem_change_reject",
            change_id=str(change.id),
            from_node=current_node,
            actor=actor_id,
        )
        return change

    # ------------------------------------------------------------------
    # 导出
    # ------------------------------------------------------------------

    async def list_problems_for_export(self, *, user: User | None = None) -> list[dict[str, Any]]:
        """返回问题清单全量行 (dict),供 Excel 导出。

        ``user`` 非空时按角色注入数据范围过滤(防导出绕过,D-007)。
        """
        stmt = select(PpmProblemList)
        if user is not None:
            scope = await problem_scope_clause(self._session, user)
            if scope is not None:
                stmt = stmt.where(scope)
        rows = (await self._session.execute(stmt)).scalars().all()
        return [
            {
                "project_name": r.project_name,
                "pro_desc": r.pro_desc,
                "pro_type": r.pro_type,
                "status": r.status,
                "duty_user_name": r.duty_user_name,
                "find_time": r.find_time.isoformat() if r.find_time else None,
            }
            for r in rows
        ]

    async def list_changes_for_export(self) -> list[dict[str, Any]]:
        """返回问题变更全量行 (dict),供 Excel 导出 (P2-3)。

        对照源 problemchange 导出列:项目名 / 变更内容 / 变更原因 /
        责任人 / 当前处理人 / 状态。
        """
        rows = (await self._session.execute(select(PpmProblemChange))).scalars().all()
        return [
            {
                "project_name": r.project_name,
                "pro_desc": r.pro_desc,
                "change_reason": r.change_reason,
                "duty_user_name": r.duty_user_name,
                "now_handle_user_name": r.now_handle_user_name,
                "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]

    # ==================================================================
    # 内部 helper
    # ==================================================================

    async def _find_role_members(self, project_id: str, role: str) -> list[PpmProjectMember]:
        """按项目 + 角色查 ppm_project_member (D-004@v1 角色字符串)。

        ``project_id`` 是 problem_list.project_id 字符串 (运行时由前端绑定为
        ppm_project_maintenance.id 的 UUID 字符串);``pm_project_id`` 是 UUID
        列。SQLite/Postgres 对 UUID 字符串比较宽容,此处按字符串相等过滤。
        """
        if not role or not project_id:
            return []
        stmt = select(PpmProjectMember).where(
            PpmProjectMember.role_name == role,
        )
        all_members = list((await self._session.execute(stmt)).scalars().all())
        # 按 project_id 字符串相等过滤 (pm_project_id UUID vs project_id 入参)
        # project_id 可能是 str 或 uuid.UUID (model 字段已 ALTER 为 UUID),
        # 统一 str() 后比较。
        pid_str = str(project_id)
        return [m for m in all_members if str(m.pm_project_id) == pid_str]

    async def _replace_change_task(
        self,
        *,
        business_id: str,
        node_key: str,
        node_name: str,
        handle_user: str | None,
        handle_user_name: str | None,
    ) -> None:
        """变更流:删旧在办任务 + 插新在办任务 (原子)。"""
        await self._session.execute(
            delete(PpmProblemChangeProcessTask).where(
                PpmProblemChangeProcessTask.business_id == business_id
            )
        )
        task = PpmProblemChangeProcessTask(
            id=uuid.uuid4(),
            business_id=business_id,
            node_key=node_key,
            node_name=node_name,
            now_handle_user=handle_user,
            now_handle_user_name=handle_user_name,
            created_at=_now(),
            updated_at=_now(),
        )
        self._session.add(task)
        await self._session.commit()

    async def _write_change_log(
        self,
        *,
        business_id: str,
        node_key: str,
        actor_id: str,
        actor_name: str | None,
        handle_info: str | None,
        next_user_id: str | None,
        next_user_name: str | None,
        comment: str | None = None,
    ) -> PpmProblemChangeProcessLog:
        proc = PpmProblemChangeProcessLog(
            id=uuid.uuid4(),
            business_id=business_id,
            node_key=node_key,
            handle_user_id=_safe_uuid(actor_id),
            handle_user_name=actor_name,
            handle_date=_now(),
            handle_info=handle_info,
            next_user_id=_safe_uuid(next_user_id) if next_user_id else None,
            next_user_name=next_user_name,
            comment=comment,
            created_at=_now(),
        )
        self._session.add(proc)
        await self._session.commit()
        await self._session.refresh(proc)
        return proc

    @staticmethod
    def _build_handle_info(
        kind: str,
        actor_name: str | None,
        current_node_name: str,
        next_node_name: str | None,
        next_user_name: str | None,
    ) -> str:
        """构造 handle_info 文案 (对照源 makeHandleInfo 简化)。"""
        actor = actor_name or "系统"
        if kind == "submit":
            if next_user_name:
                return f"{actor} 提交问题,直接生效进入处置;由:{next_user_name}负责处置。"
            return f"{actor} 提交问题,直接生效进入处置 (待指派责任人)。"
        if kind == "next":
            if next_node_name and next_user_name:
                return f"{actor} 处理「{current_node_name}」;下一步由:{next_user_name}进行「{next_node_name}」。"
            if next_node_name:
                return f"{actor} 处理「{current_node_name}」;流程推进到「{next_node_name}」(待指派处理人)。"
            return f"{actor} 处理「{current_node_name}」;流程结束,进入处置。"
        if kind == "reject":
            return f"{actor} 在「{current_node_name}」节点驳回了问题。"
        return f"{actor} 处理「{current_node_name}」。"


__all__ = [
    "ProblemError",
    "ProblemForbidden",
    "ProblemNotFound",
    "ProblemPendingAssignment",
    "ProblemService",
]
