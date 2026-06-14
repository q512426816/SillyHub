"""Agent service — orchestrates agent runs."""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import (
    AgentRunNotFound,
    AppError,
    TaskNotFound,
    WorktreeLeaseNotFound,
)
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.context_builder import build_spec_bundle
from app.modules.agent.coordinator import ExecutionCoordinatorService
from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService
from app.modules.agent.schema import AgentRunResponse
from app.modules.task.model import Task
from app.modules.workspace.model import AgentRunWorkspace, TaskWorkspace
from app.modules.worktree.model import WorktreeLease

log = get_logger(__name__)

_METADATA_FIELDS = (
    "total_cost_usd",
    "duration_ms",
    "duration_api_ms",
    "num_turns",
    "session_id",
    "input_tokens",
    "output_tokens",
)


def _apply_run_metadata(run: AgentRun, meta: dict) -> None:
    for field_name in _METADATA_FIELDS:
        value = meta.get(field_name)
        if value is not None:
            setattr(run, field_name, value)


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
        preferred_backend: str | None = None,
    ) -> AgentRun:
        """Create an AgentRun record and dispatch it to the daemon.

        The run record is created with status ``pending`` and returned
        immediately.  Execution is delegated to the user's daemon via
        ``RunPlacementService.dispatch_to_daemon`` (daemon-only since
        task-01 — the SERVER subprocess path has been removed).  If no
        online daemon is available the run is marked ``failed`` with
        ``error_code = no_online_daemon``.

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

        # -- 3. Normalize agent type ----------------------------------------------
        # daemon-only (task-01): no in-process adapter lookup; canonicalize the
        # agent_type string for storage (legacy "claude-code" → "claude_code").
        canonical = "claude_code" if agent_type in ("claude_code", "claude-code") else agent_type

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
            change_id=task.change_id,
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

        # -- 6. Placement decision (daemon-only) ----------------------------------
        # CLAUDE.md is no longer written server-side; the daemon fetches the
        # execution-context bundle and writes CLAUDE.md itself (task-05).
        placement = RunPlacementService(self._session)
        try:
            backend = await placement.decide_backend(
                workspace_id=workspace_id,
                user_id=user_id,
                change_id=task.change_id if task else None,
                task_id=task_id,
                preferred_backend=preferred_backend,
            )
        except NoOnlineDaemonError as exc:
            await self._mark_no_online_daemon(run, exc)
            return run

        log.info("start_run_placement", run_id=str(run.id), backend=backend.value)

        # daemon-only: decide_backend returns the daemon backend or raises.
        # task-03: 通用 bundle 字段（repo_url/branch）从 workspace 取并持久化到
        # lease.metadata，daemon 经 execution-context 重建 bundle。
        from app.modules.workspace.model import Workspace

        workspace = await self._session.get(Workspace, workspace_id)
        repo_url = workspace.repo_url if workspace else None
        branch = workspace.default_branch if workspace else None
        lease_id_daemon = await placement.dispatch_to_daemon(
            run.id,
            user_id,
            repo_url=repo_url,
            branch=branch,
        )
        if lease_id_daemon:
            log.info(
                "start_run_dispatched_to_daemon",
                run_id=str(run.id),
                daemon_lease_id=str(lease_id_daemon),
            )
            # Daemon will claim asynchronously; return run immediately.
            return run

        # Race: runtime went offline between decide_backend and dispatch.
        # No SERVER fallback exists (task-01); mark the run as failed.
        log.warning("start_run_dispatch_daemon_returned_none", run_id=str(run.id))
        await self._mark_no_online_daemon(
            run,
            NoOnlineDaemonError(workspace_id=workspace_id, user_id=user_id),
        )
        return run

    # ------------------------------------------------------------------
    # Daemon-only failure helper
    # ------------------------------------------------------------------

    async def _mark_no_online_daemon(self, run: AgentRun, exc: NoOnlineDaemonError) -> None:
        """Mark an AgentRun as failed because no online daemon is available.

        The SERVER execution path was removed in task-01; if dispatch cannot
        land on a daemon, the run is terminal-failed with ``error_code =
        no_online_daemon`` and a redacted user-facing message.
        """
        run.status = "failed"
        run.error_code = "no_online_daemon"
        run.output_redacted = exc.message
        run.finished_at = datetime.now(UTC)
        self._session.add(run)
        await self._session.commit()

    # ------------------------------------------------------------------
    # Kill mechanism
    # ------------------------------------------------------------------

    async def kill_run(self, run_id: uuid.UUID) -> AgentRun:
        """Cancel a running agent execution via the daemon lease layer (task-04).

        Daemon-only: ``kill_run`` delegates to
        ``DaemonLeaseService.cancel_lease`` to flip the active lease to
        ``cancelled``.  It does NOT directly mutate the AgentRun status
        (AC-09): the AgentRun status is driven asynchronously by the daemon
        via ``sync_agent_run_status`` once it observes the cancelled lease
        (single-driver state mapping).  When no active lease exists,
        ``cancel_lease`` logs a warning and returns, making kill_run idempotent.

        Args:
            run_id: UUID of the AgentRun to cancel.

        Returns:
            The AgentRun record (status unchanged; the daemon reports the
            terminal state).

        Raises:
            AgentRunNotFound: run_id does not exist in the database.
        """
        # -- 1. Load run record ---------------------------------------------------
        run = await self._session.get(AgentRun, run_id)
        if run is None:
            raise AgentRunNotFound(
                f"Run '{run_id}' not found.",
                details={"run_id": str(run_id)},
            )

        # -- 2. Delegate to daemon lease cancellation -----------------------------
        # Cancellation flips the active lease to "cancelled"; the AgentRun
        # status is NOT mutated here (single-driver state mapping, AC-09).
        from app.modules.daemon.lease_service import DaemonLeaseService

        await DaemonLeaseService(self._session).cancel_lease(run_id)

        log.info("run_kill_requested", run_id=str(run_id))
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

        # -- 5b. Placement decision (daemon-only) ------------------------------
        placement = RunPlacementService(self._session)
        try:
            backend = await placement.decide_backend(
                workspace_id=workspace_id,
                user_id=user_id,
                change_id=change_id,
            )
        except NoOnlineDaemonError as exc:
            await self._mark_no_online_daemon(run, exc)
            return run

        log.info(
            "start_stage_dispatch_placement",
            run_id=str(run.id),
            stage=stage,
            backend=backend.value,
        )

        # daemon-only: decide_backend returns the daemon backend or raises.
        # task-03 persists stage/read_only/prompt into lease.metadata so the
        # daemon can reconstruct the stage bundle via execution-context.
        from app.modules.workspace.model import Workspace

        workspace = await self._session.get(Workspace, workspace_id)
        repo_url = workspace.repo_url if workspace else None
        branch = workspace.default_branch if workspace else None
        lease_id_daemon = await placement.dispatch_to_daemon(
            run.id,
            user_id,
            prompt=prompt,
            stage=stage,
            read_only=read_only,
            repo_url=repo_url,
            branch=branch,
        )
        if lease_id_daemon:
            log.info(
                "start_stage_dispatch_dispatched_to_daemon",
                run_id=str(run.id),
                stage=stage,
                daemon_lease_id=str(lease_id_daemon),
            )
            return run

        # Race: runtime went offline between decide and dispatch.
        log.warning(
            "start_stage_dispatch_dispatch_daemon_returned_none",
            run_id=str(run.id),
            stage=stage,
        )
        await self._mark_no_online_daemon(
            run,
            NoOnlineDaemonError(workspace_id=workspace_id, user_id=user_id),
        )
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
        creates an ``AgentRun`` with ``change_id=None``, and dispatches it
        to the user's daemon for execution.

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

        # -- 3. Build scan bundle（daemon 经 execution-context 重建；此处保留调用仅消费
        #         build_scan_bundle 的 Workspace 存在性校验副作用，返回值不再本地使用）--
        await build_scan_bundle(
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

        # -- 4b. Placement decision (daemon-only) --------------------------------
        placement = RunPlacementService(self._session)
        try:
            backend = await placement.decide_backend(
                workspace_id=workspace_id,
                user_id=user_id,
            )
        except NoOnlineDaemonError as exc:
            await self._mark_no_online_daemon(run, exc)
            return run

        log.info(
            "start_scan_dispatch_placement",
            run_id=str(run.id),
            backend=backend.value,
        )

        # daemon-only: decide_backend returns the daemon backend or raises.
        # task-03 persists root_path/spec_root into lease.metadata so the daemon
        # can reconstruct the scan bundle via execution-context.
        from app.modules.workspace.model import Workspace

        workspace = await self._session.get(Workspace, workspace_id)
        repo_url = workspace.repo_url if workspace else None
        branch = workspace.default_branch if workspace else None
        lease_id_daemon = await placement.dispatch_to_daemon(
            run.id,
            user_id,
            root_path=root_path,
            spec_root=spec_root,
            repo_url=repo_url,
            branch=branch,
        )
        if lease_id_daemon:
            log.info(
                "start_scan_dispatch_dispatched_to_daemon",
                run_id=str(run.id),
                daemon_lease_id=str(lease_id_daemon),
            )
            return run

        # Race: runtime went offline between decide and dispatch.
        log.warning(
            "start_scan_dispatch_dispatch_daemon_returned_none",
            run_id=str(run.id),
        )
        await self._mark_no_online_daemon(
            run,
            NoOnlineDaemonError(workspace_id=workspace_id, user_id=user_id),
        )
        return run

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

    now = datetime.now(UTC)
    for run in stale_runs:
        # If metadata was already written (agent actually finished but commit
        # was lost during restart), restore as completed instead of failed.
        if (run.num_turns or 0) > 0 and run.exit_code is not None and run.exit_code >= 0:
            run.status = "completed" if run.exit_code == 0 else "failed"
            run.finished_at = run.finished_at or now
            log.info(
                "stale_run_restored_from_metadata",
                run_id=str(run.id),
                exit_code=run.exit_code,
            )
        else:
            run.status = "failed"
            run.finished_at = now
            run.exit_code = -1
            run.output_redacted = "Run interrupted: service restarted while agent was running."
            log.warning("stale_run_cleaned", run_id=str(run.id))
        session.add(run)

    await session.commit()
    return len(stale_runs)


def redact_agent_output(text: str) -> str:
    """Redact sensitive patterns from agent output."""
    from app.modules.git_gateway.service import redact_output

    return redact_output(text)
