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
    ApprovalRead,
    ApproveRequest,
    ChangeDocContent,
    ChangeDocMatrix,
    ChangeDocMatrixEntry,
    ChangeList,
    ChangeRead,
    ChangeReparseResponse,
    ChangeReparseStats,
    ChangeSummary,
    ChangeWarning,
    DocumentsSyncRequest,
    DocumentsSyncResponse,
    OkResponse,
    ProgressUpdate,
    RejectRequest,
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
    enriched = await service.enrich_summaries(items)
    return ChangeList(items=enriched, total=total)


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
    return await service.enrich_with_workspace_ids(change)


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


# ── Progress / Approval / Documents sync ─────────────────────────────────


@router.post(
    "/changes/{change_key}/progress",
    response_model=OkResponse,
)
async def update_progress(
    workspace_id: uuid.UUID,
    change_key: str,
    body: ProgressUpdate,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> OkResponse:
    service = ChangeService(session)
    await service.update_progress(
        workspace_id,
        change_key,
        current_stage=body.currentStage,
        stages=body.stages,
        last_active=body.lastActive,
    )
    return OkResponse()


@router.get(
    "/changes/{change_key}/approval",
    response_model=ApprovalRead,
)
async def get_approval(
    workspace_id: uuid.UUID,
    change_key: str,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> ApprovalRead:
    service = ChangeService(session)
    approval_status, reason = await service.get_approval(workspace_id, change_key)
    return ApprovalRead(status=approval_status, reason=reason)


@router.post(
    "/changes/{change_key}/approve",
    response_model=OkResponse,
)
async def approve_change(
    workspace_id: uuid.UUID,
    change_key: str,
    body: ApproveRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> OkResponse:
    service = ChangeService(session)
    await service.approve(workspace_id, change_key, approved_by=body.approved_by)
    return OkResponse()


@router.post(
    "/changes/{change_key}/reject",
    response_model=OkResponse,
)
async def reject_change(
    workspace_id: uuid.UUID,
    change_key: str,
    body: RejectRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> OkResponse:
    service = ChangeService(session)
    await service.reject(workspace_id, change_key, reason=body.reason)
    return OkResponse()


@router.post(
    "/changes/{change_key}/documents",
    response_model=DocumentsSyncResponse,
)
async def sync_documents(
    workspace_id: uuid.UUID,
    change_key: str,
    body: DocumentsSyncRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> DocumentsSyncResponse:
    service = ChangeService(session)
    docs = body.iter_documents()
    synced = await service.sync_documents(workspace_id, change_key, documents=docs)
    return DocumentsSyncResponse(synced=synced)
