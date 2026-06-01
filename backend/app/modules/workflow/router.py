"""HTTP routes for workflow — transitions, reviews, audit logs."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.workflow.schema import (
    AuditLogEntry,
    ReviewResponse,
    ReviewSubmitRequest,
    TaskTransitionRequest,
    TaskTransitionResponse,
    TransitionRequest,
    TransitionResponse,
)
from app.modules.workflow.service import WorkflowService

router = APIRouter(tags=["workflow"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.post(
    "/workspaces/{workspace_id}/changes/{change_id}/transition",
    response_model=TransitionResponse,
)
async def transition_change(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    data: TransitionRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.CHANGE_UPDATE))],
) -> TransitionResponse:
    svc = WorkflowService(session)
    change, prev = await svc.transition_change(
        workspace_id,
        change_id,
        user.id,
        data.target,
    )
    return TransitionResponse(id=change.id, status=change.status, previous_status=prev)


@router.post(
    "/workspaces/{workspace_id}/changes/{change_id}/reviews",
    response_model=ReviewResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_review(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    data: ReviewSubmitRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.CHANGE_APPROVE))],
) -> ReviewResponse:
    svc = WorkflowService(session)
    review = await svc.submit_review(
        workspace_id,
        change_id,
        user.id,
        data.verdict,
        data.comment,
    )
    return ReviewResponse.model_validate(review)


@router.get(
    "/workspaces/{workspace_id}/changes/{change_id}/reviews",
    response_model=list[ReviewResponse],
)
async def list_reviews(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> list[ReviewResponse]:
    svc = WorkflowService(session)
    reviews = await svc.list_reviews(workspace_id, change_id)
    return [ReviewResponse.model_validate(r) for r in reviews]


@router.get(
    "/workspaces/{workspace_id}/audit",
    response_model=list[AuditLogEntry],
)
async def list_audit_logs(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
    resource_type: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
) -> list[AuditLogEntry]:
    svc = WorkflowService(session)
    logs = await svc.list_audit_logs(
        workspace_id,
        resource_type=resource_type,
        limit=limit,
    )
    return [AuditLogEntry.model_validate(e) for e in logs]


@router.post(
    "/workspaces/{workspace_id}/tasks/{task_id}/transition",
    response_model=TaskTransitionResponse,
)
async def transition_task(
    workspace_id: uuid.UUID,
    task_id: uuid.UUID,
    data: TaskTransitionRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_ASSIGN))],
) -> TaskTransitionResponse:
    svc = WorkflowService(session)
    task, prev = await svc.transition_task(
        workspace_id,
        task_id,
        user.id,
        data.target,
    )
    return TaskTransitionResponse(id=task.id, status=task.status, previous_status=prev)
