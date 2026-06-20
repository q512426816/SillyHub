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

# Hold strong refs to fire-and-forget bootstrap tasks so asyncio doesn't GC
# them before they run. asyncio.create_task without a holder is weakly
# referenced and can be collected mid-flight — the task then silently never
# executes and the AgentRun stays pending forever.
_BACKGROUND_BOOTSTRAP_TASKS: set[asyncio.Task[None]] = set()

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

        # Bootstrap historically defaulted to Claude. Keep that fallback when
        # no workspace default is configured, but honor explicit workspace
        # provider/model settings for the run and daemon lease.
        resolved_provider = workspace.default_agent or "claude"
        resolved_model = workspace.default_model or None

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
                    {
                        "spec_root": str(spec_root),
                        "strategy": spec_ws.strategy,
                        "provider": resolved_provider,
                        "model": resolved_model,
                    }
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
            provider=resolved_provider,
            model=resolved_model,
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
            provider=resolved_provider,
            model=resolved_model,
        )

        # 6. Fire-and-forget background execution.
        # Hold a strong ref in _BACKGROUND_BOOTSTRAP_TASKS so asyncio doesn't
        # GC the task before it runs; discard on completion (avoids unbounded
        # growth). Without the holder the task can be collected silently → run
        # stuck pending.
        code_root = workspace.root_path
        task = asyncio.create_task(
            _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=workspace_id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(code_root),
            )
        )
        _BACKGROUND_BOOTSTRAP_TASKS.add(task)
        task.add_done_callback(_BACKGROUND_BOOTSTRAP_TASKS.discard)

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

            resolved_provider = run.provider or workspace.default_agent or "claude"
            resolved_model = run.model or workspace.default_model or None
            if run.provider != resolved_provider or run.model != resolved_model:
                run.provider = resolved_provider
                run.model = resolved_model
                session.add(run)
                await session.commit()

            # -- 2. Preflight (server-local only; daemon-client paths live on client) -
            preflight_error = preflight_workspace_code_root(
                code_root,
                path_source=workspace.path_source,
            )
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

            # scan 真阻塞（改造点 B 修正）：spec_bootstrap 也走 interactive session
            # （原来走 batch dispatch_to_daemon → agent 用 sillyspec --wait 直接 turn 终止、
            # 无审批入口）。改走 prepare_scan_interactive_dispatch（kind=interactive lease +
            # manual_approval/ask_user_only）让 daemon 注入 canUseTool——agent 调 AskUserQuestion
            # 时真阻塞，approvals 审批中心页出现卡片可答复。复用 build_scan_bundle 的 step_prompt
            # （含 AskUserQuestion 引导 + 绝对 spec_root 的正确命令模板，避免 agent 自构相对路径）。
            from app.modules.agent.context_builder import build_scan_bundle
            from app.modules.agent.model import AgentSession
            from app.modules.daemon.protocol import DAEMON_MSG_SESSION_INJECT
            from app.modules.daemon.ws_hub import get_daemon_ws_hub

            bundle = await build_scan_bundle(
                session=session,
                workspace_id=workspace_id,
                spec_root=spec_root,
                root_path=code_root,
                run_id=run.id,
            )
            scan_provider = resolved_provider or "claude_code"
            now = datetime.now(UTC)
            session_obj = AgentSession(
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
            session.add(session_obj)
            await session.flush()
            run.agent_session_id = session_obj.id
            session.add(run)

            try:
                dispatch = await placement.prepare_scan_interactive_dispatch(
                    agent_session_id=session_obj.id,
                    agent_run_id=run.id,
                    user_id=user_id,
                    provider=scan_provider,
                    prompt=bundle.step_prompt,
                    model=resolved_model,
                    root_path=code_root,
                    spec_root=spec_root,
                    runtime_root=str(Path(spec_root) / "runtime"),
                    workspace_id=workspace_id,
                    workspace_name=workspace.name,
                    workspace_slug=workspace.slug,
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

            # backfill triple binding + activate session（参照 create_session）。
            session_obj.runtime_id = dispatch.runtime_id
            session_obj.lease_id = dispatch.lease_id
            session_obj.status = "active"
            session_obj.turn_count = 1
            session_obj.last_active_at = now
            # daemon_task_lease is bound via session_obj.lease_id (FK→daemon_task_leases).
            # Do NOT assign it to run.lease_id — that column's FK→worktree_leases, so a
            # daemon lease id here raises ForeignKeyViolation on commit → dispatch fails
            # → run stuck pending. (Mirror of the service.py scan_interactive fix.)
            session.add(
                AgentRunLog(
                    run_id=run.id,
                    channel="user_input",
                    content_redacted=(bundle.step_prompt or "")[:5000],
                    timestamp=now,
                )
            )
            await session.commit()

            log.info(
                "spec_bootstrap_dispatched_interactive",
                run_id=str(run_id),
                workspace_id=str(workspace_id),
                session_id=str(session_obj.id),
                lease_id=str(dispatch.lease_id),
                provider=resolved_provider,
                model=resolved_model,
            )

            # notify daemon + SESSION_INJECT 首 turn（interactive 收尾）。
            delivered = await placement.notify_interactive_dispatch(dispatch)
            if delivered:
                hub = get_daemon_ws_hub()
                await hub.send_session_control(
                    dispatch.runtime_id,
                    DAEMON_MSG_SESSION_INJECT,
                    {
                        "session_id": str(session_obj.id),
                        "lease_id": str(dispatch.lease_id),
                        "run_id": str(run.id),
                        "prompt": bundle.step_prompt,
                        "claim_token": dispatch.claim_token,
                    },
                )
                log.info(
                    "spec_bootstrap_interactive_injected",
                    run_id=str(run_id),
                    session_id=str(session_obj.id),
                )
            else:
                # daemon 离线（notify 失败）：收敛 run failed。
                run.status = "failed"
                run.error_code = "no_online_daemon"
                run.output_redacted = "未检测到在线 daemon，请启动 sillyhub-daemon 后重试"
                run.finished_at = datetime.now(UTC)
                run.exit_code = 1
                session.add(run)
                await session.commit()
                await _publish_done_event(run_id, "failed", 1)

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


def preflight_workspace_code_root(
    code_root: str,
    *,
    path_source: str = "server-local",
) -> str | None:
    """Validate code_root on the backend host before bootstrap dispatch.

    daemon-client workspaces skip this check — ``code_root`` is only reachable
    from the bound daemon (FR-06 / D-003@v1). server-local paths are rewritten
    for Docker bind mounts (``HOST_PATH_PREFIX`` → ``CONTAINER_PATH_PREFIX``).
    """
    from app.modules.workspace.service import resolve_root_path_for_server

    server_path = resolve_root_path_for_server(code_root, path_source)
    if server_path is None:
        log.info(
            "spec_bootstrap_preflight_skipped",
            path_source=path_source,
            code_root=code_root,
        )
        return None
    return _run_preflight(Path(server_path))


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
