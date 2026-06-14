"""SpecBootstrapService -- creates an AgentRun for spec workspace bootstrap.

The bootstrap launch phase creates an AgentRun record, writes a start audit
event, links the run to the workspace via AgentRunWorkspace, and returns
immediately.  The actual execution (dispatched to the user's daemon via a
``daemon_task_leases`` row) is handled by ``_execute_bootstrap_agent_run``
which runs as a background task with its own DB session.

author: qinyi
created_at: 2026-05-27
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import SpecWorkspaceNotFound
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workflow.model import AuditLog
from app.modules.workspace.model import AgentRunWorkspace, Workspace

log = get_logger(__name__)


class SpecBootstrapService:
    """Coordinates the launch phase of spec workspace bootstrap.

    Creates an AgentRun (pending), writes a start audit log, links the run
    to the workspace, and returns a contract that the frontend can use to
    connect to the SSE stream immediately.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def bootstrap(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> dict:
        """Launch a bootstrap AgentRun for the given spec workspace.

        Steps:
        1. Load SpecWorkspace and Workspace records
        2. Ensure spec_root directory exists
        3. Write spec_bootstrap.start audit log
        4. Create AgentRun (status=pending, agent_type=claude_code)
        5. Create AgentRunWorkspace association
        6. Fire-and-forget background execution task
        7. Return launch contract

        Returns:
            dict with agent_run_id, stream_url, status, spec_root, message.
        """
        # 1. Load records
        spec_ws = await self._get_spec_workspace(workspace_id)
        workspace = await self._session.get(Workspace, workspace_id)
        if workspace is None:
            raise SpecWorkspaceNotFound(
                "Workspace not found.",
                details={"workspace_id": str(workspace_id)},
            )

        spec_root = Path(spec_ws.spec_root)

        # 2. Ensure spec_root directory exists
        spec_root.mkdir(parents=True, exist_ok=True)

        # 3. Audit: bootstrap started
        self._session.add(
            AuditLog(
                id=uuid.uuid4(),
                workspace_id=workspace_id,
                actor_id=user_id,
                action="spec_bootstrap.start",
                resource_type="spec_workspace",
                resource_id=workspace_id,
                details_json=json.dumps(
                    {"spec_root": str(spec_root), "strategy": spec_ws.strategy}
                ),
            )
        )
        await self._session.commit()

        # 4. Create AgentRun record
        run = AgentRun(
            id=uuid.uuid4(),
            task_id=None,
            lease_id=None,
            agent_type="claude_code",
            status="pending",
            spec_strategy=spec_ws.strategy,
            profile_version=spec_ws.profile_version,
        )
        self._session.add(run)
        await self._session.commit()
        await self._session.refresh(run)

        # 5. Create M:N workspace association
        self._session.add(
            AgentRunWorkspace(
                agent_run_id=run.id,
                workspace_id=workspace_id,
            )
        )
        await self._session.commit()

        log.info(
            "spec_bootstrap.start",
            workspace_id=str(workspace_id),
            agent_run_id=str(run.id),
        )

        # 6. Fire-and-forget background execution
        code_root = workspace.root_path
        asyncio.create_task(
            _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=workspace_id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(code_root),
            )
        )

        # 7. Return launch contract
        return {
            "agent_run_id": run.id,
            "stream_url": f"/api/workspaces/{workspace_id}/agent/runs/{run.id}/stream",
            "status": "pending",
            "spec_root": str(spec_root),
            "message": "Bootstrap agent run started.",
        }

    async def _get_spec_workspace(self, workspace_id: uuid.UUID) -> SpecWorkspace:
        stmt = select(SpecWorkspace).where(
            SpecWorkspace.workspace_id == workspace_id,
        )
        result = (await self._session.execute(stmt)).scalars().first()
        if result is None:
            raise SpecWorkspaceNotFound(
                "Spec workspace not found for the given workspace.",
                details={"workspace_id": str(workspace_id)},
            )
        return result


# ---------------------------------------------------------------------------
# Background execution (runs via asyncio.create_task)
# ---------------------------------------------------------------------------


async def _execute_bootstrap_agent_run(
    *,
    run_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    spec_root: str,
    code_root: str,
) -> None:
    """Dispatch the bootstrap AgentRun to the user's daemon (daemon-only).

    Previously this coroutine ran the agent adapter in-process and performed
    inline post-scan validation / SpecConflict creation / workspace activation
    / child reparse.  The SERVER subprocess backend was removed in task-01; the
    run is now handed to the daemon via a ``daemon_task_leases`` row plus a
    WebSocket wake-up.  The daemon claims the lease, fetches the
    execution-context (task-05), runs the agent, applies the patch and reports
    completion via ``complete_lease`` (task-07).

    Post-scan finalisation (SpecValidator / SpecConflict / workspace activation
    / child reparse) is performed by the daemon completion hook and is
    intentionally not duplicated here.
    """
    from app.core.db import get_session_factory
    from app.modules.agent.placement import (
        NoOnlineDaemonError,
        RunPlacementService,
    )

    factory = get_session_factory()
    async with factory() as session:
        try:
            # -- 1. Load records ---------------------------------------------------
            run = await session.get(AgentRun, run_id)
            if run is None:
                log.error(
                    "spec_bootstrap_run_missing",
                    run_id=str(run_id),
                    workspace_id=str(workspace_id),
                )
                return

            spec_ws = await _load_spec_workspace(session, workspace_id)
            if spec_ws is None:
                run.status = "failed"
                run.error_code = "spec_workspace_missing"
                run.finished_at = datetime.now(UTC)
                run.exit_code = 1
                run.output_redacted = "SpecWorkspace not found for the given workspace."
                session.add(run)
                await session.commit()
                await _publish_done_event(run_id, "failed", 1)
                return

            workspace = await session.get(Workspace, workspace_id)
            if workspace is None:
                run.status = "failed"
                run.error_code = "workspace_missing"
                run.finished_at = datetime.now(UTC)
                run.exit_code = 1
                run.output_redacted = "Workspace not found."
                session.add(run)
                await session.commit()
                await _publish_done_event(run_id, "failed", 1)
                return

            # -- 2. Preflight (code_root sanity, daemon-agnostic) ----------------
            preflight_error = _run_preflight(Path(code_root))
            if preflight_error is not None:
                run.status = "failed"
                run.error_code = "preflight_failed"
                run.finished_at = datetime.now(UTC)
                run.exit_code = 1
                run.output_redacted = preflight_error
                session.add(run)
                await _write_run_log(
                    session,
                    run_id=run_id,
                    channel="stderr",
                    content=preflight_error,
                )
                await session.commit()
                await _publish_done_event(run_id, "failed", 1)
                return

            # -- 3. Dispatch to daemon (daemon-only since task-01) ----------------
            placement = RunPlacementService(session)
            try:
                await placement.decide_backend(
                    workspace_id=workspace_id,
                    user_id=user_id,
                )
            except NoOnlineDaemonError as exc:
                run.status = "failed"
                run.error_code = "no_online_daemon"
                run.output_redacted = exc.message
                run.finished_at = datetime.now(UTC)
                run.exit_code = 1
                session.add(run)
                await session.commit()
                await _publish_done_event(run_id, "failed", 1)
                log.warning(
                    "spec_bootstrap_no_online_daemon",
                    run_id=str(run_id),
                    workspace_id=str(workspace_id),
                )
                return

            lease_id = await placement.dispatch_to_daemon(
                run.id,
                user_id,
                provider="claude_code",
            )
            if lease_id is None:
                run.status = "failed"
                run.error_code = "no_online_daemon"
                run.output_redacted = "未检测到在线 daemon，请启动 sillyhub-daemon 后重试"
                run.finished_at = datetime.now(UTC)
                run.exit_code = 1
                session.add(run)
                await session.commit()
                await _publish_done_event(run_id, "failed", 1)
                return

            log.info(
                "spec_bootstrap_dispatched_to_daemon",
                run_id=str(run_id),
                workspace_id=str(workspace_id),
                lease_id=str(lease_id),
            )

        except Exception as exc:
            log.exception(
                "spec_bootstrap_dispatch_exception",
                run_id=str(run_id),
                workspace_id=str(workspace_id),
                error=str(exc),
            )
            try:
                run = await session.get(AgentRun, run_id)
                if run is not None and run.status not in ("completed", "failed", "killed"):
                    run.status = "failed"
                    run.error_code = "dispatch_exception"
                    run.finished_at = datetime.now(UTC)
                    run.exit_code = 1
                    run.output_redacted = f"Unhandled exception: {exc}"[:10000]
                    session.add(run)
                    await session.commit()
                    await _publish_done_event(run_id, "failed", 1)
            except Exception as inner_exc:
                log.error(
                    "spec_bootstrap_dispatch_cleanup_failed",
                    run_id=str(run_id),
                    error=str(inner_exc),
                )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_PROJECT_SIGNATURES = [
    "package.json",
    "pyproject.toml",
    "pom.xml",
    "build.gradle",
    "go.mod",
    "Cargo.toml",
    "Makefile",
    "backend",
    "frontend",
    "src",
    "lib",
    "app",
]

# Entries that are not considered meaningful project content
_PLATFORM_ENTRIES = frozenset({".sillyspec", "worktree", "README.md", ".git"})


def _run_preflight(code_root: Path) -> str | None:
    """Validate code_root before launching the bootstrap agent.

    Returns an error string if preflight fails, or ``None`` if OK.
    """
    if not code_root.exists():
        return f"source_root does not exist: {code_root}"
    if not code_root.is_dir():
        return f"source_root is not a directory: {code_root}"
    entries = list(code_root.iterdir())
    meaningful = [e for e in entries if e.name not in _PLATFORM_ENTRIES]
    if not meaningful:
        return f"source_root is empty (no files besides platform-managed dirs): {code_root}"
    has_signature = any((code_root / sig).exists() for sig in _PROJECT_SIGNATURES)
    if not has_signature:
        # Check one level deeper — code may live inside a subdirectory
        for entry in entries:
            if (
                entry.is_dir()
                and entry.name not in _PLATFORM_ENTRIES
                and any((entry / sig).exists() for sig in _PROJECT_SIGNATURES)
            ):
                return None
        names = ", ".join(e.name for e in entries[:10])
        return (
            f"source_root has no recognizable project signature "
            f"(checked: {', '.join(_PROJECT_SIGNATURES[:7])}). "
            f"Found: {names}"
        )

    # Ensure git safe.directory for bind-mounted host directories
    import subprocess

    try:
        subprocess.run(
            ["git", "config", "--global", "--add", "safe.directory", str(code_root)],
            capture_output=True,
            check=False,
            timeout=5,
        )
    except Exception:
        pass

    return None


async def _write_run_log(
    session: AsyncSession,
    *,
    run_id: uuid.UUID,
    channel: str,
    content: str,
    chunk_size: int = 4000,
) -> None:
    """Persist long stderr/summary text as chunked AgentRunLog rows.

    Each row stores up to ``chunk_size`` characters.  On DB write failure
    the error is logged but does not propagate -- the caller should still
    be able to update the run status.
    """
    offset = 0
    while offset < len(content):
        chunk = content[offset : offset + chunk_size]
        try:
            session.add(
                AgentRunLog(
                    id=uuid.uuid4(),
                    run_id=run_id,
                    timestamp=datetime.now(UTC),
                    channel=channel,
                    content_redacted=chunk,
                )
            )
            await session.commit()
        except Exception as exc:
            log.warning(
                "spec_bootstrap_log_write_failed",
                run_id=str(run_id),
                channel=channel,
                error=str(exc),
            )
            # Roll back the failed commit so the session is usable for subsequent writes
            await session.rollback()
            return
        offset += chunk_size


async def _load_spec_workspace(
    session: AsyncSession,
    workspace_id: uuid.UUID,
) -> SpecWorkspace | None:
    """Load SpecWorkspace by workspace_id.  Returns None if not found."""
    stmt = select(SpecWorkspace).where(
        SpecWorkspace.workspace_id == workspace_id,
    )
    result = (await session.execute(stmt)).scalars().first()
    return result


def _parse_log_timestamp(ts: str) -> datetime:
    """Parse ISO timestamp from adapter callback."""
    try:
        return datetime.fromisoformat(ts)
    except (ValueError, TypeError):
        return datetime.now(UTC)


async def _publish_log_event(
    run_id: uuid.UUID,
    channel: str,
    content: str,
    ts: str,
) -> None:
    """Publish a log event to Redis for SSE subscribers."""
    try:
        redis = get_redis()
        payload = json.dumps(
            {
                "run_id": str(run_id),
                "channel": channel,
                "content": content[:4000],
                "timestamp": ts,
            },
            ensure_ascii=False,
        )
        await redis.publish(f"agent_run:{run_id}", payload)
    except Exception:
        log.warning("bootstrap_redis_publish_failed", run_id=str(run_id))


async def _publish_done_event(
    run_id: uuid.UUID,
    status: str,
    exit_code: int | None,
) -> None:
    """Publish a terminal ``done`` event so SSE subscribers stop waiting.

    Without this the bootstrap stream never signals completion, leaving the
    frontend stuck showing ``pending`` until the auth token expires.
    """
    try:
        redis = get_redis()
        payload = json.dumps(
            {
                "event": "done",
                "run_id": str(run_id),
                "status": status,
                "exit_code": exit_code,
            }
        )
        await redis.publish(f"agent_run:{run_id}", payload)
    except Exception:
        log.warning("bootstrap_redis_done_publish_failed", run_id=str(run_id))
