"""HTTP routes for the workspace module.

Authentication / authorization (task-04a auth slice).\n
All workspace endpoints are protected via ``get_current_user`` and RBAC\n
permissions from ``references/16-rbac.md``.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.auth_deps import require_permission, require_permission_any
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import allowed_workspace_ids
from app.modules.workspace.model import Workspace
from app.modules.workspace.scanner import ScanResult
from app.modules.workspace.schema import (
    ScanRequest,
    ScanResponse,
    WorkspaceCreate,
    WorkspaceListResponse,
    WorkspaceRead,
    WorkspaceStructureDTO,
)
from app.modules.workspace.service import WorkspaceService

router = APIRouter(prefix="/workspaces", tags=["workspace"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _build_scan_response(result: ScanResult) -> ScanResponse:
    return ScanResponse(
        root_path=result.root_path,
        sillyspec_path=result.sillyspec_path,
        is_sillyspec=result.is_sillyspec,
        structure=WorkspaceStructureDTO(**result.structure.as_dict()),
        warnings=list(result.warnings),
    )


@router.post("/scan", response_model=ScanResponse)
async def scan_workspace(
    payload: ScanRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_READ))],
) -> ScanResponse:
    service = WorkspaceService(session)
    return _build_scan_response(service.scan(payload.root_path))


@router.post(
    "",
    response_model=WorkspaceRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_workspace(
    payload: WorkspaceCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_WRITE))],
) -> WorkspaceRead:
    service = WorkspaceService(session)
    workspace = await service.create(payload, created_by=user.id)
    return WorkspaceRead.model_validate(workspace)


@router.get("", response_model=WorkspaceListResponse)
async def list_workspaces(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_READ))],
    include_deleted: Annotated[bool, Query(description="Admin-only flag")] = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> WorkspaceListResponse:
    if user.is_platform_admin:
        service = WorkspaceService(session)
        items, total = await service.list_(
            include_deleted=include_deleted,
            limit=limit,
            offset=offset,
        )
    else:
        allowed = await allowed_workspace_ids(
            session, user_id=user.id, permission=Permission.WORKSPACE_READ
        )
        stmt = select(Workspace).where(
            col(Workspace.id).in_(allowed) if allowed else col(Workspace.id).in_([])
        )
        if not include_deleted:
            stmt = stmt.where(col(Workspace.deleted_at).is_(None))
        stmt = stmt.order_by(col(Workspace.created_at).desc()).limit(limit).offset(offset)
        items = list((await session.execute(stmt)).scalars().all())

        count_stmt = select(Workspace).where(
            col(Workspace.id).in_(allowed) if allowed else col(Workspace.id).in_([])
        )
        if not include_deleted:
            count_stmt = count_stmt.where(col(Workspace.deleted_at).is_(None))
        total = len((await session.execute(count_stmt)).scalars().all())

    return WorkspaceListResponse(
        items=[WorkspaceRead.model_validate(w) for w in items],
        total=total,
    )


@router.get("/{workspace_id}", response_model=WorkspaceRead)
async def get_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> WorkspaceRead:
    service = WorkspaceService(session)
    return WorkspaceRead.model_validate(await service.get(workspace_id))


@router.post("/{workspace_id}/rescan", response_model=ScanResponse)
async def rescan_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> ScanResponse:
    service = WorkspaceService(session)
    _, scan = await service.rescan(workspace_id)
    return _build_scan_response(scan)


@router.delete(
    "/{workspace_id}",
    response_model=WorkspaceRead,
    status_code=status.HTTP_200_OK,
)
async def delete_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_ADMIN))],
) -> WorkspaceRead:
    service = WorkspaceService(session)
    return WorkspaceRead.model_validate(await service.soft_delete(workspace_id))
