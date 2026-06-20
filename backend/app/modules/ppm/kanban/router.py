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
    CommentCreateReq,
    CommentVO,
    KanbanQueryReq,
    OrgGroup,
    SubtaskVO,
    TaskAssignReq,
    TaskCardVO,
    TaskCreateReq,
    TaskReorderReq,
    TaskUpdateReq,
    UserColumnVO,
)
from app.modules.ppm.kanban.service import PpdKanbanService, _parse_hours
from app.modules.ppm.task.model import PlanTask

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


# ---------------------------------------------------------------------------
# task-01: task CRUD + comment/subtask (FR-01 / D-011)
# ---------------------------------------------------------------------------


def _to_card(t: PlanTask) -> TaskCardVO:
    """PlanTask → TaskCardVO(含 file_urls)。"""
    return TaskCardVO(
        id=t.id,
        title=t.content,
        status=t.status,
        project_id=t.project_id,
        project_name=t.project_name,
        user_id=t.user_id,
        user_name=t.user_name,
        deadline=t.end_time,
        estimate_hours=_parse_hours(t.work_load),
        kanban_order=t.kanban_order,
        file_urls=list(t.file_urls or []),
    )


@router.post("/kanban/task", response_model=TaskCardVO, status_code=201)
async def create_task(
    body: TaskCreateReq,
    session: SessionDep,
    _user: KanbanAssignUser,
) -> TaskCardVO:
    """新建看板任务(PlanTask)。kanban_order 自动取该 user 列尾 +1。"""
    svc = PpdKanbanService(session)
    task = await svc.create_task(body)
    return _to_card(task)


@router.put("/kanban/task", response_model=TaskCardVO)
async def update_task(
    body: TaskUpdateReq,
    session: SessionDep,
    _user: KanbanAssignUser,
) -> TaskCardVO:
    """更新 task(content/status/work_load/end_time/file_urls 等非空字段)。"""
    svc = PpdKanbanService(session)
    task = await svc.update_task(body.task_id, body)
    return _to_card(task)


@router.delete("/kanban/task", status_code=204)
async def delete_task(
    session: SessionDep,
    _user: KanbanAssignUser,
    task_id: uuid.UUID = Query(..., description="任务 ID"),
) -> None:
    """删除 task,级联删其 comment + subtask。"""
    svc = PpdKanbanService(session)
    await svc.delete_task(task_id)


@router.get("/kanban/task/{task_id}/comments", response_model=list[CommentVO])
async def list_comments(
    task_id: uuid.UUID,
    session: SessionDep,
    _user: KanbanViewUser,
) -> list[CommentVO]:
    """列任务评论(按 created_at 升序)。"""
    svc = PpdKanbanService(session)
    comments = await svc.list_comments(task_id)
    return [CommentVO.model_validate(c) for c in comments]


@router.post("/kanban/task/{task_id}/comments", response_model=CommentVO, status_code=201)
async def add_comment(
    task_id: uuid.UUID,
    body: CommentCreateReq,
    session: SessionDep,
    _user: KanbanViewUser,
) -> CommentVO:
    """新增评论。空内容 → 422;task 不存在 → 404。"""
    svc = PpdKanbanService(session)
    comment = await svc.add_comment(task_id, _user, body.content)
    return CommentVO.model_validate(comment)


@router.get("/kanban/task/{task_id}/subtasks", response_model=list[SubtaskVO])
async def list_subtasks(
    task_id: uuid.UUID,
    session: SessionDep,
    _user: KanbanViewUser,
) -> list[SubtaskVO]:
    """列任务子任务(按 sort_order 升序)。"""
    svc = PpdKanbanService(session)
    subtasks = await svc.list_subtasks(task_id)
    return [SubtaskVO.model_validate(s) for s in subtasks]


@router.put("/kanban/task/{task_id}/subtask/{subtask_id}/toggle", response_model=SubtaskVO)
async def toggle_subtask(
    task_id: uuid.UUID,
    subtask_id: uuid.UUID,
    session: SessionDep,
    _user: KanbanViewUser,
) -> SubtaskVO:
    """翻转子任务 done 标志;subtask 不存在 / task_id 不匹配 → 404。"""
    svc = PpdKanbanService(session)
    subtask = await svc.toggle_subtask(task_id, subtask_id)
    return SubtaskVO.model_validate(subtask)
