"""Daemon service — orchestrates daemon runtime registration, heartbeat, and lease lifecycle."""

from __future__ import annotations

import asyncio
import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.workspace.model import AgentRunWorkspace, Workspace

log = get_logger(__name__)


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


class PatchApplyError(AppError):
    code = "HTTP_422_PATCH_APPLY_ERROR"
    http_status = 422


class PatchConflictError(AppError):
    code = "HTTP_409_PATCH_CONFLICT"
    http_status = 409


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

    async def mark_offline(self, runtime_id: uuid.UUID) -> DaemonRuntime:
        """Mark a daemon runtime as offline."""
        runtime = await self._session.get(DaemonRuntime, runtime_id)
        if runtime is None:
            raise DaemonRuntimeNotFound(
                f"Daemon runtime '{runtime_id}' not found.",
                details={"runtime_id": str(runtime_id)},
            )
        now = datetime.now(UTC)
        runtime.status = "offline"
        runtime.updated_at = now
        self._session.add(runtime)
        await self._session.commit()
        await self._session.refresh(runtime)
        return runtime

    async def cleanup_stale_runtimes(self, max_age_seconds: int = 120) -> int:
        """Mark runtimes as offline if heartbeat is older than max_age_seconds."""
        cutoff = datetime.now(UTC) - timedelta(seconds=max_age_seconds)
        stmt = select(DaemonRuntime).where(
            col(DaemonRuntime.status) == "online",
            col(DaemonRuntime.last_heartbeat_at) < cutoff,
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
        claim_token = secrets.token_hex(32)

        # Update lease — keep original runtime_id if already set
        lease.status = "claimed"
        lease.claimed_at = now
        lease.lease_expires_at = now + timedelta(seconds=60)
        if not lease.runtime_id:
            lease.runtime_id = runtime_id
        metadata = dict(lease.metadata_ or {})
        metadata["claim_token"] = claim_token
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
        payload: dict = {
            "lease_id": str(lease.id),
            "agent_run_id": None,
            "workspace_id": None,
            "session_id": None,
            "tool_config": {},
        }

        if lease.agent_run_id is None:
            return payload

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
        payload["change_id"] = str(agent_run.change_id) if agent_run.change_id else None
        payload["task_id"] = str(agent_run.task_id) if agent_run.task_id else None

        # Propagate prompt from lease metadata (quick-chat scenario)
        lease_meta = lease.metadata_ or {}
        if lease_meta.get("prompt"):
            payload["prompt"] = lease_meta["prompt"]
        if lease_meta.get("provider"):
            payload["provider"] = lease_meta["provider"]
        if lease_meta.get("resume_session_id"):
            payload["resume_session_id"] = lease_meta["resume_session_id"]

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
                agent_run.status = (
                    result_status if result_status in ("completed", "failed") else "completed"
                )
                agent_run.finished_at = now

                # Store agent output and error
                if result.get("output"):
                    agent_run.output_redacted = result["output"]
                if result.get("error"):
                    existing = agent_run.output_redacted or ""
                    agent_run.output_redacted = (
                        existing + ("\n" if existing else "") + result["error"]
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

        # Patch application
        patch = result.get("patch")
        if patch and lease.agent_run_id is not None:
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

        log.info(
            "daemon_lease_completed",
            lease_id=str(lease_id),
            result_status=result.get("status"),
        )
        return lease

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
        for msg in messages:
            channel = msg.get("channel", "stdout")
            content = msg.get("content", "")
            if not content:
                continue

            log_entry = AgentRunLog(
                id=uuid.uuid4(),
                run_id=agent_run_id,
                timestamp=now,
                channel=channel,
                content_redacted=content[:5000],
            )
            self._session.add(log_entry)
            count += 1

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

        if count > 0 or (agent_run is not None and agent_run_status == "running"):
            await self._session.commit()

        # Publish to Redis with AgentRun status info
        try:
            redis = get_redis()
            payload: dict = {
                "event": "messages",
                "lease_id": str(lease_id),
                "count": count,
                "messages": messages,
            }
            if agent_run_status is not None:
                payload["agent_run_status"] = agent_run_status
            await redis.publish(
                f"agent_run:{agent_run_id}",
                json.dumps(payload),
            )
        except Exception:
            log.warning(
                "daemon_messages_redis_publish_failed",
                lease_id=str(lease_id),
                agent_run_id=str(agent_run_id),
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

        # -- Rollback: reset AgentRun to pending and dispatch to server ------
        next_attempt = attempt + 1

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

        # Dispatch to server for re-execution (resets AgentRun to pending)
        from app.modules.agent.placement import RunPlacementService

        placement = RunPlacementService(self._session)
        await placement.dispatch_to_server(agent_run_id)

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
