"""HTTP routes for changes."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.change.model import ChangeSessionLink, QuicklogSessionLink
from app.modules.change.quicklog_service import QuicklogQueryService
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
    QuicklogEntryList,
    QuicklogEntryListItem,
    QuicklogEntryRead,
    QuicklogFileItem,
    RejectRequest,
    ReviewResponse,
    StageProfileUpdate,
    TransitionDispatchResponse,
    TransitionRequest,
    TransitionResponse,
    VerifyGateResponse,
)
from app.modules.change.service import ChangeService
from app.modules.daemon.schema import AgentSessionListItem, ChangeSessionAuthor
from app.modules.workspace.service import WorkspaceService

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["change"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]

log = get_logger(__name__)


def _get_user_role(user: User) -> str:
    if getattr(user, "is_platform_admin", False):
        return "admin"
    return "business_user"


async def _build_transition_response(
    service: ChangeService,
    result: dict,
) -> TransitionResponse:
    """从 ``transition_with_dispatch`` 返回的 dict 组装 TransitionResponse。

    task-11（design §6.3）：``/transition`` 与 ``/advance-stage`` 共用本 helper，
    保证两端点响应组装逻辑一致（含 team_mode 的 mission_id/mode 字段透传，
    D-004@v2）。``result`` 形如 ``{"change": Change, "agent_dispatch": dict}``。
    """
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
            mission_id=raw_dispatch.get("mission_id"),
            mode=raw_dispatch.get("mode"),
        )

    return TransitionResponse(
        change=enriched_change.model_dump(),
        agent_dispatch=agent_dispatch,
    )


def _coerce_gate_errors(raw: Any) -> list[str]:
    """把 gate_result / gate cmd 的 errors 字段规整为 ``list[str]``（task-11）。

    ``_read_latest_gate_result`` 取的 gate_result 是落库 JSON（errors 已是
    list[str]），``_run_gate_via_delegate`` 返回 errors 也是 list[str]；但
    brownfield / 异常落库可能缺键或类型漂移，统一兜底：非 list 降级为空列表，
    每条 ``str()`` 强转。不在响应层做截断（截断在落库侧 ``_truncate_gate_errors``
    已做，响应如实返回）。
    """
    if not isinstance(raw, list):
        return []
    return [str(e) for e in raw]


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
    # task-02（2026-08-13-change-center-rework / D-004 / FR-02 / FR-04）：排序白名单
    # 透传 service.list_（默认 updated_at desc，最近活动优先，R-05）。
    sort: str = Query("updated_at_desc"),
    # task-02（FR-02 / D-002）：「待我处理」聚焦筛选。ql-20260813-005（gap②）：
    # 透传 service.list_，由 service 算全局 pending 集合 SQL IN 分页（total=全局 N），
    # 不再 router 层 enrich 后 Python filter（后者本页过滤致 N 偏低、分页偏移）。
    pending_review_only: bool = Query(False),
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
        sort=sort,
        pending_review_only=pending_review_only,
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


@router.patch(
    "/changes/{change_id}/stage-profile",
    response_model=OkResponse,
)
async def update_stage_profile(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    data: StageProfileUpdate,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> OkResponse:
    """task-03（2026-08-13-profile-system-prompt-injection）：存每阶段独立 profile_id。

    写 ``change.stages[<current_stage>]["profile_id"]``（D-003 每阶段独立）。
    profile_id=None 清除（跟随工作区默认）。
    """
    from sqlalchemy import select

    from app.modules.change.model import Change

    stmt = select(Change).where(
        Change.workspace_id == workspace_id,
        Change.id == change_id,
    )
    change = (await session.execute(stmt)).scalars().first()
    if change is None:
        raise AppError(
            "变更不存在，无法绑定阶段档案。",
            http_status=404,
            details={"change_id": str(change_id)},
        )
    if not change.current_stage:
        raise AppError(
            "变更尚未进入任何阶段，无法绑定阶段档案。",
            http_status=400,
        )

    # dict copy 防 SQLAlchemy JSON in-place 改不 dirty（反复踩的坑）。
    stages = dict(change.stages or {})
    stage_data = dict(stages.get(change.current_stage) or {})
    if data.profile_id is None:
        stage_data.pop("profile_id", None)
    else:
        stage_data["profile_id"] = data.profile_id
    stages[change.current_stage] = stage_data
    change.stages = stages
    session.add(change)
    await session.commit()
    return OkResponse(ok=True)


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


async def _fetch_session_titles(
    db: AsyncSession, session_ids: list[uuid.UUID]
) -> dict[uuid.UUID, str | None]:
    """批量取会话标题：每会话最早一条 channel=user_input 摘要（前 30 字）。

    task-03（2026-08-25-session-spec-binding / X-013）：自 ``list_change_sessions``
    提取为共享 helper——本端点与 task-07 快速修复会话端点（GET
    ``/quicklog-entries/{ql_id}/sessions``）两个消费方同在本文件，标题口径必须
    同源。窗口函数 ROW_NUMBER 分区取首条（P5 2026-08-24 会话审查，与 agent/
    daemon router 同步）——拉全部 user_input 行 Python 取最早会随轮数线性放大。

    返回映射只含命中的会话（值已按前 30 字截断；空文本归一为 None）；未命中
    会话不出现在映射，调用方 ``get`` 默认 None，与旧实现
    ``(content or "")[:30] or None`` 语义一致。
    """
    if not session_ids:
        return {}
    rn = (
        func.row_number()
        .over(
            partition_by=AgentRun.agent_session_id,
            order_by=(AgentRunLog.timestamp.asc(), AgentRunLog.id.asc()),
        )
        .label("rn")
    )
    title_subq = (
        select(
            AgentRun.agent_session_id.label("session_id"),
            AgentRunLog.content_redacted.label("content"),
            rn,
        )
        .join(AgentRunLog, AgentRunLog.run_id == AgentRun.id)
        .where(
            col(AgentRun.agent_session_id).in_(session_ids),
            col(AgentRunLog.channel) == "user_input",
        )
        .subquery()
    )
    title_rows = (
        await db.execute(
            select(title_subq.c.session_id, title_subq.c.content).where(title_subq.c.rn == 1)
        )
    ).all()
    return {row.session_id: (row.content or "")[:30] or None for row in title_rows}


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
    task-03（2026-08-25-session-spec-binding / FR-03 / D-002@v1）：数据源从
    ``AgentSession.change_id`` 单 FK 切换为 ``change_session_links`` M:N JOIN——
    links 为唯一关联真相，存量单 FK 由迁移播种成 link 行（design §5.W1.2）不丢；
    ``AgentSession.change_id`` 列继续写入不动（D-002@v1 冻结语义）。
    标题取该会话最早一条 channel=user_input 的 AgentRunLog 摘要（前 30 字，X-04，
    共享 helper ``_fetch_session_titles``）。按 last_active_at desc 排序（Python
    排序规避 PG/SQLite 方言差异）。
    """
    # 1. links JOIN agent_sessions（跨成员）。unique(change_id, session_id) 使
    #    同一 (变更, 会话) 至多一行 link，JOIN 不会产生重复会话行，无需 distinct。
    sessions = (
        (
            await session.execute(
                select(AgentSession)
                .join(ChangeSessionLink, ChangeSessionLink.session_id == AgentSession.id)
                .where(
                    ChangeSessionLink.change_id == change_id,
                    col(AgentSession.deleted_at).is_(None),  # FR-07 软删过滤
                )
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

    # 3. 批量取标题（共享 helper，task-07 快速修复会话端点同源复用，X-013）。
    titles = await _fetch_session_titles(session, session_ids)

    # 4. 组装 + 按 last_active_at desc 排序。
    items = [
        AgentSessionListItem(
            id=s.id,
            provider=s.provider,
            status=s.status,
            turn_count=s.turn_count,
            mode=(s.config or {}).get("mode"),
            author=ChangeSessionAuthor(
                user_id=s.user_id, display_name=user_name_map.get(s.user_id)
            ),
            last_active_at=s.last_active_at,
            title=titles.get(s.id),
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
        agent_profile_id=body.agent_profile_id,
        team_mode=body.team_mode,
        worker_preset=body.worker_preset,
        main_agent_config=body.main_agent_config,
    )
    return await _build_transition_response(service, result)


@router.post(
    "/changes/{change_id}/advance-stage",
    response_model=TransitionResponse,
)
async def advance_stage(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: TransitionRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> TransitionResponse:
    """单步推进 change 阶层（task-11，design §6.3 / D-005）。

    前端 ``handleDispatch`` 走 HTTP（非直连 MCP），与 task-07
    ``advance_change_stage`` MCP tool 共用同一 service 方法
    ``ChangeService.transition_with_dispatch``（team 分流：single → AgentService，
    team → _dispatch_execute_team）。body/响应与 ``/transition`` 完全对齐——
    ``advance-stage`` 为前端语义命名别名（D-005 选 HTTP 入口）。
    """
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
        agent_profile_id=body.agent_profile_id,
        team_mode=body.team_mode,
        worker_preset=body.worker_preset,
        main_agent_config=body.main_agent_config,
    )
    return await _build_transition_response(service, result)


@router.post(
    "/changes/{change_id}/run-verify-gate",
    response_model=VerifyGateResponse,
)
async def run_verify_gate(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> VerifyGateResponse:
    """gate 软调用（task-11，design §6.2/§6.3 / D-003/D-008）。

    与 task-09 ``run_verify_gate`` MCP tool 对齐，**不硬阻塞、不改 change 状态**
    （结果交调用方决策，核验纪律靠调用方）：

    1. 优先读最近 completed AgentRun.gate_result（``_read_latest_gate_result``）
       → ``source="gate_result"``。
    2. gate_result 缺 → 经 ``_run_gate_via_delegate`` 软调 ``sillyspec gate verify``
       （复用 task-06 RPC 骨架，不自动阻塞推进）→ ``source="gate_cmd"``。
    3. 两者均不可用（workspace 无 code_root / RPC 异常 / daemon 离线）
       → ``source="unavailable"``, ``exit_code=None``。
    """
    # 局部 import：dispatch / run_sync / workspace 依赖较重，且 dispatch 顶层
    # import 会与 service 形成循环（service.py 内部也是函数内 import 同款模式）。
    from app.modules.change.dispatch import (
        _read_latest_gate_result,
        _run_gate_via_delegate,
    )
    from app.modules.daemon.run_sync.service import RunSyncService
    from app.modules.workspace.service import WorkspaceService

    service = ChangeService(session)
    # service.get 校验 workspace 归属 + change 存在（不存在抛 → 404 语义）。
    change = await service.get(workspace_id, change_id)

    # 1. 优先读最近 completed AgentRun.gate_result（design §6.2 step 1）。
    gate_result, _gate_run_id = await _read_latest_gate_result(session, change_id)
    if gate_result:
        return VerifyGateResponse(
            exit_code=gate_result.get("exit_code"),
            errors=_coerce_gate_errors(gate_result.get("errors")),
            source="gate_result",
        )

    # 2. gate_result 缺 → 软调 sillyspec gate verify（design §6.2 step 2）。
    try:
        workspace = await WorkspaceService(session).get(workspace_id)
        # 复用 RunSyncService._resolve_gate_spec_root（gate cmd 的 cwd/specBase
        # 规范解析：platform-managed/repo-mirrored 走 SpecWorkspace.spec_root，
        # repo-native 走 workspace.root_path）。该方法是 gate cmd 唯一权威解析器，
        # 在此跨模块复用避免重复 ~30 行平台/仓库分流逻辑（生产级 DRY 取舍）。
        run_sync = RunSyncService(session)
        code_root, spec_dir = await run_sync._resolve_gate_spec_root(session, workspace, change)
        if not code_root:
            # workspace.root_path 缺 → gate 无 cwd 可跑，降级 unavailable
            # （design §6.2 step 3，不抛崩端点）。
            log.warning(
                "run_verify_gate_code_root_missing",
                change_id=str(change_id),
                workspace_id=str(workspace_id),
            )
            return VerifyGateResponse(exit_code=None, errors=[], source="unavailable")

        gate_cmd_result = await _run_gate_via_delegate(
            session=session,
            workspace=workspace,
            change_name=change.change_key,
            code_root=code_root,
            spec_dir=spec_dir,
        )
        return VerifyGateResponse(
            exit_code=gate_cmd_result.get("exit_code"),
            errors=_coerce_gate_errors(gate_cmd_result.get("errors")),
            source="gate_cmd",
        )
    except Exception as exc:
        # RPC 异常 / daemon 离线 / ws_rpc 未接线 → unavailable（design §6.2 step 3）。
        # gate 软调用语义要求端点不抛崩，结果交调用方决策。
        log.warning(
            "run_verify_gate_cmd_failed",
            change_id=str(change_id),
            error=str(exc),
            error_type=type(exc).__name__,
        )
        return VerifyGateResponse(exit_code=None, errors=[], source="unavailable")


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
        notify_session=body.notify_session,
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
    return ReviewResponse(
        change=enriched.model_dump(),
        agent_dispatch=agent_dispatch,
        notified_session=result["notified_session"],
        notify_error=result.get("notify_error"),
    )


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
        notify_session=body.notify_session,
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
    return ReviewResponse(
        change=enriched.model_dump(),
        agent_dispatch=agent_dispatch,
        notified_session=result["notified_session"],
        notify_error=result.get("notify_error"),
    )


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
        notify_session=body.notify_session,
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
    return ReviewResponse(
        change=enriched.model_dump(),
        agent_dispatch=agent_dispatch,
        notified_session=result["notified_session"],
        notify_error=result.get("notify_error"),
    )


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
        notify_session=body.notify_session,
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
    return ReviewResponse(
        change=enriched.model_dump(),
        agent_dispatch=agent_dispatch,
        notified_session=result["notified_session"],
        notify_error=result.get("notify_error"),
    )


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
    # 2026-08-12-dispatch-bind-agent-profile task-04：手动派发也支持选档案
    # （Query 风格对齐 provider/model）。None=跟随工作区默认。
    agent_profile_id: uuid.UUID | None = Query(default=None),
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
        agent_profile_id=agent_profile_id,
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


@router.get(
    "/quicklog-entries",
    response_model=QuicklogEntryList,
)
async def list_quicklog_entries(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
    # FR-04：search 全文（标题+四段）+ status/author 筛选 + include_placeholder
    # （默认隐藏空壳，D-007）+ linked_change（FR-07 反向区块数据面）。
    search: str | None = Query(None),
    status: str | None = Query(None),
    author: str | None = Query(None),
    linked_change: str | None = Query(None),
    include_placeholder: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
) -> QuicklogEntryList:
    """GET 快速修复列表（FR-04：双源合并 → 派生 → 筛选 → 分页）。"""
    workspace = await WorkspaceService(session).get(workspace_id)
    result = await QuicklogQueryService(session).list_entries(
        workspace,
        search=search,
        status=status,
        author=author,
        linked_change=linked_change,
        include_placeholder=include_placeholder,
        page=page,
        page_size=page_size,
    )
    items = [
        QuicklogEntryListItem(
            ql_id=e.ql_id,
            timestamp=e.timestamp,
            title=e.title,
            status=e.status,
            status_note=e.status_note,
            placeholder=e.placeholder,
            author_raw=e.author_raw,
            author_name=e.author_name,
            owner_name=e.owner_name,
            linked_changes=list(e.linked_changes),
            files=[QuicklogFileItem(path=p, note=n) for p, n in e.files],
            affected_modules=result.modules_by_ql.get(e.ql_id, []),
            source=e.source,
        )
        for e in result.items
    ]
    return QuicklogEntryList(items=items, total=result.total)


@router.get(
    "/quicklog-entries/{ql_id}",
    response_model=QuicklogEntryRead,
)
async def get_quicklog_entry(
    workspace_id: uuid.UUID,
    ql_id: str,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> QuicklogEntryRead:
    """GET 快速修复单条详情（FR-06：四段正文 + raw_block；404 未命中）。"""
    workspace = await WorkspaceService(session).get(workspace_id)
    e = await QuicklogQueryService(session).get_entry(workspace, ql_id)
    if e is None:
        raise AppError(
            "快速修复条目不存在",
            http_status=404,
            details={"ql_id": ql_id},
        )
    return QuicklogEntryRead(
        ql_id=e.ql_id,
        timestamp=e.timestamp,
        title=e.title,
        status=e.status,
        status_note=e.status_note,
        placeholder=e.placeholder,
        author_raw=e.author_raw,
        author_name=e.author_name,
        owner_name=e.owner_name,
        linked_changes=list(e.linked_changes),
        files=[QuicklogFileItem(path=p, note=n) for p, n in e.files],
        affected_modules=[],
        source=e.source,
        body_sections=dict(e.body_sections or {}),
        raw_block=e.raw_block,
        truncated=e.truncated,
    )


@router.get(
    "/quicklog-entries/{ql_id}/sessions",
    response_model=list[AgentSessionListItem],
)
async def list_quicklog_sessions(
    workspace_id: uuid.UUID,
    ql_id: str,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> list[AgentSessionListItem]:
    """列出某快速修复条目下绑定的全部会话（2026-08-25-session-spec-binding task-07）。

    FR-04 数据源：读 ``quicklog_session_links`` M:N JOIN ``agent_sessions``。
    跨成员可见（对齐 ``list_change_sessions`` 现状——列表跨成员、stream
    owner-only 不变，不加 user_id 过滤），鉴权复用 CHANGE_READ。``ql_id`` 为
    自然键（D-001@v1：无 FK 到 quicklog_entries——条目双源合并且与 agent-logs
    到达顺序不保证，绑定行不依赖条目行存在），故查询按 (workspace_id, ql_id)
    匹配 link 且不校验条目存在：无绑定返回空列表不 404（快速修复刚建、尚无
    会话是常态，design §5.W3.2）；工作区隔离由 link 行 workspace_id 保证。
    为快速修复级会话门户路由（D-006@v1，与变更门户同构）提供数据面。
    标题经共享 helper ``_fetch_session_titles`` 与变更侧同源复用（X-013 禁止
    复制 window-function 代码），按 last_active_at desc 排序（Python 排序规避
    PG/SQLite 方言差异，对齐 ``list_change_sessions``）。
    """
    # 1. links JOIN agent_sessions（跨成员）。unique(workspace_id, ql_id,
    #    session_id) 使同一 (条目, 会话) 至多一行 link，JOIN 不会产生重复
    #    会话行，无需 distinct。
    sessions = (
        (
            await session.execute(
                select(AgentSession)
                .join(QuicklogSessionLink, QuicklogSessionLink.session_id == AgentSession.id)
                .where(
                    QuicklogSessionLink.workspace_id == workspace_id,
                    QuicklogSessionLink.ql_id == ql_id,
                    col(AgentSession.deleted_at).is_(None),  # 软删过滤（对齐变更侧）
                )
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

    # 3. 批量取标题（共享 helper，与 list_change_sessions 同源复用，X-013）。
    titles = await _fetch_session_titles(session, session_ids)

    # 4. 组装 + 按 last_active_at desc 排序（与 list_change_sessions 同构）。
    items = [
        AgentSessionListItem(
            id=s.id,
            provider=s.provider,
            status=s.status,
            turn_count=s.turn_count,
            mode=(s.config or {}).get("mode"),
            author=ChangeSessionAuthor(
                user_id=s.user_id, display_name=user_name_map.get(s.user_id)
            ),
            last_active_at=s.last_active_at,
            title=titles.get(s.id),
        )
        for s in sessions
    ]
    items.sort(
        key=lambda x: x.last_active_at or datetime.min,
        reverse=True,
    )
    return items
