"""task 子域 API 端点 —— 平台级,统一前缀 ``/api/ppm``。

权限:``PPM_TASK_*`` / ``PPM_WORKHOUR_*`` (``require_permission_any``,平台级)。
固定路径 (``/personal-task-plan``、``/task-execute``、``/work-hour``) 前置于
参数化路径 (``/task-plan/{id}``) 以避免 FastAPI 路由歧义。

导出端点在 async 端点内用 ``anyio.to_thread.run_sync`` 包 openpyxl (X-002)。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission_any
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.ppm.common.crud import Page
from app.modules.ppm.common.export import ColumnDef, excel_response, rows_to_workbook
from app.modules.ppm.task.model import TaskExecute
from app.modules.ppm.task.schema import (
    ExecutePlanReq,
    PlanTaskBrief,
    PlanTaskCreate,
    PlanTaskPageReq,
    PlanTaskResponse,
    PlanTaskUpdate,
    StartReq,
    TaskExecuteCreate,
    TaskExecutePageReq,
    TaskExecuteResponse,
    TaskExecuteUpdate,
    TaskExecuteWithPlanResponse,
    WorkHourCreate,
    WorkHourPageReq,
    WorkHourResponse,
    WorkHourStatItem,
    WorkHourStatResponse,
    WorkHourUpdate,
)
from app.modules.ppm.task.service import (
    PlanTaskService,
    TaskExecuteService,
    WorkHourService,
)

# 前缀由 ``app.main`` 统一以 ``prefix="/api/ppm"`` 挂载,本 router 不自带 prefix
router = APIRouter(tags=["ppm-task"])

# 依赖类型别名 (Annotated 风格,避免 Annotated + default 混用冲突)
SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]
TaskWriteUser = Annotated[User, Depends(require_permission_any(Permission.PPM_TASK_WRITE))]
TaskDeleteUser = Annotated[User, Depends(require_permission_any(Permission.PPM_TASK_DELETE))]
TaskReadUser = Annotated[User, Depends(require_permission_any(Permission.PPM_TASK_READ))]
TaskExportUser = Annotated[User, Depends(require_permission_any(Permission.PPM_TASK_EXPORT))]
WorkHourWriteUser = Annotated[User, Depends(require_permission_any(Permission.PPM_WORKHOUR_WRITE))]
WorkHourReadUser = Annotated[User, Depends(require_permission_any(Permission.PPM_WORKHOUR_READ))]
WorkHourStatUser = Annotated[User, Depends(require_permission_any(Permission.PPM_WORKHOUR_STAT))]


def _build_workbook_bytes(
    columns: list[ColumnDef],
    rows: list[dict],
    sheet_name: str,
) -> bytes:
    """同步序列化 openpyxl workbook —— 供 ``anyio.to_thread.run_sync`` 调用 (X-002)。"""
    return rows_to_workbook(columns, rows, sheet_name=sheet_name)


def _page_resp(result, item_mapper) -> Page:
    """把 service 层 Page[ORM] 转 Page[Response]。"""
    return Page(
        items=[item_mapper(x) for x in result.items],
        total=result.total,
        page=result.page,
        page_size=result.page_size,
    )


# ===========================================================================
# task-plan CRUD + execute
# ===========================================================================


@router.post(
    "/task-plan/create",
    response_model=PlanTaskResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_plan_task(
    body: PlanTaskCreate,
    session: SessionDep,
    user: TaskWriteUser,
) -> PlanTaskResponse:
    svc = PlanTaskService(session)
    plan = await svc.create(body)
    return PlanTaskResponse.model_validate(plan)


@router.put("/task-plan/update", response_model=PlanTaskResponse)
async def update_plan_task(
    body: PlanTaskUpdate,
    plan_id: uuid.UUID = Query(..., description="任务计划 ID"),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission_any(Permission.PPM_TASK_WRITE)),
) -> PlanTaskResponse:
    svc = PlanTaskService(session)
    plan = await svc.update(plan_id, body)
    return PlanTaskResponse.model_validate(plan)


@router.get("/task-plan/get", response_model=PlanTaskResponse)
async def get_plan_task(
    plan_id: uuid.UUID = Query(..., description="任务计划 ID"),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> PlanTaskResponse:
    svc = PlanTaskService(session)
    plan = await svc.get(plan_id)
    return PlanTaskResponse.model_validate(plan)


@router.delete("/task-plan/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan_task(
    plan_id: uuid.UUID = Query(..., description="任务计划 ID"),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission_any(Permission.PPM_TASK_DELETE)),
) -> None:
    svc = PlanTaskService(session)
    await svc.delete(plan_id)


@router.get("/task-plan/page", response_model=Page[PlanTaskResponse])
async def page_plan_task(
    session: SessionDep,
    user: TaskReadUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    user_id: str | None = Query(None),
    project_id: str | None = Query(None),
    module_id: str | None = Query(None),
    plan_status: list[str] | None = Query(None, alias="status", description="状态(可多值)"),
    month: str | None = Query(None),
    year: str | None = Query(None),
    start_time: datetime | None = Query(None, description="start_time 区间起(闭)"),
    end_time: datetime | None = Query(None, description="start_time 区间止(闭)"),
    work_partner: str | None = Query(None, description="配合人员模糊匹配"),
    order_by: str | None = Query(None),
    order: str = Query("desc"),
) -> Page[PlanTaskResponse]:
    req = PlanTaskPageReq(
        page=page,
        page_size=page_size,
        user_id=user_id,
        project_id=project_id,
        module_id=module_id,
        status=plan_status,
        month=month,
        year=year,
        start_time=start_time,
        end_time=end_time,
        work_partner=work_partner,
        order_by=order_by,
        order=order,
    )
    svc = PlanTaskService(session)
    result = await svc.page(req, user=user)
    # 批量聚合已消耗工时(sum time_spent by plan_task_id, 避免前端 N+1)
    plan_ids = [t.id for t in result.items]
    spent_map: dict[uuid.UUID, float] = {}
    if plan_ids:
        rows = (
            await session.execute(
                select(TaskExecute.plan_task_id, func.sum(TaskExecute.time_spent))
                .where(TaskExecute.plan_task_id.in_(plan_ids))
                .group_by(TaskExecute.plan_task_id)
            )
        ).all()
        spent_map = {pid: float(s or 0) for pid, s in rows if pid is not None}
    items = []
    for t in result.items:
        resp = PlanTaskResponse.model_validate(t)
        resp.spent_time = spent_map.get(t.id, 0.0)
        items.append(resp)
    return Page(
        items=items,
        total=result.total,
        page=result.page,
        page_size=result.page_size,
    )


@router.put("/task-plan/execute", response_model=TaskExecuteResponse)
async def execute_plan_task(
    body: ExecutePlanReq,
    session: SessionDep,
    user: TaskWriteUser,
) -> TaskExecuteResponse:
    """执行计划:联动生成/更新 TaskExecute + 状态机推进。"""
    svc = PlanTaskService(session)
    exc = await svc.execute_plan(body, user.id)
    return TaskExecuteResponse.model_validate(exc)


@router.post(
    "/task-plan/start",
    response_model=TaskExecuteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def start_plan_task(
    body: StartReq,
    session: SessionDep,
    user: TaskWriteUser,
) -> TaskExecuteResponse:
    """启动任务(未开始→进行中): 创建 in-flight TaskExecute 记 actual_start_time。

    返回的 ``id`` 作为后续 POST /task-plan/execute 的 ``task_execute_id``。
    D-002 多次填报: 每次 start 产生一条独立 TaskExecute(1 plan : N execute)。
    """
    svc = PlanTaskService(session)
    exc = await svc.start(
        body.plan_task_id,
        body.execute_user_id or user.id,
        body.actual_start_time,
    )
    return TaskExecuteResponse.model_validate(exc)


@router.get("/task-plan/export-excel")
async def export_plan_task_excel(
    session: SessionDep,
    user: TaskExportUser,
    user_id: str | None = Query(None),
    project_id: str | None = Query(None),
    plan_status: list[str] | None = Query(None, alias="status", description="状态(可多值)"),
    month: str | None = Query(None),
    year: str | None = Query(None),
    start_time: datetime | None = Query(None),
    end_time: datetime | None = Query(None),
    work_partner: str | None = Query(None),
    order_by: str | None = Query(None),
    order: str = Query("desc"),
) -> StreamingResponse:
    """导出任务计划 (async 端点内用 anyio.to_thread 包 openpyxl,X-002)。"""
    import anyio

    req = PlanTaskPageReq(
        page=1,
        page_size=200,
        user_id=user_id,
        project_id=project_id,
        status=plan_status,
        month=month,
        year=year,
        start_time=start_time,
        end_time=end_time,
        work_partner=work_partner,
        order_by=order_by,
        order=order,
    )
    svc = PlanTaskService(session)
    result = await svc.page(req, user=user)
    columns = [
        ColumnDef("user_name", "姓名", width=15),
        ColumnDef("project_name", "项目", width=20),
        ColumnDef("content", "工作内容", width=40),
        ColumnDef("status", "状态", width=12),
        ColumnDef("start_time", "开始时间", width=20),
        ColumnDef("end_time", "结束时间", width=20),
        ColumnDef("work_load", "工作量", width=12),
        ColumnDef("time_spent", "耗时(人天)", width=12),
        ColumnDef("remarks", "备注", width=30),
    ]
    rows = [PlanTaskResponse.model_validate(p).model_dump(mode="json") for p in result.items]
    content = await anyio.to_thread.run_sync(_build_workbook_bytes, columns, rows, "任务计划")
    filename = f"任务计划_{datetime.now():%Y%m%d_%H%M%S}.xlsx"
    return excel_response(content, filename=filename)


# ===========================================================================
# personal-task-plan (按当前登录用户过滤)
# ===========================================================================


@router.get("/personal-task-plan/page", response_model=Page[PlanTaskResponse])
async def personal_plan_task_page(
    session: SessionDep,
    user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    project_id: str | None = Query(None),
    module_id: str | None = Query(None),
    plan_status: list[str] | None = Query(None, alias="status", description="状态(可多值)"),
    month: str | None = Query(None),
    year: str | None = Query(None),
    start_time: datetime | None = Query(None),
    end_time: datetime | None = Query(None),
    work_partner: str | None = Query(None),
    order_by: str | None = Query(None),
    order: str = Query("desc"),
) -> Page[PlanTaskResponse]:
    """仅返回当前登录用户的任务计划。"""
    req = PlanTaskPageReq(
        page=page,
        page_size=page_size,
        user_id=user.id,
        project_id=project_id,
        module_id=module_id,
        status=plan_status,
        month=month,
        year=year,
        start_time=start_time,
        end_time=end_time,
        work_partner=work_partner,
        order_by=order_by,
        order=order,
    )
    svc = PlanTaskService(session)
    result = await svc.page(req)
    # 批量聚合已消耗工时(sum time_spent by plan_task_id, 避免前端 N+1)
    plan_ids = [t.id for t in result.items]
    spent_map: dict[uuid.UUID, float] = {}
    if plan_ids:
        rows = (
            await session.execute(
                select(TaskExecute.plan_task_id, func.sum(TaskExecute.time_spent))
                .where(TaskExecute.plan_task_id.in_(plan_ids))
                .group_by(TaskExecute.plan_task_id)
            )
        ).all()
        spent_map = {pid: float(s or 0) for pid, s in rows if pid is not None}
    items = []
    for t in result.items:
        resp = PlanTaskResponse.model_validate(t)
        resp.spent_time = spent_map.get(t.id, 0.0)
        items.append(resp)
    return Page(
        items=items,
        total=result.total,
        page=result.page,
        page_size=result.page_size,
    )


@router.get("/personal-task-plan/list-by-date-range", response_model=list[PlanTaskResponse])
async def personal_plan_task_by_date_range(
    session: SessionDep,
    user: CurrentUser,
    start: datetime = Query(..., description="区间起始 (ISO datetime)"),
    end: datetime = Query(..., description="区间结束 (ISO datetime)"),
) -> list[PlanTaskResponse]:
    """当前登录用户在 [start, end] 区间的任务计划。"""
    svc = PlanTaskService(session)
    items = await svc.list_by_user_and_date_range(user.id, start, end)
    return [PlanTaskResponse.model_validate(p) for p in items]


# ===========================================================================
# task-execute CRUD + list-by-date-range
# ===========================================================================


@router.post(
    "/task-execute/create",
    response_model=TaskExecuteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_task_execute(
    body: TaskExecuteCreate,
    session: SessionDep,
    user: TaskWriteUser,
) -> TaskExecuteResponse:
    svc = TaskExecuteService(session)
    exc = await svc.create(body)
    return TaskExecuteResponse.model_validate(exc)


@router.put("/task-execute/update", response_model=TaskExecuteResponse)
async def update_task_execute(
    body: TaskExecuteUpdate,
    execute_id: uuid.UUID = Query(..., description="任务执行 ID"),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission_any(Permission.PPM_TASK_WRITE)),
) -> TaskExecuteResponse:
    svc = TaskExecuteService(session)
    exc = await svc.update(execute_id, body)
    return TaskExecuteResponse.model_validate(exc)


@router.get("/task-execute/get", response_model=TaskExecuteResponse)
async def get_task_execute(
    execute_id: uuid.UUID = Query(..., description="任务执行 ID"),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TaskExecuteResponse:
    svc = TaskExecuteService(session)
    exc = await svc.get(execute_id)
    return TaskExecuteResponse.model_validate(exc)


@router.delete("/task-execute/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task_execute(
    execute_id: uuid.UUID = Query(..., description="任务执行 ID"),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission_any(Permission.PPM_TASK_DELETE)),
) -> None:
    svc = TaskExecuteService(session)
    await svc.delete(execute_id)


@router.get("/task-execute/page", response_model=Page[TaskExecuteResponse])
async def page_task_execute(
    session: SessionDep,
    user: TaskReadUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    plan_task_id: str | None = Query(None),
    problem_task_id: str | None = Query(None),
    execute_status: str | None = Query(None, alias="status"),
    execute_user_id: str | None = Query(None),
    order_by: str | None = Query(None),
    order: str = Query("desc"),
) -> Page[TaskExecuteResponse]:
    req = TaskExecutePageReq(
        page=page,
        page_size=page_size,
        plan_task_id=plan_task_id,
        problem_task_id=problem_task_id,
        status=execute_status,
        execute_user_id=execute_user_id,
        order_by=order_by,
        order=order,
    )
    svc = TaskExecuteService(session)
    result = await svc.page(req)
    return _page_resp(result, TaskExecuteResponse.model_validate)


@router.get("/task-execute/list-by-date-range", response_model=list[TaskExecuteResponse])
async def task_execute_by_date_range(
    session: SessionDep,
    user: CurrentUser,
    start: datetime = Query(...),
    end: datetime = Query(...),
    execute_user_id: str | None = Query(None),
) -> list[TaskExecuteResponse]:
    svc = TaskExecuteService(session)
    items = await svc.list_by_date_range(start, end, execute_user_id)
    return [TaskExecuteResponse.model_validate(e) for e in items]


@router.get(
    "/task-execute/list-by-date-range-with-plan",
    response_model=list[TaskExecuteWithPlanResponse],
)
async def task_execute_with_plan_by_date_range(
    session: SessionDep,
    user: CurrentUser,
    start: datetime = Query(...),
    end: datetime = Query(...),
    project_id: str | None = Query(None),
    execute_user_ids: list[str] | None = Query(None),
) -> list[TaskExecuteWithPlanResponse]:
    """任务执行 + 关联计划任务(看板「团队实际工作表」展示任务名/项目)。

    按 actual_start_time 区间 + 可选多用户 + 可选项目过滤;
    批量 join PlanTask 供前端展示任务标题/项目名。
    """
    svc = TaskExecuteService(session)
    pairs = await svc.list_by_date_range_with_plan(start, end, execute_user_ids, project_id)
    return [
        TaskExecuteWithPlanResponse(
            **TaskExecuteResponse.model_validate(e).model_dump(),
            plan_task=PlanTaskBrief.model_validate(p) if p is not None else None,
        )
        for e, p in pairs
    ]


# ===========================================================================
# work-hour CRUD + stat + export
# ===========================================================================


@router.post(
    "/work-hour/create",
    response_model=WorkHourResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_work_hour(
    body: WorkHourCreate,
    session: SessionDep,
    user: WorkHourWriteUser,
) -> WorkHourResponse:
    svc = WorkHourService(session)
    wh = await svc.create(body)
    return WorkHourResponse.model_validate(wh)


@router.put("/work-hour/update", response_model=WorkHourResponse)
async def update_work_hour(
    body: WorkHourUpdate,
    work_hour_id: uuid.UUID = Query(..., description="工时 ID"),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission_any(Permission.PPM_WORKHOUR_WRITE)),
) -> WorkHourResponse:
    svc = WorkHourService(session)
    wh = await svc.update(work_hour_id, body)
    return WorkHourResponse.model_validate(wh)


@router.get("/work-hour/get", response_model=WorkHourResponse)
async def get_work_hour(
    work_hour_id: uuid.UUID = Query(..., description="工时 ID"),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkHourResponse:
    svc = WorkHourService(session)
    wh = await svc.get(work_hour_id)
    return WorkHourResponse.model_validate(wh)


@router.delete("/work-hour/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_work_hour(
    work_hour_id: uuid.UUID = Query(..., description="工时 ID"),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission_any(Permission.PPM_WORKHOUR_READ)),
) -> None:
    svc = WorkHourService(session)
    await svc.delete(work_hour_id)


@router.get("/work-hour/page", response_model=Page[WorkHourResponse])
async def page_work_hour(
    session: SessionDep,
    user: WorkHourReadUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    filter_user_id: str | None = Query(None, alias="user_id"),
    filter_project_id: str | None = Query(None, alias="project_id"),
    work_date_start: date | None = Query(None),
    work_date_end: date | None = Query(None),
    filter_type: int | None = Query(None, alias="type"),
    order_by: str | None = Query(None),
    order: str = Query("desc"),
) -> Page[WorkHourResponse]:
    req = WorkHourPageReq(
        page=page,
        page_size=page_size,
        user_id=filter_user_id,
        project_id=filter_project_id,
        work_date_start=work_date_start,
        work_date_end=work_date_end,
        type=filter_type,
        order_by=order_by,
        order=order,
    )
    svc = WorkHourService(session)
    result = await svc.page(req)
    return _page_resp(result, WorkHourResponse.model_validate)


@router.get("/work-hour/stat-by-user", response_model=WorkHourStatResponse)
async def stat_work_hour_by_user(
    session: SessionDep,
    user: WorkHourStatUser,
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    filter_user_id: str | None = Query(None, alias="user_id"),
) -> WorkHourStatResponse:
    svc = WorkHourService(session)
    rows = await svc.stat_by_user(start_date, end_date, filter_user_id)
    items = [WorkHourStatItem(**r) for r in rows]
    total = sum(i.total_hours for i in items)
    return WorkHourStatResponse(
        dimension="user",
        start_date=start_date,
        end_date=end_date,
        items=items,
        total_hours=total,
    )


@router.get("/work-hour/stat-by-project", response_model=WorkHourStatResponse)
async def stat_work_hour_by_project(
    session: SessionDep,
    user: WorkHourStatUser,
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    filter_project_id: str | None = Query(None, alias="project_id"),
) -> WorkHourStatResponse:
    svc = WorkHourService(session)
    rows = await svc.stat_by_project(start_date, end_date, filter_project_id)
    items = [WorkHourStatItem(**r) for r in rows]
    total = sum(i.total_hours for i in items)
    return WorkHourStatResponse(
        dimension="project",
        start_date=start_date,
        end_date=end_date,
        items=items,
        total_hours=total,
    )


@router.get("/work-hour/export-excel")
async def export_work_hour_excel(
    session: SessionDep,
    user: WorkHourReadUser,
    filter_user_id: str | None = Query(None, alias="user_id"),
    filter_project_id: str | None = Query(None, alias="project_id"),
    work_date_start: date | None = Query(None),
    work_date_end: date | None = Query(None),
    filter_type: int | None = Query(None, alias="type"),
    order_by: str | None = Query(None),
    order: str = Query("desc"),
) -> StreamingResponse:
    """导出工时 (async 端点内用 anyio.to_thread.run_sync 跑 openpyxl,X-002)。"""
    import anyio

    req = WorkHourPageReq(
        page=1,
        page_size=20,
        user_id=filter_user_id,
        project_id=filter_project_id,
        work_date_start=work_date_start,
        work_date_end=work_date_end,
        type=filter_type,
        order_by=order_by,
        order=order,
    )
    svc = WorkHourService(session)
    rows_orm = await svc.list_for_export(req)
    rows = [WorkHourResponse.model_validate(w).model_dump(mode="json") for w in rows_orm]
    columns = [
        ColumnDef("user_id", "填报人ID", width=36),
        ColumnDef("project_id", "项目ID", width=36),
        ColumnDef("work_date", "工作日期", width=14),
        ColumnDef("hours", "工时", width=10),
        ColumnDef("type", "类型(1任务/2项目)", width=16),
        ColumnDef("description", "工作内容", width=40),
    ]
    content = await anyio.to_thread.run_sync(_build_workbook_bytes, columns, rows, "工时")
    filename = f"工时记录_{datetime.now():%Y%m%d_%H%M%S}.xlsx"
    return excel_response(content, filename=filename)


__all__ = ["router"]
