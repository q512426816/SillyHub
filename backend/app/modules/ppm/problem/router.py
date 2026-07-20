"""problem 子域 router。

平台级,无 workspace 前缀;由 ``app.main`` 以 ``prefix="/api/ppm"`` 挂载
(W6 task-08 集成,本文件不注册到 main.py)。权限走
``require_permission_any(PPM_PROBLEM_*)``。

路径前缀 (3 态简化，对齐任务计划，见 design.md §7):
- ``/problem-list``                 问题清单 CRUD + 执行流端点
- ``/problem-list/{id}/start``      start (新建→进行中，建 in-flight TaskExecute)
- ``/problem-list/{id}/execute``    execute (收口 in-flight：submit 回新建 / complete 已完成)
- ``/problem-change``               问题变更 CRUD (deprecated，D-005)
- ``/problem-change/{id}/next|reject|tasks|logs``  变更审批流 (deprecated)
- ``/problem-list/export-excel``    导出 (X-002)

固定路径端点前置于参数化路由 (避免 /export-excel 被 /{item_id} 吞)。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

import anyio
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission_any
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.ppm.common.crud import Page, PageReq
from app.modules.ppm.common.export import ColumnDef
from app.modules.ppm.problem.schema import (
    ChangeNextProcessReq,
    ChangeRejectProcessReq,
    ProblemChangeCreate,
    ProblemChangeResp,
    ProblemChangeUpdate,
    ProblemExecuteReq,
    ProblemListCreate,
    ProblemListResp,
    ProblemListUpdate,
    ProblemStartReq,
    ProcessLogResp,
    ProcessTaskResp,
)
from app.modules.ppm.problem.service import (
    ProblemService,
)
from app.modules.ppm.task.model import TaskExecute
from app.modules.ppm.task.schema import TaskExecuteResponse

router = APIRouter(tags=["ppm-problem"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
UserDep = Annotated[User, Depends(get_current_user)]


def _req(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    order_by: str | None = Query(None),
    order: str = Query("desc"),
) -> PageReq:
    return PageReq(page=page, page_size=page_size, order_by=order_by, order=order)


PageReqDep = Annotated[PageReq, Depends(_req)]


def _actor(user: User) -> tuple[str, str | None]:
    return str(user.id), user.display_name


# ===========================================================================
# 问题清单 CRUD
# ===========================================================================


@router.get("/problem-list", response_model=Page[ProblemListResp])
async def list_problems(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_READ))],
    req: PageReqDep,
    keyword: str | None = Query(None, description="项目/模块/描述/功能/责任人/发现人 模糊匹配"),
    status: list[str] | None = Query(None, description="状态(可多值)"),
    project_id: uuid.UUID | None = Query(None),
    pro_type: str | None = Query(None),
    is_urgent: str | None = Query(None, description="'1' 急 / '0' 否"),
    find_time_start: datetime | None = Query(None),
    find_time_end: datetime | None = Query(None),
    duty_user_id: uuid.UUID | None = Query(None, description="责任人 id(我的任务)"),
) -> Page[ProblemListResp]:
    page = await ProblemService(session).list_problems(
        req,
        keyword=keyword,
        status_list=status,
        project_id=project_id,
        pro_type=pro_type,
        is_urgent=is_urgent,
        find_time_start=find_time_start,
        find_time_end=find_time_end,
        duty_user_id=duty_user_id,
        user=user,
    )
    # 批量聚合已消耗工时(sum time_spent by problem_task_id, 避免前端 N+1)
    prob_ids = [i.id for i in page.items]
    spent_map: dict[uuid.UUID, float] = {}
    if prob_ids:
        rows = (
            await session.execute(
                select(TaskExecute.problem_task_id, func.sum(TaskExecute.time_spent))
                .where(TaskExecute.problem_task_id.in_(prob_ids))
                .group_by(TaskExecute.problem_task_id)
            )
        ).all()
        spent_map = {pid: float(s or 0) for pid, s in rows if pid is not None}
    items = []
    for i in page.items:
        resp = ProblemListResp.model_validate(i)
        resp.spent_time = spent_map.get(i.id, 0.0)
        items.append(resp)
    return Page.build(items=items, total=page.total, req=req)


# export-excel 必须前置于 /{item_id} 参数化路由,否则 FastAPI 按注册顺序
# 把 "export-excel" 当 item_id 解析为 UUID 失败返回 422 (同 ql-020)。
_PROBLEM_COLUMNS = [
    ColumnDef(field="project_name", header="项目名称", width=24),
    ColumnDef(field="pro_desc", header="问题描述", width=40),
    ColumnDef(field="pro_type", header="问题类型", width=12),
    ColumnDef(field="status", header="状态", width=10),
    ColumnDef(field="duty_user_name", header="责任人", width=16),
    ColumnDef(field="find_time", header="发现时间", width=20),
]


@router.get("/problem-list/export-excel")
async def export_problems(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_READ))],
) -> Any:
    """导出问题清单为 Excel (X-002)。"""
    rows = await ProblemService(session).list_problems_for_export(user=user)
    columns = _PROBLEM_COLUMNS
    filename = f"问题清单_{datetime.now():%Y%m%d_%H%M%S}.xlsx"
    return await anyio.to_thread.run_sync(
        lambda: _build_excel_response(columns, rows, "问题清单", filename=filename)
    )


@router.post(
    "/problem-list",
    response_model=ProblemListResp,
    status_code=status.HTTP_201_CREATED,
)
async def create_problem(
    body: ProblemListCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_WRITE))],
) -> ProblemListResp:
    svc = ProblemService(session)
    data = body.model_dump()
    obj = await svc.create_problem(data)
    return ProblemListResp.model_validate(obj)


@router.get(
    "/problem-list/list-by-date-range",
    response_model=list[ProblemListResp],
)
async def list_problems_by_date_range(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_READ))],
    start_date: datetime = Query(..., description="区间起始 ISO datetime"),
    end_date: datetime = Query(..., description="区间结束 ISO datetime"),
) -> list[ProblemListResp]:
    """按 find_time 区间过滤问题清单 (task-06 / FR-06)。

    固定路径前置于 ``/{item_id}``,否则 FastAPI 会把
    ``list-by-date-range`` 当 item_id 解析返回 422。
    """
    items = await ProblemService(session).list_problems_by_date_range(start_date, end_date)
    return [ProblemListResp.model_validate(i) for i in items]


@router.get("/problem-list/{item_id}", response_model=ProblemListResp)
async def get_problem(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_READ))],
) -> ProblemListResp:
    return ProblemListResp.model_validate(await ProblemService(session).get_problem(item_id))


@router.put("/problem-list/{item_id}", response_model=ProblemListResp)
async def update_problem(
    item_id: uuid.UUID,
    body: ProblemListUpdate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_WRITE))],
) -> ProblemListResp:
    obj = await ProblemService(session).update_problem(item_id, body.model_dump(exclude_unset=True))
    return ProblemListResp.model_validate(obj)


@router.delete("/problem-list/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_problem(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_DELETE))],
) -> None:
    await ProblemService(session).delete_problem(item_id)


# ===========================================================================
# 问题清单执行流端点 (3 态，对齐任务计划)
# ===========================================================================


@router.post(
    "/problem-list/{item_id}/start",
    response_model=TaskExecuteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def start_problem(
    item_id: uuid.UUID,
    body: ProblemStartReq,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_WRITE))],
) -> TaskExecuteResponse:
    """启动问题 (新建 → 进行中)：建 in-flight TaskExecute，返回其 id 供 execute 用。

    返回的 ``id`` 作为后续 PUT /problem-list/{id}/execute 的 ``task_execute_id``。
    多次执行每次「开始」产生一条独立 TaskExecute (1 problem : N execute)。
    """
    exc = await ProblemService(session).start_problem(
        item_id,
        execute_user_id=user.id,
        actual_start_time=body.actual_start_time,
    )
    return TaskExecuteResponse.model_validate(exc)


@router.put("/problem-list/{item_id}/execute", response_model=ProblemListResp)
async def execute_problem(
    item_id: uuid.UUID,
    body: ProblemExecuteReq,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_WRITE))],
) -> ProblemListResp:
    """执行问题：收口 in-flight TaskExecute 并推进状态机。

    - action=complete → 已完成 (终态)
    - action=submit → 回新建 (可再次 start，重复执行)
    """
    problem = await ProblemService(session).execute_problem(
        item_id,
        task_execute_id=body.task_execute_id,
        action=body.action,
        execute_info=body.execute_info,
        time_spent=body.time_spent,
        actual_start_time=body.actual_start_time,
        actual_end_time=body.actual_end_time,
        execute_user_id=body.execute_user_id or user.id,
    )
    return ProblemListResp.model_validate(problem)


# ===========================================================================
# 问题变更 CRUD
# ===========================================================================


@router.get("/problem-change", response_model=Page[ProblemChangeResp])
async def list_changes(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_READ))],
    req: PageReqDep,
    keyword: str | None = Query(None, description="项目/模块/变更内容/变更原因 模糊匹配"),
    status: list[str] | None = Query(None, description="状态(可多值)"),
    created_at_start: datetime | None = Query(None),
    created_at_end: datetime | None = Query(None),
) -> Page[ProblemChangeResp]:
    page = await ProblemService(session).list_changes(
        req,
        keyword=keyword,
        status_list=status,
        created_at_start=created_at_start,
        created_at_end=created_at_end,
    )
    return Page.build(
        items=[ProblemChangeResp.model_validate(i) for i in page.items],
        total=page.total,
        req=req,
    )


# export-excel 必须前置于 /{item_id} 参数化路由 (同 problem-list/export-excel 注释)。
_PROBLEM_CHANGE_COLUMNS = [
    ColumnDef(field="project_name", header="项目名称", width=24),
    ColumnDef(field="pro_desc", header="变更内容", width=40),
    ColumnDef(field="change_reason", header="变更原因", width=30),
    ColumnDef(field="duty_user_name", header="责任人", width=16),
    ColumnDef(field="now_handle_user_name", header="当前处理人", width=16),
    ColumnDef(field="status", header="状态", width=10),
    ColumnDef(field="created_at", header="创建时间", width=20),
]


@router.get("/problem-change/export-excel")
async def export_problem_changes(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_READ))],
) -> Any:
    """导出问题变更为 Excel (P2-3, X-002)。"""
    rows = await ProblemService(session).list_changes_for_export()
    columns = _PROBLEM_CHANGE_COLUMNS
    filename = f"问题变更_{datetime.now():%Y%m%d_%H%M%S}.xlsx"
    return await anyio.to_thread.run_sync(
        lambda: _build_excel_response(columns, rows, "问题变更", filename=filename)
    )


@router.post(
    "/problem-change",
    response_model=ProblemChangeResp,
    status_code=status.HTTP_201_CREATED,
)
async def create_change(
    body: ProblemChangeCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_WRITE))],
) -> ProblemChangeResp:
    obj = await ProblemService(session).create_change(body.model_dump())
    return ProblemChangeResp.model_validate(obj)


@router.get("/problem-change/{item_id}", response_model=ProblemChangeResp)
async def get_change(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_READ))],
) -> ProblemChangeResp:
    return ProblemChangeResp.model_validate(await ProblemService(session).get_change(item_id))


@router.put("/problem-change/{item_id}", response_model=ProblemChangeResp)
async def update_change(
    item_id: uuid.UUID,
    body: ProblemChangeUpdate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_WRITE))],
) -> ProblemChangeResp:
    obj = await ProblemService(session).update_change(item_id, body.model_dump(exclude_unset=True))
    return ProblemChangeResp.model_validate(obj)


@router.delete("/problem-change/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_change(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_DELETE))],
) -> None:
    await ProblemService(session).delete_change(item_id)


# ===========================================================================
# 变更审批流端点 (task-02:4 节点链 + bug 跳部门经理)
# ===========================================================================


@router.post("/problem-change/{item_id}/next", response_model=ProblemChangeResp)
async def next_change(
    item_id: uuid.UUID,
    body: ChangeNextProcessReq,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_WRITE))],
) -> ProblemChangeResp:
    actor_id, actor_name = _actor(user)
    obj = await ProblemService(session).next_change(
        item_id, actor_id=actor_id, actor_name=actor_name, comment=body.comment
    )
    return ProblemChangeResp.model_validate(obj)


@router.post("/problem-change/{item_id}/reject", response_model=ProblemChangeResp)
async def reject_change(
    item_id: uuid.UUID,
    body: ChangeRejectProcessReq,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_WRITE))],
) -> ProblemChangeResp:
    actor_id, actor_name = _actor(user)
    obj = await ProblemService(session).reject_change(
        item_id, actor_id=actor_id, actor_name=actor_name, comment=body.comment
    )
    return ProblemChangeResp.model_validate(obj)


@router.get("/problem-change/{item_id}/tasks", response_model=list[ProcessTaskResp])
async def list_change_tasks(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_READ))],
) -> list[ProcessTaskResp]:
    rows = await ProblemService(session).list_change_tasks(str(item_id))
    return [ProcessTaskResp.model_validate(r) for r in rows]


@router.get("/problem-change/{item_id}/logs", response_model=list[ProcessLogResp])
async def list_change_logs(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_READ))],
) -> list[ProcessLogResp]:
    rows = await ProblemService(session).list_change_logs(str(item_id))
    return [ProcessLogResp.model_validate(r) for r in rows]


# ---------------------------------------------------------------------------
# 导出辅助 (X-002:openpyxl 同步丢线程池)
# 注意:字面量路径 /problem-list/export-excel 与 /problem-change/export-excel
# 必须前置于 /{item_id} 参数化路由,否则 FastAPI 按注册顺序匹配时会被当 UUID
# 解析返回 422(同 ql-020 project-plan 修过的同款问题)。export_problems /
# export_problem_changes 实际声明位置见各自 list 端点紧邻之后。
# ---------------------------------------------------------------------------


def _build_excel_response(
    columns: list[ColumnDef],
    rows: list[dict[str, Any]],
    sheet_name: str,
    filename: str = "problem_list.xlsx",
) -> Any:
    """线程池内构造 Excel 下载响应 (X-002)。"""
    from app.modules.ppm.common.export import excel_response, rows_to_workbook

    content = rows_to_workbook(columns, rows, sheet_name=sheet_name)
    return excel_response(content, filename=filename)


__all__ = ["router"]
