"""HTTP routes for worktree lease management."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.worktree.schema import (
    WorktreeAcquireRequest,
    WorktreeExtendRequest,
    WorktreeLeaseList,
    WorktreeLeaseRead,
)
from app.modules.worktree.service import WorktreeService

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["worktree"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


# ── Workspace-scoped endpoints ──────────────────────────────────────────


@router.post(
    "/worktrees/acquire",
    response_model=WorktreeLeaseRead,
    status_code=status.HTTP_201_CREATED,
)
async def acquire_worktree(
    workspace_id: uuid.UUID,
    data: WorktreeAcquireRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_RUN_AGENT))],
) -> WorktreeLeaseRead:
    service = WorktreeService(session)
    lease = await service.acquire(user.id, workspace_id, data)
    return WorktreeLeaseRead.model_validate(lease)


@router.get(
    "/worktrees",
    response_model=WorktreeLeaseList,
)
async def list_worktrees(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_ADMIN))],
) -> WorktreeLeaseList:
    service = WorktreeService(session)
    items, total = await service.list_(workspace_id)
    return WorktreeLeaseList(
        items=[WorktreeLeaseRead.model_validate(i) for i in items],
        total=total,
    )


# ── Lease-scoped endpoints (no workspace_id in path) ────────────────────

lease_router = APIRouter(tags=["worktree"])

CurrentUser = Annotated[User, Depends(get_current_user)]


@lease_router.get(
    "/worktrees/{lease_id}",
    response_model=WorktreeLeaseRead,
)
async def get_worktree(
    lease_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> WorktreeLeaseRead:
    service = WorktreeService(session)
    lease = await service.get_lease(lease_id, user.id, user.is_platform_admin)
    return WorktreeLeaseRead.model_validate(lease)


@lease_router.post(
    "/worktrees/{lease_id}/release",
    response_model=WorktreeLeaseRead,
)
async def release_worktree(
    lease_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> WorktreeLeaseRead:
    service = WorktreeService(session)
    lease = await service.release(lease_id, user.id, user.is_platform_admin)
    return WorktreeLeaseRead.model_validate(lease)


@lease_router.post(
    "/worktrees/{lease_id}/extend",
    response_model=WorktreeLeaseRead,
)
async def extend_worktree(
    lease_id: uuid.UUID,
    data: WorktreeExtendRequest,
    session: SessionDep,
    user: CurrentUser,
) -> WorktreeLeaseRead:
    service = WorktreeService(session)
    lease = await service.extend(lease_id, user.id, data.additional_seconds)
    return WorktreeLeaseRead.model_validate(lease)
