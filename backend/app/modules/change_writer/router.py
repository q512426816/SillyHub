"""HTTP routes for change writer."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.change_writer.schema import (
    BatchGenerateRequest,
    BatchGenerateResponse,
    ChangeCreateRequest,
    ChangeCreateResponse,
    MarkdownGenerateRequest,
    MarkdownGenerateResponse,
)
from app.modules.change_writer.service import ChangeWriterService

router = APIRouter(
    prefix="/workspaces/{workspace_id}",
    tags=["change_writer"],
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.post(
    "/changes/create",
    response_model=ChangeCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_change(
    workspace_id: uuid.UUID,
    data: ChangeCreateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> ChangeCreateResponse:
    service = ChangeWriterService(session)
    change = await service.create_change(
        workspace_id,
        user.id,
        title=data.title,
        change_type=data.change_type,
        affected_components=data.affected_components,
        lease_id=data.lease_id,
        description=data.description,
    )
    return ChangeCreateResponse.model_validate(change)


@router.post(
    "/changes/{change_id}/documents/generate",
    response_model=MarkdownGenerateResponse,
)
async def generate_document(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    data: MarkdownGenerateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> MarkdownGenerateResponse:
    service = ChangeWriterService(session)
    rel_path, size = await service.generate_document(
        workspace_id,
        user.id,
        change_id=change_id,
        doc_type=data.doc_type,
        content=data.content,
        lease_id=data.lease_id,  # type: ignore[arg-type]
    )
    return MarkdownGenerateResponse(doc_type=data.doc_type, path=rel_path, size=size)


@router.post(
    "/changes/{change_id}/documents/batch-generate",
    response_model=BatchGenerateResponse,
)
async def batch_generate_documents(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    data: BatchGenerateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> BatchGenerateResponse:
    service = ChangeWriterService(session)
    generated = await service.batch_generate_templates(
        workspace_id,
        user.id,
        change_id=change_id,
        doc_types=data.doc_types,
    )
    return BatchGenerateResponse(generated=generated)
