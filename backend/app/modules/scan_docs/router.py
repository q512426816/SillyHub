"""HTTP routes for scan documents."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.scan_docs.schema import (
    ScanDocList,
    ScanDocRead,
    ScanDocReparseResponse,
    ScanDocReparseStats,
    ScanDocSummary,
    ScanDocWarning,
)
from app.modules.scan_docs.service import ScanDocsService

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["scan-docs"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get(
    "/scan-docs",
    response_model=ScanDocList,
)
async def list_scan_docs(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> ScanDocList:
    service = ScanDocsService(session)
    items, total = await service.list_(workspace_id)
    return ScanDocList(
        items=[ScanDocSummary.model_validate(d) for d in items],
        total=total,
    )


@router.get(
    "/scan-docs/{doc_id}",
    response_model=ScanDocRead,
)
async def get_scan_doc(
    workspace_id: uuid.UUID,
    doc_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> ScanDocRead:
    service = ScanDocsService(session)
    doc = await service.get(workspace_id, doc_id)
    return ScanDocRead.model_validate(doc)


@router.post(
    "/scan-docs/reparse",
    response_model=ScanDocReparseResponse,
    status_code=status.HTTP_200_OK,
)
async def reparse_scan_docs(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> ScanDocReparseResponse:
    service = ScanDocsService(session)
    stats, result = await service.reparse(workspace_id)
    warnings: list[ScanDocWarning] = []
    for w in result.warnings:
        warnings.append(
            ScanDocWarning(
                code=w.code,
                detail=w.detail,
                component_key=w.component_key,
                doc_type=w.doc_type,
            )
        )
    return ScanDocReparseResponse(
        workspace_id=workspace_id,
        stats=ScanDocReparseStats(**stats),
        warnings=warnings,
    )
