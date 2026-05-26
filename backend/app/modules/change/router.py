"""HTTP routes for changes."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.change.schema import (
    ChangeDocContent,
    ChangeDocMatrix,
    ChangeDocMatrixEntry,
    ChangeList,
    ChangeRead,
    ChangeReparseResponse,
    ChangeReparseStats,
    ChangeSummary,
    ChangeWarning,
)
from app.modules.change.service import ChangeService

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["change"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get(
    "/changes",
    response_model=ChangeList,
)
async def list_changes(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
    location: str | None = Query(None),
    status: str | None = Query(None),
    owner: str | None = Query(None),
) -> ChangeList:
    service = ChangeService(session)
    items, total = await service.list_(
        workspace_id,
        location=location,
        status=status,
        owner=owner,
    )
    return ChangeList(
        items=[ChangeSummary.model_validate(c) for c in items],
        total=total,
    )


@router.get(
    "/changes/{change_id}",
    response_model=ChangeRead,
)
async def get_change(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> ChangeRead:
    service = ChangeService(session)
    change = await service.get(workspace_id, change_id)
    return ChangeRead.model_validate(change)


@router.get(
    "/changes/{change_id}/documents",
    response_model=ChangeDocMatrix,
)
async def get_change_documents(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> ChangeDocMatrix:
    service = ChangeService(session)
    docs, prototypes, references = await service.get_documents(
        workspace_id, change_id
    )
    return ChangeDocMatrix(
        change_id=change_id,
        documents=[
            ChangeDocMatrixEntry(
                doc_type=d.doc_type,
                exists=d.exists,
                path=d.path,
                status=d.status,
                last_modified_at=d.last_modified_at,
            )
            for d in docs
        ],
        prototypes=prototypes,
        references=references,
    )


@router.get(
    "/changes/{change_id}/documents/{doc_type}",
    response_model=ChangeDocContent,
)
async def get_change_document(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    doc_type: str,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
    path: str | None = Query(None),
) -> ChangeDocContent:
    service = ChangeService(session)
    doc_path, content, exists = await service.get_document_content(
        workspace_id, change_id, doc_type, file_path=path
    )
    return ChangeDocContent(
        doc_type=doc_type,
        path=doc_path,
        content=content,
        exists=exists,
    )


@router.post(
    "/changes/reparse",
    response_model=ChangeReparseResponse,
    status_code=status.HTTP_200_OK,
)
async def reparse_changes(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ChangeReparseResponse:
    service = ChangeService(session)
    stats, result = await service.reparse(workspace_id)
    warnings: list[ChangeWarning] = []
    for w in result.warnings:
        warnings.append(
            ChangeWarning(
                code=w.code,
                detail=w.detail,
                change_key=w.change_key,
                doc_type=w.doc_type,
            )
        )
    return ChangeReparseResponse(
        workspace_id=workspace_id,
        stats=ChangeReparseStats(**stats),
        warnings=warnings,
    )
