"""Runtime subdomain service — registration / heartbeat / lifecycle."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.daemon.model import DaemonRuntime

log = get_logger(__name__)

DEFAULT_RUNTIME_STALE_SECONDS = 45


# ── Domain errors / RPC errors (runtime 主对象 + WS 通道层；task-07 迁入) ──────
# 原 facade service.py:43/100/107/114/121/128/135/142 字符级搬入。code/http_status/
# docstring/__init__ 零变化（B4）。RPC 错误族统一归 runtime 子包：根因是 runtime
# 的 WS 连接态/通道问题，runtime 子域已持有 WS 连接管理（B2）。


class DaemonRuntimeNotFound(AppError):
    code = "HTTP_404_DAEMON_RUNTIME_NOT_FOUND"
    http_status = 404


class DaemonRuntimeOffline(AppError):
    """Target daemon runtime has no active WS connection (R-01)."""

    code = "HTTP_504_DAEMON_RUNTIME_OFFLINE"
    http_status = 504


# ── RPC errors (WS 通道层；root cause 是 runtime 连接态/通道问题) ────────────


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


class RuntimeService:
    """Runtime lifecycle: register / heartbeat / enable / disable / cleanup."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

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

    async def delete_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        """Physically delete an owned runtime (ql-20260621-012).

        DB ondelete=CASCADE removes bound ``daemon_task_leases`` and
        ``agent_sessions`` rows automatically. The daemon re-registers as a
        fresh runtime on its next heartbeat.
        """
        runtime = await self._get_owned_runtime(runtime_id, user_id)
        await self._session.delete(runtime)
        await self._session.commit()

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
