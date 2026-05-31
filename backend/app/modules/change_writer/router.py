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


@router.post(
    "/changes/{change_key}/execute",
    response_model=dict,
)
async def execute_change(
    workspace_id: uuid.UUID,
    change_key: str,
    session: SessionDep,
    user: CurrentUser,
) -> dict:
    """Trigger change execution — create a SillySpec AgentRun and dispatch in background."""
    from pathlib import Path

    from sqlalchemy import select
    from sqlmodel import col

    from app.core.errors import AppError, WorkspaceNotFound
    from app.modules.agent.coordinator import ExecutionCoordinatorService
    from app.modules.change.model import Change
    from app.modules.workspace.model import Workspace
    from app.modules.workspace.service import _rewrite_path

    # Look up the change record
    stmt = select(Change).where(
        col(Change.workspace_id) == workspace_id,
        col(Change.change_key) == change_key,
    )
    change = (await session.execute(stmt)).scalars().first()
    if change is None:
        raise AppError(f"Change '{change_key}' not found.", http_status=404)

    # ── Stage guard (task-04) ──────────────────────────────────────────────
    current_stage = getattr(change, "current_stage", None) or "draft"
    if current_stage != "ready_for_dev":
        raise AppError(
            f"Change '{change_key}' 当前阶段为 '{current_stage}'，"
            f"仅当阶段为 'ready_for_dev' 时可执行。"
            f"请先完成设计评审并流转至 ready_for_dev。",
            http_status=409,
        )
    # ── End stage guard ────────────────────────────────────────────────────

    # Resolve repo directory from workspace
    workspace = await session.get(Workspace, workspace_id)
    if workspace is None:
        raise WorkspaceNotFound("Workspace not found.")
    repo_dir = Path(_rewrite_path(workspace.root_path))

    # Determine scope from change_type, default to "full"
    scope = change.change_type if change.change_type in ("full", "quick") else "full"

    coordinator = ExecutionCoordinatorService(session)
    run = await coordinator.start_sillyspec_run(
        change_key=change_key,
        workspace_id=workspace_id,
        user_id=user.id,
        scope=scope,
        repo_dir=repo_dir,
    )

    return {"ok": True, "run_id": str(run.id)}
