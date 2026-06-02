"""HTTP routes for the spec_workspace module.

Provides REST endpoints for managing spec workspaces, import/sync
operations, and spec conflict resolution.

author: qinyi
created_at: 2026-05-27
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.core.errors import SpecConflictNotFound
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.spec_profile.model import SpecConflict
from app.modules.spec_profile.schema import (
    SpecConflictListResponse,
    SpecConflictRead,
    SpecConflictResolve,
)
from app.modules.spec_workspace.bootstrap import SpecBootstrapService
from app.modules.spec_workspace.schema import (
    SpecBootstrapRunStartResponse,
    SpecWorkspaceRead,
    SpecWorkspaceUpdate,
)
from app.modules.spec_workspace.service import SpecWorkspaceService

log = get_logger(__name__)

router = APIRouter(
    prefix="/workspaces/{workspace_id}",
    tags=["spec-workspace"],
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


# ── Spec Workspace ─────────────────────────────────────────────────────────────


@router.get("/spec-workspace", response_model=SpecWorkspaceRead)
async def get_spec_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> SpecWorkspaceRead:
    """Return the spec workspace associated with the given workspace."""
    service = SpecWorkspaceService(session)
    spec_ws = await service.get(workspace_id)
    return SpecWorkspaceRead.model_validate(spec_ws)


@router.post(
    "/spec-workspace/import",
    response_model=SpecWorkspaceRead,
)
async def import_spec_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> SpecWorkspaceRead:
    """Import spec files from the repo ``.sillyspec`` directory into the
    platform-managed spec workspace.

    This is a stub implementation — the actual filesystem import logic will be
    added in a later wave.
    """
    service = SpecWorkspaceService(session)
    spec_ws = await service.import_from_repo(workspace_id)
    return SpecWorkspaceRead.model_validate(spec_ws)


@router.post(
    "/spec-workspace/sync",
    response_model=SpecWorkspaceRead,
)
async def sync_spec_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> SpecWorkspaceRead:
    """Synchronise the platform spec workspace with the repo ``.sillyspec``
    directory (bidirectional for ``repo-mirrored`` strategy).

    This is a stub implementation — the actual sync logic will be added in a
    later wave.
    """
    service = SpecWorkspaceService(session)
    spec_ws = await service.sync(workspace_id)
    return SpecWorkspaceRead.model_validate(spec_ws)


@router.patch("/spec-workspace", response_model=SpecWorkspaceRead)
async def update_spec_workspace(
    workspace_id: uuid.UUID,
    payload: SpecWorkspaceUpdate,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> SpecWorkspaceRead:
    """Update mutable spec workspace configuration (strategy, repo path, etc.)."""
    service = SpecWorkspaceService(session)
    spec_ws = await service.update(workspace_id, payload)
    return SpecWorkspaceRead.model_validate(spec_ws)


@router.post(
    "/spec-bootstrap",
    response_model=SpecBootstrapRunStartResponse,
)
async def bootstrap_spec_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> SpecBootstrapRunStartResponse:
    """Launch an asynchronous bootstrap AgentRun for the spec workspace.

    Creates a pending AgentRun, writes a start audit event, links the run
    to the workspace, and returns immediately with the run ID and stream URL.
    The actual execution (ClaudeCodeAdapter + SillySpec CLI + validation)
    happens in a background task.
    """
    service = SpecBootstrapService(session)
    result = await service.bootstrap(workspace_id, user_id=_user.id)
    return SpecBootstrapRunStartResponse(**result)


# ── Spec Conflicts ─────────────────────────────────────────────────────────────


@router.get("/spec-conflicts", response_model=SpecConflictListResponse)
async def list_spec_conflicts(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> SpecConflictListResponse:
    """List spec conflicts for the given workspace, optionally filtered by
    status.
    """
    stmt = select(SpecConflict).where(
        SpecConflict.workspace_id == workspace_id,
    )
    count_stmt = (
        select(func.count())
        .select_from(SpecConflict)
        .where(
            SpecConflict.workspace_id == workspace_id,
        )
    )

    if status_filter is not None:
        stmt = stmt.where(col(SpecConflict.status) == status_filter)
        count_stmt = count_stmt.where(col(SpecConflict.status) == status_filter)

    stmt = stmt.order_by(col(SpecConflict.created_at).desc()).limit(limit).offset(offset)

    items = list((await session.execute(stmt)).scalars().all())
    total = (await session.execute(count_stmt)).scalar() or 0

    return SpecConflictListResponse(
        items=[SpecConflictRead.model_validate(c) for c in items],
        total=total,
    )


@router.post(
    "/spec-conflicts/{conflict_id}/resolve",
    response_model=SpecConflictRead,
)
async def resolve_spec_conflict(
    workspace_id: uuid.UUID,
    conflict_id: uuid.UUID,
    payload: SpecConflictResolve,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> SpecConflictRead:
    """Resolve a spec conflict by setting its status and optional details."""
    conflict = await session.get(SpecConflict, conflict_id)
    if conflict is None or conflict.workspace_id != workspace_id:
        raise SpecConflictNotFound(
            "Spec conflict not found for the given workspace.",
            details={
                "workspace_id": str(workspace_id),
                "conflict_id": str(conflict_id),
            },
        )

    conflict.status = payload.status
    if payload.details_json is not None:
        conflict.details_json = payload.details_json

    await session.commit()
    await session.refresh(conflict)

    log.info(
        "spec_conflict.resolved",
        conflict_id=str(conflict_id),
        workspace_id=str(workspace_id),
        status=payload.status,
    )

    return SpecConflictRead.model_validate(conflict)
