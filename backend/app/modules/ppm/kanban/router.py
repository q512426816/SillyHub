"""kanban 看板子域 API 端点 —— 平台级,统一前缀 ``/api/ppm``。

5 端点对齐源 ``PpdKanbanController``:
- GET    /kanban/users         人员列 (可按 Organization 分组,X-001)
- GET    /kanban/tasks         任务卡片
- POST   /kanban/task/assign   分配任务
- PUT    /kanban/task/reorder  拖拽排序
- GET    /kanban/search/users  搜人

权限:view 端点 ``PPM_KANBAN_VIEW``;assign/reorder 用 ``PPM_KANBAN_ASSIGN``
(``require_permission_any``,平台级)。

注:本 router **不自带 prefix**;由 ``app.main`` 统一以 ``prefix="/api/ppm"``
挂载 (task-08 统一注册)。本地 TestClient 测试自挂。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission_any
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.ppm.kanban.schema import (
    KanbanQueryReq,
    OrgGroup,
    TaskAssignReq,
    TaskCardVO,
    TaskReorderReq,
    UserColumnVO,
)
from app.modules.ppm.kanban.service import PpdKanbanService

router = APIRouter(tags=["ppm-kanban"])

# 依赖类型别名 (Annotated 风格,与 task 子域一致)
SessionDep = Annotated[AsyncSession, Depends(get_session)]
KanbanViewUser = Annotated[User, Depends(require_permission_any(Permission.PPM_KANBAN_VIEW))]
KanbanAssignUser = Annotated[User, Depends(require_permission_any(Permission.PPM_KANBAN_ASSIGN))]


def _parse_user_ids(raw: list[str] | None) -> list[uuid.UUID] | None:
    return [uuid.UUID(u) for u in raw] if raw else None


@router.get("/kanban/users", response_model=list[UserColumnVO] | list[OrgGroup])
async def get_user_columns(
    session: SessionDep,
    _user: KanbanViewUser,
    user_ids: list[str] | None = Query(None, description="人员范围 (多次传参)"),
    status: str | None = Query(None),
    project_id: str | None = Query(None),
    keyword: str | None = Query(None),
    group_by_org: bool = Query(False, description="True 时按 Organization 分组 (X-001)"),
) -> list[UserColumnVO] | list[OrgGroup]:
    """人员列 = 当前用户可见的 project_member (可按 Organization 分组)。"""
    req = KanbanQueryReq(
        user_ids=_parse_user_ids(user_ids),
        status=status,
        project_id=uuid.UUID(project_id) if project_id else None,
        keyword=keyword,
        group_by_org=group_by_org,
    )
    svc = PpdKanbanService(session)
    return await svc.get_user_columns(req)


@router.get("/kanban/tasks", response_model=list[TaskCardVO])
async def get_task_cards(
    session: SessionDep,
    _user: KanbanViewUser,
    user_ids: list[str] | None = Query(None),
    status: str | None = Query(None),
    project_id: str | None = Query(None),
    keyword: str | None = Query(None),
) -> list[TaskCardVO]:
    """任务卡片 (按 kanban_order 排序)。"""
    req = KanbanQueryReq(
        user_ids=_parse_user_ids(user_ids),
        status=status,
        project_id=uuid.UUID(project_id) if project_id else None,
        keyword=keyword,
    )
    svc = PpdKanbanService(session)
    return await svc.get_task_cards(req)


@router.post("/kanban/task/assign")
async def assign_task(
    body: TaskAssignReq,
    session: SessionDep,
    _user: KanbanAssignUser,
) -> bool:
    """分配任务给人员 (更新 PlanTask.user_id/user_name/kanban_order)。"""
    svc = PpdKanbanService(session)
    await svc.assign_task(body)
    return True


@router.put("/kanban/task/reorder")
async def reorder_tasks(
    body: TaskReorderReq,
    session: SessionDep,
    _user: KanbanAssignUser,
) -> bool:
    """拖拽排序:按 body.task_ids 顺序批量写 kanban_order。"""
    svc = PpdKanbanService(session)
    await svc.reorder_tasks(body.user_id, body.task_ids)
    return True


@router.get("/kanban/search/users", response_model=list[UserColumnVO])
async def search_users(
    session: SessionDep,
    _user: KanbanViewUser,
    keyword: str = Query(..., description="搜索关键词 (user_name 模糊)"),
) -> list[UserColumnVO]:
    """搜人 (按 project_member.user_name 模糊匹配)。"""
    svc = PpdKanbanService(session)
    return await svc.search_users(keyword)


__all__ = ["router"]
