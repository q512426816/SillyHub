"""problem 子域 router。

平台级,无 workspace 前缀;由 ``app.main`` 以 ``prefix="/api/ppm"`` 挂载
(W6 task-08 集成,本文件不注册到 main.py)。权限走
``require_permission_any(PPM_PROBLEM_*)``。

路径前缀 (对照源 Controller,见 design.md §7):
- ``/problem-list``           问题清单 CRUD + 审批流端点
- ``/problem-list/{id}/next``    nextProcess
- ``/problem-list/{id}/reject``  rejectProcess
- ``/problem-list/{id}/done``    doneTask
- ``/problem-list/{id}/close``   closeTask
- ``/problem-list/{id}/tasks``   在办任务查询
- ``/problem-list/{id}/logs``    流程履历查询
- ``/problem-change``         问题变更 CRUD
- ``/problem-list/export-excel`` 导出 (X-002)

固定路径端点前置于参数化路由 (避免 /export-excel 被 /{item_id} 吞)。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

import anyio
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission_any
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.ppm.common.crud import PageReq
from app.modules.ppm.common.export import ColumnDef
from app.modules.ppm.problem.schema import (
    ChangeNextProcessReq,
    ChangeRejectProcessReq,
    CloseTaskReq,
    DoneTaskReq,
    NextProcessReq,
    ProblemChangeCreate,
    ProblemChangeResp,
    ProblemChangeUpdate,
    ProblemListCreate,
    ProblemListResp,
    ProblemListUpdate,
    ProcessLogResp,
    ProcessTaskResp,
    RejectProcessReq,
)
from app.modules.ppm.problem.service import (
    ProblemService,
)

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


@router.get("/problem-list", response_model=list[ProblemListResp])
async def list_problems(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_READ))],
    req: PageReqDep,
) -> list[ProblemListResp]:
    page = await ProblemService(session).list_problems(req)
    return [ProblemListResp.model_validate(i) for i in page.items]


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
    # create_problem 内部按 submit 决定是否触发 next_process;
    # next_process 用 problem.created_by 作 actor,此处无需传 actor。
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
# 审批流端点 (固定路径前置于参数化,本组路径都已带 /problem-list/{id}/... 无冲突)
# ===========================================================================


@router.post("/problem-list/{item_id}/next", response_model=ProblemListResp)
async def next_process(
    item_id: uuid.UUID,
    body: NextProcessReq,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_WRITE))],
) -> ProblemListResp:
    actor_id, actor_name = _actor(user)
    obj = await ProblemService(session).next_process(
        item_id, actor_id=actor_id, actor_name=actor_name, comment=body.comment
    )
    return ProblemListResp.model_validate(obj)


@router.post("/problem-list/{item_id}/reject", response_model=ProblemListResp)
async def reject_process(
    item_id: uuid.UUID,
    body: RejectProcessReq,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_WRITE))],
) -> ProblemListResp:
    actor_id, actor_name = _actor(user)
    obj = await ProblemService(session).reject_process(
        item_id, actor_id=actor_id, actor_name=actor_name, comment=body.comment
    )
    return ProblemListResp.model_validate(obj)


@router.post("/problem-list/{item_id}/done", response_model=ProblemListResp)
async def done_task(
    item_id: uuid.UUID,
    body: DoneTaskReq,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_WRITE))],
) -> ProblemListResp:
    actor_id, actor_name = _actor(user)
    obj = await ProblemService(session).done_task(
        item_id,
        actor_id=actor_id,
        actor_name=actor_name,
        handle_info=body.handle_info,
        time_spent=body.time_spent,
        completed=body.completed,
    )
    return ProblemListResp.model_validate(obj)


@router.post("/problem-list/{item_id}/close", response_model=ProblemListResp)
async def close_task(
    item_id: uuid.UUID,
    body: CloseTaskReq,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_WRITE))],
) -> ProblemListResp:
    actor_id, actor_name = _actor(user)
    obj = await ProblemService(session).close_task(
        item_id,
        actor_id=actor_id,
        actor_name=actor_name,
        check_info=body.check_info,
        check_result=body.check_result,
    )
    return ProblemListResp.model_validate(obj)


@router.get("/problem-list/{item_id}/tasks", response_model=list[ProcessTaskResp])
async def list_tasks(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_READ))],
) -> list[ProcessTaskResp]:
    rows = await ProblemService(session).list_list_tasks(str(item_id))
    return [ProcessTaskResp.model_validate(r) for r in rows]


@router.get("/problem-list/{item_id}/logs", response_model=list[ProcessLogResp])
async def list_logs(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_READ))],
) -> list[ProcessLogResp]:
    rows = await ProblemService(session).list_list_logs(str(item_id))
    return [ProcessLogResp.model_validate(r) for r in rows]


# ===========================================================================
# 问题变更 CRUD
# ===========================================================================


@router.get("/problem-change", response_model=list[ProblemChangeResp])
async def list_changes(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_READ))],
    req: PageReqDep,
) -> list[ProblemChangeResp]:
    page = await ProblemService(session).list_changes(req)
    return [ProblemChangeResp.model_validate(i) for i in page.items]


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


# ===========================================================================
# 导出 (X-002:openpyxl 同步丢线程池)
# ===========================================================================


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
    rows = await ProblemService(session).list_problems_for_export()
    columns = _PROBLEM_COLUMNS
    return await anyio.to_thread.run_sync(lambda: _build_excel_response(columns, rows, "问题清单"))


def _build_excel_response(
    columns: list[ColumnDef], rows: list[dict[str, Any]], sheet_name: str
) -> Any:
    """线程池内构造 Excel 下载响应 (X-002)。"""
    from app.modules.ppm.common.export import excel_response, rows_to_workbook

    content = rows_to_workbook(columns, rows, sheet_name=sheet_name)
    return excel_response(content, filename="problem_list.xlsx")


__all__ = ["router"]
