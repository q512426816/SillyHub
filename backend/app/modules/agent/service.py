"""Agent service — orchestrates agent runs."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.db import get_session_factory
from app.core.errors import (
    AgentRunNotFound,
    AgentRunNotRunning,
    AppError,
    TaskNotFound,
    WorktreeLeaseNotFound,
)
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.context_builder import build_spec_bundle
from app.modules.agent.coordinator import ExecutionCoordinatorService
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService
from app.modules.agent.schema import AgentRunResponse, ToolFailureStats
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
    "cache_read_tokens",  # task-06: batch meta cache read (prompt cache 命中读取词元)
    "cache_creation_tokens",  # task-06: batch meta cache creation (prompt cache 写入词元)
)


def _apply_run_metadata(run: AgentRun, meta: dict) -> None:
    for field_name in _METADATA_FIELDS:
        value = meta.get(field_name)
        if value is not None:
            setattr(run, field_name, value)


# ---------------------------------------------------------------------------
# task-09 / FR-08b / D-008 / R-GLM: tool failure rate monitoring
# ---------------------------------------------------------------------------
#
# Session-level aggregation of tool_result(is_error) for observability (R-GLM).
# Pure functions + module-level config so they are unit-testable without a DB.
#
# **Data model note (task-09 §4.4 vs reality)**: the blueprint's example uses
# AgentRunLog.entry_type == 'tool_result' / l.payload.is_error, but the actual
# persisted schema is flat (channel + content_redacted). The daemon serializes
# tool_result events as content_redacted "[TOOL_RESULT] <preview>" on channel
# "stdout" (batch) or "tool_call"; is_error is embedded in the preview text
# (e.g. "permission error", "Error:") rather than a structured field. We
# therefore infer tool_result entries by the "[TOOL_RESULT]" prefix and failure
# by a conservative error-marker heuristic on the content. This keeps the
# monitor robust without requiring schema migrations or daemon changes (both
# out of scope for task-09).
#
# Constraints (task-09 §4.4 监控约束):
#   - non-blocking / no alert channel: only structlog WARNING, never changes
#     session status / never switches provider;
#   - provider-agnostic: glm + anthropic both counted (D-008 normalized);
#   - sample floor: tool_total < MIN_TOOL_FAILURE_SAMPLE → no warn;
#   - threshold configurable via env GLM_TOOL_FAILURE_RATE_THRESHOLD (default 0.5).


def _failure_threshold() -> float:
    """Read threshold from env GLM_TOOL_FAILURE_RATE_THRESHOLD (default 0.5).

    Returns 0.5 on parse error / out-of-range values (defensive, never raises).
    """
    raw = os.getenv("GLM_TOOL_FAILURE_RATE_THRESHOLD", "0.5")
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return 0.5
    # Clamp to (0, 1]; nonsensical values fall back to default.
    if 0.0 < val <= 1.0:
        return val
    return 0.5


# spike D2 实测 GLM Write 3/3 失败；样本下限 4 避免小样本抖动误告警。
MIN_TOOL_FAILURE_SAMPLE = 4

# Content error-marker heuristic (case-insensitive substring). Conservative:
# matches daemon's tool_result preview text for real failures (permission error,
# command errors). Does NOT match "ok"/"written"/"success" content.
_TOOL_FAILURE_MARKERS = (
    "permission error",
    "permission denied",
    "permissionerror",
    "error:",
    "failed:",
    "exception:",
    "traceback",
    "errno",
    "command not found",
    "no such file",
    "is_error",
)


def _is_tool_result_log(entry: AgentRunLog) -> bool:
    """True if the log entry represents a tool_result event.

    tool_result entries are serialized as "[TOOL_RESULT] <preview>" on channel
    "stdout" (batch) or "tool_call". The "[TOOL_RESULT]" prefix is the stable
    marker across both daemon paths.
    """
    content = entry.content_redacted or ""
    return "[TOOL_RESULT]" in content


def _is_tool_failure_content(entry: AgentRunLog) -> bool:
    """True if a tool_result log entry's content indicates a tool failure."""
    content = (entry.content_redacted or "").lower()
    return any(marker in content for marker in _TOOL_FAILURE_MARKERS)


def aggregate_tool_failure(logs: list[AgentRunLog]) -> ToolFailureStats:
    """Aggregate tool_result failure stats from a session's logs (task-09 §4.4).

    Args:
        logs: AgentRunLog entries for the session (any channel).

    Returns:
        ToolFailureStats with tool_total / tool_failed / failure_rate.
        tool_total counts only tool_result entries; non-tool logs (assistant
        text, system, turn-level result) are ignored. failure_rate is 0.0 when
        tool_total == 0 (zero-division safe).
    """
    tool_results = [log for log in logs if _is_tool_result_log(log)]
    total = len(tool_results)
    failed = sum(1 for log in tool_results if _is_tool_failure_content(log))
    rate = (failed / total) if total else 0.0
    return ToolFailureStats(
        tool_total=total,
        tool_failed=failed,
        failure_rate=rate,
    )


def should_warn_tool_failure(stats: ToolFailureStats, *, threshold: float) -> bool:
    """Predicate: emit a structured warn for this session's tool failure rate.

    Fires only when tool_total >= MIN_TOOL_FAILURE_SAMPLE AND failure_rate >=
    threshold. Provider-agnostic (D-008). Does not mutate session state.
    """
    if stats.tool_total < MIN_TOOL_FAILURE_SAMPLE:
        return False
    return stats.failure_rate >= threshold


async def monitor_session_tool_failures(
    *,
    agent_session_id: uuid.UUID,
    logs: list[AgentRunLog],
    provider: str | None,
) -> ToolFailureStats:
    """Aggregate a session's tool failure rate and emit a structured warn if exceeded.

    Non-blocking observability hook (R-GLM / D-008). Called by the session-log
    aggregation path (e.g. stream_session_logs on terminal session events) with
    the persisted AgentRunLog list. Emits at most one structlog WARNING per
    call when the threshold is exceeded; never raises, never changes session
    status, never switches provider.

    Args:
        agent_session_id: AgentSession.id (for log extra).
        logs: persisted AgentRunLog entries for the session.
        provider: AgentSession.provider (glm / anthropic / ...) — logged for
            attribution; does NOT branch behavior (D-008 normalized_requirement).

    Returns:
        The computed ToolFailureStats (callers / tests can inspect without
        re-running aggregation).
    """
    threshold = _failure_threshold()
    stats = aggregate_tool_failure(logs)
    if should_warn_tool_failure(stats, threshold=threshold):
        # Stdlib logger (not structlog) so the warning propagates through the
        # stdlib logging tree and is capturable by pytest's caplog / log
        # aggregators attached to the root logger. Structured fields ride on
        # LogRecord.extra (via logging.Logger.warning extra=...) for downstream
        # consumers. This satisfies task-09 §4.4 "only logger.warning structured
        # log, non-blocking, no alert channel".
        logging.getLogger(__name__).warning(
            "glm_tool_failure_rate_exceeded",
            extra={
                "event": "glm_tool_failure_rate_exceeded",
                "session_id": str(agent_session_id),
                "provider": provider,
                "tool_total": stats.tool_total,
                "tool_failed": stats.tool_failed,
                "failure_rate": stats.failure_rate,
                "threshold": threshold,
                "min_sample": MIN_TOOL_FAILURE_SAMPLE,
            },
        )
    return stats


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
    path_source: str | None = None,
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
        path_source: workspace 路径来源（Workspace.path_source）。'daemon-client'
            表示 root_path 在绑定 daemon 宿主上、backend 容器不可达，跳过本地
            stat 校验（由 daemon 自行校验）；其他值（None/'server-local'）保留校验。

    Returns:
        确定的工作目录 Path。

    Raises:
        AgentRunError: workspace_root 路径不存在时（仅 server-local）。
    """
    ws_root = Path(workspace_root)
    # daemon-client: root_path 在绑定 daemon 宿主上，backend 容器内不可达，
    # 本地 stat 恒失败；真正访问由 daemon 完成，跳过校验（修复 change dispatch
    # 在容器内 stat 宿主路径恒失败导致 stage_dispatch_failed 静默 200）。
    if path_source != "daemon-client" and not ws_root.exists():
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
        provider: str | None = None,
        model: str | None = None,
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

        from app.modules.workspace.model import Workspace

        workspace = await self._session.get(Workspace, workspace_id)
        resolved_provider = provider or (workspace.default_agent if workspace else None)
        resolved_model = model or (workspace.default_model if workspace else None)

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
            provider=resolved_provider,
            model=resolved_model,
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
        repo_url = workspace.repo_url if workspace else None
        branch = workspace.default_branch if workspace else None
        lease_id_daemon = await placement.dispatch_to_daemon(
            run.id,
            user_id,
            workspace_id=workspace_id,
            repo_url=repo_url,
            branch=branch,
            provider=resolved_provider,
            model=resolved_model,
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
        ``cancelled``.  Dual-path semantics (ql-20260616-006):

        - **Claimed lease**（daemon 在跑）：AgentRun.status 不在此处变更，等 daemon
          心跳检测到 cancelled 后通过 ``sync_agent_run_status`` 上报 killed
          （single-driver state mapping, AC-09）。
        - **Pending lease**（daemon 从未 claim）或 **无 active lease**：
          ``cancel_lease`` 直接把 AgentRun.status 置为 ``killed``（带 finished_at），
          否则会永久 pending。这是 daemon-side 检测不会触发的兜底路径。

        When no active lease exists and AgentRun is already terminal, kill is idempotent.

        Args:
            run_id: UUID of the AgentRun to cancel.

        Returns:
            The AgentRun record (current status after cancel_lease runs).

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
    # User input submission (ql-20260617-005)
    # ------------------------------------------------------------------

    async def submit_run_input(
        self,
        *,
        workspace_id: uuid.UUID,
        run_id: uuid.UUID,
        content: str,
    ) -> AgentRunLog:
        """Record user guidance input for an AgentRun and push via SSE.

        Validates the run belongs to the workspace and is in an active
        status, persists a ``AgentRunLog(channel="user_input")``, then
        publishes the event to the ``agent_run:{run_id}`` Redis Pub/Sub
        channel so connected SSE clients receive it in real-time.

        Args:
            workspace_id: Workspace that must be associated with the run.
            run_id: The AgentRun to attach the input to.
            content: User guidance text (will be redacted before storage).

        Raises:
            AgentRunError: Content is blank or exceeds length limit.
            AgentRunNotFound: Run does not exist or is not linked to workspace.
            AgentRunNotRunning: Run is in a terminal status.
        """
        stripped = content.strip()
        if not stripped:
            raise AgentRunError(
                "Input content must not be empty.",
                details={"run_id": str(run_id)},
            )
        if len(stripped) > MAX_USER_INPUT_CHARS:
            raise AgentRunError(
                f"Input content exceeds {MAX_USER_INPUT_CHARS} characters.",
                details={"run_id": str(run_id), "length": len(stripped)},
            )

        arw_stmt = select(AgentRunWorkspace).where(
            col(AgentRunWorkspace.agent_run_id) == run_id,
            col(AgentRunWorkspace.workspace_id) == workspace_id,
        )
        arw = (await self._session.execute(arw_stmt)).scalars().first()
        if arw is None:
            raise AgentRunNotFound(
                f"Run '{run_id}' not found.",
                details={"run_id": str(run_id)},
            )

        run = await self._session.get(AgentRun, run_id)
        if run is None:
            raise AgentRunNotFound(
                f"Run '{run_id}' not found.",
                details={"run_id": str(run_id)},
            )
        if run.status not in ("pending", "running"):
            raise AgentRunNotRunning(
                f"Run '{run_id}' is not running (status={run.status}).",
                details={"run_id": str(run_id), "status": run.status},
            )

        redacted = redact_agent_output(stripped)
        log_entry = AgentRunLog(
            id=uuid.uuid4(),
            run_id=run.id,
            channel=USER_INPUT_CHANNEL,
            content_redacted=redacted,
            timestamp=datetime.now(UTC),
        )
        self._session.add(log_entry)
        await self._session.commit()
        await self._session.refresh(log_entry)

        try:
            redis = get_redis()
            channel_name = f"agent_run:{run_id}"
            payload = {
                "log_id": str(log_entry.id),
                "channel": USER_INPUT_CHANNEL,
                "content": redacted,
                "timestamp": log_entry.timestamp.isoformat().replace("+00:00", "Z"),
            }
            await redis.publish(channel_name, json.dumps(payload))
        except Exception:
            log.warning(
                "submit_run_input_redis_publish_failed",
                run_id=str(run_id),
            )

        return log_entry

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

    async def get_run_logs(
        self,
        run_id: uuid.UUID,
        *,
        tool_kind: str | None = None,
    ) -> list[AgentRunLog]:
        stmt = (
            select(AgentRunLog)
            .where(col(AgentRunLog.run_id) == run_id)
            .order_by(col(AgentRunLog.timestamp))
        )
        # 2026-07-05-agent-log-type-tags task-05 / FR-07 / D-003@v1：
        # ?tool_kind= 逗号分隔多选，仅筛 channel=tool_call 行（走
        # ix_agent_run_logs_tool_kind 索引）；不传返回全部（§9 兼容）。
        if tool_kind:
            kinds = [k.strip() for k in tool_kind.split(",") if k.strip()]
            if kinds:
                stmt = stmt.where(
                    col(AgentRunLog.channel) == "tool_call",
                    col(AgentRunLog.tool_kind).in_(kinds),
                )
        return list((await self._session.execute(stmt)).scalars().all())

    async def list_workspace_active_sessions(
        self,
        workspace_id: uuid.UUID,
        *,
        mode: str | None = None,
    ) -> list[AgentSession]:
        """scan 真阻塞（改造点 E）：workspace 维度的 active AgentSession 列表。

        join AgentSession → AgentRun → AgentRunWorkspace 过滤 workspace；status 限 active
        系列（pending/active/running/reconnecting）；可选按 ``config['mode']`` 过滤
        （scan）。供前端 approvals 审批中心页聚合 scan 歧义决策（订阅各 session SSE）。
        """
        stmt = (
            select(AgentSession)
            .join(AgentRun, AgentRun.agent_session_id == AgentSession.id)
            .join(AgentRunWorkspace, AgentRunWorkspace.agent_run_id == AgentRun.id)
            .where(
                AgentRunWorkspace.workspace_id == workspace_id,
                AgentSession.status.in_(["pending", "active", "running", "reconnecting"]),
            )
        )
        sessions = list((await self._session.execute(stmt)).scalars().all())
        if mode:
            sessions = [s for s in sessions if (s.config or {}).get("mode") == mode]
        return sessions

    # ------------------------------------------------------------------
    # SSE streaming
    # ------------------------------------------------------------------

    async def stream_run_logs(
        self,
        run_id: uuid.UUID,
    ) -> AsyncGenerator[str, None]:
        """Yield SSE formatted events from Redis Pub/Sub for a given run.

        Subscribes to the ``agent_run:{run_id}`` channel (run-scoped logs and
        the ``done`` signal) and, for interactive runs that carry an
        ``agent_session_id``, also to the ``agent_session:{session_id}``
        channel so ``permission_request`` / ``permission_resolved`` events
        (published by ``DaemonPermissionService._publish_session_event``) and
        other session-level events (``turn_completed`` / ``session_closed``)
        reach the frontend's AskUserQuestion approval card. Batch runs have no
        session and skip the second subscription.  Emits ``data``
        events for each message, a ``done`` event when the agent signals
        completion, and ``: keepalive`` comments every ~30 seconds of
        silence to prevent connection timeouts.

        DB access uses a short-lived session from ``get_session_factory()``
        (opened only for the initial status re-check and the final ``done``
        status lookup) so the connection-pool slot is released immediately
        instead of being held for the lifetime of this long-lived SSE
        connection.
        """
        redis = get_redis()
        pubsub = redis.pubsub()
        channel = f"agent_run:{run_id}"
        # Session channel is subscribed separately once we know the run's
        # ``agent_session_id`` (interactive runs only; batch runs have None).
        session_channel: str | None = None
        try:
            # Flush proxy buffers immediately with an initial comment.
            yield ": connected\n\n"

            await pubsub.subscribe(channel)

            # Race-condition guard: if the agent finished while the client
            # was connecting, the router's status check may have seen
            # "running" but the "done" event was already published (and
            # missed by pub/sub).  Re-check the DB status in a short-lived
            # session so no pool slot is held for the duration of this SSE
            # connection.
            async with get_session_factory()() as db:
                run = await db.get(AgentRun, run_id)
            if run is not None and run.status not in ("pending", "running"):
                done_data = json.dumps({"status": run.status, "exit_code": run.exit_code})
                yield f"event: done\ndata: {done_data}\n\n"
                return

            # Subscribe to the session channel so permission_request /
            # permission_resolved events (published by DaemonPermissionService
            # via ``_publish_session_event`` on ``agent_session:{id}``) reach
            # the frontend's AskUserQuestion approval card, alongside any
            # turn_completed / session_closed events. Batch runs have no
            # agent_session_id and are skipped. redis-py pubsub multiplexes
            # multiple subscribed channels onto one ``get_message`` stream.
            if run is not None and run.agent_session_id is not None:
                session_channel = f"agent_session:{run.agent_session_id}"
                await pubsub.subscribe(session_channel)

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
                        if status_val is None or exit_code_val is None:
                            async with get_session_factory()() as db:
                                run = await db.get(AgentRun, run_id)
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
            if session_channel is not None:
                await pubsub.unsubscribe(session_channel)
            await pubsub.unsubscribe(channel)
            await pubsub.close()

    async def stream_session_logs(
        self,
        agent_session_id: uuid.UUID,
    ) -> AsyncGenerator[str, None]:
        """Yield SSE events aggregating all AgentRuns of an AgentSession.

        Subscribes to the ``agent_session:{session_id}`` Redis Pub/Sub channel
        so a single client connection survives across multiple turns (run_id
        changes). Emits ``data`` events for each structured log message, a
        ``done`` event when the session reaches a terminal status, and
        ``: keepalive`` comments every ~30 seconds of silence (D-005@v1, FR-03,
        R-08).

        Unlike ``stream_run_logs`` (run-scoped), this generator aggregates the
        session-level channel and surfaces ``run_id`` on each event so the
        frontend can delineate turn boundaries. ``session_ended`` (published by
        ``DaemonService._publish_session_event`` in task-05) closes the
        connection; a single turn completing does NOT.
        """
        redis = get_redis()
        pubsub = redis.pubsub()
        channel = f"agent_session:{agent_session_id}"
        try:
            # Flush proxy buffers immediately with an initial comment.
            yield ": connected\n\n"

            await pubsub.subscribe(channel)

            # Race-condition guard: if the session ended while the client was
            # connecting, task-05's end_session may have already published
            # ``session_ended`` (missed by pub/sub). Re-check DB status in a
            # short-lived session (no pool slot held for the SSE lifetime).
            async with get_session_factory()() as db:
                ag = await db.get(AgentSession, agent_session_id)
            if ag is not None and ag.status in ("ended", "failed"):
                done_data = json.dumps({"status": ag.status, "reason": "session_terminated"})
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
                    if payload.get("event") == "session_ended":
                        done_data = json.dumps(
                            {
                                "status": payload.get("status", "ended"),
                                "reason": payload.get("reason"),
                            }
                        )
                        yield f"event: done\ndata: {done_data}\n\n"
                        break
                    # Transparent passthrough: structured log / turn_completed
                    # events already carry run_id (task-05 / task-06 publish).
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
        provider: str | None = None,
        model: str | None = None,
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

        workspace_root, path_source = await self._get_workspace_root(workspace_id)

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
            path_source=path_source,
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
        # 平台托管工作区：为 stage 命令注入平台参数（--spec-root 等），使
        # propose/plan/execute/... 进入平台模式、文档产物写 spec_root（对齐 scan
        # bundle 的 build_scan_bundle）。server-local 工作区 platform_args 为空，
        # stage 仍写本地 .sillyspec（行为不变）。
        platform_args = ""
        try:
            from app.modules.spec_workspace.service import SpecWorkspaceService

            spec_ws = await SpecWorkspaceService(self._session).get(workspace_id)
            if spec_ws and spec_ws.strategy == "platform-managed" and spec_ws.spec_root:
                # 方案 B（D-001@v1 调整）：prompt 用宿主路径（SPEC_DATA_HOST_DIR/{ws}），
                # daemon 零客户端配置。spec_ws.spec_root（容器路径）保留供 backend 内部访问。
                from app.core.config import get_settings
                from app.modules.agent.context_builder import resolve_prompt_spec_root
                from app.modules.workspace.model import Workspace

                settings = get_settings()
                # 方案 A（path_source per-workspace transport 决策）：按当前 workspace 的
                # path_source 决定塞入 stage prompt 的 --spec-root 路径。daemon-client→tar
                # （daemon 本地路径），显式 server-local→shared（锁死），None→全局兜底。
                # 与 build_scan_bundle（context_builder.build_scan_bundle）复用同一 helper，保证
                # scan 与 stage 链路路径一致（task-02）。
                # 注意：host_spec_root 仅用于 prompt 文本（daemon 机器跑 sillyspec 时访问的路径）；
                # spec_ws.spec_root（容器路径权威源）的读取不受影响，仅用于 platform-managed 策略
                # 判断。stage 经 dispatch_to_daemon → batch lease（§0）；tar 模式下 daemon
                # _startInteractiveSession pull + onSessionEnd sync 自动复用 Wave1（task-06），
                # 本处无需任何 daemon 改动（D-007）。
                # stage_ws 仅在此处读 path_source（identity map 缓存命中，下方 line ~1064 的
                # workspace 查询复用同一缓存，无额外 DB 开销）。
                stage_ws = await self._session.get(Workspace, workspace_id)
                stage_path_source = stage_ws.path_source if stage_ws else None
                host_spec_root = resolve_prompt_spec_root(
                    str(workspace_id), settings, path_source=stage_path_source
                )
                host_runtime_root = f"{host_spec_root}/runtime"
                platform_args = (
                    f" --spec-root {host_spec_root}"
                    f" --runtime-root {host_runtime_root}"
                    f" --workspace-id {workspace_id}"
                )
        except Exception as exc:
            log.warning(
                "stage_dispatch_platform_args_resolve_failed",
                workspace_id=str(workspace_id),
                stage=stage,
                error=str(exc),
            )

        prompt_context = {
            "change_title": change.title or "",
            "change_key": change.change_key,
            "current_stage": change.current_stage or "draft",
            "stage": stage,
            "change_type": change.change_type or "",
            "affected_components": ", ".join(change.affected_components),
            "workspace_id": str(workspace_id),
            "platform_args": platform_args,
        }
        prompt = load_prompt_template(prompt_template, prompt_context)
        if not prompt:
            raise AgentRunError(
                f"Prompt template '{prompt_template}' not found or empty.",
                details={"template": prompt_template},
            )

        from app.modules.workspace.model import Workspace

        workspace = await self._session.get(Workspace, workspace_id)
        resolved_provider = provider or (workspace.default_agent if workspace else None)
        resolved_model = model or (workspace.default_model if workspace else None)

        # -- 4. Create AgentRun record ----------------------------------------
        run = AgentRun(
            id=uuid.uuid4(),
            task_id=None,
            lease_id=lease.id if lease else None,
            change_id=change_id,
            agent_type="claude_code",
            provider=resolved_provider,
            model=resolved_model,
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
        repo_url = workspace.repo_url if workspace else None
        branch = workspace.default_branch if workspace else None
        lease_id_daemon = await placement.dispatch_to_daemon(
            run.id,
            user_id,
            workspace_id=workspace_id,
            prompt=prompt,
            stage=stage,
            read_only=read_only,
            repo_url=repo_url,
            branch=branch,
            provider=resolved_provider,
            model=resolved_model,
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
        provider: str | None = None,
        model: str | None = None,
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
        from app.modules.workspace.model import Workspace
        from app.modules.workspace.service import resolve_root_path_for_server

        workspace = await self._session.get(Workspace, workspace_id)
        path_source = workspace.path_source if workspace else "server-local"

        # 解析 spec 同步策略（2026-06-28-daemon-client-spec-sync-strategy，D-001）：
        # 从 spec_workspaces 读 strategy，回退 platform-managed。透传到 lease payload
        # 让 daemon pullSpecBundle 据此三分支初始化缓存（platform-managed/repo-mirrored/repo-native）。
        #
        # task-10（2026-07-02-workspace-config-flow，D-010）：同一 SpecWorkspace 行顺便读
        # latest_spec_version（服务器权威文档版本），供 daemon 保鲜比对（任务执行前比对本地
        # .sillyspec-platform.json.spec_version，旧了 pullSpecBundle）。值源 = SpecWorkspace
        # .spec_version（task-09 落字段）。向前兼容 getattr 默认 0（task-09 未合前）。
        # 实际透传到 daemon claim payload 由 build_claim_payload（daemon/lease/context.py）
        # 独立从 SpecWorkspace 读——本处解析供 dispatch 路径日志/未来 init dispatch 复用，
        # 不依赖 placement 签名（不在本任务 allowed_paths 内）。
        spec_strategy = "platform-managed"
        latest_spec_version = 0
        try:
            from app.modules.spec_workspace.service import SpecWorkspaceService

            _spec_ws = await SpecWorkspaceService(self._session).get(workspace_id)
            if _spec_ws and _spec_ws.strategy:
                spec_strategy = _spec_ws.strategy
            if _spec_ws is not None:
                latest_spec_version = int(getattr(_spec_ws, "spec_version", 0) or 0)
        except Exception:
            pass

        # -- 1. Validate root_path (server-local only; daemon-client on client FS) -
        server_root = resolve_root_path_for_server(root_path, path_source)
        if server_root is not None:
            work_dir = Path(server_root)
            if not work_dir.exists() or not work_dir.is_dir():
                raise AgentRunError(
                    f"root_path does not exist or is not a directory: {root_path}",
                    details={"root_path": root_path, "server_path": server_root},
                )
            # 1b. 资产保护：源码项目若自身已被 SillySpec 管理（.sillyspec/ 含
            # changes/ 或 sillyspec.db），禁止发起平台 scan —— sillyspec init 在
            # 平台模式下会整体删除源码目录的 .sillyspec/，导致资产丢失（见
            # sillyspec/src/init.js:111-117 的 rmSync）。仅 server-local 可检测；
            # daemon-client 工作空间需依赖 sillyspec init.js 侧的资产保护补丁。
            local_ss = work_dir / ".sillyspec"
            _has_assets = False
            _changes_dir = local_ss / "changes"
            if _changes_dir.is_dir():
                try:
                    _has_assets = any(_changes_dir.iterdir())
                except OSError:
                    _has_assets = True
            if not _has_assets and (local_ss / "sillyspec.db").exists():
                _has_assets = True
            if _has_assets:
                raise AgentRunError(
                    f"目标项目已是 SillySpec 管理的项目（{local_ss} 含 changes/ 或 "
                    f"sillyspec.db）。对其发起平台 scan 会触发 sillyspec init 整体删除"
                    f" .sillyspec/，导致资产丢失。请先备份/迁移 changes/ 与 "
                    f"sillyspec.db，或更换 root_path。",
                    details={"root_path": root_path, "sillyspec_dir": str(local_ss)},
                )

        # -- 2. Pre-generate run_id so we can pass it to the bundle builder ------
        run_id = uuid.uuid4()

        # scan 真阻塞（改造点 B）：scan 改走 interactive session（不再 batch），
        # 让 daemon SessionManager 注入 canUseTool——AskUserQuestion 真阻塞等人审。
        from datetime import UTC, datetime

        from app.modules.agent.model import AgentRunLog, AgentSession
        from app.modules.daemon.protocol import DAEMON_MSG_SESSION_INJECT
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        # -- 3. Build scan bundle（step_prompt 作为 interactive 首 turn 注入）----
        # daemon 经 execution-context fetch 重建完整 bundle（CLAUDE.md 等）；此处取
        # step_prompt 作为首 turn 内容（与 batch 时 agent 收到的 scan 指令一致）。
        bundle = await build_scan_bundle(
            session=self._session,
            workspace_id=workspace_id,
            spec_root=spec_root,
            root_path=root_path,
            run_id=run_id,
            # 方案 A：透传 workspace.path_source（line ~1273 已取），让 build_scan_bundle
            # 按 per-workspace 决策 transport（daemon-client→tar / server-local→shared）。
            path_source=path_source,
        )
        resolved_provider = provider or (workspace.default_agent if workspace else None)
        resolved_model = model or (workspace.default_model if workspace else None)
        # scan_provider 兜底 "claude"（不是 "claude_code"——那是 agent_type，daemon 实际
        # provider 是 claude/codex/...，详见 _query_runtime_by_daemon_and_provider）。
        # AgentSession.provider NOT NULL（model.py:418），不能传 None；workspace.default_agent
        # 为 NULL（daemon-client scan-generate 新建工作区不设该列）且请求未传 provider 时，
        # 走 "claude" 这个通行默认值，否则 dispatch 永远匹配不到 daemon 触发 NoOnlineDaemonError。
        scan_provider = resolved_provider or "claude"

        now = datetime.now(UTC)
        # -- 4. 建 AgentSession（manual_approval=True + ask_user_only=True）------
        # config 经 lease.metadata → daemon execPayload → SessionManager.create 决定注入
        # canUseTool；manual_approval=True 是 backend permission_service 放行 PERMISSION_REQUEST
        # 的硬门控（permission_service.py:163）。ask_user_only=True 让只 AskUserQuestion 阻塞。
        session = AgentSession(
            id=uuid.uuid4(),
            user_id=user_id,
            provider=scan_provider,
            status="pending",
            config={
                "manual_approval": True,
                "ask_user_only": True,
                "mode": "scan",
            },
            turn_count=0,
            created_at=now,
        )
        self._session.add(session)
        await self._session.flush()

        # -- 5. Create AgentRun record（关联 session）----------------------------
        run = AgentRun(
            id=run_id,
            task_id=None,
            change_id=None,
            lease_id=None,
            agent_type="claude_code",
            provider=resolved_provider,
            model=resolved_model,
            status="pending",
            spec_strategy=spec_strategy,
            agent_session_id=session.id,
        )
        self._session.add(run)

        # -- 6. Create M:N workspace association ----------------------------------
        self._session.add(
            AgentRunWorkspace(
                agent_run_id=run.id,
                workspace_id=workspace_id,
            )
        )

        # -- 7. Placement：scan interactive lease（改造点 A）---------------------
        placement = RunPlacementService(self._session)
        repo_url = workspace.repo_url if workspace else None
        branch = workspace.default_branch if workspace else None
        try:
            dispatch = await placement.prepare_scan_interactive_dispatch(
                agent_session_id=session.id,
                agent_run_id=run.id,
                user_id=user_id,
                provider=scan_provider,
                prompt=bundle.step_prompt,
                model=resolved_model,
                root_path=root_path,
                spec_root=spec_root,
                runtime_root=bundle.runtime_root,
                workspace_id=workspace_id,
                workspace_name=workspace.name if workspace else None,
                workspace_slug=getattr(workspace, "slug", None) if workspace else None,
                repo_url=repo_url,
                branch=branch,
                spec_strategy=spec_strategy,
            )
        except NoOnlineDaemonError as exc:
            # 不 rollback：prepare_scan_interactive_dispatch 抛 NoOnlineDaemonError 前无任何
            # DB 写操作（raise 在 placement.py:489，lease INSERT 在 :540 之后），事务里只有
            # 本函数上方 add+flush 的 AgentSession / AgentRun / AgentRunWorkspace。若 rollback
            # 会把 AgentSession 一起冲掉，随后 _mark_no_online_daemon 的 commit 插入 agent_runs
            # 时 agent_session_id 外键违约（agent_runs_agent_session_id_fkey）→ 500。
            # 正确做法：保留 session+run，仅把 run 标 failed 并整体提交（d16e13c7 引入的
            # rollback 即此 500 根因）。
            await self._mark_no_online_daemon(run, exc)
            return run

        # backfill triple binding + activate session（参照 create_session）。
        session.runtime_id = dispatch.runtime_id
        session.lease_id = dispatch.lease_id
        session.status = "active"
        session.turn_count = 1
        session.last_active_at = now
        # daemon_task_lease is bound via session.lease_id (FK→daemon_task_leases).
        # Do NOT assign it to run.lease_id — that column's FK points to
        # worktree_leases, so a daemon lease id here raises ForeignKeyViolation
        # on commit, failing dispatch and leaving the run stuck pending.
        # 首 turn 落 user_input log（让历史回看看到首 prompt，与 create_session 一致）。
        self._session.add(
            AgentRunLog(
                run_id=run.id,
                channel="user_input",
                content_redacted=(bundle.step_prompt or "")[:5000],
                timestamp=now,
            )
        )
        await self._session.commit()
        await self._session.refresh(run)

        log.info(
            "start_scan_dispatch_interactive_prepared",
            run_id=str(run.id),
            session_id=str(session.id),
            lease_id=str(dispatch.lease_id),
            # task-10：透出 latest_spec_version 到日志，便于排查 daemon 保鲜比对失灵
            # （版本未递增 / daemon 拉到旧值的诊断）。值源 SpecWorkspace.spec_version。
            latest_spec_version=latest_spec_version,
            spec_strategy=spec_strategy,
        )

        # -- 8. Wake daemon + SESSION_INJECT 首 turn（参照 create_session 收尾）---
        delivered = await placement.notify_interactive_dispatch(dispatch)
        if not delivered:
            await self._mark_no_online_daemon(
                run,
                NoOnlineDaemonError(workspace_id=workspace_id, user_id=user_id),
            )
            return run

        hub = get_daemon_ws_hub()
        await hub.send_session_control(
            dispatch.daemon_id,
            DAEMON_MSG_SESSION_INJECT,
            {
                "session_id": str(session.id),
                "lease_id": str(dispatch.lease_id),
                "run_id": str(run.id),
                "runtime_id": str(dispatch.runtime_id),
                "prompt": bundle.step_prompt,
                "claim_token": dispatch.claim_token,
            },
        )
        log.info(
            "start_scan_dispatch_interactive_injected",
            run_id=str(run.id),
            session_id=str(session.id),
        )
        return run

    async def start_init_dispatch(
        self,
        workspace_id: uuid.UUID,
        actor_user_id: uuid.UUID,
    ) -> dict:
        """Create an init-mode interactive lease for the given workspace and actor.

        This is the automated 'Initialize' flow (2026-07-02-workspace-config-flow
        D-002/D-009)::

          1. Ensure the spec workspace container exists (``ensure_spec_workspace``).
          2. Resolve the member binding for ``runtime_id`` + ``root_path``.
          3. Create an interactive lease with ``mode='init'`` and a payload
             containing ``platform_config{server_origin, strategy}`` and
             ``latest_spec_version``.
          4. Wake the target daemon so it picks up the lease.

        The daemon processes the lease by writing ``.sillyspec-platform.json``
        to the member's local project directory, pulling the spec bundle, and
        reporting completion (task-07).

        Args:
            workspace_id: Target workspace UUID.
            actor_user_id: The user who triggers initialization.

        Returns:
            dict with ``lease_id``, ``runtime_id``, ``claim_token``.

        Raises:
            AgentRunError: If the actor has no member binding or no daemon
                runtime configured.
        """
        import json
        import secrets
        from datetime import UTC, datetime

        from sqlalchemy import text

        from app.modules.daemon.ws_hub import get_daemon_ws_hub
        from app.modules.spec_workspace.service import SpecWorkspaceService
        from app.modules.workspace.member_runtimes.resolver import (
            MemberBindingResolver,
        )

        # -- 1. Ensure spec workspace container exists -------------------------
        spec_ws_svc = SpecWorkspaceService(self._session)
        spec_ws = await spec_ws_svc.ensure_spec_workspace(workspace_id)

        # -- 2. Resolve member binding for runtime_id + daemon_id + root_path ----
        binding = await MemberBindingResolver.resolve_member_binding(
            self._session,
            workspace_id,
            actor_user_id,
        )
        daemon_id = binding.daemon_id
        root_path = binding.root_path
        runtime_id = binding.runtime_id  # D-003: preserved for lease FK / metadata

        if daemon_id is None:
            raise AgentRunError(
                "Member has no daemon configured; cannot dispatch init lease.",
                details={
                    "workspace_id": str(workspace_id),
                    "user_id": str(actor_user_id),
                },
            )

        # daemon-entity-binding 后 binding.runtime_id 常为 None（runtime 退化从属、
        # binding 按 daemon_id）。但 daemon_task_leases.runtime_id FK→daemon_runtimes
        # 需要有效 id（否则 claim_lease line 188 写 daemon 传的 daemon_local_id 会
        # FK 违约——daemon_local_id 在 daemon_instances 不在 daemon_runtimes）。从
        # daemon_instance 的 runtimes 选一个（优先 claude，与 scan dispatch 一致）。
        if runtime_id is None:
            from sqlalchemy import select as _sa_select

            from app.modules.daemon.model import DaemonRuntime as _DaemonRuntime

            _rts = (
                (
                    await self._session.execute(
                        _sa_select(_DaemonRuntime).where(
                            _DaemonRuntime.daemon_instance_id == daemon_id
                        )
                    )
                )
                .scalars()
                .all()
            )
            for _preferred in ("claude", "codex", "cursor", "opencode", "openclaw"):
                _m = next((r for r in _rts if r.provider == _preferred), None)
                if _m is not None:
                    runtime_id = _m.id
                    break

        # -- 3. Build platform_config + latest_spec_version --------------------
        # server_origin tells the daemon where the platform backend lives.
        # Default matches the daemon's own default (``config.server_url``);
        # override via SERVER_ORIGIN env var for production deployments.
        server_origin = os.getenv("SERVER_ORIGIN", "http://localhost:8000")
        platform_config: dict[str, str] = {
            "server_origin": server_origin,
            "strategy": spec_ws.strategy,
        }
        latest_spec_version = int(getattr(spec_ws, "spec_version", 0) or 0)

        # -- 4. Create init-mode interactive lease (daemon_task_leases row) -----
        lease_id = uuid.uuid4()
        now = datetime.now(UTC)
        claim_token = secrets.token_hex(32)

        metadata: dict = {
            "mode": "init",
            "workspace_id": str(workspace_id),
            "actor_user_id": str(actor_user_id),
            "runtime_id": str(runtime_id),
            "root_path": root_path,
            "platform_config": platform_config,
            "latest_spec_version": latest_spec_version,
            "claim_token": claim_token,
        }

        # kind='batch'（不是 'interactive'）：daemon 端 init lease 分支在 task-runner
        # 的 batch runLease（mode='init' 探测 → _runInitLease → handleInitLease）。若用
        # kind='interactive'，daemon 的 interactive handler 会因 init lease 无
        # session_id/run_id/prompt 早返回（interactive_missing_fields），lease 永远 claimed。
        await self._session.execute(
            text(
                """
                INSERT INTO daemon_task_leases
                    (id, agent_run_id, runtime_id, status, kind,
                     lease_expires_at, metadata, created_at, updated_at)
                VALUES
                    (:id, NULL, :runtime_id, 'pending', 'batch',
                     NULL, :metadata, :now, :now)
                """
            ),
            {
                "id": lease_id.hex,
                # runtime_id 可能为 None（daemon-entity-binding 后 runtime 退化从属，
                # 新 binding 按 daemon_id 绑定，runtime_id 常为 NULL）—— lease.runtime_id
                # 列 nullable，传 None 写 NULL。之前直接 .hex 报 AttributeError 阻塞 init。
                "runtime_id": runtime_id.hex if runtime_id is not None else None,
                "metadata": json.dumps(metadata),
                "now": now,
            },
        )
        await self._session.commit()

        log.info(
            "start_init_dispatch_lease_created",
            workspace_id=str(workspace_id),
            user_id=str(actor_user_id),
            lease_id=str(lease_id),
            runtime_id=str(runtime_id),
            latest_spec_version=latest_spec_version,
            strategy=spec_ws.strategy,
        )

        # -- 5. Wake daemon ----------------------------------------------------
        hub = get_daemon_ws_hub()
        # routing by daemon_id (WS connection key, design §5.3); payload carries
        # runtime_id for provider session identification.
        wake_id = daemon_id if daemon_id is not None else runtime_id
        if hub.is_connected(wake_id):
            await hub.send_wakeup(
                wake_id,
                lease_id=lease_id,
                payload_runtime_id=runtime_id,
            )
            log.info(
                "start_init_dispatch_wakeup_sent",
                daemon_id=str(daemon_id) if daemon_id else None,
                runtime_id=str(runtime_id),
                lease_id=str(lease_id),
            )
        else:
            log.warning(
                "start_init_dispatch_daemon_offline",
                workspace_id=str(workspace_id),
                user_id=str(actor_user_id),
                lease_id=str(lease_id),
                runtime_id=str(runtime_id),
                daemon_id=str(daemon_id) if daemon_id else None,
                note="daemon will pick up the lease on next poll",
            )

        return {
            "lease_id": str(lease_id),
            "runtime_id": str(runtime_id),
            "claim_token": claim_token,
        }

    async def _get_workspace_root(self, workspace_id: uuid.UUID) -> tuple[str, str]:
        """Get (root_path, path_source) of a workspace.

        path_source 决定 root_path 可达性语义（见 Workspace.path_source）：
        'daemon-client' 时 root_path 在绑定 daemon 宿主上、backend 容器不可达，
        调用方据此跳过本地 stat（resolve_work_dir）。
        """
        from app.modules.workspace.model import Workspace

        ws_stmt = select(Workspace).where(col(Workspace.id) == workspace_id)
        workspace = (await self._session.execute(ws_stmt)).scalars().first()
        if workspace is None:
            raise AgentRunError(
                f"Workspace '{workspace_id}' not found.",
                details={"workspace_id": str(workspace_id)},
            )
        return workspace.root_path, workspace.path_source


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


# ql-20260617-005：恢复 user_input 通道，给前端 pending_input 指导框持久化路径。
# daemon 模式下 claude.cmd 用 --print（一次性 stdin），无法中途注入指导文本，
# 但至少 (1) 接受前端 POST 不报 404，(2) 把指导写到 AgentRunLog(channel=user_input)
# 让 SSE 推到日志面板，(3) 留作后续 daemon stream-json 输入模式的回放源。
USER_INPUT_CHANNEL = "user_input"
MAX_USER_INPUT_CHARS = 4000


async def submit_run_input(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    content: str,
) -> AgentRunLog:
    """Record user guidance input for an AgentRun and push via SSE.

    Module-level wrapper that delegates to ``AgentService.submit_run_input``
    so routers can call it as a plain function (matches the typical FastAPI
    dependency style where the session is the dep, not the service).

    Validates the run belongs to the workspace and is in an active
    status, persists a ``AgentRunLog(channel="user_input")``, then
    publishes the event to the ``agent_run:{run_id}`` Redis Pub/Sub
    channel so connected SSE clients receive it in real-time.

    Args:
        session: DB session.
        workspace_id: Workspace that must be associated with the run.
        run_id: The AgentRun to attach the input to.
        content: User guidance text (will be redacted before storage).

    Raises:
        AgentRunError: Content is blank or exceeds length limit.
        AgentRunNotFound: Run does not exist or is not linked to workspace.
        AgentRunNotRunning: Run is in a terminal status.
    """
    return await AgentService(session).submit_run_input(
        workspace_id=workspace_id,
        run_id=run_id,
        content=content,
    )
