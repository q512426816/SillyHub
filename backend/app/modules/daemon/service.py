"""Daemon service — orchestrates daemon runtime registration, heartbeat, and lease lifecycle."""

from __future__ import annotations

import asyncio
import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal
from uuid import UUID

from sqlalchemy import or_, select, update
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
from app.modules.daemon.schema import SessionReopenResponse
from app.modules.git_gateway.service import redact_output
from app.modules.workspace.model import AgentRunWorkspace, Workspace

log = get_logger(__name__)

DEFAULT_RUNTIME_STALE_SECONDS = 45


# ── Domain errors ────────────────────────────────────────────────────────────


class DaemonRuntimeNotFound(AppError):
    code = "HTTP_404_DAEMON_RUNTIME_NOT_FOUND"
    http_status = 404


class DaemonLeaseNotFound(AppError):
    code = "HTTP_404_DAEMON_LEASE_NOT_FOUND"
    http_status = 404


class DaemonLeaseNotPending(AppError):
    code = "HTTP_409_DAEMON_LEASE_NOT_PENDING"
    http_status = 409


class DaemonLeaseNotClaimed(AppError):
    code = "HTTP_409_DAEMON_LEASE_NOT_CLAIMED"
    http_status = 409


class DaemonInvalidClaimToken(AppError):
    code = "HTTP_403_DAEMON_INVALID_CLAIM_TOKEN"
    http_status = 403


class DaemonAgentRunNotFound(AppError):
    code = "HTTP_404_DAEMON_AGENT_RUN_NOT_FOUND"
    http_status = 404


class DaemonLeaseNoAgentRun(AppError):
    """Batch lease has no agent_run_id (dispatch always sets it; NULL is a bug).

    Fail-fast instead of silently returning an agent_run_id=None claim payload,
    which would make the daemon send empty agent_run_id submitMessages → backend
    422 storm → connection pool exhaustion (ql-004).
    """

    code = "HTTP_422_DAEMON_LEASE_NO_AGENT_RUN"
    http_status = 422


class PatchApplyError(AppError):
    code = "HTTP_422_PATCH_APPLY_ERROR"
    http_status = 422


class PatchConflictError(AppError):
    code = "HTTP_409_PATCH_CONFLICT"
    http_status = 409


# ── RPC errors ──────────────────────────────────────────────────────────────
# task-04: WS RPC channel + list-dir forwarding endpoint. These cover the
# daemon:rpc / daemon:rpc_result round-trip surface defined in design §7.1/§7.2.


class DaemonRuntimeOffline(AppError):
    """Target daemon runtime has no active WS connection (R-01)."""

    code = "HTTP_504_DAEMON_RUNTIME_OFFLINE"
    http_status = 504


class DaemonRpcTimeout(AppError):
    """RPC round-trip exceeded the per-call timeout (R-01)."""

    code = "HTTP_504_DAEMON_RPC_TIMEOUT"
    http_status = 504


class DaemonRpcConflict(AppError):
    """rpc_id collision in the pending map (UUID4 practical impossibility)."""

    code = "HTTP_409_DAEMON_RPC_ID_CONFLICT"
    http_status = 409


class DaemonRpcGatewayError(AppError):
    """WS channel-layer failure (offline / timeout / send failure) → 504."""

    code = "HTTP_504_DAEMON_RPC_GATEWAY"
    http_status = 504


class DaemonRpcForbiddenError(AppError):
    """daemon returned error.code=forbidden (allowed_roots violation, FR-04)."""

    code = "HTTP_403_DAEMON_RPC_FORBIDDEN"
    http_status = 403


class DaemonRpcRemoteGatewayError(AppError):
    """daemon returned a non-forbidden business error → 502."""

    code = "HTTP_502_DAEMON_RPC_REMOTE"
    http_status = 502


class DaemonRpcRemoteError(Exception):
    """Internal signal carrying a daemon error dict up the send_rpc call chain.

    Deliberately NOT an AppError: the HTTP endpoint re-maps it to
    DaemonRpcForbiddenError (403) or DaemonRpcRemoteGatewayError (502), so the
    raw daemon code/message never leaks directly to HTTP status mapping.
    """

    def __init__(self, error: dict) -> None:
        self.code = error.get("code", "unknown")
        self.message = error.get("message", "")
        super().__init__(f"daemon rpc error: {self.code}: {self.message}")


# ── Interactive session errors / result types (task-05, D-005@v1) ───────────
# Status sets live at module level so router tests and future tasks can reuse
# them without re-deriving the business invariants.

ACTIVE_SESSION_STATUSES = frozenset({"pending", "active", "reconnecting"})
ACTIVE_TURN_STATUSES = frozenset({"pending", "running", "pending_approval"})
TERMINAL_TURN_STATUSES = frozenset({"completed", "failed", "killed", "cancelled"})


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


# ── Reopen (resume) errors (task-05 / FR-2 / D-002@v1, D-004@v1) ────────────


class DaemonSessionResumeUnsupported(AppError):
    """Target session provider is not resumable (provider != "claude").

    Only the Claude SDK supports ``--resume <session_id>``; codex/other
    providers cannot be reopened, so the ended session stays terminal.
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


# ── Service ─────────────────────────────────────────────────────────────────


class DaemonService:
    """Service layer for daemon runtime and task lease operations."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Runtime operations ────────────────────────────────────────────────

    async def register_runtime(
        self,
        user_id: uuid.UUID,
        *,
        name: str | None = None,
        provider: str | None = None,
        version: str | None = None,
        os: str | None = None,
        arch: str | None = None,
        capabilities: dict | None = None,
    ) -> DaemonRuntime:
        """Register a new daemon runtime or return existing one (idempotent).

        If a runtime with the same user_id + provider + name already exists,
        update its fields and return it. Otherwise create a new record.
        """
        now = datetime.now(UTC)

        # Try to find existing runtime by user_id + provider + name
        stmt = select(DaemonRuntime).where(
            col(DaemonRuntime.user_id) == user_id,
            col(DaemonRuntime.provider) == provider,
            col(DaemonRuntime.name) == name,
        )
        existing = (await self._session.execute(stmt)).scalars().first()

        if existing is not None:
            # Update existing record
            existing.version = version
            existing.os = os
            existing.arch = arch
            existing.capabilities = capabilities
            if existing.status != "disabled":
                existing.status = "online"
            existing.last_heartbeat_at = now
            existing.updated_at = now
            self._session.add(existing)
            await self._session.commit()
            await self._session.refresh(existing)
            log.info(
                "daemon_runtime_reregistered",
                runtime_id=str(existing.id),
                user_id=str(user_id),
                provider=provider,
            )
            return existing

        # Create new runtime
        runtime = DaemonRuntime(
            id=uuid.uuid4(),
            user_id=user_id,
            name=name,
            provider=provider,
            version=version,
            os=os,
            arch=arch,
            status="online",
            last_heartbeat_at=now,
            capabilities=capabilities,
            metadata_={},
        )
        self._session.add(runtime)
        await self._session.commit()
        await self._session.refresh(runtime)
        log.info(
            "daemon_runtime_registered",
            runtime_id=str(runtime.id),
            user_id=str(user_id),
            provider=provider,
        )
        return runtime

    async def heartbeat(self, runtime_id: uuid.UUID) -> DaemonRuntime:
        """Update heartbeat timestamp for a daemon runtime."""
        runtime = await self._session.get(DaemonRuntime, runtime_id)
        if runtime is None:
            raise DaemonRuntimeNotFound(
                f"Daemon runtime '{runtime_id}' not found.",
                details={"runtime_id": str(runtime_id)},
            )

        now = datetime.now(UTC)
        runtime.last_heartbeat_at = now
        if runtime.status != "disabled":
            runtime.status = "online"
        runtime.updated_at = now
        self._session.add(runtime)
        await self._session.commit()
        await self._session.refresh(runtime)
        return runtime

    async def get_runtime(self, runtime_id: uuid.UUID) -> DaemonRuntime | None:
        """Get a daemon runtime by ID."""
        return await self._session.get(DaemonRuntime, runtime_id)

    async def list_runtimes(self, user_id: uuid.UUID) -> list[DaemonRuntime]:
        """List all runtimes for a given user."""
        stmt = (
            select(DaemonRuntime)
            .where(col(DaemonRuntime.user_id) == user_id)
            .order_by(col(DaemonRuntime.created_at).desc())
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def mark_offline(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID | None = None,
    ) -> DaemonRuntime:
        """Mark a daemon runtime as offline."""
        runtime = await self._session.get(DaemonRuntime, runtime_id)
        if runtime is None or (user_id is not None and runtime.user_id != user_id):
            raise DaemonRuntimeNotFound(
                f"Daemon runtime '{runtime_id}' not found.",
                details={"runtime_id": str(runtime_id)},
            )
        now = datetime.now(UTC)
        if runtime.status != "disabled":
            runtime.status = "offline"
        runtime.updated_at = now
        self._session.add(runtime)
        await self._session.commit()
        await self._session.refresh(runtime)
        return runtime

    async def disable_runtime(self, runtime_id: uuid.UUID, user_id: uuid.UUID) -> DaemonRuntime:
        """Disable a runtime for placement without losing heartbeat freshness."""
        runtime = await self._get_owned_runtime(runtime_id, user_id)
        now = datetime.now(UTC)
        runtime.status = "disabled"
        runtime.updated_at = now
        self._session.add(runtime)
        await self._session.commit()
        await self._session.refresh(runtime)
        return runtime

    async def enable_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        max_age_seconds: int = DEFAULT_RUNTIME_STALE_SECONDS,
    ) -> DaemonRuntime:
        """Enable a runtime, restoring online only when its heartbeat is fresh."""
        runtime = await self._get_owned_runtime(runtime_id, user_id)
        now = datetime.now(UTC)
        runtime.status = (
            "online"
            if self._is_recent_heartbeat(runtime.last_heartbeat_at, max_age_seconds)
            else "offline"
        )
        runtime.updated_at = now
        self._session.add(runtime)
        await self._session.commit()
        await self._session.refresh(runtime)
        return runtime

    async def cleanup_stale_runtimes(
        self,
        max_age_seconds: int = DEFAULT_RUNTIME_STALE_SECONDS,
    ) -> int:
        """Mark runtimes as offline if heartbeat is older than max_age_seconds."""
        cutoff = datetime.now(UTC) - timedelta(seconds=max_age_seconds)
        stmt = select(DaemonRuntime).where(
            col(DaemonRuntime.status) == "online",
            or_(
                col(DaemonRuntime.last_heartbeat_at).is_(None),
                col(DaemonRuntime.last_heartbeat_at) < cutoff,
            ),
        )
        stale = list((await self._session.execute(stmt)).scalars().all())
        now = datetime.now(UTC)
        for runtime in stale:
            runtime.status = "offline"
            runtime.updated_at = now
            self._session.add(runtime)
        if stale:
            await self._session.commit()
        return len(stale)

    async def _get_owned_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> DaemonRuntime:
        runtime = await self._session.get(DaemonRuntime, runtime_id)
        if runtime is None or runtime.user_id != user_id:
            raise DaemonRuntimeNotFound(
                f"Daemon runtime '{runtime_id}' not found.",
                details={"runtime_id": str(runtime_id)},
            )
        return runtime

    @staticmethod
    def _is_recent_heartbeat(value: datetime | None, max_age_seconds: int) -> bool:
        if value is None:
            return False
        heartbeat_at = value if value.tzinfo else value.replace(tzinfo=UTC)
        return heartbeat_at >= datetime.now(UTC) - timedelta(seconds=max_age_seconds)

    # ── Lease operations ──────────────────────────────────────────────────

    async def create_lease(
        self,
        runtime_id: uuid.UUID,
        *,
        agent_run_id: uuid.UUID | None = None,
        ttl_seconds: int = 3600,
    ) -> DaemonTaskLease:
        """Create a new task lease for a daemon runtime."""
        runtime = await self._session.get(DaemonRuntime, runtime_id)
        if runtime is None:
            raise DaemonRuntimeNotFound(
                f"Daemon runtime '{runtime_id}' not found.",
                details={"runtime_id": str(runtime_id)},
            )

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=runtime_id,
            agent_run_id=agent_run_id,
            status="pending",
            metadata_={},
        )
        self._session.add(lease)
        await self._session.commit()
        await self._session.refresh(lease)
        log.info(
            "daemon_lease_created",
            lease_id=str(lease.id),
            runtime_id=str(runtime_id),
            agent_run_id=str(agent_run_id) if agent_run_id else None,
        )
        return lease

    async def claim_lease(
        self,
        lease_id: uuid.UUID,
        runtime_id: uuid.UUID,
    ) -> tuple[DaemonTaskLease, dict]:
        """Claim a pending task lease.

        Returns a tuple of (lease, payload) where payload contains the
        execution context built from the associated AgentRun.
        """
        lease = await self._session.get(DaemonTaskLease, lease_id)
        if lease is None:
            raise DaemonLeaseNotFound(
                f"Daemon task lease '{lease_id}' not found.",
                details={"lease_id": str(lease_id)},
            )

        if lease.status != "pending":
            raise DaemonLeaseNotPending(
                f"Lease '{lease_id}' is not pending (status={lease.status}).",
                details={"lease_id": str(lease_id), "status": lease.status},
            )

        now = datetime.now(UTC)
        metadata = dict(lease.metadata_ or {})
        # gap-2（D-002@v3 补丁 design §3）：interactive lease 在
        # prepare_interactive_dispatch 时已生成 claim_token 写入 metadata，这里
        # 复用同一 token（不重新生成），保证 SESSION_INJECT 下发的 claim_token 与
        # lease metadata 一致，daemon claim 后持有的 token 对后续 start/heartbeat/
        # submit_messages/close_interactive_run 验证都有效。batch lease 无预生成
        # claim_token，走原逻辑生成新 token。
        existing_token = metadata.get("claim_token")
        if existing_token:
            claim_token = existing_token
        else:
            claim_token = secrets.token_hex(32)
            metadata["claim_token"] = claim_token

        # Update lease — keep original runtime_id if already set
        lease.status = "claimed"
        lease.claimed_at = now
        # interactive lease 永不过期（生命周期由 end_session 管，design §D-005）；
        # batch lease 用 60s claim 窗口（claim→start 间隔超时回收）。
        # **修复 Bug**：原无条件设 60s 覆盖了 prepare_*_interactive_dispatch 写的 NULL，
        # 导致 scan 长任务中途 lease 过期。
        if lease.kind != "interactive":
            lease.lease_expires_at = now + timedelta(seconds=60)
        if not lease.runtime_id:
            lease.runtime_id = runtime_id
        lease.metadata_ = metadata
        flag_modified(lease, "metadata_")
        lease.updated_at = now
        self._session.add(lease)

        # Build payload from associated AgentRun
        payload = await self._build_claim_payload(lease)

        await self._session.commit()
        await self._session.refresh(lease)

        log.info(
            "daemon_lease_claimed",
            lease_id=str(lease_id),
            runtime_id=str(runtime_id),
        )
        return lease, payload

    async def _build_claim_payload(self, lease: DaemonTaskLease) -> dict:
        """Build execution context payload for a claimed lease."""
        lease_meta = dict(lease.metadata_ or {})
        payload: dict = {
            "lease_id": str(lease.id),
            "agent_run_id": None,
            "workspace_id": None,
            "session_id": None,
            "tool_config": {},
            # gap-5（补丁遗漏）：claim payload 必须带 lease.kind，否则 daemon
            # execPayload.kind 为 undefined → 走 batch task_runner（422）。
            "kind": lease.kind,
        }
        # gap-5：interactive lease agent_run_id=NULL（D-005），不走 agent_run 提取分支，
        # 从 lease metadata 取首 turn 参数（prepare_interactive_dispatch 写入），
        # 供 daemon _startInteractiveSession 构造 SessionManager.create 输入。
        if lease.kind == "interactive":
            payload["agent_session_id"] = lease_meta.get("session_id")
            # daemon execPayload.agentRunId 读 snake_case `agent_run_id`（不是 run_id），
            # 把 metadata.run_id 同时映射到 agent_run_id，否则 daemon has_run_id=false
            payload["agent_run_id"] = lease_meta.get("run_id")
            payload["run_id"] = lease_meta.get("run_id")
            payload["prompt"] = lease_meta.get("prompt")
            payload["provider"] = lease_meta.get("provider")
            payload["model"] = lease_meta.get("model")
            payload["root_path"] = lease_meta.get("cwd") or lease_meta.get("root_path")
            # scan 真阻塞：透传 manual_approval / ask_user_only（prepare_scan_interactive_dispatch
            # 写入 lease metadata）→ daemon execPayload 归一化 → SessionManager.create input：
            #   - manual_approval 决定是否注入 canUseTool（per-session，chat=false 不注入）
            #   - ask_user_only=true 时只 AskUserQuestion 走人审、Bash 等放行让 scan 自动跑。
            # **修复 Bug**：原 interactive 分支漏传这两个字段 → askUserOnly=undefined → gate
            # 不触发 → 所有工具（含 sillyspec 的 Bash）都走人审 → 5min 超时死循环。
            if lease_meta.get("manual_approval") is not None:
                payload["manual_approval"] = lease_meta["manual_approval"]
            if lease_meta.get("ask_user_only") is not None:
                payload["ask_user_only"] = lease_meta["ask_user_only"]
            return payload

        if lease.agent_run_id is None:
            # ql-004：batch lease（interactive 已在上方 return）agent_run_id 不应为
            # NULL。静默返回 agent_run_id=None 的 payload 会让 daemon 发空
            # agent_run_id → backend 422 风暴 → 连接池耗尽。fail-fast 抛错暴露。
            raise DaemonLeaseNoAgentRun(
                f"Batch lease '{lease.id}' has no agent_run_id (kind={lease.kind}).",
                details={"lease_id": str(lease.id), "kind": lease.kind},
            )

        agent_run = await self._session.get(AgentRun, lease.agent_run_id)
        if agent_run is None:
            log.warning(
                "daemon_claim_agent_run_missing",
                lease_id=str(lease.id),
                agent_run_id=str(lease.agent_run_id),
            )
            return payload

        # Get workspace_id from M:N association
        ws_stmt = (
            select(AgentRunWorkspace.workspace_id)
            .where(
                col(AgentRunWorkspace.agent_run_id) == agent_run.id,
            )
            .limit(1)
        )
        ws_row = (await self._session.execute(ws_stmt)).first()
        workspace_id = ws_row[0] if ws_row else None

        payload["agent_run_id"] = str(agent_run.id)
        payload["workspace_id"] = str(workspace_id) if workspace_id else None
        payload["session_id"] = agent_run.session_id
        payload["agent_type"] = agent_run.agent_type
        if agent_run.provider:
            payload["provider"] = agent_run.provider
        if agent_run.model:
            payload["model"] = agent_run.model
        payload["change_id"] = str(agent_run.change_id) if agent_run.change_id else None
        payload["task_id"] = str(agent_run.task_id) if agent_run.task_id else None

        # Propagate prompt from lease metadata (quick-chat scenario)
        lease_meta = lease.metadata_ or {}
        if lease_meta.get("prompt"):
            payload["prompt"] = lease_meta["prompt"]
        # ql-20260618-009：AgentRun 是 source of truth（持久化快照），
        # lease_meta 仅在 AgentRun 字段为空时兜底（如旧测试场景）。
        # 不再用 lease_meta 覆盖 AgentRun 已固化的值——避免重 dispatch 时 transport
        # 与快照不一致导致 daemon 拿到错的 provider/model。
        if not agent_run.provider and lease_meta.get("provider"):
            payload["provider"] = lease_meta["provider"]
        if not agent_run.model and lease_meta.get("model"):
            payload["model"] = lease_meta["model"]
        if lease_meta.get("resume_session_id"):
            payload["resume_session_id"] = lease_meta["resume_session_id"]
        # Propagate bundle context fields from lease metadata (task-03 / Phase 2).
        if lease_meta.get("repo_url"):
            payload["repo_url"] = lease_meta["repo_url"]
        if lease_meta.get("branch"):
            payload["branch"] = lease_meta["branch"]
        if lease_meta.get("allowed_paths"):
            payload["allowed_paths"] = lease_meta["allowed_paths"]
        if lease_meta.get("tool_config"):
            payload["tool_config"] = lease_meta["tool_config"]  # 覆盖默认 {}
        if lease_meta.get("timeout_seconds") is not None:
            payload["timeout_seconds"] = lease_meta["timeout_seconds"]
        # ql-20260617-009：workspace 标识 + root_path 透传给 daemon（camelCase + snake_case 双写，
        # 对齐 daemon.ts:662-665 兜底链；root_path 用于 daemon 直接当 cwd，跳过 mirror）。
        if lease_meta.get("workspace_name"):
            payload["workspaceName"] = lease_meta["workspace_name"]
            payload["workspace_name"] = lease_meta["workspace_name"]
        if lease_meta.get("workspace_slug"):
            payload["workspaceSlug"] = lease_meta["workspace_slug"]
            payload["workspace_slug"] = lease_meta["workspace_slug"]
        if lease_meta.get("root_path"):
            payload["rootPath"] = lease_meta["root_path"]
            payload["root_path"] = lease_meta["root_path"]

        # Include runtime capabilities (cmd_path, bin_path, protocol)
        runtime = await self._session.get(DaemonRuntime, lease.runtime_id)
        if runtime is not None and runtime.capabilities:
            caps = runtime.capabilities if isinstance(runtime.capabilities, dict) else {}
            payload["cmd_path"] = caps.get("bin_path", "")
            payload["protocol"] = caps.get("protocol", "")

        return payload

    async def start_lease(self, lease_id: uuid.UUID, claim_token: str) -> DaemonTaskLease:
        """Mark a claimed lease as started."""
        lease = await self._get_lease_and_verify_token(lease_id, claim_token)

        if lease.status != "claimed":
            raise DaemonLeaseNotClaimed(
                f"Lease '{lease_id}' is not claimed (status={lease.status}).",
                details={"lease_id": str(lease_id), "status": lease.status},
            )

        # Lease status stays "claimed" — running status is tracked in AgentRun
        now = datetime.now(UTC)
        lease.updated_at = now
        # interactive lease 保持 NULL（永不过期）；batch lease 续 60s（running 期间
        # 心跳续期，超时回收）。
        if lease.kind != "interactive":
            lease.lease_expires_at = now + timedelta(seconds=60)
        self._session.add(lease)

        # Also update AgentRun to running if it exists
        if lease.agent_run_id is not None:
            agent_run = await self._session.get(AgentRun, lease.agent_run_id)
            if agent_run is not None:
                agent_run.status = "running"
                agent_run.started_at = now
                self._session.add(agent_run)

        await self._session.commit()
        await self._session.refresh(lease)

        # Publish AgentRun start event via Redis
        if lease.agent_run_id is not None:
            try:
                redis = get_redis()
                await redis.publish(
                    f"agent_run:{lease.agent_run_id}",
                    json.dumps(
                        {
                            "event": "status_changed",
                            "status": "running",
                            "lease_id": str(lease_id),
                        }
                    ),
                )
            except Exception:
                log.warning(
                    "daemon_start_redis_publish_failed",
                    lease_id=str(lease_id),
                    agent_run_id=str(lease.agent_run_id),
                )

        log.info(
            "daemon_lease_started",
            lease_id=str(lease_id),
            agent_run_id=str(lease.agent_run_id) if lease.agent_run_id else None,
        )
        return lease

    async def lease_heartbeat(self, lease_id: uuid.UUID, claim_token: str) -> DaemonTaskLease:
        """Renew a lease's heartbeat to prevent expiry."""
        lease = await self._get_lease_and_verify_token(lease_id, claim_token)

        now = datetime.now(UTC)
        lease.lease_expires_at = now + timedelta(seconds=60)
        lease.updated_at = now
        self._session.add(lease)
        await self._session.commit()
        await self._session.refresh(lease)
        return lease

    async def complete_lease(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        result: dict,
    ) -> DaemonTaskLease:
        """Mark a lease as completed with results."""
        lease = await self._get_lease_and_verify_token(lease_id, claim_token)

        now = datetime.now(UTC)
        lease.status = "completed"
        lease.updated_at = now
        self._session.add(lease)

        # Update associated AgentRun
        if lease.agent_run_id is not None:
            agent_run = await self._session.get(AgentRun, lease.agent_run_id)
            if agent_run is not None:
                result_status = result.get("status", "completed")
                # ql-20260616-006：终态优先级护栏——killed > failed > cancelled > completed
                # daemon 在 cancel 链路里先调 syncStatus("killed") 把 AgentRun 标 killed，
                # 再 complete_lease 收尾时上报 status="cancelled"。若直接覆写会让 UI 显示
                # "cancelled"（用户取消语义弱）而不是 "killed"（实际被 SIGTERM）。
                # 这里按优先级合并：当前 status 优先级 >= 待写 status 时不动。
                priority = {"completed": 0, "cancelled": 1, "failed": 2, "killed": 3}
                current_priority = priority.get(agent_run.status, 0)
                new_priority = priority.get(
                    result_status if result_status in priority else "completed",
                    0,
                )
                if new_priority >= current_priority:
                    agent_run.status = (
                        result_status
                        if result_status in ("completed", "failed", "cancelled", "killed")
                        else "completed"
                    )
                # finished_at 已被 syncStatus("killed") 写入则保留，否则补 now
                if agent_run.finished_at is None:
                    agent_run.finished_at = now

                # Store agent output and error（task-07：redact_output 二次脱敏，
                # 单一真相源 git_gateway.redact_output，daemon 不移植正则规则）
                if result.get("output"):
                    agent_run.output_redacted = redact_output(result["output"])
                if result.get("error"):
                    existing = agent_run.output_redacted or ""
                    agent_run.output_redacted = (
                        existing + ("\n" if existing else "") + redact_output(result["error"])
                    )
                if result.get("duration_ms"):
                    agent_run.duration_ms = result["duration_ms"]
                if result.get("session_id"):
                    agent_run.session_id = result["session_id"]

                # Apply usage stats from result if present
                stats = result.get("stats")
                if stats and isinstance(stats, dict):
                    if "total_cost_usd" in stats:
                        agent_run.total_cost_usd = stats["total_cost_usd"]
                    if "duration_ms" in stats:
                        agent_run.duration_ms = stats["duration_ms"]
                    if "input_tokens" in stats:
                        agent_run.input_tokens = stats["input_tokens"]
                    if "output_tokens" in stats:
                        agent_run.output_tokens = stats["output_tokens"]
                    if "num_turns" in stats:
                        agent_run.num_turns = stats["num_turns"]
                    if "session_id" in stats:
                        agent_run.session_id = stats["session_id"]
                    if "exit_code" in stats:
                        agent_run.exit_code = stats["exit_code"]

                self._session.add(agent_run)

        await self._session.commit()
        await self._session.refresh(lease)

        # Publish completion event via Redis
        if lease.agent_run_id is not None:
            try:
                redis = get_redis()
                await redis.publish(
                    f"agent_run:{lease.agent_run_id}",
                    json.dumps(
                        {
                            "event": "done",
                            "status": "completed",
                            "lease_id": str(lease_id),
                        }
                    ),
                )
            except Exception:
                log.warning(
                    "daemon_complete_redis_publish_failed",
                    lease_id=str(lease_id),
                )

        # Patch application（task-07：入库前 redact_output 二次脱敏 patch，
        # 对齐 diff_collector.py:174，确保 daemon 上报的密钥不入库）
        patch = result.get("patch")
        if patch and lease.agent_run_id is not None:
            if isinstance(patch, str):
                patch = redact_output(patch)
            patch_data = json.dumps(patch) if isinstance(patch, dict) else str(patch)
            try:
                await self._apply_patch_to_worktree(
                    agent_run_id=lease.agent_run_id,
                    patch_data=patch_data,
                    use_3way=True,
                )
                log.info(
                    "daemon_patch_applied",
                    lease_id=str(lease_id),
                    agent_run_id=str(lease.agent_run_id),
                    patch_size=len(patch_data),
                )
            except PatchConflictError as exc:
                log.warning(
                    "daemon_patch_conflict",
                    lease_id=str(lease_id),
                    agent_run_id=str(lease.agent_run_id),
                    conflict_detail=exc.message,
                )
                metadata = dict(lease.metadata_ or {})
                metadata["patch_conflict"] = {
                    "error": exc.message,
                    "details": exc.details,
                }
                lease.metadata_ = metadata
                flag_modified(lease, "metadata_")
                self._session.add(lease)
                await self._session.commit()
                await self._session.refresh(lease)
            except PatchApplyError:
                raise

        # A2: stage 完成回调 —— stage dispatch（AgentRun.change_id 非空）的 run
        # 完成后，同步 sillyspec.db 状态并 auto-dispatch 下一阶段。spec sync 已在
        # daemon _finish 之前完成（task-runner.ts:477），server spec_root 的
        # sillyspec.db 此时为最新。失败不阻塞 lease 完成（与 reconcile_stale_runs
        # 容错一致）。scan（change_id=None）不走此路径。
        if lease.agent_run_id is not None:
            try:
                await self._trigger_stage_completion_callback(lease.agent_run_id)
            except Exception as exc:
                log.warning(
                    "complete_lease_stage_callback_failed",
                    lease_id=str(lease_id),
                    agent_run_id=str(lease.agent_run_id),
                    error=str(exc),
                )

        # C: scan 完成后跑平台侧结构化校验（PostScanValidator）—— 消费 sillyspec
        # 平台模式产出的 manifest.json / postcheck-result / 源码污染检测 / 7 文档
        # 齐全等结构化回执。仅 scan run（change_id=None + platform-managed）触发；
        # 结果写入 lease.metadata['post_scan_validation']，不翻转 scan 成功语义。
        if lease.agent_run_id is not None:
            try:
                await self._run_post_scan_validation(lease)
            except Exception as exc:
                log.warning(
                    "complete_lease_post_scan_validation_failed",
                    lease_id=str(lease_id),
                    error=str(exc),
                )

        log.info(
            "daemon_lease_completed",
            lease_id=str(lease_id),
            result_status=result.get("status"),
        )
        return lease

    async def _trigger_stage_completion_callback(self, agent_run_id: uuid.UUID) -> None:
        """A2: stage dispatch 的 AgentRun 完成后同步 sillyspec.db 并推进下一阶段。

        仅对 stage dispatch（change_id 非空、status=completed）生效；scan
        （change_id=None）由 spec sync + scan_docs.reparse 单独回流，不走这里。
        调用范式对齐 reconcile_stale_runs（dispatch.py:466-483）。
        """
        from app.modules.change.dispatch import (
            SillySpecStageDispatchService,
            auto_dispatch_next_step,
        )
        from app.modules.change.model import Change

        agent_run = await self._session.get(AgentRun, agent_run_id)
        if agent_run is None or agent_run.change_id is None:
            return
        if agent_run.status != "completed":
            return

        change = await self._session.get(Change, agent_run.change_id)
        if change is None:
            return

        svc = SillySpecStageDispatchService(self._session)
        sync_result = await svc.sync_stage_status(self._session, agent_run.change_id, agent_run.id)
        if not sync_result.synced:
            log.info(
                "stage_callback_sync_skipped",
                agent_run_id=str(agent_run_id),
                change_id=str(agent_run.change_id),
                error=sync_result.error,
            )
            return

        # user_id：对齐 reconcile_stale_runs 的回退策略（change.owner_id → 零 UUID）。
        user_id = change.owner_id or uuid.UUID(int=0)
        await auto_dispatch_next_step(
            session=self._session,
            workspace_id=change.workspace_id,
            change_id=agent_run.change_id,
            user_id=user_id,
            sync_result=sync_result,
        )
        log.info(
            "stage_callback_done",
            agent_run_id=str(agent_run_id),
            change_id=str(agent_run.change_id),
        )

    async def _run_post_scan_validation(self, lease: DaemonTaskLease) -> None:
        """C: scan 完成后跑平台侧结构化校验（PostScanValidator）。

        消费 sillyspec 平台模式产出的结构化回执：manifest.json / platform-scan.json
        / postcheck-result / 源码污染检测 / 7 份 scan 文档齐全性。仅对 scan run
        （``AgentRun.change_id`` 为空且 ``spec_strategy == "platform-managed"``）触发；
        校验结果写入 ``lease.metadata['post_scan_validation']``，**不翻转** scan 的
        成功语义（避免破坏现有行为，仅做增强校验与留痕）。

        daemon-client 模式下 source_root 可能不在 server 本机，PostScanValidator
        内部以 ``exists()`` 容错；外层另有 try/except 保证不阻塞 lease 完成。
        """
        from app.modules.agent.post_scan_validator import PostScanValidator

        if not lease.agent_run_id:
            return
        agent_run = await self._session.get(AgentRun, lease.agent_run_id)
        if agent_run is None:
            return
        # 仅 scan run：无 change_id 且平台托管（stage run 走 _trigger_stage_completion_callback）
        if agent_run.change_id is not None:
            return
        if getattr(agent_run, "spec_strategy", None) != "platform-managed":
            return

        meta = dict(lease.metadata_ or {})
        source_root = meta.get("root_path")
        spec_root = meta.get("spec_root")
        runtime_root = meta.get("runtime_root") or (
            str(Path(spec_root) / "runtime") if spec_root else None
        )
        if not source_root or not spec_root or not runtime_root:
            log.info(
                "post_scan_validation_skipped_no_paths",
                lease_id=str(lease.id),
                has_root_path=bool(source_root),
                has_spec_root=bool(spec_root),
            )
            return

        validator = PostScanValidator(source_root, spec_root, runtime_root, str(agent_run.id))
        result = validator.validate(agent_run.output_redacted or "", agent_run.exit_code or 0)
        meta["post_scan_validation"] = {
            "status": str(result.status.value),
            "has_errors": result.has_errors,
            "has_warnings": result.has_warnings,
            "errors": [
                {"code": e.code, "severity": e.severity, "message": e.message}
                for e in result.errors
            ],
            "warnings": [
                {"code": w.code, "severity": w.severity, "message": w.message}
                for w in result.warnings
            ],
            "metadata": result.metadata,
        }
        lease.metadata_ = meta
        flag_modified(lease, "metadata_")
        self._session.add(lease)
        await self._session.commit()

        log.info(
            "post_scan_validation_done",
            lease_id=str(lease.id),
            agent_run_id=str(agent_run.id),
            status=str(result.status.value),
            errors=len(result.errors),
            warnings=len(result.warnings),
        )

    async def submit_messages(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        agent_run_id: uuid.UUID,
        messages: list[dict],
    ) -> int:
        """Submit agent conversation messages for a lease.

        Writes to AgentRunLog, syncs AgentRun status, and publishes via Redis
        pub/sub. Returns the number of messages written.
        """
        await self._get_lease_and_verify_token(lease_id, claim_token)

        now = datetime.now(UTC)
        count = 0
        published_logs: list[dict] = []
        # ql-20260617-001：daemon _eventToMessages 把 usage/session_id 透传到首条
        # message（task-runner.ts:1142-1155），但首条 message 总有 content（[ASSISTANT]/
        # [TOOL_USE]/[TOOL_RESULT] 等），所以「仅在 content 为空时提取 usage」的旧分支
        # 永远走不到。现在对所有 message 都提取 usage/session_id（取 max 防御乱序）。
        # ql-20260617-003：Claude CLI stream-json 的中间 assistant 事件 usage 永远是
        # {input_tokens:0, output_tokens:0}（只在最终 result 事件才有真实值）。
        # 所以 daemon 透传的 usage 经常是 0/0 —— 我们把它当成"无数据"，不覆盖
        # AgentRun 已有的非零值（complete_lease 路径会用 result 事件的真实值覆盖）。
        latest_input_tokens: int | None = None
        latest_output_tokens: int | None = None
        latest_session_id: str | None = None
        for msg in messages:
            # ql-20260616-003：daemon _eventToMessage 不发 channel/timestamp/log_id，
            # 后端按 event_type 映射 channel（text→stdout, tool_use/tool_result→tool_call,
            # error→stderr），避免前端 SSE 实时流出现 Invalid Date + channel 误判。
            event_type = msg.get("event_type") or ""
            content = msg.get("content", "")
            # ql-005：interactive session（SDK driver）的 onTurnMessage 发原始 SDK msg
            # （{type, message:{content:[ContentBlock]}}），顶层无 content/event_type。
            # 提取 message.content 的 text blocks 让 message 落地——否则 count=0、
            # 前端 quick-chat 看不到输出。batch（flat {event_type,content}）不受影响。
            if not content and not event_type:
                sdk_type = msg.get("type")
                if isinstance(sdk_type, str):
                    event_type = sdk_type
                    inner = msg.get("message")
                    if isinstance(inner, dict):
                        blocks = inner.get("content")
                        if isinstance(blocks, list):
                            content = "".join(
                                str(b.get("text", ""))
                                for b in blocks
                                if isinstance(b, dict) and b.get("type") == "text"
                            )
            channel = msg.get("channel") or _channel_from_event_type(event_type)
            # ql-20260617-001：usage / session_id 在每条 message 顶层（daemon 透传），
            # 与 content 是否为空无关，全部提取。
            usage = msg.get("usage")
            if isinstance(usage, dict):
                in_tok = usage.get("input_tokens")
                out_tok = usage.get("output_tokens")
                if isinstance(in_tok, (int, float)) and int(in_tok) > 0:
                    latest_input_tokens = max(latest_input_tokens or 0, int(in_tok))
                if isinstance(out_tok, (int, float)) and int(out_tok) > 0:
                    latest_output_tokens = max(latest_output_tokens or 0, int(out_tok))
            msg_session_id = msg.get("session_id")
            if isinstance(msg_session_id, str) and msg_session_id:
                latest_session_id = msg_session_id

            if not content:
                # 无 content 的 message（理论上 daemon 不产生）跳过日志写入，
                # 但 usage / session_id 已在上面提取。
                continue

            log_id = uuid.uuid4()
            log_entry = AgentRunLog(
                id=log_id,
                run_id=agent_run_id,
                timestamp=now,
                channel=channel,
                content_redacted=content[:5000],
            )
            self._session.add(log_entry)
            count += 1
            published_logs.append(
                {
                    "log_id": str(log_id),
                    "channel": channel,
                    "content": content[:5000],
                    "timestamp": now.isoformat().replace("+00:00", "Z"),
                }
            )

        # Sync AgentRun status: pending -> running on first messages
        agent_run_status: str | None = None
        agent_run = await self._session.get(AgentRun, agent_run_id)
        if agent_run is not None:
            agent_run_status = agent_run.status
            if agent_run.status == "pending":
                agent_run.status = "running"
                agent_run.started_at = now
                agent_run_status = "running"
                self._session.add(agent_run)
                log.info(
                    "daemon_messages_agent_run_activated",
                    agent_run_id=str(agent_run_id),
                    lease_id=str(lease_id),
                )
            # ql-20260616-004：实时 token 写回。仅在数值增大时覆盖（防御乱序），
            # 让前端 5s 轮询拿到中间过程的累积 token，不必等 result 事件汇总。
            if latest_input_tokens is not None and (
                agent_run.input_tokens is None or latest_input_tokens > agent_run.input_tokens
            ):
                agent_run.input_tokens = latest_input_tokens
                self._session.add(agent_run)
            if latest_output_tokens is not None and (
                agent_run.output_tokens is None or latest_output_tokens > agent_run.output_tokens
            ):
                agent_run.output_tokens = latest_output_tokens
                self._session.add(agent_run)
            # ql-20260617-001：session_id 实时写回（首次拿到就填，complete_lease 仍可覆盖）。
            if latest_session_id and not agent_run.session_id:
                agent_run.session_id = latest_session_id
                self._session.add(agent_run)

        if count > 0 or (agent_run is not None and agent_run_status == "running"):
            await self._session.commit()

        # ql-20260616-003：每条已持久化的 log 单独 publish 成扁平 StreamLogEvent
        # 形态（{channel, content, timestamp, log_id}），前端 SSE onmessage 直接当
        # StreamLogEvent 用，无需识别 {event:"messages"} 包装。仍保留一条聚合
        # messages 事件做计数/审计（event 字段区分）。
        try:
            redis = get_redis()
            channel_name = f"agent_run:{agent_run_id}"
            for log_payload in published_logs:
                await redis.publish(channel_name, json.dumps(log_payload))
            summary_payload: dict = {
                "event": "messages",
                "lease_id": str(lease_id),
                "count": count,
            }
            if agent_run_status is not None:
                summary_payload["agent_run_status"] = agent_run_status
            await redis.publish(channel_name, json.dumps(summary_payload))
        except Exception:
            log.warning(
                "daemon_messages_redis_publish_failed",
                lease_id=str(lease_id),
                agent_run_id=str(agent_run_id),
            )

        # task-06 / D-005@v1 / FR-03：interactive run 双 publish —— 保留上面
        # agent_run:{run_id} 不变，同时把每条扁平 log 以带 run_id 标记的事件
        # 发布到 session 级 channel ``agent_session:{session_id}``，让单条 SSE
        # 连接跨多个 turn 不断流。batch run（agent_session_id IS NULL）跳过。
        # 独立 try/except：session publish 失败不得破坏 run channel 或回滚已
        # 提交的 AgentRunLog（AC-06）；Redis Pub/Sub 无历史，丢失实时事件不
        # 影响 DB 真相，前端重连即续流。
        if agent_run is not None and agent_run.agent_session_id is not None:
            try:
                redis = get_redis()
                session_channel = f"agent_session:{agent_run.agent_session_id}"
                for log_payload in published_logs:
                    session_payload = {
                        "event": "log",
                        "session_id": str(agent_run.agent_session_id),
                        "run_id": str(agent_run_id),
                        "log_id": log_payload["log_id"],
                        "channel": log_payload["channel"],
                        "content": log_payload["content"],
                        "timestamp": log_payload["timestamp"],
                    }
                    await redis.publish(session_channel, json.dumps(session_payload))
            except Exception:
                log.warning(
                    "daemon_messages_session_redis_publish_failed",
                    lease_id=str(lease_id),
                    agent_run_id=str(agent_run_id),
                    agent_session_id=str(agent_run.agent_session_id),
                )

        log.info(
            "daemon_messages_submitted",
            lease_id=str(lease_id),
            agent_run_id=str(agent_run_id),
            count=count,
            agent_run_status=agent_run_status,
        )
        return count

    async def get_lease(self, lease_id: uuid.UUID) -> DaemonTaskLease | None:
        """Get a task lease by ID."""
        return await self._session.get(DaemonTaskLease, lease_id)

    async def list_leases(self, runtime_id: uuid.UUID) -> list[DaemonTaskLease]:
        """List all leases for a given daemon runtime."""
        stmt = (
            select(DaemonTaskLease)
            .where(col(DaemonTaskLease.runtime_id) == runtime_id)
            .order_by(col(DaemonTaskLease.created_at).desc())
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def expire_leases(self) -> list[DaemonTaskLease]:
        """Mark expired leases based on lease_expires_at.

        Returns the list of leases that were marked as expired, so callers
        can inspect them for follow-up actions (e.g. lease expiry handling).
        """
        now = datetime.now(UTC)
        stmt = select(DaemonTaskLease).where(
            col(DaemonTaskLease.status).in_(["claimed", "pending"]),
            col(DaemonTaskLease.lease_expires_at) < now,
        )
        expired = list((await self._session.execute(stmt)).scalars().all())
        for lease in expired:
            lease.status = "expired"
            lease.updated_at = now
            self._session.add(lease)
        if expired:
            await self._session.commit()
        return expired

    # ── AgentRun status sync ─────────────────────────────────────────────

    async def sync_agent_run_status(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        status: str,
        *,
        error: str | None = None,
    ) -> AgentRun | None:
        """Sync AgentRun status from daemon side.

        Validates the lease + claim_token, locates the associated AgentRun,
        updates its status and timestamps, and publishes a Redis event.

        Returns the updated AgentRun, or None if no AgentRun is linked.
        """
        lease = await self._get_lease_and_verify_token(lease_id, claim_token)

        if lease.agent_run_id is None:
            log.warning(
                "daemon_sync_no_agent_run",
                lease_id=str(lease_id),
            )
            return None

        agent_run = await self._session.get(AgentRun, lease.agent_run_id)
        if agent_run is None:
            raise DaemonAgentRunNotFound(
                f"AgentRun '{lease.agent_run_id}' not found for lease '{lease_id}'.",
                details={
                    "lease_id": str(lease_id),
                    "agent_run_id": str(lease.agent_run_id),
                },
            )

        now = datetime.now(UTC)
        agent_run.status = status

        if status == "running" and agent_run.started_at is None:
            agent_run.started_at = now
        if status in ("completed", "failed", "killed") and agent_run.finished_at is None:
            agent_run.finished_at = now
        if status == "killed" and agent_run.exit_code is None:
            agent_run.exit_code = -1
        if error is not None and status == "failed":
            agent_run.output_redacted = error

        self._session.add(agent_run)
        await self._session.commit()
        await self._session.refresh(agent_run)

        # Publish status change via Redis
        try:
            redis = get_redis()
            redis_payload: dict = {
                "event": "status_changed",
                "status": status,
                "lease_id": str(lease_id),
                "agent_run_id": str(agent_run.id),
            }
            if error is not None:
                redis_payload["error"] = error
            await redis.publish(
                f"agent_run:{agent_run.id}",
                json.dumps(redis_payload),
            )
        except Exception:
            log.warning(
                "daemon_sync_redis_publish_failed",
                lease_id=str(lease_id),
                agent_run_id=str(agent_run.id),
            )

        log.info(
            "daemon_agent_run_status_synced",
            lease_id=str(lease_id),
            agent_run_id=str(agent_run.id),
            status=status,
            error=error,
        )
        return agent_run

    # ── Interactive run terminal close (gap-3, design §4) ──────────────────

    async def close_interactive_run(
        self,
        lease_id: uuid.UUID,
        run_id: uuid.UUID,
        claim_token: str,
        *,
        status: str,
        is_error: bool,
        subtype: str | None = None,
        result_summary: str | None = None,
    ) -> AgentRun:
        """Close an interactive AgentRun from daemon SDK result (gap-3 / design §4).

        Daemon ``SessionManager._onResult`` → ``hubClient.notifyRunResult`` → this
        endpoint. The lease is verified via ``claim_token``; the run is located by
        ``run_id`` (interactive lease has ``agent_run_id=NULL`` per D-005@v1, so we
        cannot read it off the lease row) and bound to the lease's session via
        ``lease.metadata.session_id`` to prevent cross-session run injection.

        Terminal mapping (design §4):
          - status=success → AgentRun.status='completed'
          - status=error_during_execution → AgentRun.status='failed'
            (interrupted semantics; error_code='interactive_interrupted')
          - any other is_error → AgentRun.status='failed'
            (error_code='interactive_failed')

        Idempotent: an AgentRun already in TERMINAL_TURN_STATUSES is a no-op
        (returns the row unchanged) so daemon retries after a transient network
        blip do not double-write or flip a completed run back to failed.

        Raises ``DaemonAgentRunNotFound`` when the run does not exist or is not
        bound to the lease's session (resource-hiding 404 — no existence leak).
        """
        lease = await self._get_lease_and_verify_token(lease_id, claim_token)
        lease_meta = lease.metadata_ or {}
        bound_session_id_raw = lease_meta.get("session_id")

        agent_run = await self._session.get(AgentRun, run_id)
        if agent_run is None:
            raise DaemonAgentRunNotFound(
                f"AgentRun '{run_id}' not found for lease '{lease_id}'.",
                details={
                    "lease_id": str(lease_id),
                    "agent_run_id": str(run_id),
                },
            )

        # Bind check: the run must belong to the lease's session. interactive
        # lease.agent_run_id is NULL (D-005@v1), so session_id is the link.
        # Missing bound session_id in metadata is treated as invariant failure.
        if (
            bound_session_id_raw is None
            or agent_run.agent_session_id is None
            or str(agent_run.agent_session_id) != str(bound_session_id_raw)
        ):
            raise DaemonAgentRunNotFound(
                f"AgentRun '{run_id}' is not bound to lease '{lease_id}' session.",
                details={
                    "lease_id": str(lease_id),
                    "agent_run_id": str(run_id),
                    "lease_session_id": bound_session_id_raw,
                    "run_session_id": (
                        str(agent_run.agent_session_id) if agent_run.agent_session_id else None
                    ),
                },
            )

        # Idempotent: already terminal → no-op return (daemon retry safety).
        if agent_run.status in TERMINAL_TURN_STATUSES:
            log.info(
                "interactive_run_close_already_terminal",
                lease_id=str(lease_id),
                agent_run_id=str(agent_run.id),
                status=agent_run.status,
            )
            return agent_run

        now = datetime.now(UTC)
        # Map SDK result → AgentRun terminal status (design §4).
        if status == "success" and not is_error:
            agent_run.status = "completed"
            agent_run.exit_code = 0
        elif status == "error_during_execution" or is_error:
            agent_run.status = "failed"
            agent_run.exit_code = 1
            # error_during_execution = interrupted turn (spike D1 / SDK abort);
            # other errors are genuine failures. error_code keeps them distinct.
            agent_run.error_code = (
                "interactive_interrupted"
                if status == "error_during_execution"
                else "interactive_failed"
            )
        else:
            # Unknown status → conservative failed (never leave a half-state).
            agent_run.status = "failed"
            agent_run.exit_code = 1
            agent_run.error_code = "interactive_unknown_status"

        agent_run.finished_at = now
        if result_summary:
            # Redact via git_gateway redact_output to avoid leaking secrets in
            # the stored summary (mirrors batch completeLease path).
            try:
                agent_run.output_redacted = redact_output(result_summary)
            except Exception:
                agent_run.output_redacted = result_summary[:4000]

        self._session.add(agent_run)
        await self._session.commit()
        await self._session.refresh(agent_run)

        # Publish terminal event so SSE stream (task-06) emits turn_completed.
        try:
            redis = get_redis()
            await redis.publish(
                f"agent_run:{agent_run.id}",
                json.dumps(
                    {
                        "event": "status_changed",
                        "status": agent_run.status,
                        "lease_id": str(lease_id),
                        "agent_run_id": str(agent_run.id),
                        "subtype": subtype,
                    },
                    default=str,
                ),
            )
        except Exception:
            log.warning(
                "interactive_run_close_redis_publish_failed",
                lease_id=str(lease_id),
                agent_run_id=str(agent_run.id),
            )

        # design §6 step3 / §8.2：往 session 级 channel 发 turn_completed，让前端
        # SSE onTurnCompleted 清空 currentRunId、解锁输入框发下一条。否则 turn 在
        # 后端已完成（status_changed 只发到 agent_run:{run_id}），但前端只订阅
        # agent_session:{session_id}，收不到结束信号 → UI 永远停在「运行中」、发不
        # 了下一条（用户报告的现象）。契约见 frontend/src/lib/daemon.ts
        # SessionStreamEnvelope（event=turn_completed + status + exit_code）。
        # _publish_session_event 自带 try/except，Redis 抖动不影响已提交的终态行。
        await self._publish_session_event(
            agent_run.agent_session_id,
            {
                "event": "turn_completed",
                "session_id": str(agent_run.agent_session_id),
                "run_id": str(agent_run.id),
                "status": agent_run.status,
                "exit_code": agent_run.exit_code,
                "timestamp": now.isoformat().replace("+00:00", "Z"),
            },
        )

        log.info(
            "interactive_run_closed",
            lease_id=str(lease_id),
            agent_run_id=str(agent_run.id),
            status=agent_run.status,
            sdk_status=status,
            is_error=is_error,
            subtype=subtype,
        )
        return agent_run

    # ── Lease expiry / rollback ────────────────────────────────────────────

    async def handle_lease_expiry(self, agent_run_id: UUID) -> None:
        """Handle a single lease expiry: rollback or fail the associated AgentRun.

        Decision logic:
        1. Skip if AgentRun is already in a terminal state (completed/failed/killed).
        2. If attempt_number >= 3 -> mark AgentRun as failed.
        3. Otherwise -> reset AgentRun to pending and dispatch back to server.
        4. Create a new pending lease with attempt_number = old + 1.
        5. Publish Redis event for the status change.
        """
        # -- Look up the most recent expired lease for this agent_run_id -----
        lease_stmt = (
            select(DaemonTaskLease)
            .where(
                col(DaemonTaskLease.agent_run_id) == agent_run_id,
                col(DaemonTaskLease.status) == "expired",
            )
            .order_by(col(DaemonTaskLease.updated_at).desc())
        )
        lease = (await self._session.execute(lease_stmt)).scalars().first()

        if lease is None:
            log.warning(
                "handle_lease_expiry_no_expired_lease",
                agent_run_id=str(agent_run_id),
            )
            return

        # -- Check AgentRun status -------------------------------------------
        agent_run = await self._session.get(AgentRun, agent_run_id)
        if agent_run is None:
            log.warning(
                "handle_lease_expiry_agent_run_missing",
                agent_run_id=str(agent_run_id),
            )
            return

        if agent_run.status in ("completed", "failed", "killed"):
            log.info(
                "handle_lease_expiry_skip_terminal",
                agent_run_id=str(agent_run_id),
                agent_run_status=agent_run.status,
            )
            return

        # -- Determine next action based on attempt_number -------------------
        attempt = lease.attempt_number or 1

        if attempt >= 3:
            # Max retries exceeded -- mark as failed
            now = datetime.now(UTC)
            agent_run.status = "failed"
            agent_run.finished_at = now
            agent_run.exit_code = -1
            agent_run.output_redacted = (
                f"Daemon lease expired after {attempt} attempt(s). Maximum retry count reached."
            )
            self._session.add(agent_run)
            await self._session.commit()

            log.warning(
                "handle_lease_expiry_max_retries",
                agent_run_id=str(agent_run_id),
                attempt_number=attempt,
            )

            # Publish failure event via Redis
            await self._publish_run_event(
                agent_run_id,
                event="done",
                status="failed",
                reason="lease_expired_max_retries",
                attempt_number=attempt,
            )
            return

        # -- Rollback: reset AgentRun to pending and re-queue the lease ------
        next_attempt = attempt + 1

        # Reset the run so the daemon re-claims it via the new lease.  The
        # SERVER re-dispatch path was removed in task-01; the daemon picks up
        # the new pending lease on WebSocket wake-up.
        agent_run.status = "pending"
        agent_run.started_at = None
        self._session.add(agent_run)

        # Create a new pending lease with incremented attempt_number
        new_lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=lease.runtime_id,
            agent_run_id=agent_run_id,
            status="pending",
            attempt_number=next_attempt,
            metadata_={},
        )
        self._session.add(new_lease)
        await self._session.commit()

        log.info(
            "handle_lease_expiry_rollback",
            agent_run_id=str(agent_run_id),
            old_lease_id=str(lease.id),
            new_lease_id=str(new_lease.id),
            attempt_number=next_attempt,
        )

        # Publish rollback event via Redis
        await self._publish_run_event(
            agent_run_id,
            event="lease_expired_rollback",
            status="pending",
            attempt_number=next_attempt,
            new_lease_id=str(new_lease.id),
        )

        # Notify the daemon about the new pending lease via WebSocket wake-up
        # (daemon-only since task-01 — the SERVER re-dispatch path is gone).
        # The new lease was created above; the daemon claims it on wake-up.
        from app.modules.agent.placement import RunPlacementService

        placement = RunPlacementService(self._session)
        await placement._send_ws_wakeup(lease.runtime_id, new_lease.id, agent_run_id)

    async def handle_expired_leases_batch(self) -> int:
        """Process all expired leases and handle their rollback logic.

        Returns the number of expired leases processed.
        Individual lease failures are logged but do not prevent
        processing of other leases.
        """
        expired_leases = await self.expire_leases()
        if not expired_leases:
            return 0

        processed = 0
        for lease in expired_leases:
            if lease.agent_run_id is None:
                log.info(
                    "handle_expired_leases_skip_no_agent_run",
                    lease_id=str(lease.id),
                )
                processed += 1
                continue

            try:
                await self.handle_lease_expiry(lease.agent_run_id)
            except Exception:
                log.exception(
                    "handle_expired_leases_single_failed",
                    lease_id=str(lease.id),
                    agent_run_id=str(lease.agent_run_id),
                )
            processed += 1

        log.info(
            "handle_expired_leases_batch_done",
            total=len(expired_leases),
            processed=processed,
        )
        return processed

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
            )
            self._session.add(run)
            await self._session.flush()

            placement = RunPlacementService(self._session)
            dispatch = await placement.prepare_interactive_dispatch(
                agent_session_id=session.id,
                agent_run_id=run.id,
                user_id=user_id,
                provider=provider,
                prompt=prompt,
                model=model,
                manual_approval=manual_approval,
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
        control_ok = await hub.send_session_control(
            dispatch.runtime_id,
            DAEMON_MSG_SESSION_INJECT,
            {
                "session_id": str(session.id),
                "lease_id": str(dispatch.lease_id),
                "run_id": str(run.id),
                "prompt": prompt,
                # gap-2：首 turn SESSION_INJECT 携带 lease 级 claim_token，
                # daemon 存入 SessionState.claimToken。
                "claim_token": dispatch.claim_token,
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
        control_ok = await hub.send_session_control(
            session.runtime_id,  # type: ignore[arg-type]
            DAEMON_MSG_SESSION_INJECT,
            {
                "session_id": str(session.id),
                "lease_id": str(session.lease_id),
                "run_id": str(run.id),
                "prompt": prompt,
                "claim_token": inject_claim_token,
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
                    "runtime_id": str(session.runtime_id),  # type: ignore[arg-type]
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
            lease_id=session.lease_id,  # type: ignore[arg-type]
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
        control_ok = await hub.send_session_control(
            session.runtime_id,  # type: ignore[arg-type]
            DAEMON_MSG_SESSION_INTERRUPT,
            {
                "session_id": str(session.id),
                "lease_id": str(session.lease_id),
            },
        )
        if not control_ok:
            raise DaemonRuntimeOffline(
                f"daemon runtime '{session.runtime_id}' is offline; "
                f"interrupt could not be delivered.",
                details={
                    "runtime_id": str(session.runtime_id),  # type: ignore[arg-type]
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
    ) -> SessionControlResult:
        """Single reconciliation of session/lease/currentRun (FR-05 / §8.5).

        Locks the session, validates the bound interactive lease, sends a
        best-effort SESSION_END, then in ONE transaction marks currentRun
        killed, session ended, lease completed. Idempotent on already-ended
        sessions. WS failure is a warning only — the local reconciliation
        still succeeds so a daemon offline never strands an active session.
        """
        try:
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
            end_ok = await hub.send_session_control(
                session.runtime_id,
                DAEMON_MSG_SESSION_END,
                {
                    "session_id": str(session.id),
                    "lease_id": str(session.lease_id),
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
                    status=session.status,  # type: ignore[arg-type]
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

    _LIST_STATUSES = frozenset({"pending", "active", "reconnecting", "ended", "failed"})

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
        """Reopen an ended Claude session for SDK resume (task-05+07 / FR-2).

        Validation (task-05) + full transition (task-07): new interactive lease,
        ``claim_token`` rotation, SESSION_RESUME WS. The daemon-side SDK resume
        is task-08. This method:

          1. SELECT AgentSession FOR UPDATE + ownership (user_id mismatch → 404,
             no existence leak — mirrors :meth:`end_session`).
          2. Pre-flight checks IN ORDER (first failure wins, see task-05 §边界):
             - provider != "claude" → :class:`DaemonSessionResumeUnsupported`
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
        if session.provider != "claude":
            raise DaemonSessionResumeUnsupported(
                f"Session '{session_id}' provider '{session.provider}' does not "
                f"support resume (only claude).",
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
            if not hub.is_connected(runtime_id):
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
            resume_ok = await hub.send_session_control(
                target_runtime_id,
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
                end_ok = await hub.send_session_control(
                    session.runtime_id,
                    DAEMON_MSG_SESSION_END,
                    {
                        "session_id": str(session.id),
                        "lease_id": str(session.lease_id) if session.lease_id else "",
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

    # ── Helpers ───────────────────────────────────────────────────────────

    async def _publish_run_event(
        self,
        agent_run_id: UUID,
        *,
        event: str,
        status: str,
        **extra: object,
    ) -> None:
        """Publish a Redis event for an AgentRun status change.

        Failures are logged but never raised -- callers should not
        abort their workflow due to a Redis publish error.
        """
        payload = {"event": event, "status": status, **extra}
        try:
            redis = get_redis()
            await redis.publish(
                f"agent_run:{agent_run_id}",
                json.dumps(payload, default=str),
            )
        except Exception:
            log.warning(
                "publish_run_event_failed",
                agent_run_id=str(agent_run_id),
                redis_event=event,
            )

    async def _apply_patch_to_worktree(
        self,
        agent_run_id: UUID,
        patch_data: str,
        use_3way: bool = True,
    ) -> None:
        """Apply a unified diff patch to the workspace associated with *agent_run_id*.

        Steps:
        1. Resolve the workspace root_path via the AgentRunWorkspace M:N table.
        2. Run ``git apply --check`` to validate the patch.
        3. If the check fails and *use_3way* is True, retry with ``--3way``.
        4. If 3way also fails raise :class:`PatchConflictError`.
        5. If the check succeeds, apply the patch normally.
        """
        # 1. Resolve workspace root_path
        ws_stmt = (
            select(AgentRunWorkspace.workspace_id)
            .where(col(AgentRunWorkspace.agent_run_id) == agent_run_id)
            .limit(1)
        )
        ws_row = (await self._session.execute(ws_stmt)).first()
        if ws_row is None:
            raise PatchApplyError(
                f"No workspace associated with agent_run '{agent_run_id}'.",
                details={"agent_run_id": str(agent_run_id)},
            )

        workspace = await self._session.get(Workspace, ws_row[0])
        if workspace is None:
            raise PatchApplyError(
                f"Workspace '{ws_row[0]}' not found.",
                details={"workspace_id": str(ws_row[0])},
            )

        workdir = Path(workspace.root_path)

        # 2. git apply --check
        check_ok, check_stderr = await self._run_git_apply(
            workdir=workdir,
            args=["git", "apply", "--check"],
            patch_data=patch_data,
        )

        if check_ok:
            # 5. Apply normally
            apply_ok, apply_stderr = await self._run_git_apply(
                workdir=workdir,
                args=["git", "apply"],
                patch_data=patch_data,
            )
            if not apply_ok:
                raise PatchApplyError(
                    f"git apply failed after successful check: {apply_stderr}",
                    details={
                        "agent_run_id": str(agent_run_id),
                        "workspace_id": str(workspace.id),
                        "stderr": apply_stderr,
                    },
                )
            return

        # Check failed
        if not use_3way:
            raise PatchApplyError(
                f"Patch does not apply cleanly: {check_stderr}",
                details={
                    "agent_run_id": str(agent_run_id),
                    "workspace_id": str(workspace.id),
                    "stderr": check_stderr,
                },
            )

        # 3. Try --3way
        log.info(
            "daemon_patch_check_failed_trying_3way",
            agent_run_id=str(agent_run_id),
            check_stderr=check_stderr,
        )
        merge_ok, merge_stderr = await self._run_git_apply(
            workdir=workdir,
            args=["git", "apply", "--3way"],
            patch_data=patch_data,
        )
        if not merge_ok:
            # 4. Conflict
            raise PatchConflictError(
                f"Patch conflict (3way merge failed): {merge_stderr}",
                details={
                    "agent_run_id": str(agent_run_id),
                    "workspace_id": str(workspace.id),
                    "check_stderr": check_stderr,
                    "merge_stderr": merge_stderr,
                },
            )

    @staticmethod
    async def _run_git_apply(
        *,
        workdir: Path,
        args: list[str],
        patch_data: str,
    ) -> tuple[bool, str]:
        """Run a ``git apply`` sub-command and return ``(ok, stderr)``."""
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=str(workdir),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr_bytes = await proc.communicate(input=patch_data.encode())
        stderr = stderr_bytes.decode(errors="replace").strip()
        return proc.returncode == 0, stderr

    async def _get_lease_and_verify_token(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
    ) -> DaemonTaskLease:
        """Load a lease and verify the claim_token matches."""
        lease = await self._session.get(DaemonTaskLease, lease_id)
        if lease is None:
            raise DaemonLeaseNotFound(
                f"Daemon task lease '{lease_id}' not found.",
                details={"lease_id": str(lease_id)},
            )

        metadata = lease.metadata_ or {}
        stored_token = metadata.get("claim_token")
        if not stored_token or stored_token != claim_token:
            raise DaemonInvalidClaimToken(
                "Invalid or missing claim_token.",
                details={"lease_id": str(lease_id)},
            )
        return lease


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _channel_from_event_type(event_type: str) -> str:
    """Map daemon AgentEvent type to AgentRunLog channel.

    ql-20260616-003：daemon 的 _eventToMessage 不发 channel 字段（只发 event_type），
    后端按事件类型补全 channel，让前端 SSE 实时流能正确渲染 TOOL/WARN/INFO 徽章。

    Args:
        event_type: daemon AgentEvent.type，5 种取值之一
            （text / tool_use / tool_result / error / complete）。

    Returns:
        AgentRunLog channel：tool_call / stderr / stdout 之一。
    """
    if event_type in ("tool_use", "tool_result"):
        return "tool_call"
    if event_type == "error":
        return "stderr"
    return "stdout"
