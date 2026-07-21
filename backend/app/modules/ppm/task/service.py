"""task 子域 service —— CRUD + executePlan 联动 + 工时统计。

设计依据:``design.md`` §7 (task 子域) + 源 ``TaskPlanServiceImpl.executePlan``。
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
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
from app.modules.ppm.common.data_scope import task_scope_clause
from app.modules.ppm.plan.model import PlanNodeModule
from app.modules.ppm.task.model import PlanTask, TaskExecute, WorkHour
from app.modules.ppm.task.schema import (
    ExecutePlanReq,
    PlanTaskCreate,
    PlanTaskPageReq,
    PlanTaskUpdate,
    TaskExecuteCreate,
    TaskExecutePageReq,
    TaskExecuteUpdate,
    WorkHourCreate,
    WorkHourPageReq,
    WorkHourUpdate,
)

log = get_logger(__name__)


# 任务执行状态机常量 (对齐源 TaskExecuteDO.STATUS_*)
STATUS_NOT_SUBMIT = "10"  # 未提交
STATUS_WAITING_DISPOSE = "20"  # 待处置
STATUS_DOING = "30"  # 处置中
STATUS_CHECKING = "40"  # 待验证
STATUS_END = "90"  # 已完成

# 状态合法集合 (统计/校验用)
VALID_EXECUTE_STATUS = frozenset(
    {STATUS_NOT_SUBMIT, STATUS_WAITING_DISPOSE, STATUS_DOING, STATUS_CHECKING, STATUS_END}
)

# 计划排序白名单 (apply_sort 防注入)
PLAN_SORT_FIELDS = frozenset(
    {"created_at", "updated_at", "start_time", "end_time", "kanban_order", "no"}
)
EXECUTE_SORT_FIELDS = frozenset({"created_at", "updated_at", "actual_start_time"})
WORKHOUR_SORT_FIELDS = frozenset({"created_at", "updated_at", "work_date", "hours"})


def _parse_uuid_optional(value: str | uuid.UUID | None) -> uuid.UUID | None:
    """把查询参数容错规整为 UUID。

    前端可能传占位符(如 "-"、"")或非法字符串,这里 try-parse:
    能解析则返回 UUID,否则返回 None(等价于不过滤),避免 422 / SQLAlchemy 异常。
    """
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


class TaskError(AppError):
    """task 子域业务错误基类。"""

    code = "PPM_TASK_ERROR"
    http_status = 400


class PlanTaskNotFound(TaskError):
    code = "PPM_PLAN_TASK_NOT_FOUND"
    http_status = 404


class TaskExecuteNotFound(TaskError):
    code = "PPM_TASK_EXECUTE_NOT_FOUND"
    http_status = 404


class WorkHourNotFound(TaskError):
    code = "PPM_WORK_HOUR_NOT_FOUND"
    http_status = 404


class IllegalStatusTransition(TaskError):
    code = "PPM_TASK_ILLEGAL_STATUS"
    http_status = 400


def _page_req_from(page: int, page_size: int, order_by: str | None, order: str) -> PageReq:
    """从查询参数构造 :class:`PageReq`。"""
    return PageReq(page=page, page_size=page_size, order_by=order_by, order=order)


class PlanTaskService:
    """任务计划 CRUD + executePlan 联动。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    async def create(self, data: PlanTaskCreate) -> PlanTask:
        """创建任务计划。"""
        plan = PlanTask(**data.model_dump())
        self._session.add(plan)
        await self._session.commit()
        await self._session.refresh(plan)
        log.info("plan_task_created", plan_task_id=str(plan.id), user_id=str(plan.user_id))
        return plan

    async def get(self, plan_id: uuid.UUID) -> PlanTask:
        """按 ID 取单条;不存在抛 :class:`PlanTaskNotFound`。"""
        plan = await self._session.get(PlanTask, plan_id)
        if plan is None:
            raise PlanTaskNotFound(f"PlanTask '{plan_id}' not found.")
        return plan

    async def update(self, plan_id: uuid.UUID, data: PlanTaskUpdate) -> PlanTask:
        """部分更新（直接 setattr；未传字段由路由 exclude_unset 过滤，null 表示清空）。"""
        plan = await self.get(plan_id)
        payload = data.model_dump(exclude_unset=True)
        for key, value in payload.items():
            setattr(plan, key, value)
        plan.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(plan)
        return plan

    async def delete(self, plan_id: uuid.UUID) -> None:
        """删除计划 (顺带清理关联 TaskExecute)。"""
        plan = await self.get(plan_id)
        # 联动删除执行记录
        execs = await self._session.execute(
            select(TaskExecute).where(TaskExecute.plan_task_id == plan_id)
        )
        for exc in execs.scalars().all():
            await self._session.delete(exc)
        await self._session.delete(plan)
        await self._session.commit()
        log.info("plan_task_deleted", plan_task_id=str(plan_id))

    async def page(self, req: PlanTaskPageReq, *, user: User | None = None) -> Page[PlanTask]:
        """分页查询 (支持 user/project/status多值/month/year/起止区间/work_partner 过滤)。

        ``user`` 非空时按角色注入数据范围过滤(超管全部/经理相关项目/其余自己负责,
        见 :mod:`app.modules.ppm.common.data_scope`)。
        """
        page_req = _page_req_from(req.page, req.page_size, req.order_by, req.order)
        stmt = select(PlanTask)
        user_id = _parse_uuid_optional(req.user_id)
        project_id = _parse_uuid_optional(req.project_id)
        module_id = _parse_uuid_optional(req.module_id)
        if user_id is not None:
            stmt = stmt.where(PlanTask.user_id == user_id)
        if project_id is not None:
            stmt = stmt.where(PlanTask.project_id == project_id)
        if module_id is not None:
            stmt = stmt.where(PlanTask.module_id == module_id)
        if req.status:
            stmt = stmt.where(PlanTask.status.in_(req.status))
        if req.month is not None:
            stmt = stmt.where(PlanTask.month == req.month)
        if req.year is not None:
            stmt = stmt.where(PlanTask.year == req.year)
        if req.start_time is not None:
            stmt = stmt.where(PlanTask.start_time >= req.start_time)
        if req.end_time is not None:
            stmt = stmt.where(PlanTask.start_time <= req.end_time)
        if req.work_partner:
            stmt = stmt.where(PlanTask.work_partner.ilike(f"%{req.work_partner}%"))
        # 数据范围过滤 (2026-07-18-ppm-data-scope D-007):user 非空时按角色收敛可见任务
        if user is not None:
            scope = await task_scope_clause(self._session, user)
            if scope is not None:
                stmt = stmt.where(scope)
        stmt = apply_sort(stmt, PlanTask, req.order_by, PLAN_SORT_FIELDS, req.order)
        total = await count_total(self._session, stmt)
        stmt = apply_pagination(stmt, page_req)
        result = await self._session.execute(stmt)
        items = list(result.scalars().all())
        await self._enrich_module_name(items)
        return Page[PlanTask].build(items=items, total=total, req=page_req)

    async def _enrich_module_name(self, items: list[PlanTask]) -> None:
        """补 module_name:``ppm_plan_task.module_name`` 冗余字段历史从未填
        (迁移脚本/各创建入口均不写),但 ``module_id`` 多数有值。按 module_id
        批量反查 ``ppm_plan_node_module.module_name`` 内存补值,**仅展示不入库**——
        补值前 expunge 脱离 session,杜绝被后续 flush 误写。
        """
        needs = [t for t in items if t.module_id is not None and not t.module_name]
        if not needs:
            return
        for t in needs:
            self._session.expunge(t)
        mod_ids = {t.module_id for t in needs}
        rows = await self._session.execute(
            select(PlanNodeModule.id, PlanNodeModule.module_name).where(
                PlanNodeModule.id.in_(mod_ids)
            )
        )
        name_map = {row.id: row.module_name for row in rows.all()}
        for t in needs:
            name = name_map.get(t.module_id)
            if name:
                t.module_name = name

    async def list_by_user_and_date_range(
        self,
        user_id: uuid.UUID,
        start: datetime,
        end: datetime,
    ) -> list[PlanTask]:
        """按用户 + 时间区间查询 (start_time/end_time 与区间相交)。"""
        stmt = (
            select(PlanTask)
            .where(PlanTask.user_id == user_id)
            .where(PlanTask.start_time <= end)
            .where(PlanTask.end_time >= start)
            .order_by(PlanTask.start_time.asc())
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    # ------------------------------------------------------------------
    # executePlan 联动
    # ------------------------------------------------------------------

    async def start(
        self,
        plan_task_id: uuid.UUID,
        execute_user_id: uuid.UUID | None = None,
        actual_start_time: datetime | None = None,
    ) -> TaskExecute:
        """启动任务(未开始→进行中): 创建一条 in-flight TaskExecute 并记录 actual_start_time。

        D-002: 多次填报的每次"启动"产生一条独立 TaskExecute(1 plan : N execute)。
        ``actual_start_time`` 可选(前端跨天拆分补填时传指定日期,默认 now)。
        返回的 ``id`` 作为后续 execute(action=submit/complete) 的 ``task_execute_id``。
        """
        plan = await self.get(plan_task_id)
        if plan.status != "未开始":
            raise TaskError(
                f"仅未开始状态可启动(current={plan.status})",
                details={"plan_task_id": str(plan.id), "status": plan.status},
            )
        now = datetime.now(UTC)
        start_time = actual_start_time or now
        actor = execute_user_id or plan.user_id
        exc = TaskExecute(
            id=uuid.uuid4(),
            plan_task_id=plan.id,
            execute_user_id=actor,
            actual_start_time=start_time,
            status=STATUS_DOING,
            current_user_id=actor,
        )
        self._session.add(exc)
        plan.status = "进行中"
        if plan.actual_start_time is None:
            plan.actual_start_time = start_time
        plan.updated_at = now
        await self._session.commit()
        await self._session.refresh(exc)
        await self._session.refresh(plan)
        log.info(
            "plan_started",
            plan_task_id=str(plan.id),
            task_execute_id=str(exc.id),
        )
        return exc

    async def execute_plan(self, req: ExecutePlanReq, current_user_id: uuid.UUID) -> TaskExecute:
        """执行计划:单事务联动生成/更新 TaskExecute 并推进状态机。

        状态语义 (D-002/D-003, 删 submit 改 action):
        - ``action="complete"`` → 收口 in-flight 记录 status=90 + plan 已完成
        - ``action="submit"`` → 收口 in-flight 记录 status=90 + plan 重置未开始(可再次 start)

        task_execute_id 必填(start 端点创建的 in-flight 记录)。
        D-005 强制回填 actual_end_time(让新录入有 actual 区间, 日历求和才能显示);
        D-004 service 内跨天校验(actual_start vs actual_end 同日, 否则 422)。

        Args:
            req: 执行请求(action + task_execute_id 必填)。
            current_user_id: 当前登录用户。

        Returns:
            收口后的 :class:`TaskExecute`。
        """
        plan = await self.get(req.plan_task_id)

        now = datetime.now(UTC)
        # task_execute_id 必填(start 端点创建的 in-flight 记录)
        exc = await self._session.get(TaskExecute, req.task_execute_id)
        if exc is None:
            raise TaskExecuteNotFound(f"TaskExecute '{req.task_execute_id}' not found.")
        if exc.plan_task_id != plan.id:
            raise TaskError(
                "task_execute_id 与 plan_task_id 不匹配",
                details={
                    "plan_task_id": str(plan.id),
                    "task_execute_id": str(req.task_execute_id),
                },
            )

        # D-005: 强制回填 actual_end_time(不再只在 req 带时写; 让新录入有 actual 区间)
        exc.actual_end_time = req.actual_end_time or now

        # D-004: service 内跨天校验(start 写 actual_start, execute 写 actual_end, 跨两次请求)
        if (
            exc.actual_start_time is not None
            and exc.actual_start_time.date() != exc.actual_end_time.date()
        ):
            raise TaskError(
                "执行起止时间不可跨天，请拆成每天单独填报",
                details={
                    "actual_start_time": exc.actual_start_time.isoformat(),
                    "actual_end_time": exc.actual_end_time.isoformat(),
                },
            )

        # 同步执行信息
        if req.execute_info is not None:
            exc.execute_info = req.execute_info
        if req.time_spent is not None:
            exc.time_spent = req.time_spent
        if req.actual_start_time is not None:
            exc.actual_start_time = req.actual_start_time
        if req.start_remark is not None:
            exc.start_remark = req.start_remark
        if req.end_remark is not None:
            exc.end_remark = req.end_remark
        if req.execute_user_id is not None:
            exc.execute_user_id = req.execute_user_id
        exc.current_user_id = req.execute_user_id or current_user_id

        # 推进状态机: submit/complete 都收口当前 in-flight 记录为 status=90
        self._assert_transition(exc.status, STATUS_END)
        exc.status = STATUS_END
        exc.updated_at = now
        plan.updated_at = now

        # D-003 action 分支: complete→已完成; submit→重置未开始(支持再次 start 多次填报)
        if req.action == "complete":
            plan.status = "已完成"
            plan.actual_end_time = exc.actual_end_time
        else:  # submit
            plan.status = "未开始"

        await self._session.commit()
        await self._session.refresh(exc)
        await self._session.refresh(plan)
        log.info(
            "plan_executed",
            plan_task_id=str(plan.id),
            task_execute_id=str(exc.id),
            status=exc.status,
            action=req.action,
        )
        return exc

    @staticmethod
    def _assert_transition(current: str, target: str) -> None:
        """校验状态迁移合法性,非法抛 :class:`IllegalStatusTransition`。"""
        # 终态 90 不可再迁移
        if current == STATUS_END:
            raise IllegalStatusTransition(
                f"Task already ended (status={current}), cannot transition to {target}.",
                details={"current": current, "target": target},
            )


class TaskExecuteService:
    """任务执行 CRUD + 日期范围查询。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, data: TaskExecuteCreate) -> TaskExecute:
        if data.status not in VALID_EXECUTE_STATUS:
            raise TaskError(f"Invalid status: {data.status}", details={"status": data.status})
        exc = TaskExecute(**data.model_dump())
        self._session.add(exc)
        await self._session.commit()
        await self._session.refresh(exc)
        return exc

    async def get(self, exec_id: uuid.UUID) -> TaskExecute:
        exc = await self._session.get(TaskExecute, exec_id)
        if exc is None:
            raise TaskExecuteNotFound(f"TaskExecute '{exec_id}' not found.")
        return exc

    async def update(self, exec_id: uuid.UUID, data: TaskExecuteUpdate) -> TaskExecute:
        exc = await self.get(exec_id)
        payload = data.model_dump(exclude_unset=True)
        if "status" in payload and payload["status"] not in VALID_EXECUTE_STATUS:
            raise TaskError(
                f"Invalid status: {payload['status']}", details={"status": payload["status"]}
            )
        for key, value in payload.items():
            setattr(exc, key, value)
        exc.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(exc)
        return exc

    async def delete(self, exec_id: uuid.UUID) -> None:
        exc = await self.get(exec_id)
        await self._session.delete(exc)
        await self._session.commit()

    async def page(self, req: TaskExecutePageReq) -> Page[TaskExecute]:
        page_req = _page_req_from(req.page, req.page_size, req.order_by, req.order)
        stmt = select(TaskExecute)
        plan_task_id = _parse_uuid_optional(req.plan_task_id)
        problem_task_id = _parse_uuid_optional(req.problem_task_id)
        execute_user_id = _parse_uuid_optional(req.execute_user_id)
        if plan_task_id is not None:
            stmt = stmt.where(TaskExecute.plan_task_id == plan_task_id)
        if problem_task_id is not None:
            stmt = stmt.where(TaskExecute.problem_task_id == problem_task_id)
        if req.status is not None:
            stmt = stmt.where(TaskExecute.status == req.status)
        if execute_user_id is not None:
            stmt = stmt.where(TaskExecute.execute_user_id == execute_user_id)
        stmt = apply_sort(stmt, TaskExecute, req.order_by, EXECUTE_SORT_FIELDS, req.order)
        total = await count_total(self._session, stmt)
        stmt = apply_pagination(stmt, page_req)
        result = await self._session.execute(stmt)
        items = list(result.scalars().all())
        return Page[TaskExecute].build(items=items, total=total, req=page_req)

    async def list_by_date_range(
        self,
        start: datetime,
        end: datetime,
        execute_user_id: str | uuid.UUID | None = None,
    ) -> list[TaskExecute]:
        """按 actual_start_time 区间查询任务执行。"""
        stmt = (
            select(TaskExecute)
            .where(TaskExecute.actual_start_time >= start)
            .where(TaskExecute.actual_start_time <= end)
        )
        uid = _parse_uuid_optional(execute_user_id)
        if uid is not None:
            stmt = stmt.where(TaskExecute.execute_user_id == uid)
        stmt = stmt.order_by(TaskExecute.actual_start_time.asc())
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def list_by_date_range_with_plan(
        self,
        start: datetime,
        end: datetime,
        execute_user_ids: list[str] | list[uuid.UUID] | None = None,
        project_id: str | uuid.UUID | None = None,
    ) -> list[tuple[TaskExecute, PlanTask | None]]:
        """按 actual_start_time 区间查询任务执行,可选多用户 + 项目过滤,
        并批量补关联 PlanTask(任务名/项目,避免 N+1;TaskExecute 无 relationship)。
        返回 (execute, plan_task) 对。
        """
        stmt = (
            select(TaskExecute)
            .where(TaskExecute.actual_start_time >= start)
            .where(TaskExecute.actual_start_time <= end)
        )
        parsed_uids = (
            [_parse_uuid_optional(u) for u in execute_user_ids] if execute_user_ids else []
        )
        valid_uids = [u for u in parsed_uids if u is not None]
        if valid_uids:
            stmt = stmt.where(TaskExecute.execute_user_id.in_(valid_uids))
        pid = _parse_uuid_optional(project_id)
        if pid is not None:
            # join PlanTask 按项目过滤(无 plan_task_id 的 problem 执行被排除,对齐源)
            stmt = stmt.join(PlanTask, PlanTask.id == TaskExecute.plan_task_id).where(
                PlanTask.project_id == pid
            )
        stmt = stmt.order_by(TaskExecute.actual_start_time.asc())
        result = await self._session.execute(stmt)
        executes = list(result.scalars().all())
        plan_ids = {e.plan_task_id for e in executes if e.plan_task_id is not None}
        plan_map: dict[uuid.UUID, PlanTask] = {}
        if plan_ids:
            plans = await self._session.execute(select(PlanTask).where(PlanTask.id.in_(plan_ids)))
            plan_map = {p.id: p for p in plans.scalars().all()}
        return [(e, plan_map.get(e.plan_task_id)) for e in executes]


class WorkHourService:
    """工时 CRUD + 统计 (按 user/project 聚合)。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, data: WorkHourCreate) -> WorkHour:
        wh = WorkHour(**{**data.model_dump(), "work_date": _date_to_datetime(data.work_date)})
        self._session.add(wh)
        await self._session.commit()
        await self._session.refresh(wh)
        return wh

    async def get(self, wh_id: uuid.UUID) -> WorkHour:
        wh = await self._session.get(WorkHour, wh_id)
        if wh is None:
            raise WorkHourNotFound(f"WorkHour '{wh_id}' not found.")
        return wh

    async def update(self, wh_id: uuid.UUID, data: WorkHourUpdate) -> WorkHour:
        wh = await self.get(wh_id)
        payload = data.model_dump(exclude_unset=True)
        if "work_date" in payload and payload["work_date"] is not None:
            payload["work_date"] = _date_to_datetime(payload["work_date"])
        for key, value in payload.items():
            setattr(wh, key, value)
        wh.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(wh)
        return wh

    async def delete(self, wh_id: uuid.UUID) -> None:
        wh = await self.get(wh_id)
        await self._session.delete(wh)
        await self._session.commit()

    async def page(self, req: WorkHourPageReq) -> Page[WorkHour]:
        page_req = _page_req_from(req.page, req.page_size, req.order_by, req.order)
        stmt = select(WorkHour)
        user_id = _parse_uuid_optional(req.user_id)
        project_id = _parse_uuid_optional(req.project_id)
        if user_id is not None:
            stmt = stmt.where(WorkHour.user_id == user_id)
        if project_id is not None:
            stmt = stmt.where(WorkHour.project_id == project_id)
        if req.type is not None:
            stmt = stmt.where(WorkHour.type == req.type)
        if req.work_date_start is not None:
            stmt = stmt.where(WorkHour.work_date >= _date_to_datetime(req.work_date_start))
        if req.work_date_end is not None:
            stmt = stmt.where(
                WorkHour.work_date < _date_to_datetime(req.work_date_end) + timedelta(days=1)
            )
        stmt = apply_sort(stmt, WorkHour, req.order_by, WORKHOUR_SORT_FIELDS, req.order)
        total = await count_total(self._session, stmt)
        stmt = apply_pagination(stmt, page_req)
        result = await self._session.execute(stmt)
        items = list(result.scalars().all())
        return Page[WorkHour].build(items=items, total=total, req=page_req)

    async def list_for_export(self, req: WorkHourPageReq, limit: int = 5000) -> list[WorkHour]:
        """导出用:忽略分页,返回过滤后全量 (硬上限 limit 防内存爆)。"""
        stmt = select(WorkHour)
        user_id = _parse_uuid_optional(req.user_id)
        project_id = _parse_uuid_optional(req.project_id)
        if user_id is not None:
            stmt = stmt.where(WorkHour.user_id == user_id)
        if project_id is not None:
            stmt = stmt.where(WorkHour.project_id == project_id)
        if req.type is not None:
            stmt = stmt.where(WorkHour.type == req.type)
        if req.work_date_start is not None:
            stmt = stmt.where(WorkHour.work_date >= _date_to_datetime(req.work_date_start))
        if req.work_date_end is not None:
            stmt = stmt.where(
                WorkHour.work_date < _date_to_datetime(req.work_date_end) + timedelta(days=1)
            )
        stmt = apply_sort(stmt, WorkHour, req.order_by, WORKHOUR_SORT_FIELDS, req.order)
        stmt = stmt.limit(limit)
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def stat_by_user(
        self,
        start: date | None,
        end: date | None,
        user_id: str | uuid.UUID | None = None,
    ) -> list[dict[str, Any]]:
        """按 execute_user_id 聚合工时 (数据源:``ppm_task_execute.time_spent``)。

        注意:源 ``ppm_work_hour`` 表当前为空 (历史未录入),实际工时数据落在
        任务执行表 ``time_spent`` 字段,故统计改查此表以保证页面有数据。
        ``start`` / ``end`` 过滤 ``actual_start_time`` / ``actual_end_time``。
        """
        group_col = TaskExecute.execute_user_id
        stmt = (
            select(
                group_col.label("key"),
                func.sum(TaskExecute.time_spent).label("total_hours"),
                func.count(TaskExecute.id).label("count"),
            )
            .where(group_col.is_not(None))
            .group_by(group_col)
            .order_by(func.sum(TaskExecute.time_spent).desc())
        )
        uid = _parse_uuid_optional(user_id)
        if uid is not None:
            stmt = stmt.where(group_col == uid)
        start_dt, end_dt = _stat_date_range(start, end)
        if start_dt is not None:
            stmt = stmt.where(TaskExecute.actual_start_time >= start_dt)
        if end_dt is not None:
            stmt = stmt.where(TaskExecute.actual_end_time < end_dt)
        return await self._fetch_stat_rows(stmt)

    async def stat_by_project(
        self,
        start: date | None,
        end: date | None,
        project_id: str | uuid.UUID | None = None,
    ) -> list[dict[str, Any]]:
        """按 project_id 聚合工时。

        数据源:``ppm_task_execute`` JOIN ``ppm_plan_task``
        (ON task_execute.plan_task_id = plan_task.id),SUM(time_spent)。
        """
        group_col = PlanTask.project_id
        stmt = (
            select(
                group_col.label("key"),
                func.sum(TaskExecute.time_spent).label("total_hours"),
                func.count(TaskExecute.id).label("count"),
            )
            .join(PlanTask, TaskExecute.plan_task_id == PlanTask.id)
            .where(group_col.is_not(None))
            .group_by(group_col)
            .order_by(func.sum(TaskExecute.time_spent).desc())
        )
        pid = _parse_uuid_optional(project_id)
        if pid is not None:
            stmt = stmt.where(group_col == pid)
        start_dt, end_dt = _stat_date_range(start, end)
        if start_dt is not None:
            stmt = stmt.where(TaskExecute.actual_start_time >= start_dt)
        if end_dt is not None:
            stmt = stmt.where(TaskExecute.actual_end_time < end_dt)
        return await self._fetch_stat_rows(stmt)

    async def _fetch_stat_rows(self, stmt: Any) -> list[dict[str, Any]]:
        """执行聚合 SQL,返回 [{key, total_hours, count}] 列表。"""
        result = await self._session.execute(stmt)
        rows: list[dict[str, Any]] = []
        for row in result.all():
            count_val: Any = row.count
            rows.append(
                {
                    "key": row.key,
                    "total_hours": float(row.total_hours or 0),
                    "count": int(count_val or 0),
                }
            )
        return rows


def _date_to_datetime(d: date) -> datetime:
    """date → UTC 0 点 datetime (统一存储时区感知)。"""
    return datetime(d.year, d.month, d.day, tzinfo=UTC)


def _stat_date_range(
    start: date | None, end: date | None
) -> tuple[datetime | None, datetime | None]:
    """stat 端点统一日期范围:[start 00:00, end+1day 00:00)。"""
    start_dt = _date_to_datetime(start) if start is not None else None
    end_dt = _date_to_datetime(end) + timedelta(days=1) if end is not None else None
    return start_dt, end_dt


__all__ = [
    "STATUS_CHECKING",
    "STATUS_DOING",
    "STATUS_END",
    "STATUS_NOT_SUBMIT",
    "STATUS_WAITING_DISPOSE",
    "PlanTaskService",
    "TaskExecuteService",
    "WorkHourService",
]
