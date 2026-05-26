"""HTTP routes for the workspace module.

Authentication / authorization land with task-04; in V1 the routes accept an
optional ``X-Debug-User`` header for testing only. **DO NOT** rely on this in
production — it is a development-only shim.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
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
DebugUserHeader = Annotated[str | None, Header(alias="X-Debug-User")]


def _build_scan_response(result: ScanResult) -> ScanResponse:
    return ScanResponse(
        root_path=result.root_path,
        sillyspec_path=result.sillyspec_path,
        is_sillyspec=result.is_sillyspec,
        structure=WorkspaceStructureDTO(**result.structure.as_dict()),
        warnings=list(result.warnings),
    )


def _parse_debug_user(raw: str | None) -> uuid.UUID | None:
    """Decode the dev-only ``X-Debug-User`` header. Returns ``None`` if absent / invalid."""
    if not raw:
        return None
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None


@router.post("/scan", response_model=ScanResponse)
async def scan_workspace(payload: ScanRequest, session: SessionDep) -> ScanResponse:
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
    x_debug_user: DebugUserHeader = None,
) -> WorkspaceRead:
    service = WorkspaceService(session)
    workspace = await service.create(payload, created_by=_parse_debug_user(x_debug_user))
    return WorkspaceRead.model_validate(workspace)


@router.get("", response_model=WorkspaceListResponse)
async def list_workspaces(
    session: SessionDep,
    include_deleted: Annotated[bool, Query(description="Admin-only flag")] = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> WorkspaceListResponse:
    service = WorkspaceService(session)
    items, total = await service.list_(
        include_deleted=include_deleted,
        limit=limit,
        offset=offset,
    )
    return WorkspaceListResponse(
        items=[WorkspaceRead.model_validate(w) for w in items],
        total=total,
    )


@router.get("/{workspace_id}", response_model=WorkspaceRead)
async def get_workspace(workspace_id: uuid.UUID, session: SessionDep) -> WorkspaceRead:
    service = WorkspaceService(session)
    return WorkspaceRead.model_validate(await service.get(workspace_id))


@router.post("/{workspace_id}/rescan", response_model=ScanResponse)
async def rescan_workspace(workspace_id: uuid.UUID, session: SessionDep) -> ScanResponse:
    service = WorkspaceService(session)
    _, scan = await service.rescan(workspace_id)
    return _build_scan_response(scan)


@router.delete(
    "/{workspace_id}",
    response_model=WorkspaceRead,
    status_code=status.HTTP_200_OK,
)
async def delete_workspace(workspace_id: uuid.UUID, session: SessionDep) -> WorkspaceRead:
    service = WorkspaceService(session)
    return WorkspaceRead.model_validate(await service.soft_delete(workspace_id))
