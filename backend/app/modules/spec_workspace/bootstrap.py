"""SpecBootstrapService -- creates an AgentRun for spec workspace bootstrap.

The bootstrap launch phase creates an AgentRun record, writes a start audit
event, links the run to the workspace via AgentRunWorkspace, and returns
immediately.  The actual execution (ClaudeCodeAdapter + SillySpec CLI +
validation) is handled by ``_execute_bootstrap_agent_run`` which runs as a
background task with its own DB session.

author: qinyi
created_at: 2026-05-27
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import SpecWorkspaceNotFound
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.base import AgentSpecBundle
from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.spec_profile.model import SpecConflict
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.spec_workspace.validator import SpecValidator
from app.modules.workflow.model import AuditLog
from app.modules.workspace.model import AgentRunWorkspace, Workspace
from app.modules.workspace.service import WorkspaceService

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
    """Run ClaudeCodeAdapter in the background and finalize bootstrap state.

    Uses an independent DB session created via ``get_session_factory()``
    because the caller's request-level session may be closed by the time
    this background coroutine runs.

    Control flow:
        1. Open independent session, load AgentRun / SpecWorkspace / Workspace.
        2. Mark run as running.
        3. Build AgentSpecBundle and runtime directory.
        4. Execute via ClaudeCodeAdapter.
        5. Run SpecValidator on spec_root.
        6. Update AgentRun + SpecWorkspace + SpecConflict + AuditLog.
    """
    from app.core.db import get_session_factory
    from app.modules.agent.adapters.claude_code import ClaudeCodeAdapter

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
                run.finished_at = datetime.utcnow()
                run.exit_code = 1
                run.output_redacted = "SpecWorkspace not found for the given workspace."
                session.add(run)
                await session.commit()
                return

            workspace = await session.get(Workspace, workspace_id)
            if workspace is None:
                run.status = "failed"
                run.finished_at = datetime.utcnow()
                run.exit_code = 1
                run.output_redacted = "Workspace not found."
                session.add(run)
                await session.commit()
                return

            # -- 2. Mark running ---------------------------------------------------
            run.status = "running"
            run.started_at = datetime.utcnow()
            session.add(run)
            await session.commit()

            start_ts = datetime.utcnow().isoformat()
            start_message = (
                "[BOOTSTRAP] Agent run started. Connecting ClaudeCodeAdapter "
                "for sillyspec init and scan."
            )
            await _write_run_log(
                session,
                run_id=run_id,
                channel="stdout",
                content=start_message,
            )
            await _publish_log_event(run_id, "stdout", start_message, start_ts)

            # -- 3. Preflight checks ------------------------------------------------
            code_root_path = Path(code_root)
            preflight_error = _run_preflight(code_root_path)
            if preflight_error:
                run.status = "failed"
                run.finished_at = datetime.utcnow()
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

            # -- 4. Build runtime directory + bundle --------------------------------
            spec_root_path = Path(spec_root)
            spec_root_path.mkdir(parents=True, exist_ok=True)

            runtime_dir = spec_root_path / ".runtime" / "bootstrap" / str(run_id)
            runtime_dir.mkdir(parents=True, exist_ok=True)

            bundle = _build_bootstrap_bundle(
                workspace_id=workspace_id,
                workspace=workspace,
                spec_ws=spec_ws,
                spec_root=spec_root_path,
                code_root=code_root_path,
                run_id=run_id,
            )

            # -- 5. Execute via adapter (with real-time log writing) ---------------
            # lease_path = code_root so Claude CWD is the source directory
            adapter = ClaudeCodeAdapter()

            async def _on_log(channel: str, content: str, ts: str) -> None:
                try:
                    async with factory() as log_session:
                        log_session.add(
                            AgentRunLog(
                                id=uuid.uuid4(),
                                run_id=run_id,
                                timestamp=_parse_log_timestamp(ts),
                                channel=channel,
                                content_redacted=content[:4000],
                            )
                        )
                        await log_session.commit()
                except Exception as exc:
                    log.warning(
                        "bootstrap_on_log_failed",
                        run_id=str(run_id),
                        channel=channel,
                        error=str(exc),
                    )

            async def _on_metadata(meta: dict) -> None:
                try:
                    async with factory() as meta_session:
                        meta_run = await meta_session.get(AgentRun, run_id)
                        if meta_run is not None:
                            _apply_run_metadata(meta_run, meta)
                            meta_session.add(meta_run)
                            await meta_session.commit()
                except Exception as exc:
                    log.warning(
                        "bootstrap_on_metadata_failed",
                        run_id=str(run_id),
                        error=str(exc),
                    )

            result = await adapter.run_with_bundle(
                run_id=run_id,
                bundle=bundle,
                lease_path=code_root_path,
                timeout=600,
                on_log=_on_log,
                on_metadata=_on_metadata,
            )

            # -- 6. Platform-side post-scan validation ------------------------------
            from app.modules.agent.post_scan_validator import PostScanValidator

            runtime_dir = spec_root_path / "runtime"
            validator = PostScanValidator(
                source_root=code_root_path,
                spec_root=spec_root_path,
                runtime_root=runtime_dir,
                scan_run_id=str(run_id),
            )
            post_result = validator.validate(
                agent_output=result.redacted_output or "",
                agent_exit_code=result.exit_code or 0,
            )

            # -- 7. SpecValidator for spec structure ---------------------------------
            report = SpecValidator().validate(spec_root)
            validation_passed = result.exit_code == 0 and report.passed

            # -- 7. Write stderr AgentRunLog (chunked) ------------------------------
            if result.stderr.strip():
                await _write_run_log(
                    session,
                    run_id=run_id,
                    channel="stderr",
                    content=result.stderr,
                )

            # -- 8. Update AgentRun + SpecWorkspace ---------------------------------
            now = datetime.utcnow()
            exit_code = result.exit_code

            if validation_passed:
                run.status = "completed"
                run.exit_code = exit_code
                run.output_redacted = result.redacted_output[:10000]
                run.finished_at = now
                run.total_cost_usd = result.total_cost_usd
                run.duration_ms = result.duration_ms
                run.duration_api_ms = result.duration_api_ms
                run.num_turns = result.num_turns
                run.session_id = result.session_id
                run.conversation_events = result.conversation_events
                run.input_tokens = result.input_tokens
                run.output_tokens = result.output_tokens

                spec_ws.sync_status = "clean"
                spec_ws.last_synced_at = now
                spec_ws.updated_at = now
            else:
                run.status = "failed"
                run.exit_code = exit_code
                run.output_redacted = result.redacted_output[:10000]
                run.finished_at = now
                run.total_cost_usd = result.total_cost_usd
                run.duration_ms = result.duration_ms
                run.duration_api_ms = result.duration_api_ms
                run.num_turns = result.num_turns
                run.session_id = result.session_id
                run.conversation_events = result.conversation_events
                run.input_tokens = result.input_tokens
                run.output_tokens = result.output_tokens

                spec_ws.sync_status = "dirty"
                spec_ws.updated_at = now

                # Create SpecConflict for adapter non-zero exit
                if exit_code != 0:
                    session.add(
                        SpecConflict(
                            id=uuid.uuid4(),
                            workspace_id=workspace_id,
                            stage="bootstrap",
                            conflict_type="command",
                            details_json=json.dumps(
                                {
                                    "exit_code": exit_code,
                                    "stderr_preview": result.stderr[:500],
                                }
                            ),
                        )
                    )

                # Create SpecConflict for each validation error
                for issue in report.errors:
                    session.add(
                        SpecConflict(
                            id=uuid.uuid4(),
                            workspace_id=workspace_id,
                            stage="bootstrap",
                            conflict_type=issue.category,
                            details_json=json.dumps(
                                {
                                    "path": issue.path,
                                    "message": issue.message,
                                    "category": issue.category,
                                }
                            ),
                        )
                    )

                # Create SpecConflict for post-scan validation errors
                for perr in post_result.errors:
                    # Map validation error codes to specific conflict types
                    conflict_type_map = {
                        "source_root_pollution": "source_root_pollution",
                        "expected_docs_missing": "missing_spec_artifact",
                        "docs_empty": "missing_spec_artifact",
                        "scan_dir_missing": "missing_spec_artifact",
                        "missing_spec_artifacts": "missing_spec_artifact",
                        "error_pattern_detected": "agent_log_error",
                        "source_commit_failed": "metadata_error",
                        "manifest_missing": "manifest_error",
                    }
                    conflict_type = conflict_type_map.get(perr.code, "post_scan_validation_error")

                    session.add(
                        SpecConflict(
                            id=uuid.uuid4(),
                            workspace_id=workspace_id,
                            stage="bootstrap",
                            conflict_type=conflict_type,
                            details_json=json.dumps(
                                {
                                    "code": perr.code,
                                    "message": perr.message,
                                    "severity": perr.severity,
                                    "details": perr.details,
                                }
                            ),
                        )
                    )

            run.post_scan_status = post_result.status.value
            run.source_commit = post_result.metadata.get("source_commit")
            session.add(run)
            session.add(spec_ws)

            # -- 9. Write complete audit log ----------------------------------------
            error_count = len(report.errors) + len(post_result.errors)
            warning_count = len(report.warnings) + len(post_result.warnings)
            audit_details = {
                "validation_passed": validation_passed,
                "post_scan_status": post_result.status.value,
                "error_count": error_count,
                "warning_count": warning_count,
                "sync_status": spec_ws.sync_status,
                "exit_code": exit_code,
                "spec_root": str(spec_root),
                "source_commit": post_result.metadata.get("source_commit"),
                "source_commit_error": post_result.metadata.get("source_commit_error"),
                "post_scan_errors": [
                    {"code": e.code, "message": e.message} for e in post_result.errors
                ],
            }
            session.add(
                AuditLog(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    actor_id=user_id,
                    action="spec_bootstrap.complete",
                    resource_type="agent_run",
                    resource_id=run.id,
                    details_json=json.dumps(audit_details),
                )
            )

            await session.commit()

            # -- 9b. Success post-processing: activate + reparse children ------
            # Mirror the pattern from _execute_scan_run in agent/service.py.
            if validation_passed:
                # 9b-1. Promote workspace from pending -> active
                try:
                    ws = await session.get(Workspace, workspace_id)
                    if ws is not None and ws.status == "pending":
                        ws.status = "active"
                        ws.last_scanned_at = datetime.utcnow()
                        ws.updated_at = datetime.utcnow()
                        session.add(ws)
                        await session.commit()
                        log.info(
                            "bootstrap_workspace_activated",
                            run_id=str(run_id),
                            workspace_id=str(workspace_id),
                        )
                except Exception as exc:
                    log.warning(
                        "bootstrap_workspace_activate_failed",
                        run_id=str(run_id),
                        workspace_id=str(workspace_id),
                        error=str(exc),
                    )

                # 9b-2. Auto-reparse child workspaces from generated specs
                try:
                    svc = WorkspaceService(session)
                    _parse_result, stats, _children, _relations = await svc.reparse(workspace_id)
                    log.info(
                        "bootstrap_reparse_done",
                        run_id=str(run_id),
                        workspace_id=str(workspace_id),
                        created=stats.get("created"),
                        relations_created=stats.get("relations_created"),
                    )
                except Exception as exc:
                    log.warning(
                        "bootstrap_reparse_failed",
                        run_id=str(run_id),
                        workspace_id=str(workspace_id),
                        error=str(exc),
                    )

            await _publish_done_event(run_id, run.status, run.exit_code)

            log.info(
                "spec_bootstrap.complete",
                run_id=str(run_id),
                workspace_id=str(workspace_id),
                validation_passed=validation_passed,
                exit_code=exit_code,
                sync_status=spec_ws.sync_status,
            )

        except Exception as exc:
            # Outer guard: ensure run never stays in 'running' on unhandled exception
            log.exception(
                "spec_bootstrap_exception",
                run_id=str(run_id),
                workspace_id=str(workspace_id),
                error=str(exc),
            )
            try:
                # Re-read run in case it was modified before the exception
                run = await session.get(AgentRun, run_id)
                if run is not None and run.status not in ("completed", "failed", "killed"):
                    run.status = "failed"
                    run.finished_at = datetime.utcnow()
                    run.exit_code = 1
                    run.output_redacted = f"Unhandled exception: {exc}"[:10000]
                    session.add(run)

                    # Write stderr log for SSE replay
                    await _write_run_log(
                        session,
                        run_id=run_id,
                        channel="stderr",
                        content=f"Unhandled exception: {exc}",
                    )

                    # Write complete audit even on exception
                    session.add(
                        AuditLog(
                            id=uuid.uuid4(),
                            workspace_id=workspace_id,
                            actor_id=user_id,
                            action="spec_bootstrap.complete",
                            resource_type="agent_run",
                            resource_id=run_id,
                            details_json=json.dumps(
                                {
                                    "validation_passed": False,
                                    "error_count": -1,
                                    "warning_count": 0,
                                    "sync_status": "dirty",
                                    "exit_code": 1,
                                    "spec_root": spec_root,
                                    "exception": str(exc)[:500],
                                }
                            ),
                        )
                    )

                    # Update SpecWorkspace to dirty if possible
                    spec_ws = await _load_spec_workspace(session, workspace_id)
                    if spec_ws is not None:
                        spec_ws.sync_status = "dirty"
                        spec_ws.updated_at = datetime.utcnow()
                        session.add(spec_ws)

                    await session.commit()

                    await _publish_done_event(run_id, "failed", 1)
            except Exception as inner_exc:
                log.error(
                    "spec_bootstrap_exception_cleanup_failed",
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
    return None


def _build_bootstrap_bundle(
    *,
    workspace_id: uuid.UUID,
    workspace: Workspace,
    spec_ws: SpecWorkspace,
    spec_root: Path,
    code_root: Path,
    run_id: uuid.UUID,
) -> AgentSpecBundle:
    """Return the exact bootstrap AgentSpecBundle consumed by ClaudeCodeAdapter.

    The bundle instructs Claude to:
    - Run ``sillyspec init --dir <code_root>``
    - Run ``sillyspec run scan --dir <code_root> --spec-root <spec_root> ...``
    - NOT wait for real stdin interaction; use conservative defaults instead.
    """
    runtime_root = str(spec_root / "runtime")
    ws_id = str(workspace_id)
    run_id_str = str(run_id)

    init_cmd = f"sillyspec init --dir {code_root}"
    scan_start_cmd = (
        f"sillyspec run scan"
        f" --dir {code_root}"
        f" --spec-root {spec_root}"
        f" --runtime-root {runtime_root}"
        f" --workspace-id {ws_id}"
        f" --scan-run-id {run_id_str}"
    )
    scan_done_cmd = (
        f"sillyspec run scan --done --change default --dir {code_root}"
        f' --input "步骤描述" --output "步骤摘要"'
    )
    step_prompt = (
        f"你是一个项目分析 agent。请对项目目录 {code_root} 执行 sillyspec scan。\n\n"
        f"## ⚠️ 命令模板（严格复制，不要省略任何参数）\n\n"
        f"**第 1 步 — 初始化（仅一次）：**\n"
        f"```\n{init_cmd}\n```\n\n"
        f"**第 2 步 — 启动 scan（仅一次，必须包含全部平台参数）：**\n"
        f"```\n{scan_start_cmd}\n```\n\n"
        f"**第 3-N 步 — 逐步推进（每次完成后执行）：**\n"
        f"```\n{scan_done_cmd}\n"
        f"```\n\n"
        f"## 执行流程\n"
        f"1. 执行 init 命令（--dir 指向源码目录 {code_root}）\n"
        f"2. 执行 scan 启动命令（包含全部平台参数，文档输出到 {spec_root}）\n"
        f"3. CLI 输出 step prompt → 执行扫描操作 → 用 done 命令推进\n"
        f"4. 重复 step 3 直到 10/10 步全部完成\n\n"
        f"## 规则\n"
        f"- --dir 必须指向源码目录 {code_root}（不是 spec_root）\n"
        f"- 对 {code_root} 目录中的源码只读，不要修改项目文件\n"
        f"- .sillyspec/ 目录会在源码目录下创建（由 --dir 决定）\n"
        f"- 文档生成在 {spec_root}/.sillyspec/docs/ 目录下\n"
        f"- 启动 scan 命令必须包含 --spec-root/--runtime-root/--workspace-id/--scan-run-id\n"
        f"- done 命令不需要重复平台参数\n"
        f"- 每个步骤必须用 done 完成，不要跳过\n"
        f"- Do NOT wait for real stdin interaction; use conservative defaults.\n"
    )

    return AgentSpecBundle(
        change_summary="Spec workspace bootstrap",
        task_key="stage:scan",
        task_title="Stage dispatch: scan",
        allowed_paths=[str(spec_root), str(code_root)],
        denied_paths=[],
        available_tools=["sillyspec"],
        spec_strategy=spec_ws.strategy,
        profile_version=spec_ws.profile_version,
        platform_metadata={
            "bootstrap": True,
            "workspace_id": ws_id,
            "spec_root": str(spec_root),
            "code_root": str(code_root),
            "root_path": str(code_root),
            "runtime_root": runtime_root,
            "scan_run_id": run_id_str,
            "mode": "scan",
        },
        stage_dispatch=True,
        change_key=None,
        stage="scan",
        spec_root=str(spec_root),
        runtime_root=runtime_root,
        step_prompt=step_prompt,
        read_only=True,
    )


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
                    timestamp=datetime.utcnow(),
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
        return datetime.utcnow()


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
