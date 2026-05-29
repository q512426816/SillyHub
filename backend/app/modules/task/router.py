"""HTTP routes for tasks."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.task.schema import (
    TaskBoard,
    TaskBoardColumn,
    TaskList,
    TaskParseWarning,
    TaskRead,
    TaskReparseResponse,
    TaskReparseStats,
    TaskSummary,
)
from app.modules.task.service import TaskService

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["task"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get(
    "/changes/{change_id}/tasks",
    response_model=TaskList,
)
async def list_tasks(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
    task_status: str | None = Query(None, alias="status"),
    owner: str | None = Query(None),
    priority: str | None = Query(None),
    phase: str | None = Query(None),
) -> TaskList:
    service = TaskService(session)
    items, total = await service.list_(
        workspace_id,
        change_id,
        status=task_status,
        owner=owner,
        priority=priority,
        phase=phase,
    )
    enriched = await service.enrich_summaries(items)
    return TaskList(items=enriched, total=total)


@router.get(
    "/tasks/{task_id}",
    response_model=TaskRead,
)
async def get_task(
    workspace_id: uuid.UUID,
    task_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
) -> TaskRead:
    service = TaskService(session)
    task = await service.get(workspace_id, task_id)
    return await service.enrich_with_workspace_ids(task)


@router.get(
    "/changes/{change_id}/tasks/board",
    response_model=TaskBoard,
)
async def get_task_board(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
) -> TaskBoard:
    service = TaskService(session)
    columns = await service.get_board(workspace_id, change_id)
    enriched_columns = []
    for c in columns:
        enriched_items = await service.enrich_summaries(c["items"])
        enriched_columns.append(
            TaskBoardColumn(
                status=c["status"],
                count=c["count"],
                items=enriched_items,
            )
        )
    return TaskBoard(columns=enriched_columns)


@router.post(
    "/changes/{change_id}/tasks/reparse",
    response_model=TaskReparseResponse,
    status_code=status.HTTP_200_OK,
)
async def reparse_tasks(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.TASK_CREATE))],
) -> TaskReparseResponse:
    service = TaskService(session)
    stats, result = await service.reparse(workspace_id, change_id)
    warnings = [
        TaskParseWarning(
            code=w.code,
            detail=w.detail,
            task_key=w.task_key,
        )
        for w in result.warnings
    ]
    return TaskReparseResponse(
        workspace_id=str(workspace_id),
        change_id=str(change_id),
        stats=TaskReparseStats(**stats),
        warnings=warnings,
    )
