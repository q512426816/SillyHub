"""problem 子域 service。

职责:
- 问题清单 CRUD (PpmProblemList)
- 问题变更 CRUD (PpmProblemChange)
- 4 节点审批流驱动:
  - ``next_process``  : 推进到下一节点 (按当前 now_node + 项目角色查
    ppm_project_member 找下一处理人;bug 跳过部门经理 40)
  - ``reject_process`` : 驳回 → status=5 已作废
  - ``done_task``     : 责任人完成处置 (completed=true → 6 待验证)
  - ``close_task``    : 验证人验证 (check_result=1 → 4 已关闭 / 否则打回责任人)
- 每次流转同事务:写 ProcessLog + 删旧 ProcessTask/插新 ProcessTask
  + audit_log (BaseModel 自动审计,额外 log)
- 找下一处理人缺失 fallback (X-003):项目无该角色成员 → 流程挂起 +
  返回待指派提示 (不崩溃)
- 列表 page:有未关闭变更时内存态标记 status=7 变更中

平台级,无 workspace 过滤 (D-001@v1)。

设计依据:``tasks/task-05.md`` + ``design.md`` §8 + 源
``ProblemNode10-40`` / ``ProblemProcesssExecutor`` / ``ProblemListServiceImpl``。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.ppm.common.crud import (
    Page,
    PageReq,
    apply_pagination,
    apply_sort,
    count_total,
)
from app.modules.ppm.common.fsm import assert_transition
from app.modules.ppm.problem.fsm import (
    CHANGE_TRANSITIONS,
    NODE_NAMES,
    NODE_TO_ROLE,
    TRANSITIONS,
    ProblemChangeStatus,
    ProblemNode,
    ProblemStatus,
    compute_change_next_node,
    compute_next_node,
    is_audit_node,
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
from app.modules.ppm.project.model import PpmProjectMember

log = get_logger(__name__)


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
            if v is not None:
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
    ) -> Page[PpmProblemList]:
        """分页列表(支持服务端过滤)。有未关闭变更的行内存态标记 status=7 变更中。

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
        page = await _Crud(self._session, PpmProblemList).list_paged(
            req=req,
            allowed_sort={"created_at", "find_time", "status"},
            where_clauses=clauses or None,
        )
        # 变更中标记 (内存态):查所有有未关闭变更的 resource_id 集合,
        # 命中的行用 object.__setattr__ 设置 _effective_status="7" (非持久化,
        # 不污染 status 持久化字段,通过 effective_status property 暴露)。
        changing_ids = await self._changing_resource_ids()
        for item in page.items:
            if str(item.id) in changing_ids:
                object.__setattr__(item, "_effective_status", ProblemStatus.CHANGING.value)
        return page

    async def create_problem(self, data: dict[str, Any]) -> PpmProblemList:
        """创建问题清单。

        ``submit=true`` 时立即推进到 Node20 审核中 (源 processNext 语义);
        否则 status=1 已保存。submit 推进会触发找开发经理 fallback。
        """
        submit = bool(data.pop("submit", False))
        data.setdefault("status", ProblemStatus.SAVED.value)
        data.setdefault("now_node", ProblemNode.APPLY.value)
        obj = await _Crud(self._session, PpmProblemList).create(data)
        if submit:
            obj = await self.next_process(
                obj.id, actor_id=str(obj.created_by or "system"), actor_name=None
            )
        return obj

    async def list_problems_by_date_range(
        self,
        start: datetime,
        end: datetime,
    ) -> list[PpmProblemList]:
        """按 find_time 区间过滤问题清单 (task-06 / FR-06)。

        - 反向区间 (start > end) 内部自动 swap,不报错
        - find_time 为空的问题不返回 (无发现时间,不纳入区间统计)
        - 按 find_time 倒序返回
        - 有未关闭变更的行内存态标记 effective_status=7 变更中 (同 list_problems)

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
        items = list((await self._session.execute(stmt)).scalars().all())
        # 变更中标记 (内存态):与 list_problems 一致
        changing_ids = await self._changing_resource_ids()
        for item in items:
            if str(item.id) in changing_ids:
                object.__setattr__(item, "_effective_status", ProblemStatus.CHANGING.value)
        return items

    async def get_problem(self, item_id: uuid.UUID) -> PpmProblemList:
        return await _Crud(self._session, PpmProblemList).get(item_id)

    async def update_problem(self, item_id: uuid.UUID, data: dict[str, Any]) -> PpmProblemList:
        return await _Crud(self._session, PpmProblemList).update(item_id, data)

    async def delete_problem(self, item_id: uuid.UUID) -> None:
        await _Crud(self._session, PpmProblemList).delete(item_id)

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
        return await _Crud(self._session, PpmProblemChange).create(data)

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
    # 审批流:next / reject / done / close
    # ------------------------------------------------------------------

    async def next_process(
        self,
        item_id: uuid.UUID,
        *,
        actor_id: str,
        actor_name: str | None,
        comment: str | None = None,
    ) -> PpmProblemList:
        """推进到下一节点 (申请→开发经理→项目经理→[非bug部门经理]→结束)。

        - 当前 Node10/20/30/40 各自定义下一节点 (bug 在 30 直接结束)
        - 下一节点对应角色查 ppm_project_member 找处理人
        - 找不到处理人 (X-003):流程仍推进到下一节点 (now_node 更新),
          但 now_handle_user 置空,标记挂起待指派,返回 ProblemPendingAssignment
          提示 (不抛 4xx,业务上算成功推进)
        - 下一节点为 None (结束):status=3 处置中,now_handle_user=责任人

        每次推进:写 ProcessLog + 删旧 ProcessTask + 插新 ProcessTask。
        """
        problem = await self.get_problem(item_id)
        current_node = problem.now_node or ProblemNode.APPLY.value
        next_node = compute_next_node(current_node, problem.pro_type)
        current_node_name = NODE_NAMES.get(current_node, str(current_node))

        if next_node is None:
            # 结束节点 → 处置中,流转给责任人
            assert_transition(
                ProblemStatus(problem.status),
                ProblemStatus.DOING,
                TRANSITIONS,
                entity="problem_list",
                entity_id=problem.id,
            )
            # now_handle_user 字段是 String (逗号列表),duty_user_id 已是 UUID,
            # 赋值前 str() 化以匹配 String 列的 bind processor。
            next_handle_user = str(problem.duty_user_id) if problem.duty_user_id else None
            next_handle_user_name = problem.duty_user_name
            next_node_name = "处置"
            problem.status = ProblemStatus.DOING.value
            problem.now_node = None  # 审批结束
        else:
            # 审核节点 → 找该角色成员。
            # 注意:审核节点之间 (10→20→30→40) status 保持 AUDITING (2→2 是
            # 保持而非迁移),只在首次 1→2 进入审核时校验迁移合法性;后续审核
            # 节点推进 status 不变,仅 now_node 变化,不重复 assert。
            if problem.status == ProblemStatus.SAVED.value:
                assert_transition(
                    ProblemStatus(problem.status),
                    ProblemStatus.AUDITING,
                    TRANSITIONS,
                    entity="problem_list",
                    entity_id=problem.id,
                )
            elif problem.status != ProblemStatus.AUDITING.value:
                # 非已保存/审核中状态不可推进审批流
                raise ProblemError(
                    f"当前状态 {problem.status} 不可推进审批流",
                    details={"problem_id": str(problem.id), "status": problem.status},
                )
            role = NODE_TO_ROLE.get(next_node)
            members = await self._find_role_members(problem.project_id, role or "")
            next_handle_user = ",".join(str(m.user_id) for m in members) or None
            next_handle_user_name = ",".join(filter(None, (m.user_name for m in members))) or None
            next_node_name = NODE_NAMES.get(next_node, str(next_node))
            problem.status = ProblemStatus.AUDITING.value
            problem.now_node = next_node

        problem.now_handle_user = next_handle_user
        problem.now_handle_user_name = next_handle_user_name
        problem.updated_at = _now()
        await self._session.commit()
        await self._session.refresh(problem)

        # ProcessTask:删旧插新
        await self._replace_list_task(
            business_id=problem.id,
            node_key=str(next_node) if next_node is not None else "end",
            node_name=next_node_name,
            handle_user=next_handle_user,
            handle_user_name=next_handle_user_name,
        )

        # ProcessLog
        handle_info = self._build_handle_info(
            "next", actor_name, current_node_name, next_node_name, next_handle_user_name
        )
        await self._write_list_log(
            business_id=problem.id,
            node_key=str(current_node),
            actor_id=actor_id,
            actor_name=actor_name,
            handle_info=handle_info,
            next_user_id=next_handle_user,
            next_user_name=next_handle_user_name,
            comment=comment,
        )

        log.info(
            "problem_next_process",
            problem_id=str(problem.id),
            from_node=current_node,
            to_node=next_node,
            status=problem.status,
            actor=actor_id,
        )

        # X-003 fallback:推进成功但缺处理人 → 标记待指派
        if next_node is not None and not next_handle_user:
            raise ProblemPendingAssignment(
                f"项目缺少「{NODE_TO_ROLE.get(next_node, '')}」,流程已推进到"
                f"{next_node_name}节点,待指派处理人",
                details={
                    "problem_id": str(problem.id),
                    "pending_node": next_node,
                    "pending_role": NODE_TO_ROLE.get(next_node),
                },
            )
        return problem

    async def reject_process(
        self,
        item_id: uuid.UUID,
        *,
        actor_id: str,
        actor_name: str | None,
        comment: str | None = None,
    ) -> PpmProblemList:
        """驳回 → status=5 已作废。

        仅审核节点 (20/30/40) 可驳回。源 reject 会回退到 STATUS_SAVE,
        但 task-05.md 验收明确 reject→5 已作废,遵循 task 规范。
        """
        problem = await self.get_problem(item_id)
        current_node = problem.now_node or ProblemNode.APPLY.value
        if not is_audit_node(current_node):
            raise ProblemError(
                f"当前节点 {current_node} 不可驳回 (仅审核节点 20/30/40 可驳回)",
                details={"problem_id": str(problem.id), "current_node": current_node},
            )
        assert_transition(
            ProblemStatus(problem.status),
            ProblemStatus.BACK,
            TRANSITIONS,
            entity="problem_list",
            entity_id=problem.id,
        )
        current_node_name = NODE_NAMES.get(current_node, str(current_node))
        problem.status = ProblemStatus.BACK.value
        problem.now_node = None
        problem.now_handle_user = None
        problem.now_handle_user_name = None
        problem.updated_at = _now()
        await self._session.commit()
        await self._session.refresh(problem)

        # 删所有在办任务 (驳回无下一步任务)
        await self._session.execute(
            delete(PpmProblemListProcessTask).where(
                PpmProblemListProcessTask.business_id == problem.id
            )
        )
        await self._session.commit()

        handle_info = self._build_handle_info("reject", actor_name, current_node_name, None, None)
        await self._write_list_log(
            business_id=problem.id,
            node_key=str(current_node),
            actor_id=actor_id,
            actor_name=actor_name,
            handle_info=handle_info,
            next_user_id=None,
            next_user_name=None,
            comment=comment,
        )
        log.info(
            "problem_reject_process",
            problem_id=str(problem.id),
            from_node=current_node,
            actor=actor_id,
        )
        return problem

    async def done_task(
        self,
        item_id: uuid.UUID,
        *,
        actor_id: str,
        actor_name: str | None,
        handle_info: str | None = None,
        time_spent: float | None = None,
        completed: bool = True,
    ) -> PpmProblemList:
        """责任人完成处置。

        - ``completed=true``:status=3→6 待验证,real_end_time=now,
          now_handle_user 切换到验证人 (audit_user_id,需前端预设;否则置空)
        - ``completed=false``:仅追加 handle_info,仍 status=3 处置中
        - 累加 time_spent (源语义)
        """
        problem = await self.get_problem(item_id)
        if completed:
            assert_transition(
                ProblemStatus(problem.status),
                ProblemStatus.WAIT_CHECK,
                TRANSITIONS,
                entity="problem_list",
                entity_id=problem.id,
            )
            problem.status = ProblemStatus.WAIT_CHECK.value
            problem.real_end_time = _now()
            # 待验证处理人 = 验证人 (audit_user_id);未预设则置空 (待指派)
            # now_handle_user 是 String 列,audit_user_id 是 UUID,str() 化。
            problem.now_handle_user = str(problem.audit_user_id) if problem.audit_user_id else None
            problem.now_handle_user_name = problem.audit_user_name
            target_node_name = "待验证"
        else:
            target_node_name = "处置中"
            if problem.status != ProblemStatus.DOING.value:
                raise ProblemError(
                    "非处置中状态不可追加处置情况",
                    details={"problem_id": str(problem.id), "status": problem.status},
                )

        # 追加处置情况 (源在 handle_info 前缀时间戳)
        if handle_info:
            stamp = _now().strftime("%Y-%m-%d %H:%M:%S")
            prefix = f"【{stamp}】{handle_info}"
            problem.handle_info = (
                f"{prefix}\n{problem.handle_info}" if problem.handle_info else prefix
            )
        # 累加 time_spent
        if time_spent is not None:
            base = float(problem.time_spent or 0)
            problem.time_spent = base + time_spent
        problem.updated_at = _now()
        await self._session.commit()
        await self._session.refresh(problem)

        # ProcessTask 更新
        node_key = "wait_check" if completed else "doing"
        await self._replace_list_task(
            business_id=problem.id,
            node_key=node_key,
            node_name=target_node_name,
            handle_user=problem.now_handle_user,
            handle_user_name=problem.now_handle_user_name,
        )

        await self._write_list_log(
            business_id=problem.id,
            node_key=node_key,
            actor_id=actor_id,
            actor_name=actor_name,
            handle_info=problem.handle_info,
            next_user_id=problem.now_handle_user,
            next_user_name=problem.now_handle_user_name,
            comment=handle_info,
        )
        log.info(
            "problem_done_task",
            problem_id=str(problem.id),
            completed=completed,
            actor=actor_id,
        )
        return problem

    async def close_task(
        self,
        item_id: uuid.UUID,
        *,
        actor_id: str,
        actor_name: str | None,
        check_info: str | None = None,
        check_result: str = "1",
    ) -> PpmProblemList:
        """验证人验证关闭。

        - ``check_result == "1"``:通过 → status=6→4 已关闭,
          now_handle_user 清空,audit_time/check_time/check_info 落库
        - 否则:打回 → status=6→3 处置中,now_handle_user 切回责任人
        """
        problem = await self.get_problem(item_id)
        target = ProblemStatus.CLOSED if check_result == "1" else ProblemStatus.DOING
        assert_transition(
            ProblemStatus(problem.status),
            target,
            TRANSITIONS,
            entity="problem_list",
            entity_id=problem.id,
        )
        now = _now()
        problem.status = target.value
        problem.check_result = check_result
        problem.check_info = check_info
        problem.check_time = now
        problem.audit_time = now
        problem.audit_user_id = actor_id
        problem.audit_user_name = actor_name
        if target is ProblemStatus.CLOSED:
            problem.now_handle_user = None
            problem.now_handle_user_name = None
            node_key = "closed"
            node_name = "已关闭"
        else:
            # 打回责任人
            problem.now_handle_user = str(problem.duty_user_id) if problem.duty_user_id else None
            problem.now_handle_user_name = problem.duty_user_name
            node_key = "doing"
            node_name = "处置中"
        problem.updated_at = now
        await self._session.commit()
        await self._session.refresh(problem)

        await self._replace_list_task(
            business_id=problem.id,
            node_key=node_key,
            node_name=node_name,
            handle_user=problem.now_handle_user,
            handle_user_name=problem.now_handle_user_name,
        )
        await self._write_list_log(
            business_id=problem.id,
            node_key=node_key,
            actor_id=actor_id,
            actor_name=actor_name,
            handle_info=check_info,
            next_user_id=problem.now_handle_user,
            next_user_name=problem.now_handle_user_name,
            comment=check_info,
        )
        log.info(
            "problem_close_task",
            problem_id=str(problem.id),
            check_result=check_result,
            status=problem.status,
            actor=actor_id,
        )
        return problem

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

    async def list_problems_for_export(self) -> list[dict[str, Any]]:
        """返回问题清单全量行 (dict),供 Excel 导出。"""
        rows = (await self._session.execute(select(PpmProblemList))).scalars().all()
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

    async def _changing_resource_ids(self) -> set[str]:
        """有未关闭变更 (status != 2) 的 problem_list.id 集合 (字符串化)。"""
        stmt = select(PpmProblemChange.resource_id).where(
            PpmProblemChange.status != ProblemChangeStatus.CLOSED.value
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        return {str(r) for r in rows}

    async def _replace_list_task(
        self,
        *,
        business_id: uuid.UUID,
        node_key: str,
        node_name: str,
        handle_user: str | None,
        handle_user_name: str | None,
    ) -> None:
        """删旧在办任务 + 插新在办任务 (原子)。"""
        await self._session.execute(
            delete(PpmProblemListProcessTask).where(
                PpmProblemListProcessTask.business_id == business_id
            )
        )
        task = PpmProblemListProcessTask(
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

    async def _write_list_log(
        self,
        *,
        business_id: uuid.UUID,
        node_key: str,
        actor_id: str,
        actor_name: str | None,
        handle_info: str | None,
        next_user_id: str | None,
        next_user_name: str | None,
        comment: str | None = None,
    ) -> PpmProblemListProcessLog:
        proc = PpmProblemListProcessLog(
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
    "ProblemNotFound",
    "ProblemPendingAssignment",
    "ProblemService",
]
