"""plan 子域 router。

平台级,无 workspace 前缀;由 ``app.main`` 以 ``prefix="/api/ppm"`` 挂载
(W6 task-08 集成)。权限走 ``require_permission_any(PPM_PLAN_*)``。

路径前缀 (对照源 Controller,见 design.md §7)：
- ``/plan-node``          计划节点模板 CRUD + 子表明细
- ``/plan-node-module``   模块 CRUD
- ``/project-plan``       ps 项目计划 CRUD
- ``/plan-node-ps``       ps 里程碑 CRUD
- ``/plan-node-detail``   ps 里程碑明细 CRUD + 状态机流程
- ``/plan-node-detail/{id}/process``   流程子端点
                                          (save/reject/change/list)
"""

from __future__ import annotations

import uuid
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
from app.modules.ppm.plan.schema import (
    ChangeProcessReq,
    PlanNodeCreate,
    PlanNodeDetailCreate,
    PlanNodeDetailResp,
    PlanNodeDetailUpdate,
    PlanNodeModuleCreate,
    PlanNodeModuleResp,
    PlanNodeModuleUpdate,
    PlanNodeResp,
    PlanNodeUpdate,
    ProcessActionReq,
    PsPlanNodeCreate,
    PsPlanNodeDetailCreate,
    PsPlanNodeDetailProcessResp,
    PsPlanNodeDetailResp,
    PsPlanNodeDetailUpdate,
    PsPlanNodeResp,
    PsPlanNodeUpdate,
    PsProjectPlanCreate,
    PsProjectPlanResp,
    PsProjectPlanUpdate,
)
from app.modules.ppm.plan.service import PlanService

router = APIRouter(tags=["ppm-plan"])

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
# 计划节点模板 CRUD
# ===========================================================================


@router.get("/plan-node", response_model=list[PlanNodeResp])
async def list_plan_nodes(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_READ))],
    req: PageReqDep,
) -> list[PlanNodeResp]:
    page = await PlanService(session).list_plan_nodes(req)
    return [PlanNodeResp.model_validate(i) for i in page.items]


@router.post(
    "/plan-node",
    response_model=PlanNodeResp,
    status_code=status.HTTP_201_CREATED,
)
async def create_plan_node(
    body: PlanNodeCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> PlanNodeResp:
    obj = await PlanService(session).create_plan_node(body.model_dump())
    return PlanNodeResp.model_validate(obj)


@router.get("/plan-node/{item_id}", response_model=PlanNodeResp)
async def get_plan_node(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_READ))],
) -> PlanNodeResp:
    obj = await PlanService(session).get_plan_node(item_id)
    return PlanNodeResp.model_validate(obj)


@router.put("/plan-node/{item_id}", response_model=PlanNodeResp)
async def update_plan_node(
    item_id: uuid.UUID,
    body: PlanNodeUpdate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> PlanNodeResp:
    obj = await PlanService(session).update_plan_node(item_id, body.model_dump(exclude_unset=True))
    return PlanNodeResp.model_validate(obj)


@router.delete("/plan-node/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan_node(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_DELETE))],
) -> None:
    await PlanService(session).delete_plan_node(item_id)


# ---------- 模板明细 (按 plan_node_id 列表) ----------
@router.get(
    "/plan-node/{plan_node_id}/details",
    response_model=list[PlanNodeDetailResp],
)
async def list_plan_node_details(
    plan_node_id: str,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_READ))],
) -> list[PlanNodeDetailResp]:
    rows = await PlanService(session).list_plan_node_details_by_node(plan_node_id)
    return [PlanNodeDetailResp.model_validate(r) for r in rows]


@router.post(
    "/plan-node-detail-tpl",
    response_model=PlanNodeDetailResp,
    status_code=status.HTTP_201_CREATED,
)
async def create_plan_node_detail_tpl(
    body: PlanNodeDetailCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> PlanNodeDetailResp:
    obj = await PlanService(session).create_plan_node_detail(body.model_dump())
    return PlanNodeDetailResp.model_validate(obj)


@router.put("/plan-node-detail-tpl/{item_id}", response_model=PlanNodeDetailResp)
async def update_plan_node_detail_tpl(
    item_id: uuid.UUID,
    body: PlanNodeDetailUpdate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> PlanNodeDetailResp:
    obj = await PlanService(session).update_plan_node_detail(
        item_id, body.model_dump(exclude_unset=True)
    )
    return PlanNodeDetailResp.model_validate(obj)


@router.delete("/plan-node-detail-tpl/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan_node_detail_tpl(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_DELETE))],
) -> None:
    await PlanService(session).delete_plan_node_detail(item_id)


# ===========================================================================
# 模块 CRUD
# ===========================================================================


@router.get(
    "/plan-node/{plan_node_id}/modules",
    response_model=list[PlanNodeModuleResp],
)
async def list_modules(
    plan_node_id: str,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_READ))],
) -> list[PlanNodeModuleResp]:
    rows = await PlanService(session).list_modules_by_node(plan_node_id)
    return [PlanNodeModuleResp.model_validate(r) for r in rows]


@router.post(
    "/plan-node-module",
    response_model=PlanNodeModuleResp,
    status_code=status.HTTP_201_CREATED,
)
async def create_module(
    body: PlanNodeModuleCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> PlanNodeModuleResp:
    obj = await PlanService(session).create_module(body.model_dump())
    return PlanNodeModuleResp.model_validate(obj)


@router.put("/plan-node-module/{item_id}", response_model=PlanNodeModuleResp)
async def update_module(
    item_id: uuid.UUID,
    body: PlanNodeModuleUpdate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> PlanNodeModuleResp:
    obj = await PlanService(session).update_module(item_id, body.model_dump(exclude_unset=True))
    return PlanNodeModuleResp.model_validate(obj)


@router.delete("/plan-node-module/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_module(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_DELETE))],
) -> None:
    await PlanService(session).delete_module(item_id)


# ===========================================================================
# ps 项目计划 CRUD
# ===========================================================================


@router.get("/project-plan", response_model=list[PsProjectPlanResp])
async def list_ps_project_plans(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_READ))],
    req: PageReqDep,
) -> list[PsProjectPlanResp]:
    page = await PlanService(session).list_ps_project_plans(req)
    return [PsProjectPlanResp.model_validate(i) for i in page.items]


@router.post(
    "/project-plan",
    response_model=PsProjectPlanResp,
    status_code=status.HTTP_201_CREATED,
)
async def create_ps_project_plan(
    body: PsProjectPlanCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> PsProjectPlanResp:
    data = body.model_dump()
    data["create_name"] = data.get("create_name") or user.display_name
    obj = await PlanService(session).create_ps_project_plan(data)
    return PsProjectPlanResp.model_validate(obj)


@router.get("/project-plan/{item_id}", response_model=PsProjectPlanResp)
async def get_ps_project_plan(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_READ))],
) -> PsProjectPlanResp:
    return PsProjectPlanResp.model_validate(await PlanService(session).get_ps_project_plan(item_id))


@router.put("/project-plan/{item_id}", response_model=PsProjectPlanResp)
async def update_ps_project_plan(
    item_id: uuid.UUID,
    body: PsProjectPlanUpdate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> PsProjectPlanResp:
    obj = await PlanService(session).update_ps_project_plan(
        item_id, body.model_dump(exclude_unset=True)
    )
    return PsProjectPlanResp.model_validate(obj)


@router.delete("/project-plan/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ps_project_plan(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_DELETE))],
) -> None:
    await PlanService(session).delete_ps_project_plan(item_id)


# ===========================================================================
# ps 里程碑 CRUD
# ===========================================================================


@router.get(
    "/project-plan/{ps_project_plan_id}/plan-nodes",
    response_model=list[PsPlanNodeResp],
)
async def list_ps_plan_nodes(
    ps_project_plan_id: str,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_READ))],
) -> list[PsPlanNodeResp]:
    rows = await PlanService(session).list_ps_plan_nodes_by_plan(ps_project_plan_id)
    return [PsPlanNodeResp.model_validate(r) for r in rows]


@router.post(
    "/plan-node-ps",
    response_model=PsPlanNodeResp,
    status_code=status.HTTP_201_CREATED,
)
async def create_ps_plan_node(
    body: PsPlanNodeCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> PsPlanNodeResp:
    obj = await PlanService(session).create_ps_plan_node(body.model_dump())
    return PsPlanNodeResp.model_validate(obj)


@router.get("/plan-node-ps/{item_id}", response_model=PsPlanNodeResp)
async def get_ps_plan_node(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_READ))],
) -> PsPlanNodeResp:
    return PsPlanNodeResp.model_validate(await PlanService(session).get_ps_plan_node(item_id))


@router.put("/plan-node-ps/{item_id}", response_model=PsPlanNodeResp)
async def update_ps_plan_node(
    item_id: uuid.UUID,
    body: PsPlanNodeUpdate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> PsPlanNodeResp:
    obj = await PlanService(session).update_ps_plan_node(
        item_id, body.model_dump(exclude_unset=True)
    )
    return PsPlanNodeResp.model_validate(obj)


@router.delete("/plan-node-ps/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ps_plan_node(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_DELETE))],
) -> None:
    await PlanService(session).delete_ps_plan_node(item_id)


# ===========================================================================
# ps 里程碑明细 CRUD + 状态机流程
# ===========================================================================


@router.get(
    "/plan-node-ps/{plan_node_id}/details",
    response_model=list[PsPlanNodeDetailResp],
)
async def list_details_by_node(
    plan_node_id: str,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_READ))],
) -> list[PsPlanNodeDetailResp]:
    rows = await PlanService(session).list_details_by_node(plan_node_id)
    return [PsPlanNodeDetailResp.model_validate(r) for r in rows]


@router.post(
    "/plan-node-detail",
    response_model=PsPlanNodeDetailResp,
    status_code=status.HTTP_201_CREATED,
)
async def create_detail(
    body: PsPlanNodeDetailCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> PsPlanNodeDetailResp:
    obj = await PlanService(session).create_detail(body.model_dump())
    return PsPlanNodeDetailResp.model_validate(obj)


@router.get("/plan-node-detail/{item_id}", response_model=PsPlanNodeDetailResp)
async def get_detail(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_READ))],
) -> PsPlanNodeDetailResp:
    return PsPlanNodeDetailResp.model_validate(await PlanService(session).get_detail(item_id))


@router.put("/plan-node-detail/{item_id}", response_model=PsPlanNodeDetailResp)
async def update_detail(
    item_id: uuid.UUID,
    body: PsPlanNodeDetailUpdate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> PsPlanNodeDetailResp:
    obj = await PlanService(session).update_detail(item_id, body.model_dump(exclude_unset=True))
    return PsPlanNodeDetailResp.model_validate(obj)


@router.delete("/plan-node-detail/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_detail(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_DELETE))],
) -> None:
    await PlanService(session).delete_detail(item_id)


# ---------- 版本链 ----------
@router.get(
    "/plan-node-detail/{item_id}/versions",
    response_model=list[PsPlanNodeDetailResp],
)
async def list_versions(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_READ))],
) -> list[PsPlanNodeDetailResp]:
    rows = await PlanService(session).list_versions(item_id)
    return [PsPlanNodeDetailResp.model_validate(r) for r in rows]


# ===========================================================================
# 流程子端点:save / reject / change / list-processes
# ===========================================================================


@router.post(
    "/plan-node-detail/{item_id}/process/save",
    response_model=PsPlanNodeDetailResp,
)
async def save_process(
    item_id: uuid.UUID,
    body: ProcessActionReq,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> PsPlanNodeDetailResp:
    actor_id, actor_name = _actor(user)
    obj = await PlanService(session).save_process(
        item_id,
        actor_id=actor_id,
        actor_name=actor_name,
        handle_info=body.handle_info,
        next_user_id=body.next_user_id,
        next_user_name=body.next_user_name,
    )
    return PsPlanNodeDetailResp.model_validate(obj)


@router.post(
    "/plan-node-detail/{item_id}/process/reject",
    response_model=PsPlanNodeDetailResp,
)
async def reject_process(
    item_id: uuid.UUID,
    body: ProcessActionReq,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> PsPlanNodeDetailResp:
    actor_id, actor_name = _actor(user)
    obj = await PlanService(session).reject_process(
        item_id,
        actor_id=actor_id,
        actor_name=actor_name,
        handle_info=body.handle_info,
    )
    return PsPlanNodeDetailResp.model_validate(obj)


@router.post(
    "/plan-node-detail/{item_id}/process/change",
    response_model=PsPlanNodeDetailResp,
    status_code=status.HTTP_201_CREATED,
)
async def change_process(
    item_id: uuid.UUID,
    body: ChangeProcessReq,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> PsPlanNodeDetailResp:
    actor_id, actor_name = _actor(user)
    obj = await PlanService(session).change_process(
        item_id,
        actor_id=actor_id,
        actor_name=actor_name,
        change_reason=body.change_reason,
        overrides=body.overrides or None,
    )
    return PsPlanNodeDetailResp.model_validate(obj)


@router.get(
    "/plan-node-detail/{item_id}/processes",
    response_model=list[PsPlanNodeDetailProcessResp],
)
async def list_processes(
    item_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_READ))],
) -> list[PsPlanNodeDetailProcessResp]:
    rows = await PlanService(session).list_processes(str(item_id))
    return [PsPlanNodeDetailProcessResp.model_validate(r) for r in rows]


# ===========================================================================
# 导出 (同步 def,X-002)
# ===========================================================================


_PLAN_NODE_COLUMNS = [
    ColumnDef(field="overall_stage", header="总体阶段", width=20),
    ColumnDef(field="project_type", header="项目类型", width=20),
    ColumnDef(field="no", header="序号", width=10),
]


@router.get("/plan-node/export-excel")
async def export_plan_nodes(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_EXPORT))],
) -> Any:
    """导出计划节点模板为 Excel。

    X-002: openpyxl 是同步 CPU 库,会阻塞事件循环。此处先 async 读 DB,
    再用 ``anyio.to_thread.run_sync`` 把 openpyxl 序列化丢到线程池。
    """
    rows = await PlanService(session).list_plan_nodes_for_export()
    columns = _PLAN_NODE_COLUMNS
    # openpyxl 序列化丢线程池,X-002
    return await anyio.to_thread.run_sync(
        lambda: _build_excel_response(columns, rows, "计划节点模板")
    )


def _build_excel_response(
    columns: list[ColumnDef], rows: list[dict[str, Any]], sheet_name: str
) -> Any:
    """线程池内构造 Excel 下载响应 (X-002)。"""
    from app.modules.ppm.common.export import excel_response, rows_to_workbook

    content = rows_to_workbook(columns, rows, sheet_name=sheet_name)
    return excel_response(content, filename="plan_nodes.xlsx")


__all__ = ["router"]
