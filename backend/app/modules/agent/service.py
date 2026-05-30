"""Agent service — orchestrates agent runs."""

from __future__ import annotations

import asyncio
import json
import signal
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import (
    AgentRunNotFound,
    AgentRunNotRunning,
    AppError,
    TaskNotFound,
    WorktreeLeaseNotFound,
)
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.adapters.claude_code import ClaudeCodeAdapter
from app.modules.agent.base import AgentAdapter, AgentSpecBundle
from app.modules.agent.context_builder import build_spec_bundle, render_bundle_to_claude_md
from app.modules.agent.coordinator import ExecutionCoordinatorService
from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.agent.schema import AgentRunResponse
from app.modules.task.model import Task
from app.modules.workspace.model import AgentRunWorkspace, TaskWorkspace
from app.modules.worktree.model import WorktreeLease

log = get_logger(__name__)

ADAPTERS: dict[str, type[AgentAdapter]] = {
    "claude_code": ClaudeCodeAdapter,
}

# Alias support — allows legacy agent type keys to resolve to the canonical name
AGENT_TYPE_ALIASES: dict[str, str] = {
    "claude-code": "claude_code",
}


class AgentRunError(AppError):
    code = "AGENT_RUN_ERROR"
    http_status = 400


class AgentService:
    # 进程注册表 — 类属性，所有实例共享
    # key: run_id (UUID), value: asyncio.subprocess.Process
    _proc_registry: dict[uuid.UUID, asyncio.subprocess.Process] = {}

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def start_run(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        task_id: uuid.UUID,
        lease_id: uuid.UUID,
        agent_type: str = "claude_code",
        idempotency_key: str | None = None,
    ) -> AgentRun:
        """Create an AgentRun record and trigger background execution.

        The run record is created with status ``pending`` and returned
        immediately.  Actual agent execution is delegated to
        ``_execute_run_background``.  In the current implementation the
        background call happens synchronously within the request, but the
        code structure is ready for a true task-queue replacement.

        If ``idempotency_key`` is provided and a run with that key already
        exists, the existing run is returned immediately (HTTP 200 instead
        of 201 — handled by the router layer).
        """
        coordinator = ExecutionCoordinatorService(self._session)

        # -- 0. Idempotency check ------------------------------------------------
        if idempotency_key:
            existing = await coordinator.check_idempotency(idempotency_key)
            if existing is not None:
                log.info("idempotent_run_returned", run_id=str(existing.id), key=idempotency_key)
                return existing

        # -- 1. Validate task -----------------------------------------------------
        task = await self._session.get(Task, task_id)
        if task is None or task.workspace_id != workspace_id:
            raise TaskNotFound(
                f"Task '{task_id}' not found.",
                details={"task_id": str(task_id)},
            )

        # -- 2. Validate lease ----------------------------------------------------
        lease = await self._session.get(WorktreeLease, lease_id)
        if lease is None:
            raise WorktreeLeaseNotFound(
                f"Lease '{lease_id}' not found.",
                details={"lease_id": str(lease_id)},
            )
        if lease.status != "locked":
            raise AgentRunError(
                "Lease is not active.",
                details={"lease_id": str(lease_id), "status": lease.status},
            )

        # -- 3. Resolve adapter ---------------------------------------------------
        canonical = AGENT_TYPE_ALIASES.get(agent_type, agent_type)
        adapter_cls = ADAPTERS.get(canonical)
        if adapter_cls is None:
            raise AgentRunError(
                f"Unknown agent type '{agent_type}'.",
                details={"agent_type": canonical, "available": list(ADAPTERS.keys())},
            )

        # -- 4. Build spec bundle -------------------------------------------------
        bundle = await build_spec_bundle(
            self._session,
            change_id=task.change_id,
            task_id=task_id,
            workspace_id=workspace_id,
        )

        # -- 4b. Compute context fingerprint --------------------------------------
        fingerprint = coordinator.compute_fingerprint(bundle)

        # -- 5. Create run record (pending) --------------------------------------
        run = AgentRun(
            id=uuid.uuid4(),
            task_id=task_id,
            lease_id=lease_id,
            agent_type=canonical,
            status="pending",
            spec_strategy=bundle.spec_strategy,
            profile_version=bundle.profile_version,
            idempotency_key=idempotency_key,
            context_fingerprint=fingerprint,
        )
        self._session.add(run)
        await self._session.commit()
        await self._session.refresh(run)

        # -- 5a. Generate resume_token for potential future resume ----------------
        await coordinator.generate_resume_token(run)

        # -- 5b. Create M:N workspace associations -------------------------------
        task_ws_stmt = select(TaskWorkspace.workspace_id).where(
            col(TaskWorkspace.task_id) == task_id,
        )
        task_ws_ids = [row[0] for row in (await self._session.execute(task_ws_stmt)).all()]
        all_ws_ids = set(task_ws_ids)
        all_ws_ids.add(workspace_id)
        for wid in all_ws_ids:
            self._session.add(AgentRunWorkspace(
                agent_run_id=run.id,
                workspace_id=wid,
            ))
        await self._session.commit()

        # -- 6. Write CLAUDE.md into lease path -----------------------------------
        lease_path = Path(lease.path)
        claude_md = render_bundle_to_claude_md(bundle)
        (lease_path / "CLAUDE.md").write_text(claude_md, encoding="utf-8")

        # -- 7. Execute (currently synchronous, structured for future async) ------
        await self._execute_run_background(
            run_id=run.id,
            bundle=bundle,
            lease_path=lease_path,
            agent_type=canonical,
            workspace_id=workspace_id,
            user_id=user_id,
            task_id=task_id,
        )

        # Refresh to pick up status changes from _execute_run_background
        await self._session.refresh(run)
        return run

    # ------------------------------------------------------------------
    # Background execution (currently called synchronously)
    # ------------------------------------------------------------------

    async def _execute_run_background(
        self,
        *,
        run_id: uuid.UUID,
        bundle: AgentSpecBundle,
        lease_path: Path,
        agent_type: str,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        task_id: uuid.UUID,
    ) -> None:
        """Execute the agent and update run records.

        Designed as an async method that can be dispatched by a background
        task scheduler in the future.  For now it is called directly from
        ``start_run``.
        """
        # -- 1. Load run record ---------------------------------------------------
        run = await self._session.get(AgentRun, run_id)
        if run is None:
            log.error("execute_run_background_run_missing", run_id=str(run_id))
            return

        adapter_cls = ADAPTERS.get(agent_type)
        if adapter_cls is None:
            run.status = "failed"
            run.finished_at = datetime.utcnow()
            run.exit_code = 1
            run.output_redacted = f"Unknown agent type '{agent_type}'."
            self._session.add(run)
            await self._session.commit()
            return

        # -- 2. Mark running ------------------------------------------------------
        run.status = "running"
        run.started_at = datetime.utcnow()
        self._session.add(run)
        await self._session.commit()

        # -- 3. Execute via adapter -----------------------------------------------
        adapter = adapter_cls()
        result = await adapter.run_with_bundle(run_id, bundle, lease_path)

        # -- 4. Update run record -------------------------------------------------
        run.status = "completed" if result.exit_code == 0 else "failed"
        run.finished_at = datetime.utcnow()
        run.exit_code = result.exit_code
        run.output_redacted = result.redacted_output[:10000]  # truncate
        self._session.add(run)

        # -- 5. Collect diff ------------------------------------------------------
        try:
            from app.modules.agent.diff_collector import collect_diff

            diff_result = await collect_diff(lease_path)
            if diff_result.files_changed > 0:
                run.diff_summary = (
                    f"{diff_result.stat_summary}\n"
                    f"--- Summary: {diff_result.files_changed} files changed, "
                    f"{diff_result.insertions} insertions(+), "
                    f"{diff_result.deletions} deletions(-)"
                )
            else:
                run.diff_summary = None
            self._session.add(run)
        except Exception as exc:
            log.warning(
                "diff_collect_failed",
                run_id=str(run_id),
                error=str(exc),
            )

        # -- 6. Log stdout/stderr -------------------------------------------------
        for channel, content in [
            ("stdout", result.stdout),
            ("stderr", result.stderr),
        ]:
            if content:
                log_entry = AgentRunLog(
                    id=uuid.uuid4(),
                    run_id=run.id,
                    channel=channel,
                    content_redacted=redact_agent_output(content)[:5000],
                )
                self._session.add(log_entry)

        # -- 7. Write audit log ---------------------------------------------------
        from app.modules.workflow.model import AuditLog

        audit = AuditLog(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            actor_id=user_id,
            action="agent.run",
            resource_type="agent_run",
            resource_id=run.id,
            details_json=json.dumps({
                "task_id": str(task_id),
                "agent_type": agent_type,
                "exit_code": result.exit_code,
                "timed_out": result.timed_out,
                "spec_strategy": bundle.spec_strategy,
                "profile_version": bundle.profile_version,
            }),
        )
        self._session.add(audit)

        await self._session.commit()

    # ------------------------------------------------------------------
    # Kill mechanism
    # ------------------------------------------------------------------

    async def kill_run(self, run_id: uuid.UUID) -> AgentRun:
        """Terminate a running agent execution.

        Sends SIGTERM, waits up to 5 seconds, then sends SIGKILL if
        the process has not exited.

        Args:
            run_id: UUID of the AgentRun to terminate.

        Returns:
            The updated AgentRun with status='killed'.

        Raises:
            AgentRunNotFound: run_id does not exist in the database.
            AgentRunNotRunning: run exists but status is not 'running'.
        """
        # -- 1. Load run record ---------------------------------------------------
        run = await self._session.get(AgentRun, run_id)
        if run is None:
            raise AgentRunNotFound(
                f"Run '{run_id}' not found.",
                details={"run_id": str(run_id)},
            )

        # -- 2. Status check ------------------------------------------------------
        if run.status != "running":
            raise AgentRunNotRunning(
                f"Run '{run_id}' is not running (status={run.status}).",
                details={"run_id": str(run_id), "status": run.status},
            )

        # -- 3. Find process in registry ------------------------------------------
        proc = self._proc_registry.get(run_id)

        if proc is not None and proc.returncode is None:
            # 3a. Send SIGTERM
            try:
                proc.send_signal(signal.SIGTERM)
            except ProcessLookupError:
                pass

            # 3b. Wait up to 5 seconds
            try:
                await asyncio.wait_for(proc.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                # 3c. SIGKILL
                try:
                    proc.kill()
                except ProcessLookupError:
                    pass
                await proc.wait()

        # -- 4. Remove from registry (whether proc exists or not) ------------------
        self._proc_registry.pop(run_id, None)

        # -- 5. Update database record --------------------------------------------
        run.status = "killed"
        run.finished_at = datetime.utcnow()
        run.exit_code = run.exit_code if run.exit_code is not None else -9
        self._session.add(run)
        await self._session.commit()
        await self._session.refresh(run)

        log.info("run_killed", run_id=str(run_id))
        return run

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    async def get_run(self, run_id: uuid.UUID) -> AgentRun | None:
        return await self._session.get(AgentRun, run_id)

    async def list_runs(
        self,
        workspace_id: uuid.UUID,
        task_id: uuid.UUID | None = None,
    ) -> list[AgentRun]:
        # Query via M:N association table
        arw_subq = select(AgentRunWorkspace.agent_run_id).where(
            col(AgentRunWorkspace.workspace_id) == workspace_id,
        )

        if task_id:
            stmt = select(AgentRun).where(
                col(AgentRun.task_id) == task_id,
                col(AgentRun.id).in_(arw_subq),
            )
        else:
            stmt = select(AgentRun).where(
                col(AgentRun.id).in_(arw_subq),
            )
        stmt = stmt.order_by(col(AgentRun.started_at).desc())
        return list((await self._session.execute(stmt)).scalars().all())

    # ------------------------------------------------------------------
    # M:N Enrichment
    # ------------------------------------------------------------------

    async def enrich_with_workspace_ids(self, run: AgentRun) -> AgentRunResponse:
        """Build AgentRunResponse with workspace_ids populated from M:N table."""
        stmt = select(AgentRunWorkspace.workspace_id).where(
            col(AgentRunWorkspace.agent_run_id) == run.id,
        )
        ws_ids = [row[0] for row in (await self._session.execute(stmt)).all()]
        data = AgentRunResponse.model_validate(run)
        data.workspace_ids = ws_ids
        return data

    async def enrich_list(self, runs: list[AgentRun]) -> list[AgentRunResponse]:
        """Build AgentRunResponse list with workspace_ids populated."""
        result: list[AgentRunResponse] = []
        for r in runs:
            enriched = await self.enrich_with_workspace_ids(r)
            result.append(enriched)
        return result

    async def get_run_logs(self, run_id: uuid.UUID) -> list[AgentRunLog]:
        stmt = (
            select(AgentRunLog)
            .where(col(AgentRunLog.run_id) == run_id)
            .order_by(col(AgentRunLog.timestamp))
        )
        return list((await self._session.execute(stmt)).scalars().all())

    # ------------------------------------------------------------------
    # SSE streaming
    # ------------------------------------------------------------------

    async def stream_run_logs(self, run_id: uuid.UUID) -> AsyncGenerator[str, None]:
        """Yield SSE formatted events from Redis Pub/Sub for a given run.

        Subscribes to the ``agent_run:{run_id}`` channel.  Emits ``data``
        events for each message, a ``done`` event when the agent signals
        completion, and ``: keepalive`` comments every ~30 seconds of
        silence to prevent connection timeouts.
        """
        redis = get_redis()
        pubsub = redis.pubsub()
        channel = f"agent_run:{run_id}"
        try:
            await pubsub.subscribe(channel)
            while True:
                try:
                    message = await asyncio.wait_for(
                        pubsub.get_message(timeout=25),
                        timeout=30,
                    )
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if message and message["type"] == "message":
                    data = message["data"]
                    try:
                        payload = json.loads(data)
                    except (json.JSONDecodeError, TypeError):
                        payload = {}
                    if payload.get("event") == "done":
                        yield "event: done\ndata: {}\n\n"
                        break
                    yield f"data: {data}\n\n"
                else:
                    yield ": keepalive\n\n"
        except Exception:
            yield 'event: error\ndata: {"error": "redis connection failed"}\n\n'
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()


    # ------------------------------------------------------------------
    # Stale run cleanup
    # ------------------------------------------------------------------

    async def cleanup_stale_runs(self) -> int:
        """Clean up stale running-state AgentRun records.

        Called during service startup to mark any runs that were
        running when the service restarted as failed.
        """
        return await _cleanup_stale_runs_impl(self._session)


async def _cleanup_stale_runs_impl(session: AsyncSession) -> int:
    """Scan for stale running-state AgentRuns and mark them as failed.

    When the service restarts, the in-memory process registry is empty,
    but database records may still show status='running'.  This function
    marks them as failed so they don't appear stuck forever.

    Returns:
        Number of stale runs cleaned up.
    """
    stmt = select(AgentRun).where(col(AgentRun.status) == "running")
    stale_runs = list((await session.execute(stmt)).scalars().all())

    if not stale_runs:
        return 0

    now = datetime.utcnow()
    for run in stale_runs:
        run.status = "failed"
        run.finished_at = now
        run.exit_code = -1
        run.output_redacted = "Run interrupted: service restarted while agent was running."
        session.add(run)
        log.warning("stale_run_cleaned", run_id=str(run.id))

    await session.commit()
    return len(stale_runs)


def redact_agent_output(text: str) -> str:
    """Redact sensitive patterns from agent output."""
    from app.modules.git_gateway.service import redact_output
    return redact_output(text)
