"""Session subdomain service — agent session lifecycle (task-05 / D-005@v1).

Pure migration from DaemonService: 20 session methods + 3 status frozensets +
9 session-domain exception/result classes moved verbatim. Facade DaemonService
retains the 20 method signatures as one-line delegates (design §7.1).

Cross-domain lazy imports (RunPlacementService, get_daemon_ws_hub) stay
function-level (design §7.2 / §10 R1). DaemonRuntimeOffline is imported at
module level — safe under D-005 (facade loads sub-services via lazy import in
__init__, so no module cycle).
"""

from __future__ import annotations

import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.protocol import (
    DAEMON_MSG_SESSION_END,
    DAEMON_MSG_SESSION_INJECT,
    DAEMON_MSG_SESSION_INTERRUPT,
    DAEMON_MSG_SESSION_RESUME,
)
from app.modules.daemon.runtime.service import DaemonRuntimeOffline
from app.modules.daemon.schema import SessionReopenResponse

log = get_logger(__name__)


ACTIVE_SESSION_STATUSES = frozenset({"pending", "active", "reconnecting"})
ACTIVE_TURN_STATUSES = frozenset({"pending", "running", "pending_approval"})
TERMINAL_TURN_STATUSES = frozenset({"completed", "failed", "killed", "cancelled"})


async def _resolve_daemon_id_for_runtime(
    db_session: AsyncSession,
    runtime_id: uuid.UUID,
) -> uuid.UUID | None:
    """task-06 / design §5.3: map a provider ``runtime_id`` to its daemon entity.

    WS Hub routes by ``daemon_instance_id`` (one socket per daemon entity), but
    sessions / dispatches are still keyed by ``daemon_runtimes.id`` (the provider
    row). This helper looks up the owning ``daemon_instance_id`` for a runtime
    so the session service can address the right WS connection.

    Migration fallback (D-007 window): pre-existing runtime rows have
    ``daemon_instance_id=NULL`` until the daemon re-registers under the new
    per-server config. For those, we fall back to the ``runtime_id`` itself as
    the connection key so the offline check + best-effort sends keep working
    against the legacy routing surface — once a daemon_instance is bound, the
    per-daemon key takes over. Returns ``None`` only when the runtime row is
    missing entirely (truly unknown runtime).
    """
    runtime = await db_session.get(DaemonRuntime, runtime_id)
    if runtime is None:
        return None
    if runtime.daemon_instance_id is None:
        # D-007 migration window: no daemon entity yet → route by runtime_id.
        return runtime_id
    return runtime.daemon_instance_id


class DaemonSessionNotFound(AppError):
    code = "HTTP_404_DAEMON_SESSION_NOT_FOUND"
    http_status = 404


class DaemonSessionNotActive(AppError):
    code = "HTTP_409_DAEMON_SESSION_NOT_ACTIVE"
    http_status = 409


class DaemonSessionTurnConflict(AppError):
    code = "HTTP_409_DAEMON_SESSION_TURN_CONFLICT"
    http_status = 409


class DaemonSessionNoCurrentRun(AppError):
    code = "HTTP_409_DAEMON_SESSION_NO_CURRENT_RUN"
    http_status = 409


class DaemonSessionInvariantViolation(AppError):
    code = "HTTP_409_DAEMON_SESSION_INVARIANT_VIOLATION"
    http_status = 409


class DaemonSessionResumeUnsupported(AppError):
    """Target session provider is not resumable (provider not in {claude, codex}).

    Claude SDK ``--resume <session_id>`` and Codex app-server
    ``thread/resume(threadId)`` both support resume; other providers
    cannot be reopened, so the ended session stays terminal.
    """

    code = "HTTP_409_DAEMON_SESSION_RESUME_UNSUPPORTED"
    http_status = 409


class DaemonSessionNoAgentSession(AppError):
    """Session has ``agent_session_id IS NULL`` (D-004@v1).

    A session that never reached a successful create-time SDK handshake (or
    whose create failed before the SDK returned a session id) has no SDK
    session to resume — reopen is impossible. The session is NOT mutated.
    """

    code = "HTTP_409_DAEMON_SESSION_NO_AGENT_SESSION"
    http_status = 409


class DaemonOffline(AppError):
    """Target runtime has no active WS connection — reopen needs a live daemon.

    Reopen drives an SDK resume ON the owning daemon (task-08), so the daemon
    must be connected. Distinct from :class:`DaemonRuntimeOffline` (504, used
    by RPC/inject paths where a stale lease must surface as a gateway fault):
    reopen is a user-initiated optimistic action, so 409 CONFLICT fits the
    "try again once the runtime reconnects" semantics better than a 5xx.
    """

    code = "HTTP_409_DAEMON_OFFLINE"
    http_status = 409


@dataclass(frozen=True, slots=True)
class SessionDispatchResult:
    """Result of create_session / inject_session (D-005@v1 triple)."""

    agent_session: AgentSession
    agent_run: AgentRun
    lease_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class SessionControlResult:
    """Result of interrupt_session / end_session.

    ``current_run_id`` is the run targeted by the control message (the unique
    currentRun), or None when end_session ran on a session without an active
    turn.
    """

    agent_session: AgentSession
    current_run_id: uuid.UUID | None


@dataclass(frozen=True, slots=True)
class SessionRecoveryResult:
    """Result of recover_session_after_daemon_restart (task-10, FR-08).

    ``status`` is the post-recover session state as seen by backend:
      - ``reconnecting``: recover succeeded, currentRun converged; daemon now
        runs restoreAndReconnect (query resume) and will confirm_reconnected.
      - ``ended``/``failed``: session was already terminal (not resurrected).
      - ``rejected``: ownership mismatch (runtime/lease/provider/lease kind);
        daemon must delete its local record and not call restoreAndReconnect.

    ``interrupted_run_status`` reports the converged run result (``failed``)
    when a crashed currentRun was reconciled; ``None`` when the session was
    idle (no running run) or already terminal.
    """

    session_id: uuid.UUID
    lease_id: uuid.UUID | None
    status: Literal["active", "ended", "failed", "reconnecting", "rejected"]
    interrupted_run_status: Literal["failed"] | None = None


class SessionService:
    """AgentSession 生命周期子域 service（task-05 / design §5.2）。

    方法体逐字节搬入 DaemonService 同名方法。facade 保留 20 个同名委托
    （design §7.1）。session 不持 facade 引用：跨域调用是
    ``agent.placement.RunPlacementService`` 与 ``daemon.ws_hub``（函数级 lazy
    import），不调 daemon 其他子 service（design §7.2 / D-006）。
    """

    _LIST_STATUSES = frozenset({"pending", "active", "reconnecting", "ended", "failed"})

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Interactive session orchestration (task-05, D-005@v1) ──────────────

    async def _get_owned_session_for_update(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> AgentSession:
        """Lock and return the AgentSession owned by ``user_id``.

        Uses ``with_for_update`` so two concurrent inject/interrupt/end calls
        on the same session serialize at the DB row level (PostgreSQL FOR
        UPDATE; SQLite ignores the hint but the query/ownership semantics
        still hold). Returns 404 for missing / cross-user sessions without
        leaking existence (mirrors ``_get_owned_runtime``).
        """
        stmt = (
            select(AgentSession)
            .where(
                AgentSession.id == session_id,
                AgentSession.user_id == user_id,
            )
            .with_for_update()
        )
        session = (await self._session.execute(stmt)).scalar_one_or_none()
        if session is None:
            raise DaemonSessionNotFound(
                f"AgentSession '{session_id}' not found.",
                details={"session_id": str(session_id)},
            )
        return session

    async def _get_session_by_runtime_owner_for_update(
        self,
        session_id: uuid.UUID,
        owner_user_id: uuid.UUID,
    ) -> AgentSession:
        """Lock and return a session whose bound runtime is owned by ``owner_user_id``.

        daemon 身份（X-API-Key）专用（ql-20260623-004）：api-key 解析出的
        ``user`` 是 runtime owner，**不等于** session 创建者
        （``AgentSession.user_id``）。ownership 改为「目标 session 绑定的
        runtime 归属于 api-key owner」（``DaemonRuntime.user_id``），否则
        admin 共享 runtime 场景（creator≠runtime owner）下的
        ``notifySessionEnd`` 会因 ``AgentSession.user_id`` 不匹配误判 404。

        join ``daemon_runtimes``；缺失 / 跨 owner → 404，不泄露存在性
        （与 :meth:`_get_owned_session_for_update` 一致）。
        """
        from app.modules.daemon.model import DaemonRuntime

        stmt = (
            select(AgentSession)
            .join(DaemonRuntime, AgentSession.runtime_id == DaemonRuntime.id)
            .where(
                AgentSession.id == session_id,
                DaemonRuntime.user_id == owner_user_id,
            )
            .with_for_update()
        )
        session = (await self._session.execute(stmt)).scalar_one_or_none()
        if session is None:
            raise DaemonSessionNotFound(
                f"AgentSession '{session_id}' not found.",
                details={"session_id": str(session_id)},
            )
        return session

    async def _get_current_run(
        self,
        session_id: uuid.UUID,
    ) -> AgentRun | None:
        """Return the single active-turn run for the session, or None.

        Active turn = status in ACTIVE_TURN_STATUSES (pending / running /
        pending_approval). AgentRun has no created_at, so we must rely on the
        invariant "at most one active run per session". Zero → None, one →
        that run, more than one → DaemonSessionInvariantViolation (never
        guess which one to terminate).
        """
        stmt = select(AgentRun).where(
            AgentRun.agent_session_id == session_id,
            col(AgentRun.status).in_(list(ACTIVE_TURN_STATUSES)),
        )
        runs = list((await self._session.execute(stmt)).scalars().all())
        if not runs:
            return None
        if len(runs) > 1:
            raise DaemonSessionInvariantViolation(
                f"Session '{session_id}' has multiple active runs.",
                details={
                    "session_id": str(session_id),
                    "active_run_ids": [str(r.id) for r in runs],
                },
            )
        return runs[0]

    async def _publish_session_event(
        self,
        session_id: uuid.UUID,
        payload: dict[str, object],
    ) -> None:
        """Publish an event on the ``agent_session:{session_id}`` Redis channel.

        Shared entry point for task-06 (SSE aggregation) and task-08
        (permission events). Failures are logged but never raised so a Redis
        blip cannot abort end/interrupt. Does NOT implement the SSE route,
        history replay, or cursor — those belong to task-06.
        """
        try:
            redis = get_redis()
            await redis.publish(
                f"agent_session:{session_id}",
                json.dumps(payload, default=str),
            )
        except Exception:
            log.warning(
                "publish_session_event_failed",
                session_id=str(session_id),
                redis_event=payload.get("event") if isinstance(payload, dict) else None,
            )

    async def create_session(
        self,
        user_id: uuid.UUID,
        *,
        provider: str,
        prompt: str,
        model: str | None = None,
        manual_approval: bool = False,
        ask_user_only: bool = False,
        change_id: uuid.UUID | None = None,
        workspace_id: uuid.UUID | None = None,
    ) -> SessionDispatchResult:
        """Create an interactive session + first-turn run + interactive lease.

        FR-01 / design §7.6 step 1. The session, run and lease are committed
        atomically (D-005@v1 triple), then the daemon is woken. If the wake-up
        cannot be delivered the triple is converged to failed terminal states
        and DaemonRuntimeOffline is raised so no active session lingers.
        """
        if not prompt or not prompt.strip():
            raise DaemonSessionNotActive(
                "prompt must not be empty.",
                details={"reason": "empty_prompt"},
            )

        from app.modules.agent.placement import RunPlacementService

        # 2026-07-09-change-detail-session / D-003@v1：变更会话 cwd=workspace 本地
        # 项目根。复用 Workspace.root_path（workspace/model.py:63），未传 workspace_id
        # 时 cwd=None 走原逻辑（边界 E4，零回归）。
        cwd: str | None = None
        if workspace_id is not None:
            from app.modules.workspace.model import Workspace

            _ws = await self._session.get(Workspace, workspace_id)
            if _ws is not None:
                cwd = _ws.root_path

        now = datetime.now(UTC)
        # Copy config so the request dict is never mutated (boundary #16).
        config: dict = {
            "manual_approval": bool(manual_approval),
        }
        if model:
            config["model"] = model

        try:
            session = AgentSession(
                id=uuid.uuid4(),
                user_id=user_id,
                provider=provider,
                status="pending",
                config=config,
                turn_count=0,
                created_at=now,
                change_id=change_id,
                workspace_id=workspace_id,
                cwd=cwd,
            )
            self._session.add(session)
            await self._session.flush()

            run = AgentRun(
                id=uuid.uuid4(),
                agent_type="claude_code",
                provider=provider,
                model=model,
                status="pending",
                spec_strategy="interactive",
                agent_session_id=session.id,
                change_id=change_id,
            )
            self._session.add(run)
            await self._session.flush()

            # 2026-07-09-change-detail-session / D-004@v1（X-02/X-04）：变更会话首轮
            # 注入【变更上下文】前导。dispatch prompt = 前导+用户消息，经 lease
            # metadata 的 prompt 字段透传到 daemon _startInteractiveSession 构造
            # 首条 user 消息。AgentRunLog(user_input) 与 SESSION_INJECT 的 prompt
            # 仍写干净用户消息（列表标题 / 回放 / 展示干净）。零 daemon 改动。
            from app.modules.daemon.session.context import (
                build_change_context_preamble,
            )

            preamble = await build_change_context_preamble(self._session, change_id)
            dispatch_prompt = f"{preamble}\n\n---\n\n{prompt}" if preamble else prompt

            placement = RunPlacementService(self._session)
            dispatch = await placement.prepare_interactive_dispatch(
                agent_session_id=session.id,
                agent_run_id=run.id,
                user_id=user_id,
                provider=provider,
                prompt=dispatch_prompt,
                model=model,
                manual_approval=manual_approval,
                ask_user_only=ask_user_only,
                workspace_id=workspace_id,
                cwd=cwd,
            )

            # Backfill the triple binding fields + activate the session.
            session.runtime_id = dispatch.runtime_id
            session.lease_id = dispatch.lease_id
            session.status = "active"
            session.turn_count = 1
            session.last_active_at = now
            self._session.add(session)

            # task-01 / FR-01 / D-005@v1：首 turn 落一条 channel="user_input" 的
            # AgentRunLog，让历史回看能看到用户发的首 prompt（与 agent 输出
            # stdout/stderr/tool_call 并列）。prompt 经 content_redacted 脱敏
            # （与 submit_messages 一致的 ``[:5000]`` 截断），user_input channel
            # 显式写、不经 _channel_from_event_type（与 agent service 的
            # USER_INPUT_CHANNEL 标准保持一致）。
            self._session.add(
                AgentRunLog(
                    run_id=run.id,
                    channel="user_input",
                    content_redacted=prompt[:5000],
                    timestamp=now,
                )
            )
            await self._session.commit()
            await self._session.refresh(session)
            await self._session.refresh(run)
        except Exception:
            await self._session.rollback()
            raise

        # Commit succeeded → wake the daemon. Failure here must converge the
        # just-committed triple to terminal failed states before raising.
        placement = RunPlacementService(self._session)
        delivered = await placement.notify_interactive_dispatch(dispatch)
        if not delivered:
            await self._converge_failed_dispatch(
                session=session,
                run=run,
                lease_id=dispatch.lease_id,
                error="interactive dispatch wake-up failed (daemon offline)",
            )
            raise DaemonRuntimeOffline(
                f"daemon runtime '{dispatch.runtime_id}' is offline; "
                f"interactive session '{session.id}' could not start.",
                details={
                    "runtime_id": str(dispatch.runtime_id),
                    "session_id": str(session.id),
                    "run_id": str(run.id),
                },
            )

        # Best-effort SESSION_INJECT control message carrying the first turn.
        # Wake-up already signalled the lease; the control message lets the
        # daemon SessionManager know the exact first prompt (FR-02 contract).
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        hub = get_daemon_ws_hub()
        # task-06: WS Hub routes by daemon_instance_id; resolve from the
        # provider runtime_id carried on the dispatch.
        daemon_id = await _resolve_daemon_id_for_runtime(self._session, dispatch.runtime_id)
        control_ok = False
        if daemon_id is not None:
            control_ok = await hub.send_session_control(
                daemon_id,
                DAEMON_MSG_SESSION_INJECT,
                {
                    "session_id": str(session.id),
                    "lease_id": str(dispatch.lease_id),
                    "run_id": str(run.id),
                    "prompt": prompt,
                    # gap-2：首 turn SESSION_INJECT 携带 lease 级 claim_token，
                    # daemon 存入 SessionState.claimToken。
                    "claim_token": dispatch.claim_token,
                    # design §5.3: payload carries the provider runtime_id so
                    # the daemon dispatches to the correct SessionManager.
                    "runtime_id": str(dispatch.runtime_id),
                },
            )
        if not control_ok:
            # Wake-up delivered but control send failed: the daemon will still
            # claim the lease (metadata has the prompt), so we do NOT fail the
            # session here. Log for observability; FR-01 success already holds.
            log.warning(
                "session_create_control_send_failed",
                session_id=str(session.id),
                run_id=str(run.id),
                runtime_id=str(dispatch.runtime_id),
            )

        await self._publish_session_event(
            session.id,
            {"event": "session_created", "session_id": str(session.id), "run_id": str(run.id)},
        )
        return SessionDispatchResult(
            agent_session=session,
            agent_run=run,
            lease_id=dispatch.lease_id,
        )

    async def _converge_failed_dispatch(
        self,
        *,
        session: AgentSession,
        run: AgentRun,
        lease_id: uuid.UUID,
        error: str,
    ) -> None:
        """Mark a freshly-committed triple as failed terminal (create_session offline path)."""
        now = datetime.now(UTC)
        try:
            run.status = "failed"
            run.finished_at = now
            run.error_code = "interactive_dispatch_offline"
            run.output_redacted = error
            self._session.add(run)

            session.status = "failed"
            session.ended_at = now
            session.last_active_at = now
            self._session.add(session)

            lease = await self._session.get(DaemonTaskLease, lease_id)
            if lease is not None and lease.status not in ("completed", "cancelled", "expired"):
                lease.status = "completed"
                lease.updated_at = now
                self._session.add(lease)

            await self._session.commit()
            await self._session.refresh(session)
            await self._session.refresh(run)
        except Exception:
            await self._session.rollback()
            log.warning(
                "session_failed_dispatch_convergence_failed",
                session_id=str(session.id),
                run_id=str(run.id),
                lease_id=str(lease_id),
            )

    async def inject_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        prompt: str,
    ) -> SessionDispatchResult:
        """Append a new turn run to an active session (FR-02 / design §7.6 step 1).

        Holds the session row lock, rejects when an active run already exists
        (DaemonSessionTurnConflict), creates the new AgentRun, commits, then
        dispatches a SESSION_INJECT control message. WS send failure converges
        the new run to failed but keeps the session active (boundary #13).
        """
        if not prompt or not prompt.strip():
            raise DaemonSessionNotActive(
                "prompt must not be empty.",
                details={"reason": "empty_prompt"},
            )

        now = datetime.now(UTC)
        try:
            session = await self._get_owned_session_for_update(session_id, user_id)
            if session.status != "active":
                raise DaemonSessionNotActive(
                    f"AgentSession '{session_id}' is not active (status={session.status}).",
                    details={"session_id": str(session_id), "status": session.status},
                )
            if session.lease_id is None or session.runtime_id is None:
                raise DaemonSessionInvariantViolation(
                    f"Active session '{session_id}' has no lease/runtime binding.",
                    details={"session_id": str(session_id)},
                )

            current = await self._get_current_run(session.id)
            if current is not None:
                raise DaemonSessionTurnConflict(
                    f"Session '{session_id}' already has an active run '{current.id}'.",
                    details={
                        "session_id": str(session_id),
                        "current_run_id": str(current.id),
                    },
                )

            config = dict(session.config or {})
            run = AgentRun(
                id=uuid.uuid4(),
                agent_type="claude_code",
                provider=session.provider,
                model=config.get("model"),
                status="pending",
                spec_strategy="interactive",
                agent_session_id=session.id,
            )
            self._session.add(run)

            session.turn_count = (session.turn_count or 0) + 1
            session.last_active_at = now
            self._session.add(session)

            # task-01 / FR-02 / D-005@v1：后续 turn 同样落一条 channel="user_input"
            # AgentRunLog，挂在新建 run 上（首 turn 在 create_session 已落）。
            self._session.add(
                AgentRunLog(
                    run_id=run.id,
                    channel="user_input",
                    content_redacted=prompt[:5000],
                    timestamp=now,
                )
            )

            await self._session.commit()
            await self._session.refresh(session)
            await self._session.refresh(run)
        except AppError:
            await self._session.rollback()
            raise
        except Exception:
            await self._session.rollback()
            raise

        # Dispatch the new turn control message.
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        # gap-2：从 lease metadata 取 claim_token（claim 时已写入或 prepare 时预生成），
        # 后续 turn 的 SESSION_INJECT 仍携带同一 lease 级 claim_token（跨 turn 复用）。
        lease_row = await self._session.get(DaemonTaskLease, session.lease_id)
        lease_meta = dict((lease_row.metadata_ if lease_row else None) or {})
        inject_claim_token = lease_meta.get("claim_token", "")

        hub = get_daemon_ws_hub()
        # task-06: resolve provider runtime_id → daemon_instance_id (WS route key).
        runtime_id = session.runtime_id
        daemon_id = (
            await _resolve_daemon_id_for_runtime(self._session, runtime_id)
            if runtime_id is not None
            else None
        )
        control_ok = False
        if daemon_id is not None and runtime_id is not None:
            control_ok = await hub.send_session_control(
                daemon_id,
                DAEMON_MSG_SESSION_INJECT,
                {
                    "session_id": str(session.id),
                    "lease_id": str(session.lease_id),
                    "run_id": str(run.id),
                    "prompt": prompt,
                    "claim_token": inject_claim_token,
                    "runtime_id": str(runtime_id),  # design §5.3 provider discriminator
                },
            )
        if not control_ok:
            # New run failed to dispatch → converge it to failed but leave the
            # session active so the caller can retry (boundary #13).
            try:
                run.status = "failed"
                run.finished_at = datetime.now(UTC)
                run.error_code = "interactive_inject_send_failed"
                run.output_redacted = f"failed to dispatch turn (daemon offline): prompt={prompt!r}"
                self._session.add(run)
                await self._session.commit()
                await self._session.refresh(run)
            except Exception:
                await self._session.rollback()
                log.warning(
                    "session_inject_run_convergence_failed",
                    session_id=str(session.id),
                    run_id=str(run.id),
                )
            raise DaemonRuntimeOffline(
                f"daemon runtime '{session.runtime_id}' is offline; turn could not be dispatched.",
                details={
                    "runtime_id": str(session.runtime_id),
                    "session_id": str(session.id),
                    "run_id": str(run.id),
                },
            )

        await self._publish_session_event(
            session.id,
            {"event": "turn_injected", "session_id": str(session.id), "run_id": str(run.id)},
        )
        return SessionDispatchResult(
            agent_session=session,
            agent_run=run,
            lease_id=session.lease_id,
        )

    async def interrupt_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> SessionControlResult:
        """Send a turn-level interrupt for the current run (FR-04).

        Locks + validates the session, finds the unique currentRun, sends
        SESSION_INTERRUPT. Does NOT touch session/lease terminal state and does
        NOT pre-empt the run status — daemon result drives AgentRun=failed
        (design §7.6 step 3). No currentRun → DaemonSessionNoCurrentRun.
        """
        try:
            session = await self._get_owned_session_for_update(session_id, user_id)
            if session.status != "active":
                raise DaemonSessionNotActive(
                    f"AgentSession '{session_id}' is not active (status={session.status}).",
                    details={"session_id": str(session_id), "status": session.status},
                )
            if session.lease_id is None or session.runtime_id is None:
                raise DaemonSessionInvariantViolation(
                    f"Active session '{session_id}' has no lease/runtime binding.",
                    details={"session_id": str(session_id)},
                )
            run = await self._get_current_run(session.id)
            await self._session.commit()
        except AppError:
            await self._session.rollback()
            raise
        except Exception:
            await self._session.rollback()
            raise

        if run is None:
            raise DaemonSessionNoCurrentRun(
                f"Session '{session_id}' has no active run to interrupt.",
                details={"session_id": str(session_id)},
            )

        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        hub = get_daemon_ws_hub()
        # task-06: resolve provider runtime_id → daemon_instance_id (WS route key).
        runtime_id = session.runtime_id
        daemon_id = (
            await _resolve_daemon_id_for_runtime(self._session, runtime_id)
            if runtime_id is not None
            else None
        )
        if daemon_id is None or runtime_id is None:
            raise DaemonRuntimeOffline(
                f"daemon runtime '{runtime_id}' is offline; interrupt could not be delivered.",
                details={
                    "session_id": str(session_id),
                    "runtime_id": str(runtime_id) if runtime_id else None,
                },
            )
        control_ok = await hub.send_session_control(
            daemon_id,
            DAEMON_MSG_SESSION_INTERRUPT,
            {
                "session_id": str(session.id),
                "lease_id": str(session.lease_id),
                "runtime_id": str(runtime_id),  # design §5.3 provider discriminator
            },
        )
        if not control_ok:
            raise DaemonRuntimeOffline(
                f"daemon runtime '{session.runtime_id}' is offline; "
                f"interrupt could not be delivered.",
                details={
                    "runtime_id": str(session.runtime_id),
                    "session_id": str(session.id),
                    "run_id": str(run.id),
                },
            )

        return SessionControlResult(agent_session=session, current_run_id=run.id)

    async def end_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        reason: str = "manual",
        actor_runtime_owner_id: uuid.UUID | None = None,
    ) -> SessionControlResult:
        """Single reconciliation of session/lease/currentRun (FR-05 / §8.5).

        Locks the session, validates the bound interactive lease, sends a
        best-effort SESSION_END, then in ONE transaction marks currentRun
        killed, session ended, lease completed. Idempotent on already-ended
        sessions. WS failure is a warning only — the local reconciliation
        still succeeds so a daemon offline never strands an active session.

        gap-4 修复（ql-20260623-004）：两种调用方共由此端点，按 ``actor`` 区分
        session 定位方式——
          * 前端（Bearer JWT，``actor_runtime_owner_id is None``）：保持
            :meth:`_get_owned_session_for_update` 的 ``AgentSession.user_id``
            校验；
          * daemon（X-API-Key，router 传入 ``actor_runtime_owner_id``）：api-key
            owner 是 runtime owner，不等于 session 创建者，改走
            :meth:`_get_session_by_runtime_owner_for_update` 按 runtime 归属校验，
            否则 admin 共享 runtime 场景（creator≠owner）必 404。
        其余收口逻辑（lease 校验 / run killed / lease completed / SSE）两种身份
        完全一致。
        """
        try:
            if actor_runtime_owner_id is not None:
                session = await self._get_session_by_runtime_owner_for_update(
                    session_id, actor_runtime_owner_id
                )
            else:
                session = await self._get_owned_session_for_update(session_id, user_id)

            # Idempotent: already ended → no-op return.
            if session.status == "ended":
                await self._session.commit()
                return SessionControlResult(agent_session=session, current_run_id=None)

            if session.lease_id is None:
                raise DaemonSessionInvariantViolation(
                    f"Session '{session_id}' has no bound lease.",
                    details={"session_id": str(session_id)},
                )

            lease = await self._session.get(DaemonTaskLease, session.lease_id)
            if lease is None or lease.kind != "interactive" or lease.id != session.lease_id:
                raise DaemonSessionInvariantViolation(
                    f"Session '{session_id}' lease binding is invalid "
                    f"(missing/non-interactive/mismatched).",
                    details={
                        "session_id": str(session_id),
                        "lease_id": str(session.lease_id),
                        "lease_kind": lease.kind if lease else None,
                    },
                )

            run = await self._get_current_run(session.id)
        except AppError:
            await self._session.rollback()
            raise
        except Exception:
            await self._session.rollback()
            raise

        # Best-effort SESSION_END (kill currentRun + clear SessionStore on daemon).
        if session.runtime_id is not None:
            from app.modules.daemon.ws_hub import get_daemon_ws_hub

            hub = get_daemon_ws_hub()
            # task-06: resolve provider runtime_id → daemon_instance_id.
            daemon_id = await _resolve_daemon_id_for_runtime(self._session, session.runtime_id)
            end_ok = False
            if daemon_id is not None:
                end_ok = await hub.send_session_control(
                    daemon_id,
                    DAEMON_MSG_SESSION_END,
                    {
                        "session_id": str(session.id),
                        "lease_id": str(session.lease_id),
                        "runtime_id": str(session.runtime_id),
                    },
                )
            if not end_ok:
                log.warning(
                    "session_end_control_send_failed",
                    session_id=str(session.id),
                    runtime_id=str(session.runtime_id),
                    reason=reason,
                )

        # Single-transaction local reconciliation (§8.5 收口).
        now = datetime.now(UTC)
        try:
            if run is not None and run.status not in TERMINAL_TURN_STATUSES:
                run.status = "killed"
                run.finished_at = now
                run.exit_code = -1
                self._session.add(run)

            session.status = "ended"
            session.ended_at = now
            session.last_active_at = now
            self._session.add(session)

            lease.status = "completed"
            lease.updated_at = now
            self._session.add(lease)

            await self._session.commit()
            await self._session.refresh(session)
        except Exception:
            await self._session.rollback()
            raise

        await self._publish_session_event(
            session.id,
            {
                "event": "session_ended",
                "session_id": str(session.id),
                "reason": reason,
                "current_run_id": str(run.id) if run else None,
            },
        )
        return SessionControlResult(
            agent_session=session,
            current_run_id=run.id if run else None,
        )

    # ── Daemon-restart recovery (task-10, FR-08 / D-003@v1) ──────────────────

    async def recover_session_after_daemon_restart(
        self,
        session_id: uuid.UUID,
        *,
        runtime_id: uuid.UUID,
        lease_id: uuid.UUID,
        provider: str,
        agent_session_id: str,
        interrupted_run_id: uuid.UUID | None,
    ) -> SessionRecoveryResult:
        """Reconcile an interactive session after daemon restart (task-10 §4.4).

        Called once per persisted record on daemon boot, BEFORE the daemon runs
        ``SessionManager.restoreAndReconnect`` (query resume). Independent of
        end_session / create_session / inject_session — does not touch the
        existing 4 session REST paths.

        Single transaction must:
          1. SELECT AgentSession FOR UPDATE; validate ownership
             (runtime_id / lease_id / provider / lease.kind == interactive).
          2. Session already ended/failed → return terminal (no resurrect,
             no run convergence). Daemon deletes local record.
          3. Ownership mismatch (runtime/lease/provider/lease kind) OR session
             missing → return ``rejected``. Daemon deletes local record; no
             token rotation, no local session built.
          4. Recoverable (active/reconnecting) → write status=reconnecting +
             last_active_at=now.
          5. interrupted_run_id non-null → converge ONLY the same-session run
             whose status is in ACTIVE_TURN_STATUSES to failed (error_code=
             daemon_restarted, finished_at=now); already-terminal → idempotent
             (keep result). Cross-session run id → invariant violation (409).
          6. Another non-terminal run on same session (besides interrupted) →
             invariant violation (409) — never guess or batch-fail.
          7. Rotate lease.claim_token (防旧 claim 重放，task-10 §7 边界 15).
          8. Publish session reconnecting event; return result.

        ``agent_session_id`` is accepted for log/audit only (SDK session_id);
        backend never trusts it for ownership — runtime_id/lease_id/provider
        are the real guards.
        """
        try:
            # Ownership lock + validate. SELECT FOR UPDATE serializes concurrent
            # recover on same session (PostgreSQL); SQLite still exercises the
            # query + branches.
            stmt = select(AgentSession).where(AgentSession.id == session_id).with_for_update()
            session = (await self._session.execute(stmt)).scalar_one_or_none()

            if session is None:
                log.info(
                    "session_recover_not_found",
                    session_id=str(session_id),
                    runtime_id=str(runtime_id),
                )
                return SessionRecoveryResult(
                    session_id=session_id,
                    lease_id=lease_id,
                    status="rejected",
                )

            # Session already terminal → do not resurrect, do not converge runs.
            if session.status in ("ended", "failed"):
                log.info(
                    "session_recover_already_terminal",
                    session_id=str(session_id),
                    status=session.status,
                )
                return SessionRecoveryResult(
                    session_id=session.id,
                    lease_id=session.lease_id,
                    status=session.status,
                )

            # Ownership guards: runtime/lease/provider/lease kind must all match.
            ownership_ok = (
                session.runtime_id == runtime_id
                and session.lease_id == lease_id
                and session.provider == provider
            )
            lease: DaemonTaskLease | None = None
            if session.lease_id is not None:
                lease = await self._session.get(DaemonTaskLease, session.lease_id)
            lease_ok = (
                lease is not None
                and lease.kind == "interactive"
                and lease.id == session.lease_id
                and lease.id == lease_id
            )
            if not ownership_ok or not lease_ok:
                log.warning(
                    "session_recover_ownership_mismatch",
                    session_id=str(session_id),
                    runtime_id=str(runtime_id),
                    expected_runtime_id=str(session.runtime_id),
                    lease_id=str(lease_id),
                    lease_kind=lease.kind if lease else None,
                )
                return SessionRecoveryResult(
                    session_id=session.id,
                    lease_id=session.lease_id,
                    status="rejected",
                )

            # Converge crashed currentRun BEFORE writing reconnecting, so the
            # reconnecting state never co-exists with a lingering running run.
            interrupted_status: Literal["failed"] | None = None
            if interrupted_run_id is not None:
                interrupted_status = await self._converge_crashed_run(
                    session_id=session.id,
                    run_id=interrupted_run_id,
                )

            # Sanity invariant: no OTHER non-terminal run should remain on this
            # session after convergence (else daemon state is ambiguous). This
            # catches the rare double-crash / state-corruption case.
            await self._assert_no_other_active_run(
                session_id=session.id,
                excluded_run_id=interrupted_run_id,
            )

            # Write reconnecting + rotate token.
            now = datetime.now(UTC)
            session.status = "reconnecting"
            session.last_active_at = now
            self._session.add(session)

            if lease is not None:
                new_token = secrets.token_hex(32)
                metadata = dict(lease.metadata_ or {})
                metadata["claim_token"] = new_token
                lease.metadata_ = metadata
                flag_modified(lease, "metadata_")
                lease.updated_at = now
                self._session.add(lease)

            await self._session.commit()
            await self._session.refresh(session)

            await self._publish_session_event(
                session.id,
                {
                    "event": "session_reconnecting",
                    "session_id": str(session.id),
                    "runtime_id": str(runtime_id),
                    "interrupted_run_id": (str(interrupted_run_id) if interrupted_run_id else None),
                },
            )
            log.info(
                "session_recovered_reconnecting",
                session_id=str(session.id),
                runtime_id=str(runtime_id),
                interrupted_run_status=interrupted_status,
            )
            return SessionRecoveryResult(
                session_id=session.id,
                lease_id=session.lease_id,
                status="reconnecting",
                interrupted_run_status=interrupted_status,
            )
        except AppError:
            await self._session.rollback()
            raise
        except Exception:
            await self._session.rollback()
            raise

    async def _converge_crashed_run(
        self,
        *,
        session_id: uuid.UUID,
        run_id: uuid.UUID,
    ) -> Literal["failed"] | None:
        """Converge a single crashed run to failed (daemon_restarted).

        - Run belongs to a different session → invariant violation (409).
        - Run already terminal → idempotent, return None (keep result).
        - Run in ACTIVE_TURN_STATUSES → failed + finished_at + error_code.

        Returns ``"failed"`` only when this call actually converged the run.
        """
        run = await self._session.get(AgentRun, run_id)
        if run is None:
            # Run id stale/unknown — treat as nothing to converge (idempotent).
            log.warning(
                "session_recover_interrupted_run_missing",
                session_id=str(session_id),
                run_id=str(run_id),
            )
            return None

        if run.agent_session_id != session_id:
            # Cross-session run id — never touch another session's run.
            raise DaemonSessionInvariantViolation(
                f"interrupted_run_id '{run_id}' belongs to another session.",
                details={
                    "session_id": str(session_id),
                    "run_id": str(run_id),
                    "run_session_id": str(run.agent_session_id),
                },
            )

        if run.status in TERMINAL_TURN_STATUSES:
            # Idempotent: keep the original terminal result.
            return None

        if run.status not in ACTIVE_TURN_STATUSES:
            # Unexpected state (e.g. unknown status string) — still converge to
            # failed to avoid a stuck non-terminal run after restart.
            log.warning(
                "session_recover_run_unexpected_status",
                session_id=str(session_id),
                run_id=str(run_id),
                run_status=run.status,
            )

        now = datetime.now(UTC)
        run.status = "failed"
        run.finished_at = now
        run.error_code = "daemon_restarted"
        if not run.output_redacted:
            run.output_redacted = "daemon_restarted"
        self._session.add(run)
        return "failed"

    async def _assert_no_other_active_run(
        self,
        *,
        session_id: uuid.UUID,
        excluded_run_id: uuid.UUID | None,
    ) -> None:
        """Raise invariant violation if another non-terminal run lingers."""
        stmt = select(AgentRun.id).where(
            AgentRun.agent_session_id == session_id,
            col(AgentRun.status).in_(list(ACTIVE_TURN_STATUSES)),
        )
        ids = [
            row[0] for row in (await self._session.execute(stmt)).all() if row[0] != excluded_run_id
        ]
        if ids:
            raise DaemonSessionInvariantViolation(
                f"Session '{session_id}' has an unexpected lingering active run "
                f"after daemon restart.",
                details={
                    "session_id": str(session_id),
                    "lingering_run_ids": [str(i) for i in ids],
                },
            )

    async def confirm_session_reconnected(
        self,
        session_id: uuid.UUID,
        *,
        runtime_id: uuid.UUID,
    ) -> Literal["active", "failed", "rejected"]:
        """Flip a reconnecting session to active after daemon resume succeeds.

        Two-phase recover (task-10 §4.4 step 7): daemon runs
        recover_session_after_daemon_restart (writes reconnecting) → then
        restoreAndReconnect (driver.start resume) → on success calls this to
        flip reconnecting → active. On resume failure the daemon leaves the
        session in reconnecting (converged by task-07 idle sweep or manual end).

        Ownership guard: runtime_id must match; mismatch → rejected.
        Non-reconnecting session (already active/ended/failed) → idempotent
        return of current status.
        """
        try:
            stmt = (
                select(AgentSession)
                .where(
                    AgentSession.id == session_id,
                    AgentSession.runtime_id == runtime_id,
                )
                .with_for_update()
            )
            session = (await self._session.execute(stmt)).scalar_one_or_none()
            if session is None:
                return "rejected"
            if session.status != "reconnecting":
                # Idempotent: already active (or terminal). Return current.
                return session.status  # type: ignore[return-value]

            session.status = "active"
            session.last_active_at = datetime.now(UTC)
            self._session.add(session)
            await self._session.commit()
            await self._session.refresh(session)

            await self._publish_session_event(
                session.id,
                {"event": "session_reconnected", "session_id": str(session.id)},
            )
            log.info(
                "session_reconnected_active",
                session_id=str(session.id),
                runtime_id=str(runtime_id),
            )
            return "active"
        except AppError:
            await self._session.rollback()
            raise
        except Exception:
            await self._session.rollback()
            raise

    async def mark_session_recovery_failed(
        self,
        session_id: uuid.UUID,
        *,
        runtime_id: uuid.UUID,
        reason: str = "restore_failed",
    ) -> Literal["failed", "rejected"]:
        """Flip a reconnecting session to failed after daemon resume failed.

        Daemon calls this when driver.start({resume}) throws (cwd mismatch /
        executable missing / SDK jsonl missing). The session was written
        reconnecting by recover_session_after_daemon_restart; resume failing
        means it cannot be restored → failed terminal.
        """
        try:
            stmt = (
                select(AgentSession)
                .where(
                    AgentSession.id == session_id,
                    AgentSession.runtime_id == runtime_id,
                )
                .with_for_update()
            )
            session = (await self._session.execute(stmt)).scalar_one_or_none()
            if session is None:
                return "rejected"
            if session.status in ("ended", "failed"):
                return session.status  # type: ignore[return-value]

            now = datetime.now(UTC)
            session.status = "failed"
            session.ended_at = now
            session.last_active_at = now
            self._session.add(session)
            await self._session.commit()
            await self._session.refresh(session)

            await self._publish_session_event(
                session.id,
                {
                    "event": "session_recovery_failed",
                    "session_id": str(session.id),
                    "reason": reason,
                },
            )
            log.warning(
                "session_recovery_failed",
                session_id=str(session.id),
                runtime_id=str(runtime_id),
                reason=reason,
            )
            return "failed"
        except AppError:
            await self._session.rollback()
            raise
        except Exception:
            await self._session.rollback()
            raise

    # ── Read-only session list + history (task-12, FR-10 / D-005@v1) ────────

    async def list_agent_sessions(
        self,
        user_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
        status_filter: str | None = None,
    ) -> tuple[list[AgentSession], int]:
        """Owner-scoped list of AgentSession with stable paging.

        D-005@v1: isolation is purely DB-level (``AgentSession.user_id``); no
        post-filter. Stable order ``coalesce(last_active_at, created_at) DESC,
        id DESC`` so paging never skips / repeats. ``status_filter`` (when given)
        must already be validated by the router to a known literal.
        """
        from sqlalchemy import func

        base_filters = [AgentSession.user_id == user_id]
        if status_filter is not None:
            base_filters.append(AgentSession.status == status_filter)

        count_stmt = select(func.count()).select_from(AgentSession).where(*base_filters)
        total = int((await self._session.execute(count_stmt)).scalar() or 0)

        order_key = func.coalesce(AgentSession.last_active_at, AgentSession.created_at)
        list_stmt = (
            select(AgentSession)
            .where(*base_filters)
            .order_by(order_key.desc(), AgentSession.id.desc())
            .limit(limit)
            .offset(offset)
        )
        items = list((await self._session.execute(list_stmt)).scalars().all())
        return items, total

    async def get_agent_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> AgentSession:
        """Return a single owned AgentSession (task-06 / FR-2 / D-002@v1).

        Read-only single-read counterpart to :meth:`list_agent_sessions`.
        Ownership is enforced by the ``user_id`` filter so a missing OR
        cross-user session both surface as 404 without leaking existence
        (mirrors ``_get_owned_session_for_update`` minus the row lock — no
        write here, so FOR UPDATE would only add contention). Returns the ORM
        row; the router serializes it via ``AgentSessionRead`` (same mapping
        the list endpoint uses).
        """
        stmt = select(AgentSession).where(
            AgentSession.id == session_id,
            AgentSession.user_id == user_id,
        )
        session = (await self._session.execute(stmt)).scalar_one_or_none()
        if session is None:
            raise DaemonSessionNotFound(
                f"AgentSession '{session_id}' not found.",
                details={"session_id": str(session_id)},
            )
        return session

    async def reopen_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> SessionReopenResponse:
        """Reopen an ended Claude/Codex session for resume (task-05+07 / FR-06).

        Validation (task-05) + full transition (task-07): new interactive lease,
        ``claim_token`` rotation, SESSION_RESUME WS. The daemon-side SDK resume
        is task-08. This method:

          1. SELECT AgentSession FOR UPDATE + ownership (user_id mismatch → 404,
             no existence leak — mirrors :meth:`end_session`).
          2. Pre-flight checks IN ORDER (first failure wins, see task-05 §边界):
             - provider not in {claude, codex} → :class:`DaemonSessionResumeUnsupported`
             - agent_session_id is None → :class:`DaemonSessionNoAgentSession`
               (D-004: create-time handshake never produced an SDK session id)
             - status in ACTIVE_SESSION_STATUSES → :class:`DaemonSessionNotActive`
               (caller should use inject, not reopen)
             - target runtime offline → :class:`DaemonOffline`
          3. task-07 transition: create a NEW interactive lease (the original
             ``completed`` lease is preserved untouched, design §6.2) with a
             fresh ``claim_token``, point ``session.lease_id`` at it, flip
             ``status="reconnecting"``, commit, then emit a best-effort
             ``daemon:session_resume`` WS (``agent_session_id`` is the SDK resume
             key and is preserved verbatim). The method signature + return shape
             are final.

        ``FOR UPDATE`` serializes concurrent reopen on the same row; a second
        reopen landing after the first commits is caught by the status check
        (now ``reconnecting`` ∈ ACTIVE_SESSION_STATUSES → NOT_ACTIVE).
        """
        session = await self._get_owned_session_for_update(session_id, user_id)

        # Pre-flight checks (order is load-bearing — see task-05 §边界处理).
        if session.provider not in {"claude", "codex"}:
            raise DaemonSessionResumeUnsupported(
                f"Session '{session_id}' provider '{session.provider}' does not "
                f"support resume (only claude/codex).",
                details={
                    "session_id": str(session_id),
                    "provider": session.provider,
                },
            )
        if not session.agent_session_id:
            raise DaemonSessionNoAgentSession(
                f"Session '{session_id}' has no agent_session_id to resume.",
                details={"session_id": str(session_id)},
            )
        if session.status in ACTIVE_SESSION_STATUSES:
            raise DaemonSessionNotActive(
                f"Session '{session_id}' is still {session.status}; use inject instead of reopen.",
                details={
                    "session_id": str(session_id),
                    "status": session.status,
                },
            )
        # Runtime must be connected so the daemon can run the SDK resume.
        runtime_id = session.runtime_id
        if runtime_id is not None:
            from app.modules.daemon.ws_hub import get_daemon_ws_hub

            hub = get_daemon_ws_hub()
            # task-06: WS Hub routes by daemon_instance_id; resolve from runtime.
            target_daemon_id = await _resolve_daemon_id_for_runtime(self._session, runtime_id)
            if target_daemon_id is None or not hub.is_connected(target_daemon_id):
                raise DaemonOffline(
                    f"Target runtime '{runtime_id}' is offline; reopen needs a "
                    f"live daemon to run the SDK resume.",
                    details={
                        "session_id": str(session_id),
                        "runtime_id": str(runtime_id),
                    },
                )

        # ── task-07: full reopen transition (design §6.1/§6.2/§6.4/§14) ───────
        # Do NOT revive the original (completed) lease — design §6.2: the ended
        # lease stays ``completed`` for audit; a brand-new interactive lease is
        # created with a fresh ``claim_token`` so a stale pre-reopen claim can
        # never be replayed against the resumed session (matches
        # recover_session_after_daemon_restart token rotation, task-10 §7).
        now = datetime.now(UTC)
        target_runtime_id = session.runtime_id
        assert target_runtime_id is not None  # offline check above guarantees online

        new_token = secrets.token_hex(32)
        new_lease = DaemonTaskLease(
            runtime_id=target_runtime_id,
            agent_run_id=None,
            kind="interactive",
            status="pending",
            lease_expires_at=None,  # NULL → expire_leases skips (D-005@v1)
            attempt_number=1,
            metadata_={
                "session_id": str(session.id),
                "agent_session_id": session.agent_session_id,
                "provider": session.provider,
                "claim_token": new_token,
                "reopened_from_status": session.status,
            },
        )
        self._session.add(new_lease)
        await self._session.flush()  # populate new_lease.id before FK bind

        # Switch session onto the new lease. agent_session_id stays — it is the
        # SDK resume key and must never change. runtime_id is only updated if the
        # caller targets a different daemon (none today; reopen always reuses
        # session.runtime_id, but the branch is kept symmetric with create).
        session.lease_id = new_lease.id
        session.runtime_id = target_runtime_id
        session.status = "reconnecting"
        session.last_active_at = now
        self._session.add(session)
        await self._session.commit()
        await self._session.refresh(session)
        await self._session.refresh(new_lease)

        # ── best-effort daemon:session_resume WS (design §6.4) ────────────────
        # WS failure does NOT roll back the local reconnecting state — the daemon
        # will converge on its own (pull/next-poll or recover-on-restart). The
        # frontend surfaces reconnecting immediately. cwd is forwarded so the
        # SDK resume runs in the original working directory (R-cwd).
        resume_payload = {
            "session_id": str(session.id),
            "lease_id": str(new_lease.id),
            "agent_session_id": session.agent_session_id,
            "cwd": session.cwd,
            "provider": session.provider,
            "runtime_id": str(target_runtime_id),
        }
        try:
            from app.modules.daemon.ws_hub import get_daemon_ws_hub

            hub = get_daemon_ws_hub()
            # task-06: resolve provider runtime_id → daemon_instance_id (WS key).
            resume_daemon_id = await _resolve_daemon_id_for_runtime(
                self._session, target_runtime_id
            )
            resume_ok = False
            if resume_daemon_id is not None:
                resume_ok = await hub.send_session_control(
                    resume_daemon_id,
                    DAEMON_MSG_SESSION_RESUME,
                    resume_payload,
                )
            if not resume_ok:
                log.warning(
                    "session_resume_control_not_delivered",
                    session_id=str(session.id),
                    runtime_id=str(target_runtime_id),
                    lease_id=str(new_lease.id),
                )
        except Exception:
            # best-effort: any WS error stays a warning, local reconnecting holds.
            log.warning(
                "session_resume_control_send_failed",
                session_id=str(session.id),
                runtime_id=str(target_runtime_id),
                lease_id=str(new_lease.id),
                exc_info=True,
            )

        return SessionReopenResponse(
            session_id=str(session.id),
            status="reconnecting",
        )

    async def delete_agent_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        """Delete an owned session while retaining its run history.

        task-03 / FR-03 / D-003@v1: an active/pending/reconnecting session is no
        longer rejected with 409 — the service first performs an internal end
        reconciliation (best-effort SESSION_END WS + currentRun killed +
        lease completed), mirroring :meth:`end_session`, then executes the
        existing hard delete (sever ``agent_runs.agent_session_id`` foreign key
        to preserve run/log history, then drop the session row). ended/failed
        sessions are hard-deleted directly. Daemon-offline WS failure is a
        warning only — the local end + delete still succeed so an offline daemon
        can never strand a deletable active session.
        """
        agent_session = (
            await self._session.execute(
                select(AgentSession)
                .where(
                    AgentSession.id == session_id,
                    AgentSession.user_id == user_id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if agent_session is None:
            raise DaemonSessionNotFound(
                f"AgentSession '{session_id}' not found.",
                details={"session_id": str(session_id)},
            )

        if agent_session.status in ACTIVE_SESSION_STATUSES:
            # Best-effort end reconciliation. Failures here MUST NOT bubble up:
            # the caller asked to delete, so we still force the hard delete below
            # (daemon offline is handled by its own idle-timeout on its side).
            try:
                await self._end_session_for_delete(agent_session)
            except Exception:
                log.warning(
                    "session_delete_end_reconciliation_failed",
                    session_id=str(session_id),
                    status=agent_session.status,
                    exc_info=True,
                )

        await self._session.execute(
            update(AgentRun)
            .where(AgentRun.agent_session_id == session_id)
            .values(agent_session_id=None)
        )
        await self._session.delete(agent_session)
        await self._session.commit()

    async def _end_session_for_delete(self, session: AgentSession) -> None:
        """Internal end reconciliation used by delete_agent_session.

        task-03 / D-003@v1: mirrors the core of :meth:`end_session` (WS +
        run killed + lease completed) but never raises on WS failure and never
        touches ``session.status`` beyond the converged ``ended`` — the caller
        (delete) hard-deletes the row right after, so the session status is
        effectively throwaway; only the run/lease convergence matters for audit.
        Holds the same session row lock the caller already acquired.
        """
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        # Best-effort SESSION_END (kill currentRun + clear SessionStore on daemon).
        if session.runtime_id is not None:
            hub = get_daemon_ws_hub()
            try:
                # task-06: resolve provider runtime_id → daemon_instance_id.
                daemon_id = await _resolve_daemon_id_for_runtime(self._session, session.runtime_id)
                end_ok = False
                if daemon_id is not None:
                    end_ok = await hub.send_session_control(
                        daemon_id,
                        DAEMON_MSG_SESSION_END,
                        {
                            "session_id": str(session.id),
                            "lease_id": str(session.lease_id) if session.lease_id else "",
                            "runtime_id": str(session.runtime_id),
                        },
                    )
                if not end_ok:
                    log.warning(
                        "session_delete_end_control_send_failed",
                        session_id=str(session.id),
                        runtime_id=str(session.runtime_id),
                    )
            except Exception:
                log.warning(
                    "session_delete_end_control_send_failed",
                    session_id=str(session.id),
                    runtime_id=str(session.runtime_id),
                    exc_info=True,
                )

        now = datetime.now(UTC)
        # Kill the current non-terminal run if any (single-transaction convergence).
        runs = (
            (
                await self._session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == session.id)
                )
            )
            .scalars()
            .all()
        )
        for run in runs:
            if run.status not in TERMINAL_TURN_STATUSES:
                run.status = "killed"
                run.finished_at = now
                run.exit_code = -1
                self._session.add(run)

        # Complete the bound interactive lease (if any).
        if session.lease_id is not None:
            lease = await self._session.get(DaemonTaskLease, session.lease_id)
            if lease is not None and lease.status not in (
                "completed",
                "cancelled",
                "expired",
            ):
                lease.status = "completed"
                lease.updated_at = now
                self._session.add(lease)

        await self._session.flush()

    async def get_agent_session_logs(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> list[AgentRunLog]:
        """Return all AgentRunLog rows for an owned session, cross-run aggregate.

        D-005@v1: aggregation key is ``AgentRun.agent_session_id`` (the 1:N FK
        to AgentSession), NEVER ``AgentRun.session_id`` (the claude resume id,
        different semantics). Ownership is verified DB-side
        (``session_id + user_id``); a missing or cross-user session raises
        DaemonSessionNotFound so existence does not leak.

        Ordering note: ``AgentRun`` has no ``created_at`` column, so cross-run
        order is anchored on each run's earliest log timestamp (then
        ``started_at`` then ``id``), and within a run logs are ordered by
        ``timestamp ASC, id ASC``. This is stable and lets the frontend
        delineate turns via ``run_id``.
        """
        from sqlalchemy import func

        # Ownership check (resource hiding — same not-found for missing/cross-user).
        owned = (
            await self._session.execute(
                select(AgentSession.id).where(
                    AgentSession.id == session_id,
                    AgentSession.user_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if owned is None:
            raise DaemonSessionNotFound(
                f"AgentSession '{session_id}' not found.",
                details={"session_id": str(session_id)},
            )

        # Per-run earliest log timestamp (for cross-run ordering anchor).
        min_ts_subq = (
            select(
                AgentRunLog.run_id.label("run_id"),
                func.min(AgentRunLog.timestamp).label("min_ts"),
            )
            .group_by(AgentRunLog.run_id)
            .subquery()
        )

        # Join: logs → runs (filtered by agent_session_id == session_id) → min_ts anchor.
        run_anchor = (
            select(
                AgentRun.id.label("run_id"),
                func.coalesce(min_ts_subq.c.min_ts, AgentRun.started_at).label("anchor_ts"),
            )
            .select_from(AgentRun)
            .outerjoin(min_ts_subq, min_ts_subq.c.run_id == AgentRun.id)
            .where(AgentRun.agent_session_id == session_id)
            .subquery()
        )

        stmt = (
            select(AgentRunLog)
            .select_from(AgentRunLog)
            .join(run_anchor, run_anchor.c.run_id == AgentRunLog.run_id)
            .order_by(
                run_anchor.c.anchor_ts.asc(),
                AgentRunLog.timestamp.asc(),
                AgentRunLog.id.asc(),
            )
        )
        return list((await self._session.execute(stmt)).scalars().all())
