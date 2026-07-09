"""HTTP routes for changes."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.change.schema import (
    ApprovalRead,
    ApproveRequest,
    ArchiveConfirmRequest,
    ArchiveGateResponse,
    ChangeDocMatrix,
    ChangeDocMatrixEntry,
    ChangeFileContent,
    ChangeFileEntry,
    ChangeFileList,
    ChangeFileWriteRequest,
    ChangeFileWriteResponse,
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
    PendingFileEntry,
    PendingFileList,
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
from app.modules.daemon.schema import AgentSessionListItem, ChangeSessionAuthor

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
    search: str | None = Query(None),
    current_stage: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
) -> ChangeList:
    service = ChangeService(session)
    items, total = await service.list_(
        workspace_id,
        location=location,
        status=status,
        owner=owner,
        search=search,
        current_stage=current_stage,
        page=page,
        page_size=page_size,
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


# ── File tree endpoints（2026-07-02-change-detail-file-tree-editor）──────


@router.get(
    "/changes/{change_id}/files",
    response_model=ChangeFileList,
)
async def list_change_files(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> ChangeFileList:
    service = ChangeService(session)
    items = await service.list_files(workspace_id, change_id)
    return ChangeFileList(
        change_id=change_id,
        items=[ChangeFileEntry(**it) for it in items],
    )


@router.get(
    "/changes/{change_id}/sessions",
    response_model=list[AgentSessionListItem],
)
async def list_change_sessions(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> list[AgentSessionListItem]:
    """列出某变更下的全部会话（2026-07-09-change-detail-session task-09）。

    跨成员可见（D-005@v1，不加 user_id 过滤），鉴权复用 CHANGE_READ（X-03）。
    标题取该会话最早一条 channel=user_input 的 AgentRunLog 摘要（前 30 字，X-04）。
    按 last_active_at desc 排序（Python 排序规避 PG/SQLite 方言差异）。
    """
    # 1. AgentSession where change_id=change_id（跨成员）。用 col(AgentSession.change_id)
    #    显式限定列名，避免与函数参数 change_id 同名遮蔽。
    sessions = (
        (
            await session.execute(
                select(AgentSession).where(col(AgentSession.change_id) == change_id)
            )
        )
        .scalars()
        .all()
    )
    if not sessions:
        return []

    session_ids = [s.id for s in sessions]
    user_ids = {s.user_id for s in sessions}

    # 2. 批量取作者展示名（避免 N+1）。
    users = (await session.execute(select(User).where(col(User.id).in_(user_ids)))).scalars().all()
    user_name_map: dict[uuid.UUID, str | None] = {u.id: u.display_name for u in users}

    # 3. 批量取每个 session 的首条 user_input 标题：JOIN AgentRun 过滤
    #    agent_session_id IN (...) + AgentRunLog.channel='user_input'，按
    #    (agent_session_id, AgentRunLog.timestamp asc) 取首条。Python 侧 group + 取最早。
    title_stmt = (
        select(
            AgentRun.agent_session_id.label("session_id"),
            AgentRunLog.timestamp.label("ts"),
            AgentRunLog.content_redacted.label("content"),
        )
        .join(AgentRunLog, AgentRunLog.run_id == AgentRun.id)
        .where(
            col(AgentRun.agent_session_id).in_(session_ids),
            col(AgentRunLog.channel) == "user_input",
        )
    )
    title_rows = (await session.execute(title_stmt)).all()
    first_input_by_session: dict[uuid.UUID, datetime] = {}
    content_by_session: dict[uuid.UUID, str] = {}
    for row in title_rows:
        sid = row.session_id
        ts = row.ts
        prev = first_input_by_session.get(sid)
        if prev is None or ts < prev:
            first_input_by_session[sid] = ts
            content_by_session[sid] = row.content or ""

    # 4. 组装 + 按 last_active_at desc 排序。
    items = [
        AgentSessionListItem(
            id=s.id,
            provider=s.provider,
            status=s.status,
            turn_count=s.turn_count,
            author=ChangeSessionAuthor(
                user_id=s.user_id, display_name=user_name_map.get(s.user_id)
            ),
            last_active_at=s.last_active_at,
            title=(content_by_session.get(s.id, "") or "")[:30] or None,
        )
        for s in sessions
    ]
    items.sort(
        key=lambda x: x.last_active_at or datetime.min,
        reverse=True,
    )
    return items


@router.get(
    "/changes/{change_id}/files/content",
    response_model=ChangeFileContent,
)
async def get_change_file_content(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
    path: str = Query(...),
) -> ChangeFileContent:
    service = ChangeService(session)
    rel, content, exists = await service.read_file(workspace_id, change_id, path)
    return ChangeFileContent(path=rel, content=content, exists=exists)


@router.post(
    "/changes/{change_id}/files/content",
    response_model=ChangeFileWriteResponse,
)
async def write_change_file_content(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: ChangeFileWriteRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ChangeFileWriteResponse:
    service = ChangeService(session)
    # D-001@v1：daemon-client 写回入队需 user_id 校验 daemon 归属（现算 runtime）。
    result = await service.write_file(workspace_id, change_id, body.path, body.content, user.id)
    return ChangeFileWriteResponse(**result)


@router.get(
    "/changes/{change_id}/files/pending",
    response_model=PendingFileList,
)
async def list_pending_change_files(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> PendingFileList:
    service = ChangeService(session)
    items = await service.list_pending_files(workspace_id, change_id)
    return PendingFileList(items=[PendingFileEntry(**it) for it in items])


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
        provider=body.provider,
        model=body.model,
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


@router.post(
    "/changes/{change_id}/archive-confirm",
    response_model=ReviewResponse,
)
async def archive_confirm(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: ArchiveConfirmRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ReviewResponse:
    service = ChangeService(session)
    result = await service.archive_confirm(
        workspace_id,
        change_id,
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

    # Fallback: if last_dispatch has no run_id, query this change's most recent run.
    # ql-20260706-004：按 change_id 精确过滤——旧实现只按 workspace 取最近 run，会把
    # workspace 下 scan/它变更的 run（change_id 为 NULL）误当本变更日志串台显示。
    # AgentRun.change_id 列实存（model.py，带索引 ix_agent_runs_change_id），dispatch
    # 落库即写（agent/service.py），故按 FK 取本变更最近 run；没派发过则保持 None
    # （前端不渲染日志面板），不再做 workspace 级回退（那正是串台来源）。
    if not last_dispatch or not last_dispatch.get("run_id"):
        from sqlalchemy import select

        from app.modules.agent.model import AgentRun

        stmt = (
            select(AgentRun)
            .where(col(AgentRun.change_id) == change_id)
            .order_by(col(AgentRun.started_at).desc())
            .limit(1)
        )
        result = await session.execute(stmt)
        latest_run = result.scalar_one_or_none()
        if latest_run:
            last_dispatch = {
                "run_id": str(latest_run.id),
                "stage": current_stage,
                "status": latest_run.status,
                "at": latest_run.started_at.isoformat() if latest_run.started_at else None,
                "finished_at": latest_run.finished_at.isoformat()
                if latest_run.finished_at
                else None,
                "exit_code": latest_run.exit_code,
            }

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
    # ql-20260618-009：max_length 与 schema.py TransitionRequest 对齐（64/128）
    provider: str | None = Query(default=None, max_length=64),
    model: str | None = Query(default=None, max_length=128),
) -> DispatchResponse:
    """Manually trigger agent dispatch for the current stage of a change."""
    from app.modules.change.dispatch import dispatch, get_config_for_stage, has_active_run

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
        provider=provider,
        model=model,
    )

    # Refresh change to get updated stages
    await session.refresh(change)
    stages = change.stages or {}
    last_dispatch = stages.get("last_dispatch")

    # Fallback: same logic as get_agent_status endpoint (ql-20260706-004：按
    # change_id 过滤，避免 scan run 串台；详见 get_agent_status 注释)。
    if not last_dispatch or not last_dispatch.get("run_id"):
        from sqlalchemy import select

        from app.modules.agent.model import AgentRun

        stmt = (
            select(AgentRun)
            .where(col(AgentRun.change_id) == change_id)
            .order_by(col(AgentRun.started_at).desc())
            .limit(1)
        )
        result = await session.execute(stmt)
        latest_run = result.scalar_one_or_none()
        if latest_run:
            last_dispatch = {
                "run_id": str(latest_run.id),
                "stage": current_stage,
                "status": latest_run.status,
                "at": latest_run.started_at.isoformat() if latest_run.started_at else None,
                "finished_at": latest_run.finished_at.isoformat()
                if latest_run.finished_at
                else None,
                "exit_code": latest_run.exit_code,
            }

    return DispatchResponse(
        change_id=change_id,
        current_stage=current_stage,
        has_active_run=dispatch_result.get("dispatched", False)
        or await has_active_run(session, change_id),
        config_enabled=True,
        last_dispatch=last_dispatch,
        dispatch_result=dispatch_result,
    )
