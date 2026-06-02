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
from app.modules.agent.base import AgentSpecBundle
from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.spec_profile.model import SpecConflict
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.spec_workspace.validator import SpecValidator
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

            # -- 3. Build runtime directory + bundle --------------------------------
            spec_root_path = Path(spec_root)
            code_root_path = Path(code_root)
            spec_root_path.mkdir(parents=True, exist_ok=True)

            runtime_dir = spec_root_path / ".runtime" / "bootstrap" / str(run_id)
            runtime_dir.mkdir(parents=True, exist_ok=True)

            bundle = _build_bootstrap_bundle(
                workspace_id=workspace_id,
                spec_ws=spec_ws,
                spec_root=spec_root_path,
                code_root=code_root_path,
            )

            # -- 4. Execute via adapter ---------------------------------------------
            adapter = ClaudeCodeAdapter()
            result = await adapter.run_with_bundle(
                run_id=run_id,
                bundle=bundle,
                lease_path=runtime_dir,
                timeout=600,
            )

            # -- 5. Run validation --------------------------------------------------
            report = SpecValidator().validate(spec_root)
            validation_passed = result.exit_code == 0 and report.passed

            # -- 6. Write stderr AgentRunLog (chunked) ------------------------------
            if result.stderr.strip():
                await _write_run_log(
                    session,
                    run_id=run_id,
                    channel="stderr",
                    content=result.stderr,
                )

            # -- 7. Update AgentRun + SpecWorkspace ---------------------------------
            now = datetime.utcnow()
            exit_code = result.exit_code

            if validation_passed:
                run.status = "completed"
                run.exit_code = exit_code
                run.output_redacted = result.redacted_output[:10000]
                run.finished_at = now

                spec_ws.sync_status = "clean"
                spec_ws.last_synced_at = now
                spec_ws.updated_at = now
            else:
                run.status = "failed"
                run.exit_code = exit_code
                run.output_redacted = result.redacted_output[:10000]
                run.finished_at = now

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

            session.add(run)
            session.add(spec_ws)

            # -- 8. Write complete audit log ----------------------------------------
            error_count = len(report.errors)
            warning_count = len(report.warnings)
            audit_details = {
                "validation_passed": validation_passed,
                "error_count": error_count,
                "warning_count": warning_count,
                "sync_status": spec_ws.sync_status,
                "exit_code": exit_code,
                "spec_root": str(spec_root),
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
            except Exception as inner_exc:
                log.error(
                    "spec_bootstrap_exception_cleanup_failed",
                    run_id=str(run_id),
                    error=str(inner_exc),
                )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_bootstrap_bundle(
    *,
    workspace_id: uuid.UUID,
    spec_ws: SpecWorkspace,
    spec_root: Path,
    code_root: Path,
) -> AgentSpecBundle:
    """Return the exact bootstrap AgentSpecBundle consumed by ClaudeCodeAdapter.

    The bundle instructs Claude to:
    - Run ``sillyspec init --dir <spec_root>``
    - Run ``sillyspec run scan --dir <spec_root>``
    - NOT wait for real stdin interaction; use conservative defaults instead.
    """
    task_markdown = (
        "# Bootstrap Spec Workspace\n\n"
        "## Goal\n"
        "Initialize the platform-managed spec root directory for this workspace.\n\n"
        "## Steps\n"
        "1. Run `sillyspec init --dir <spec_root>` to create the initial "
        ".sillyspec directory structure.\n"
        "2. Run `sillyspec run scan --dir <spec_root>` to scan the codebase "
        "and generate architecture documentation.\n\n"
        "## Important Rules\n"
        "- Do NOT wait for real stdin interaction. If you encounter a prompt "
        "that requires user confirmation, write a log entry describing the "
        "blocking point and continue using conservative default values.\n"
        "- If you cannot continue at all, exit with a non-zero code.\n"
        "- The spec root directory is where .sillyspec/ structure should be created.\n"
        f"- spec_root: {spec_root}\n"
        f"- code_root: {code_root}\n"
    )

    return AgentSpecBundle(
        change_summary="Spec workspace bootstrap",
        task_key="spec-bootstrap",
        task_title="Bootstrap spec workspace",
        task_markdown=task_markdown,
        allowed_paths=[str(spec_root), str(code_root)],
        available_tools=["sillyspec"],
        spec_strategy=spec_ws.strategy,
        profile_version=spec_ws.profile_version,
        platform_metadata={
            "bootstrap": True,
            "workspace_id": str(workspace_id),
            "spec_root": str(spec_root),
            "code_root": str(code_root),
        },
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
