"""RunPlacementService -- unified decision layer for agent run execution backend.

Decides whether an AgentRun should execute on the server (subprocess) or be
dispatched to a local daemon.  The daemon tables (daemon_runtimes,
daemon_task_leases) are created by the daemon module (task-01 / task-02);
this service uses raw SQL via ``text()`` so it works even before the ORM
models land.
"""

from __future__ import annotations

import enum
import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.model import AgentRun

log = get_logger(__name__)


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------


class ExecutionBackend(enum.Enum):
    """Where an AgentRun will be executed."""

    SERVER = "server"  # server-side subprocess mode
    DAEMON = "daemon"  # local daemon mode


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class RunPlacementService:
    """Unified entry point that decides *where* an AgentRun executes."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------
    # Decision
    # ------------------------------------------------------------------

    async def decide_backend(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        change_id: uuid.UUID | None = None,
        task_id: uuid.UUID | None = None,
        preferred_backend: str | None = None,
    ) -> ExecutionBackend:
        """Decide which backend should execute the upcoming AgentRun.

        Decision logic:

        1. If the caller explicitly requests ``preferred_backend``:
           - ``"server"``  -> ``ExecutionBackend.SERVER``
           - ``"daemon"``  -> check whether an online daemon runtime exists
             for the user; if yes -> ``DAEMON``, otherwise fallback to
             ``SERVER``.
        2. Without explicit preference, auto-detect: if the user has at
           least one online runtime, prefer ``DAEMON``; otherwise fall back
           to ``SERVER``.
        """
        log.info(
            "placement_decide_backend",
            workspace_id=str(workspace_id),
            user_id=str(user_id),
            change_id=str(change_id),
            task_id=str(task_id),
            preferred_backend=preferred_backend,
        )

        # -- explicit preference ------------------------------------------------
        if preferred_backend is not None:
            pref = preferred_backend.lower().strip()
            if pref == "server":
                log.info("placement_backend_forced", backend="server")
                return ExecutionBackend.SERVER

            if pref == "daemon":
                has_runtime = await self._has_online_runtime(user_id)
                if has_runtime:
                    log.info("placement_backend_forced", backend="daemon")
                    return ExecutionBackend.DAEMON
                log.warning(
                    "placement_daemon_preferred_but_no_runtime",
                    user_id=str(user_id),
                )
                return ExecutionBackend.SERVER

            log.warning(
                "placement_unknown_preferred_backend",
                preferred_backend=preferred_backend,
            )
            # fall through to auto-detect

        # -- auto-detect --------------------------------------------------------
        has_runtime = await self._has_online_runtime(user_id)
        backend = ExecutionBackend.DAEMON if has_runtime else ExecutionBackend.SERVER
        log.info(
            "placement_backend_auto",
            backend=backend.value,
            has_online_runtime=has_runtime,
        )
        return backend

    # ------------------------------------------------------------------
    # Dispatch helpers
    # ------------------------------------------------------------------

    async def dispatch_to_daemon(
        self,
        agent_run_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> uuid.UUID | None:
        """Dispatch an AgentRun to the user's daemon.

        Steps:
        1. Create a ``daemon_task_leases`` row (status=pending).
        2. Send a WebSocket wake-up signal if an online WS connection exists
           (stub for now -- Wave 2).
        3. Return the lease_id.
        """
        runtime = await self._get_online_runtime(user_id)
        if runtime is None:
            log.warning(
                "dispatch_daemon_no_online_runtime",
                agent_run_id=str(agent_run_id),
                user_id=str(user_id),
            )
            return None

        runtime_id: uuid.UUID = runtime["id"]

        lease_id = uuid.uuid4()
        now = datetime.now(UTC)

        await self._session.execute(
            text(
                """
                INSERT INTO daemon_task_leases
                    (id, agent_run_id, runtime_id, status, created_at, updated_at)
                VALUES
                    (:id, :agent_run_id, :runtime_id, 'pending', :now, :now)
                """
            ),
            {
                "id": lease_id,
                "agent_run_id": agent_run_id,
                "runtime_id": runtime_id,
                "now": now,
            },
        )
        await self._session.commit()

        log.info(
            "dispatch_daemon_lease_created",
            lease_id=str(lease_id),
            agent_run_id=str(agent_run_id),
            runtime_id=str(runtime_id),
        )

        # -- Wave 2: WS wake-up signal (stub) -----------------------------------
        await self._send_ws_wakeup(runtime_id, lease_id, agent_run_id)

        return lease_id

    async def dispatch_to_server(self, agent_run_id: uuid.UUID) -> None:
        """Dispatch an AgentRun to the server subprocess backend.

        Resets the AgentRun to ``pending`` so it will be picked up by the
        server-side execution scheduler (e.g. ``AgentService``) on the next
        scheduling cycle.  Publishes a Redis event so that any listeners
        (WebSocket clients, progress trackers) are notified of the status
        change.
        """
        # Load the AgentRun via ORM to update status
        stmt = select(AgentRun).where(col(AgentRun.id) == agent_run_id)
        agent_run = (await self._session.execute(stmt)).scalars().first()

        if agent_run is None:
            log.warning(
                "dispatch_server_agent_run_missing",
                agent_run_id=str(agent_run_id),
            )
            return

        # Only act if the run is in a state that allows server re-execution
        if agent_run.status not in ("pending", "running"):
            log.info(
                "dispatch_server_skip_non_reexecutable",
                agent_run_id=str(agent_run_id),
                current_status=agent_run.status,
            )
            return

        # Reset to pending for server-side re-execution
        agent_run.status = "pending"
        agent_run.started_at = None
        agent_run.finished_at = None
        agent_run.exit_code = None
        self._session.add(agent_run)
        await self._session.commit()

        # Publish Redis event so listeners know the run was rolled back
        try:
            redis = get_redis()
            await redis.publish(
                f"agent_run:{agent_run_id}",
                json.dumps(
                    {
                        "event": "dispatched_to_server",
                        "status": "pending",
                        "agent_run_id": str(agent_run_id),
                    }
                ),
            )
        except Exception:
            log.warning(
                "dispatch_server_redis_publish_failed",
                agent_run_id=str(agent_run_id),
            )

        log.info(
            "dispatch_server_rollback",
            agent_run_id=str(agent_run_id),
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _has_online_runtime(self, user_id: uuid.UUID) -> bool:
        """Return True if the user has at least one online daemon runtime.

        Returns False (i.e. no runtime available) if the ``daemon_runtimes``
        table does not exist yet -- this happens when the daemon module
        migrations have not been applied.
        """
        try:
            result = await self._session.execute(
                text(
                    """
                    SELECT COUNT(*) AS cnt
                    FROM daemon_runtimes
                    WHERE user_id = :user_id
                      AND status = 'online'
                    """
                ),
                {"user_id": user_id},
            )
            row = result.mappings().first()
            count = row["cnt"] if row else 0
            return count > 0
        except Exception as exc:
            log.warning(
                "placement_has_online_runtime_query_failed",
                user_id=str(user_id),
                error=str(exc),
            )
            return False

    async def _get_online_runtime(self, user_id: uuid.UUID) -> dict | None:
        """Return the first online daemon runtime for the user, or None."""
        try:
            result = await self._session.execute(
                text(
                    """
                    SELECT id, user_id, status, connected_at
                    FROM daemon_runtimes
                    WHERE user_id = :user_id
                      AND status = 'online'
                    ORDER BY connected_at DESC
                    LIMIT 1
                    """
                ),
                {"user_id": user_id},
            )
            row = result.mappings().first()
            return dict(row) if row else None
        except Exception as exc:
            log.warning(
                "placement_get_online_runtime_query_failed",
                user_id=str(user_id),
                error=str(exc),
            )
            return None

    async def _send_ws_wakeup(
        self,
        runtime_id: uuid.UUID,
        lease_id: uuid.UUID,
        agent_run_id: uuid.UUID,
    ) -> None:
        """Send a WebSocket wake-up signal to the daemon via DaemonWsHub."""
        from app.modules.daemon.ws_hub import get_ws_hub

        hub = get_ws_hub()
        if hub.is_connected(runtime_id):
            await hub.send_wakeup(str(runtime_id), lease_id=str(lease_id))
            log.info(
                "ws_wakeup_sent",
                runtime_id=str(runtime_id),
                lease_id=str(lease_id),
                agent_run_id=str(agent_run_id),
            )
        else:
            log.info(
                "ws_wakeup_skipped_no_connection",
                runtime_id=str(runtime_id),
                lease_id=str(lease_id),
                agent_run_id=str(agent_run_id),
            )
