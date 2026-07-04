"""HTTP routes for change writer."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
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
    ProxyCreateChangeRequest,
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

    # Auto-dispatch brainstorm agent (best-effort, non-blocking)
    dispatch_info = None
    try:
        from app.core.db import get_session_factory
        from app.modules.change.dispatch import dispatch

        change.current_stage = "brainstorm"
        session.add(change)
        await session.commit()

        factory = get_session_factory()
        async with factory() as dispatch_session:
            dispatch_info = await dispatch(
                session=dispatch_session,
                workspace_id=workspace_id,
                change_id=change.id,
                target_stage="brainstorm",
                user_id=user.id,
            )
    except Exception as exc:
        from app.core.logging import get_logger

        log = get_logger(__name__)
        log.warning(
            "auto_brainstorm_dispatch_failed",
            change_id=str(change.id),
            error=str(exc),
        )

    response = ChangeCreateResponse.model_validate(change)
    response.agent_dispatch = dispatch_info
    return response


@router.post(
    "/changes/proxy-create",
    response_model=ChangeCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def proxy_create_change(
    workspace_id: uuid.UUID,
    data: ProxyCreateChangeRequest,
    session: SessionDep,
    user: CurrentUser,
) -> ChangeCreateResponse:
    """daemon-client 变更代写入口 (design §5.3 Phase 3 / D-004@v1)。

    与 server-local ``/changes/create`` 区分：
    - 不传 ``lease_id``，改传 ``runtime_id``（绑定在线 daemon）。
    - 经 ``service.create_change(..., runtime_id=...)`` 走 proxy 路径（lease-polling
      下发 daemon_change_writes → 等回执 → 落库 Change）。
    - **不自动 dispatch brainstorm**（daemon-client change 暂不接 agent 流；agent
      dispatch 由 task-12/后续接，避免与 server-local auto-dispatch 语义混淆）。

    daemon 离线 / runtime 不绑定 → 400 ``DAEMON_CLIENT_NO_SESSION``（service 层抛）。
    """
    service = ChangeWriterService(session)
    change = await service.create_change(
        workspace_id,
        user.id,
        title=data.title,
        change_type=data.change_type,
        runtime_id=data.runtime_id,
        description=data.description,
    )

    response = ChangeCreateResponse.model_validate(change)
    response.agent_dispatch = None
    return response


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
        lease_id=data.lease_id,
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
    provider: str | None = Query(None),
    model: str | None = Query(None),
) -> dict:
    """Trigger change execution — dispatch via unified stage dispatch service."""
    from sqlalchemy import select
    from sqlmodel import col

    from app.core.errors import AppError
    from app.modules.change.dispatch import SillySpecStageDispatchService
    from app.modules.change.model import Change

    # Look up the change record
    stmt = select(Change).where(
        col(Change.workspace_id) == workspace_id,
        col(Change.change_key) == change_key,
    )
    change = (await session.execute(stmt)).scalars().first()
    if change is None:
        raise AppError(f"Change '{change_key}' not found.", http_status=404)

    # Dispatch via unified service
    service = SillySpecStageDispatchService(session)
    result = await service.dispatch_next_step(
        session=session,
        workspace_id=workspace_id,
        change_id=change.id,
        user_id=user.id,
        target_stage="execute",
        provider=provider,
        model=model,
    )

    if not result.get("dispatched"):
        return {
            "ok": False,
            "reason": result.get("reason", "dispatch_failed"),
            "stage": result.get("stage"),
        }

    return {
        "ok": True,
        "run_id": result["agent_run_id"],
        "stage": result.get("stage"),
    }
