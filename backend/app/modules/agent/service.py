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


def resolve_work_dir(
    *,
    workspace_root: str,
    change_path: str | None,
    change_key: str | None,
    lease: WorktreeLease | None,
    requires_worktree: bool,
    read_only: bool,
) -> Path:
    """根据阶段配置和 worktree 可用性确定工作目录。

    策略：
      - 有 lease（workspace 有 git identity + 写阶段） → worktree repo
      - 无 lease + 写阶段（无 git identity）→ workspace root
      - 只读阶段 → workspace root（拼接 change.path）

    Args:
        workspace_root: workspace 的根路径（来自 Workspace.root_path）。
        change_path: change.path 字段值，可能为 None。
        change_key: change.change_key，用于拼接 worktree 内 .sillyspec 路径。
        lease: 已获取的 WorktreeLease，无 git identity 时为 None。
        requires_worktree: 阶段配置是否要求 worktree。
        read_only: 阶段是否只读。

    Returns:
        确定的工作目录 Path。

    Raises:
        AgentRunError: workspace_root 路径不存在时。
    """
    ws_root = Path(workspace_root)
    if not ws_root.exists():
        raise AgentRunError(
            f"Workspace root does not exist: {workspace_root}",
            details={"workspace_root": workspace_root},
        )

    # 只读阶段 → workspace root（拼接 change.path）
    if read_only:
        if change_path:
            candidate = (
                ws_root / change_path if not Path(change_path).is_absolute() else Path(change_path)
            )
            if candidate.is_dir():
                return candidate
        return ws_root

    # 写阶段 + 有 lease → worktree repo
    if lease is not None:
        return Path(lease.path) / "repo"

    # 写阶段 + 无 lease → workspace root（审计日志由调用方记录）
    return ws_root


class AgentService:
    # 进程注册表 — 类属性，所有实例共享
    # key: run_id (UUID), value: asyncio.subprocess.Process
    _proc_registry: dict[uuid.UUID, asyncio.subprocess.Process] = {}

    # 后台任务引用集 — 防止 asyncio.Task 被 GC 回收
    _background_tasks: set[asyncio.Task] = set()

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------
    # Background task lifecycle helpers
    # ------------------------------------------------------------------

    def _fire_background_task(
        self,
        coro,
        *,
        workspace_id: uuid.UUID | None = None,
        run_id: uuid.UUID | None = None,
    ) -> asyncio.Task:
        """Create a background task and hold a strong reference to prevent GC."""
        task = asyncio.create_task(coro)
        self._background_tasks.add(task)
        task.add_done_callback(self._on_background_task_done)
        log.info(
            "background_task_fired",
            task_id=id(task),
            workspace_id=str(workspace_id),
            run_id=str(run_id),
        )
        return task

    @staticmethod
    def _on_background_task_done(task: asyncio.Task) -> None:
        """Remove task from the tracking set and surface exceptions."""
        AgentService._background_tasks.discard(task)
        try:
            exc = task.exception()
        except (asyncio.InvalidStateError, asyncio.CancelledError):
            return
        if exc is not None:
            log.exception("background_task_failed", task_id=id(task), exc_info=exc)

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
            self._session.add(
                AgentRunWorkspace(
                    agent_run_id=run.id,
                    workspace_id=wid,
                )
            )
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
        run.total_cost_usd = result.total_cost_usd
        run.duration_ms = result.duration_ms
        run.duration_api_ms = result.duration_api_ms
        run.num_turns = result.num_turns
        run.session_id = result.session_id
        run.conversation_events = result.conversation_events
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
            details_json=json.dumps(
                {
                    "task_id": str(task_id),
                    "agent_type": agent_type,
                    "exit_code": result.exit_code,
                    "timed_out": result.timed_out,
                    "spec_strategy": bundle.spec_strategy,
                    "profile_version": bundle.profile_version,
                }
            ),
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
            except TimeoutError:
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

    async def stream_run_logs(
        self,
        run_id: uuid.UUID,
        *,
        session: AsyncSession | None = None,
    ) -> AsyncGenerator[str, None]:
        """Yield SSE formatted events from Redis Pub/Sub for a given run.

        Subscribes to the ``agent_run:{run_id}`` channel.  Emits ``data``
        events for each message, a ``done`` event when the agent signals
        completion, and ``: keepalive`` comments every ~30 seconds of
        silence to prevent connection timeouts.

        If *session* is provided, re-checks the run status after subscribing
        to Redis so that runs which completed between the router's status
        check and this subscription are still detected.
        """
        redis = get_redis()
        pubsub = redis.pubsub()
        channel = f"agent_run:{run_id}"
        try:
            # Flush proxy buffers immediately with an initial comment.
            yield ": connected\n\n"

            await pubsub.subscribe(channel)

            # Race-condition guard: if the agent finished while the client
            # was connecting, the router's status check may have seen
            # "running" but the "done" event was already published (and
            # missed by pub/sub).  Re-check the DB status.
            if session is not None:
                run = await session.get(AgentRun, run_id)
                if run is not None and run.status not in ("pending", "running"):
                    done_data = json.dumps({"status": run.status, "exit_code": run.exit_code})
                    yield f"event: done\ndata: {done_data}\n\n"
                    return

            while True:
                try:
                    message = await asyncio.wait_for(
                        pubsub.get_message(timeout=25),
                        timeout=30,
                    )
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if message and message["type"] == "message":
                    data = message["data"]
                    try:
                        payload = json.loads(data)
                    except (json.JSONDecodeError, TypeError):
                        payload = {}
                    if payload.get("event") == "done":
                        # Prefer the authoritative DB status/exit_code over the
                        # pub/sub payload, which some publishers leave as null.
                        status_val = payload.get("status")
                        exit_code_val = payload.get("exit_code")
                        if session is not None and (status_val is None or exit_code_val is None):
                            session.expire_all()
                            run = await session.get(AgentRun, run_id)
                            if run is not None:
                                status_val = run.status
                                exit_code_val = run.exit_code
                        done_data = json.dumps(
                            {
                                "status": status_val,
                                "exit_code": exit_code_val,
                            }
                        )
                        yield f"event: done\ndata: {done_data}\n\n"
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

    # ------------------------------------------------------------------
    # Stage dispatch (change-level, not task-level)
    # ------------------------------------------------------------------

    async def start_stage_dispatch(
        self,
        *,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        user_id: uuid.UUID,
        stage: str,
        prompt_template: str,
        requires_worktree: bool,
        read_only: bool = True,
    ) -> AgentRun:
        """Create and execute an AgentRun driven by a stage transition.

        This is separate from ``start_run`` because:
        - No task_id is required (change-level dispatch).
        - Worktree lease is optional (skipped for read-only stages).
        - The prompt is rendered from the stage template, not from a Task.
        """
        from app.modules.change.dispatch import load_prompt_template
        from app.modules.change.model import Change

        # -- 1. Load change ---------------------------------------------------
        change = await self._session.get(Change, change_id)
        if change is None:
            raise AgentRunError(
                f"Change '{change_id}' not found.",
                details={"change_id": str(change_id)},
            )

        workspace_root = await self._get_workspace_root(workspace_id)

        # -- 2. Resolve worktree or working directory -------------------------

        lease: WorktreeLease | None = None

        if requires_worktree:
            lease = await self._try_acquire_lease(
                workspace_id=workspace_id,
                change_id=change_id,
                user_id=user_id,
            )
            # No longer raise on None — fallback to workspace root

        work_dir = resolve_work_dir(
            workspace_root=workspace_root,
            change_path=change.path,
            change_key=change.change_key,
            lease=lease,
            requires_worktree=requires_worktree,
            read_only=read_only,
        )

        # 审计日志：写阶段 + 无 lease → 记录 warning
        if not read_only and lease is None:
            log.warning(
                "stage_dispatch_no_worktree_fallback",
                stage=stage,
                change_id=str(change_id),
                workspace_id=str(workspace_id),
                work_dir=str(work_dir),
            )

        # -- 2b. Ensure .sillyspec/changes/<key>/ exists in worktree -----------
        if change.change_key and not read_only:
            await self._ensure_change_dir_in_worktree(
                work_dir=work_dir,
                change_key=change.change_key,
                workspace_root=workspace_root,
            )

        # -- 3. Build prompt --------------------------------------------------
        prompt_context = {
            "change_title": change.title or "",
            "change_key": change.change_key,
            "current_stage": change.current_stage or "draft",
            "stage": stage,
            "change_type": change.change_type or "",
            "affected_components": ", ".join(change.affected_components),
            "workspace_id": str(workspace_id),
        }
        prompt = load_prompt_template(prompt_template, prompt_context)
        if not prompt:
            raise AgentRunError(
                f"Prompt template '{prompt_template}' not found or empty.",
                details={"template": prompt_template},
            )

        # -- 4. Create AgentRun record ----------------------------------------
        run = AgentRun(
            id=uuid.uuid4(),
            task_id=None,
            lease_id=lease.id if lease else None,
            change_id=change_id,
            agent_type="claude_code",
            status="pending",
        )
        self._session.add(run)
        await self._session.commit()
        await self._session.refresh(run)

        # -- 5. Create M:N workspace association ------------------------------
        self._session.add(
            AgentRunWorkspace(
                agent_run_id=run.id,
                workspace_id=workspace_id,
            )
        )
        await self._session.commit()

        # -- 6. Execute agent (fire-and-forget) --------------------------------
        self._fire_background_task(
            self._execute_stage_run(
                run_id=run.id,
                prompt=prompt,
                work_dir=work_dir,
                read_only=read_only,
                workspace_id=workspace_id,
                change_id=change_id,
                user_id=user_id,
                stage=stage,
            ),
            workspace_id=workspace_id,
            run_id=run.id,
        )

        # Return immediately — caller can poll agent-status for progress
        return run

    async def _ensure_change_dir_in_worktree(
        self,
        work_dir: Path,
        change_key: str,
        workspace_root: str,
    ) -> None:
        """确保 worktree 内 .sillyspec/changes/<change_key>/ 目录存在。

        如果目录不存在，从主 repo 复制。如果复制失败，记录 warning
        并继续（agent 启动后可通过 sillyspec init 创建）。
        """
        change_dir = work_dir / ".sillyspec" / "changes" / change_key
        if change_dir.exists():
            return

        log.info(
            "ensuring_change_dir_in_worktree",
            change_key=change_key,
            work_dir=str(work_dir),
        )

        # 尝试从主 repo 复制
        source_dir = Path(workspace_root) / ".sillyspec" / "changes" / change_key
        if source_dir.exists():
            try:
                import shutil

                change_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(str(source_dir), str(change_dir))
                log.info("change_dir_copied_from_main_repo", dest=str(change_dir))
            except Exception as exc:
                log.warning(
                    "change_dir_copy_failed",
                    source=str(source_dir),
                    dest=str(change_dir),
                    error=str(exc),
                )
        else:
            log.warning(
                "change_dir_not_in_main_repo",
                change_key=change_key,
                source=str(source_dir),
            )

    async def _try_acquire_lease(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> WorktreeLease | None:
        """Try to acquire a worktree lease for the change.

        Returns the lease if successful, or ``None`` if the workspace
        has no git identity configured (the caller should skip dispatch).
        """
        from app.modules.git_identity.model import GitIdentity
        from app.modules.workspace.model import Workspace
        from app.modules.worktree.schema import WorktreeAcquireRequest
        from app.modules.worktree.service import WorktreeService

        # Find workspace
        ws_stmt = select(Workspace).where(col(Workspace.id) == workspace_id)
        workspace = (await self._session.execute(ws_stmt)).scalars().first()
        if workspace is None or not workspace.repo_url:
            return None

        # Find a usable git identity for this user
        id_stmt = select(GitIdentity).where(
            col(GitIdentity.user_id) == user_id,
            col(GitIdentity.revoked_at).is_(None),
        )
        identity = (await self._session.execute(id_stmt)).scalars().first()
        if identity is None:
            return None

        ws_svc = WorktreeService(self._session)
        request = WorktreeAcquireRequest(
            component_id=workspace_id,  # use workspace as component for stage dispatch
            change_id=change_id,
            task_id=uuid.uuid4(),  # synthetic task for lease
            git_identity_id=identity.id,
            ttl_seconds=3600,
        )
        lease = await ws_svc.acquire(
            user_id=user_id,
            workspace_id=workspace_id,
            data=request,
        )
        return lease

    async def _execute_stage_run(
        self,
        *,
        run_id: uuid.UUID,
        prompt: str,
        work_dir: Path,
        read_only: bool,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        user_id: uuid.UUID,
        stage: str,
    ) -> None:
        """Execute a stage-level agent run (runs in background task).

        Uses an independent DB session since we are called via
        ``asyncio.create_task`` and the parent request's session may be
        closed already.
        """
        from app.core.db import get_session_factory
        from app.modules.agent.base import AgentSpecBundle

        factory = get_session_factory()
        async with factory() as session:
            try:
                run = await session.get(AgentRun, run_id)
                if run is None:
                    log.error("stage_run_missing", run_id=str(run_id))
                    return

                adapter_cls = ADAPTERS.get("claude_code")
                if adapter_cls is None:
                    run.status = "failed"
                    run.finished_at = datetime.utcnow()
                    run.exit_code = 1
                    run.output_redacted = "Unknown agent type."
                    session.add(run)
                    await session.commit()
                    return

                # Mark running
                run.status = "running"
                run.started_at = datetime.utcnow()
                session.add(run)
                await session.commit()

                # ── 构建包含阶段 prompt 的完整 bundle ──
                # 将阶段 prompt 嵌入 task_markdown，让 render_bundle_to_claude_md
                # 将其作为 "Task" section inline 到 CLAUDE.md 中
                mode_suffix = (
                    "\n\n## Mode: READ-ONLY\nDo NOT modify any files. Only analyze and report.\n"
                    if read_only
                    else "\n\n## Mode: WRITE\nYou may modify files in the worktree as needed.\n"
                )

                bundle = AgentSpecBundle(
                    change_summary=f"Change stage: {stage}",
                    task_key=f"stage:{stage}",
                    task_title=f"Stage dispatch: {stage}",
                    # ★ 关键：将阶段 prompt + 模式标记嵌入 task_markdown
                    # render_bundle_to_claude_md 会将其作为 ## Task section 输出
                    task_markdown=prompt + mode_suffix,
                    # 通过 platform_metadata 传递 stage 上下文（供 adapter / task-06 使用）
                    platform_metadata={
                        "stage_dispatch": True,
                        "stage": stage,
                        "read_only": read_only,
                        "change_id": str(change_id),
                        "workspace_id": str(workspace_id),
                    },
                    available_tools=["sillyspec"],
                )

                # Ensure work directory exists
                work_dir.mkdir(parents=True, exist_ok=True)

                # ──（已移除）直接写 CLAUDE.md ──
                # CLAUDE.md 现在由 adapter.run_with_bundle() 内部统一渲染和写入

                adapter = adapter_cls()
                result = await adapter.run_with_bundle(run_id, bundle, work_dir)

                # Update run record
                run.status = "completed" if result.exit_code == 0 else "failed"
                run.finished_at = datetime.utcnow()
                run.exit_code = result.exit_code
                run.output_redacted = result.redacted_output[:10000]
                run.total_cost_usd = result.total_cost_usd
                run.duration_ms = result.duration_ms
                run.duration_api_ms = result.duration_api_ms
                run.num_turns = result.num_turns
                run.session_id = result.session_id
                run.conversation_events = result.conversation_events
                session.add(run)

                # Log stdout/stderr
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
                        session.add(log_entry)

                # Write audit log
                from app.modules.workflow.model import AuditLog

                audit = AuditLog(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    actor_id=user_id,
                    action="agent.stage_dispatch",
                    resource_type="agent_run",
                    resource_id=run.id,
                    details_json=json.dumps(
                        {
                            "change_id": str(change_id),
                            "stage": stage,
                            "agent_type": "claude_code",
                            "exit_code": result.exit_code,
                            "read_only": read_only,
                        }
                    ),
                )
                session.add(audit)

                # Update change.stages.last_dispatch with final status
                from app.modules.change.model import Change

                change = await session.get(Change, change_id)
                if change is not None:
                    stages = change.stages or {}
                    last_dispatch = stages.get("last_dispatch", {})
                    last_dispatch.update(
                        {
                            "status": run.status,
                            "finished_at": run.finished_at.isoformat() if run.finished_at else None,
                            "run_id": str(run.id),
                            "exit_code": run.exit_code,
                        }
                    )
                    stages["last_dispatch"] = last_dispatch
                    change.stages = stages
                    session.add(change)

                # -- 8. Sync stage status + auto dispatch next step -----------------
                if run.status == "completed":
                    try:
                        from app.modules.change.dispatch import (
                            SillySpecStageDispatchService,
                            auto_dispatch_next_step,
                        )

                        dispatch_svc = SillySpecStageDispatchService(session)
                        sync_result = await dispatch_svc.sync_stage_status(
                            session=session,
                            change_id=change_id,
                            run_id=run_id,
                        )
                        log.info(
                            "stage_sync_completed",
                            run_id=str(run_id),
                            change_id=str(change_id),
                            synced=sync_result.synced,
                            has_pending_step=sync_result.has_pending_step,
                            stage_completed=sync_result.stage_completed,
                        )

                        if sync_result.synced and sync_result.has_pending_step:
                            auto_result = await auto_dispatch_next_step(
                                session=session,
                                workspace_id=workspace_id,
                                change_id=change_id,
                                user_id=user_id,
                                sync_result=sync_result,
                            )
                            log.info(
                                "auto_dispatch_result",
                                run_id=str(run_id),
                                change_id=str(change_id),
                                dispatched=auto_result.get("dispatched"),
                                reason=auto_result.get("reason"),
                            )
                    except Exception as exc:
                        # 自动调度失败不应影响主流程（AgentRun 已完成）
                        log.warning(
                            "auto_dispatch_failed",
                            run_id=str(run_id),
                            change_id=str(change_id),
                            error=str(exc),
                        )

                await session.commit()

            except Exception as exc:
                # -- Guard: mark failed on unhandled exception ----------------------
                log.error(
                    "stage_run_exception",
                    run_id=str(run_id),
                    error=str(exc),
                )
                try:
                    run = await session.get(AgentRun, run_id)
                    if run is not None and run.status not in ("completed", "failed", "killed"):
                        run.status = "failed"
                        run.finished_at = datetime.utcnow()
                        run.exit_code = -1
                        run.output_redacted = f"Unhandled exception: {exc}"[:10000]
                        session.add(run)
                        await session.commit()
                except Exception:
                    log.error(
                        "stage_run_exception_cleanup_failed",
                        run_id=str(run_id),
                    )
            finally:
                # Safety net: ensure run is never stuck in "running"
                try:
                    run = await session.get(AgentRun, run_id)
                    if run is not None and run.status == "running":
                        run.status = "failed"
                        run.finished_at = datetime.utcnow()
                        run.exit_code = -1
                        run.output_redacted = "Force-failed: task lifecycle guard"[:10000]
                        session.add(run)
                        await session.commit()
                except Exception:
                    log.error(
                        "stage_run_finally_guard_failed",
                        run_id=str(run_id),
                    )

    # ------------------------------------------------------------------
    # Scan dispatch (workspace-level, no Change dependency)
    # ------------------------------------------------------------------

    async def start_scan_dispatch(
        self,
        *,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        root_path: str,
        spec_root: str,
    ) -> AgentRun:
        """Create and execute a scan-mode AgentRun.

        Unlike ``start_stage_dispatch``, this method has no dependency on a
        Change record.  It builds a scan bundle via ``build_scan_bundle``,
        creates an ``AgentRun`` with ``change_id=None``, and fires off a
        background execution via ``_execute_scan_run``.

        Args:
            workspace_id: Existing Workspace record ID.
            user_id: User who initiated the scan.
            root_path: Absolute path to the user's project directory (read-only).
            spec_root: Absolute path to the platform-managed spec directory.

        Returns:
            The newly created AgentRun record (status="pending").

        Raises:
            AgentRunError: If root_path does not exist or is not a directory.
        """
        from app.modules.agent.context_builder import build_scan_bundle

        # -- 1. Validate root_path ------------------------------------------------
        work_dir = Path(root_path)
        if not work_dir.exists() or not work_dir.is_dir():
            raise AgentRunError(
                f"root_path does not exist or is not a directory: {root_path}",
                details={"root_path": root_path},
            )

        # -- 2. Pre-generate run_id so we can pass it to the bundle builder ------
        run_id = uuid.uuid4()

        # -- 3. Build scan bundle -------------------------------------------------
        bundle = await build_scan_bundle(
            session=self._session,
            workspace_id=workspace_id,
            spec_root=spec_root,
            root_path=root_path,
            run_id=run_id,
        )

        # -- 4. Create AgentRun record --------------------------------------------
        run = AgentRun(
            id=run_id,
            task_id=None,
            change_id=None,
            lease_id=None,
            agent_type="claude_code",
            status="pending",
            spec_strategy="platform-managed",
        )
        self._session.add(run)
        await self._session.commit()
        await self._session.refresh(run)

        # -- 4. Create M:N workspace association ----------------------------------
        self._session.add(
            AgentRunWorkspace(
                agent_run_id=run.id,
                workspace_id=workspace_id,
            )
        )
        await self._session.commit()

        # -- 5. Fire-and-forget background execution -----------------------------
        self._fire_background_task(
            self._execute_scan_run(
                run_id=run.id,
                bundle=bundle,
                work_dir=work_dir,
                workspace_id=workspace_id,
                user_id=user_id,
            ),
            workspace_id=workspace_id,
            run_id=run.id,
        )

        return run

    async def _execute_scan_run(
        self,
        *,
        run_id: uuid.UUID,
        bundle: AgentSpecBundle,
        work_dir: Path,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        """Execute a scan-mode agent run (runs in background task).

        Uses an independent DB session since we are called via
        ``asyncio.create_task`` and the parent request's session may be
        closed already.

        This method does **not** call any Change-related logic (no
        ``change.stages`` update, no ``auto_dispatch_next_step``).
        """
        from app.core.db import get_session_factory
        from app.modules.workflow.model import AuditLog

        factory = get_session_factory()
        async with factory() as session:
            try:
                # -- 1. Load AgentRun record --------------------------------------
                run = await session.get(AgentRun, run_id)
                if run is None:
                    log.error("scan_run_missing", run_id=str(run_id))
                    return

                # -- 2. Get adapter -----------------------------------------------
                adapter_cls = ADAPTERS.get("claude_code")
                if adapter_cls is None:
                    run.status = "failed"
                    run.finished_at = datetime.utcnow()
                    run.exit_code = 1
                    run.output_redacted = "Unknown agent type."
                    session.add(run)
                    await session.commit()
                    return

                # -- 3. Mark running -----------------------------------------------
                run.status = "running"
                run.started_at = datetime.utcnow()
                session.add(run)
                await session.commit()

                # -- 4. Ensure work directory exists --------------------------------
                work_dir.mkdir(parents=True, exist_ok=True)

                # -- 5. Execute via adapter -----------------------------------------
                adapter = adapter_cls()

                async def on_log(channel: str, content: str, ts: str) -> None:
                    log_entry = AgentRunLog(
                        id=uuid.uuid4(),
                        run_id=run.id,
                        channel=channel,
                        content_redacted=redact_agent_output(content)[:5000],
                    )
                    try:
                        session.add(log_entry)
                        await session.commit()
                    except Exception:
                        log.warning("scan_on_log_failed", run_id=str(run_id))

                result = await adapter.run_with_bundle(run_id, bundle, work_dir, on_log=on_log)

                # -- 6. Update run record -------------------------------------------
                run.status = "completed" if result.exit_code == 0 else "failed"
                run.finished_at = datetime.utcnow()
                run.exit_code = result.exit_code

                # Save full output to file for debugging
                runtime_root = bundle.runtime_root or str(
                    Path(bundle.spec_root or work_dir) / "runtime"
                )
                log_dir = Path(runtime_root) / "scan-runs" / str(run_id)
                log_dir.mkdir(parents=True, exist_ok=True)
                (log_dir / "output.log").write_text(result.redacted_output or "", encoding="utf-8")
                (log_dir / "stderr.log").write_text(result.stderr or "", encoding="utf-8")

                # DB only stores tail
                run.output_redacted = (
                    result.redacted_output[-10000:] if result.redacted_output else ""
                )
                run.total_cost_usd = result.total_cost_usd
                run.duration_ms = result.duration_ms
                run.duration_api_ms = result.duration_api_ms
                run.num_turns = result.num_turns
                run.session_id = result.session_id
                run.conversation_events = result.conversation_events
                session.add(run)

                # -- 7. Log stdout/stderr (fallback) --------------------------------
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
                        session.add(log_entry)

                # -- 8. Write audit log ---------------------------------------------
                audit = AuditLog(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    actor_id=user_id,
                    action="agent.scan_dispatch",
                    resource_type="agent_run",
                    resource_id=run.id,
                    details_json=json.dumps(
                        {
                            "workspace_id": str(workspace_id),
                            "agent_type": "claude_code",
                            "exit_code": result.exit_code,
                        }
                    ),
                )
                session.add(audit)

                await session.commit()

                # -- 9. Success finalize: activate workspace + reparse children -----
                # run completed/failed state is already committed above; the steps
                # below are enhancements that must never flip a successful run to
                # failed.
                if result.exit_code == 0:
                    # 9a. Promote the bootstrapping workspace from pending -> active.
                    # Without this the row stays pending and list_() filters it out,
                    # so /workspaces never shows the just-generated project.
                    try:
                        from app.modules.workspace.model import Workspace

                        ws = await session.get(Workspace, workspace_id)
                        if ws is not None and ws.status == "pending":
                            ws.status = "active"
                            ws.last_scanned_at = datetime.utcnow()
                            ws.updated_at = datetime.utcnow()
                            session.add(ws)
                            await session.commit()
                            log.info(
                                "scan_run_workspace_activated",
                                run_id=str(run_id),
                                workspace_id=str(workspace_id),
                            )
                    except Exception as exc:
                        log.warning(
                            "scan_run_workspace_activate_failed",
                            run_id=str(run_id),
                            workspace_id=str(workspace_id),
                            error=str(exc),
                        )

                    # 9b. Auto-reparse child workspaces.
                    try:
                        from app.modules.workspace.service import WorkspaceService

                        svc = WorkspaceService(session)
                        # reparse commits internally; do NOT commit again here.
                        _parse_result, stats, _children, _relations = await svc.reparse(
                            workspace_id
                        )
                        log.info(
                            "scan_run_reparse_done",
                            run_id=str(run_id),
                            workspace_id=str(workspace_id),
                            created=stats.get("created"),
                            relations_created=stats.get("relations_created"),
                        )
                    except Exception as exc:
                        log.warning(
                            "scan_run_reparse_failed",
                            run_id=str(run_id),
                            workspace_id=str(workspace_id),
                            error=str(exc),
                        )
                        # do not change run.status / exit_code, do not re-raise

            except Exception as exc:
                # -- Guard: mark failed on unhandled exception ----------------------
                log.error(
                    "scan_run_exception",
                    run_id=str(run_id),
                    error=str(exc),
                )
                try:
                    run = await session.get(AgentRun, run_id)
                    if run is not None and run.status not in ("completed", "failed", "killed"):
                        run.status = "failed"
                        run.finished_at = datetime.utcnow()
                        run.exit_code = -1
                        run.output_redacted = f"Unhandled exception: {exc}"[:10000]
                        session.add(run)
                        await session.commit()
                except Exception:
                    log.error(
                        "scan_run_exception_cleanup_failed",
                        run_id=str(run_id),
                    )
            finally:
                # Safety net: ensure run is never stuck in "running"
                try:
                    run = await session.get(AgentRun, run_id)
                    if run is not None and run.status == "running":
                        run.status = "failed"
                        run.finished_at = datetime.utcnow()
                        run.exit_code = -1
                        run.output_redacted = "Force-failed: task lifecycle guard"[:10000]
                        session.add(run)
                        await session.commit()
                except Exception:
                    log.error(
                        "scan_run_finally_guard_failed",
                        run_id=str(run_id),
                    )

    async def _get_workspace_root(self, workspace_id: uuid.UUID) -> str:
        """Get the root_path of a workspace."""
        from app.modules.workspace.model import Workspace

        ws_stmt = select(Workspace).where(col(Workspace.id) == workspace_id)
        workspace = (await self._session.execute(ws_stmt)).scalars().first()
        if workspace is None:
            raise AgentRunError(
                f"Workspace '{workspace_id}' not found.",
                details={"workspace_id": str(workspace_id)},
            )
        return workspace.root_path


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
