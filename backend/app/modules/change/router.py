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
    ArchiveGateResponse,
    ChangeDocContent,
    ChangeDocMatrix,
    ChangeDocMatrixEntry,
    ChangeList,
    ChangeRead,
    ChangeReparseResponse,
    ChangeReparseStats,
    ChangeWarning,
    DispatchResponse,
    DocumentsSyncRequest,
    DocumentsSyncResponse,
    FeedbackRequest,
    HumanTestRequest,
    OkResponse,
    PlanReviewRequest,
    ProgressUpdate,
    ProposalReviewRequest,
    RejectRequest,
    ReviewResponse,
    TransitionDispatchResponse,
    TransitionRequest,
    TransitionResponse,
)
from app.modules.change.service import ChangeService

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["change"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _get_user_role(user: User) -> str:
    if getattr(user, "is_platform_admin", False):
        return "admin"
    return "business_user"


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
    docs, prototypes, references = await service.get_documents(workspace_id, change_id)
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


# ── Workflow endpoints ───────────────────────────────────────────────────


@router.post(
    "/changes/{change_id}/transition",
    response_model=TransitionResponse,
)
async def transition_change(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: TransitionRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> TransitionResponse:
    service = ChangeService(session)
    result = await service.transition_with_dispatch(
        workspace_id=workspace_id,
        change_id=change_id,
        target_stage=body.target_stage,
        user_role=_get_user_role(_user),
        reason=body.reason,
        user_id=_user.id,
    )
    # Enrich the change data for the response
    enriched_change = await service.enrich_with_workspace_ids(result["change"])

    # Build agent_dispatch: convert raw dict to TransitionDispatchResponse or None
    agent_dispatch: TransitionDispatchResponse | None = None
    raw_dispatch = result.get("agent_dispatch")
    if raw_dispatch and raw_dispatch.get("dispatched") is True:
        agent_dispatch = TransitionDispatchResponse(
            dispatched=True,
            agent_run_id=raw_dispatch.get("agent_run_id"),
            stage=raw_dispatch.get("stage"),
            reason=None,
        )

    return TransitionResponse(
        change=enriched_change.model_dump(),
        agent_dispatch=agent_dispatch,
    )


@router.post(
    "/changes/{change_id}/feedback",
    response_model=ChangeRead,
)
async def submit_feedback(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: FeedbackRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ChangeRead:
    service = ChangeService(session)
    change = await service.submit_feedback(
        workspace_id,
        change_id,
        category=body.category,
        text=body.text,
        user_id=_user.id,
        target_stage=body.target_stage,
    )
    return await service.enrich_with_workspace_ids(change)


@router.get(
    "/changes/{change_id}/archive-gate",
    response_model=ArchiveGateResponse,
)
async def check_archive_gate(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> ArchiveGateResponse:
    service = ChangeService(session)
    return await service.check_archive_gate(workspace_id, change_id)


# ── Review Gate endpoints ────────────────────────────────────────────────


@router.post(
    "/changes/{change_id}/proposal-review",
    response_model=ReviewResponse,
)
async def proposal_review(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: ProposalReviewRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ReviewResponse:
    service = ChangeService(session)
    result = await service.proposal_review(
        workspace_id,
        change_id,
        body.decision,
        body.comment,
        _user.id,
    )
    enriched = await service.enrich_with_workspace_ids(result["change"])
    raw_dispatch = result.get("agent_dispatch")
    agent_dispatch = None
    if raw_dispatch and raw_dispatch.get("dispatched"):
        agent_dispatch = TransitionDispatchResponse(
            dispatched=True,
            agent_run_id=raw_dispatch.get("agent_run_id"),
            stage=raw_dispatch.get("stage"),
        )
    return ReviewResponse(change=enriched.model_dump(), agent_dispatch=agent_dispatch)


@router.post(
    "/changes/{change_id}/plan-review",
    response_model=ReviewResponse,
)
async def plan_review(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: PlanReviewRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ReviewResponse:
    service = ChangeService(session)
    result = await service.plan_review(
        workspace_id,
        change_id,
        body.decision,
        body.comment,
        _user.id,
    )
    enriched = await service.enrich_with_workspace_ids(result["change"])
    raw_dispatch = result.get("agent_dispatch")
    agent_dispatch = None
    if raw_dispatch and raw_dispatch.get("dispatched"):
        agent_dispatch = TransitionDispatchResponse(
            dispatched=True,
            agent_run_id=raw_dispatch.get("agent_run_id"),
            stage=raw_dispatch.get("stage"),
        )
    return ReviewResponse(change=enriched.model_dump(), agent_dispatch=agent_dispatch)


@router.post(
    "/changes/{change_id}/human-test",
    response_model=ReviewResponse,
)
async def human_test(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: HumanTestRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ReviewResponse:
    service = ChangeService(session)
    result = await service.human_test(
        workspace_id,
        change_id,
        body.result,
        body.comment,
        _user.id,
    )
    enriched = await service.enrich_with_workspace_ids(result["change"])
    raw_dispatch = result.get("agent_dispatch")
    agent_dispatch = None
    if raw_dispatch and raw_dispatch.get("dispatched"):
        agent_dispatch = TransitionDispatchResponse(
            dispatched=True,
            agent_run_id=raw_dispatch.get("agent_run_id"),
            stage=raw_dispatch.get("stage"),
        )
    return ReviewResponse(change=enriched.model_dump(), agent_dispatch=agent_dispatch)


# ── Agent dispatch endpoints ────────────────────────────────────────────


@router.get(
    "/changes/{change_id}/agent-status",
    response_model=DispatchResponse,
)
async def get_agent_status(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> DispatchResponse:
    """Get the current agent dispatch status for a change."""
    from app.modules.change.dispatch import get_config_for_stage, has_active_run

    service = ChangeService(session)
    change = await service.get(workspace_id, change_id)

    current_stage = change.current_stage or "draft"
    config = get_config_for_stage(current_stage)
    has_active = await has_active_run(session, change_id)

    # Extract last_dispatch from stages JSON
    stages = change.stages or {}
    last_dispatch = stages.get("last_dispatch")

    return DispatchResponse(
        change_id=change_id,
        current_stage=current_stage,
        has_active_run=has_active,
        config_enabled=config is not None and config.enabled if config else False,
        last_dispatch=last_dispatch,
    )


@router.post(
    "/changes/{change_id}/dispatch",
    response_model=DispatchResponse,
)
async def manual_dispatch(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> DispatchResponse:
    """Manually trigger agent dispatch for the current stage of a change."""
    from app.modules.change.dispatch import dispatch, get_config_for_stage

    service = ChangeService(session)
    change = await service.get(workspace_id, change_id)

    current_stage = change.current_stage or "draft"
    config = get_config_for_stage(current_stage)

    if config is None or not config.enabled:
        return DispatchResponse(
            change_id=change_id,
            current_stage=current_stage,
            has_active_run=False,
            config_enabled=False,
            last_dispatch=None,
        )

    dispatch_result = await dispatch(
        session=session,
        workspace_id=workspace_id,
        change_id=change_id,
        target_stage=current_stage,
        user_id=_user.id,
    )

    # Refresh change to get updated stages
    await session.refresh(change)
    stages = change.stages or {}
    last_dispatch = stages.get("last_dispatch")

    return DispatchResponse(
        change_id=change_id,
        current_stage=current_stage,
        has_active_run=dispatch_result.get("dispatched", False),
        config_enabled=True,
        last_dispatch=last_dispatch,
        dispatch_result=dispatch_result,
    )
