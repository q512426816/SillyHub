"""Tests for SpecBootstrapService and _execute_bootstrap_agent_run.

Covers:
- bootstrap() launch phase: creates AgentRun, AgentRunWorkspace, start audit,
  returns pending contract immediately without waiting for background execution.
- _execute_bootstrap_agent_run(): runs ClaudeCodeAdapter, SpecValidator, and
  persists final state (AgentRun status, SpecWorkspace sync_status, SpecConflict,
  AuditLog, AgentRunLog).

author: qinyi
created_at: 2026-05-28
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import SpecWorkspaceNotFound
from app.modules.agent.base import AgentRunResult, AgentSpecBundle
from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.spec_profile.model import SpecConflict
from app.modules.spec_workspace.bootstrap import (
    SpecBootstrapService,
    _execute_bootstrap_agent_run,
)
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.spec_workspace.validator import ValidationIssue, ValidationReport
from app.modules.workflow.model import AuditLog
from app.modules.workspace.model import AgentRunWorkspace, Workspace

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_workspace(session: AsyncSession, **overrides) -> Workspace:
    defaults = dict(
        id=uuid.uuid4(),
        name="Test Workspace",
        slug="test-ws",
        root_path="/tmp/test-ws",
        status="active",
    )
    defaults.update(overrides)
    ws = Workspace(**defaults)
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_spec_workspace(
    session: AsyncSession,
    workspace: Workspace,
    spec_root: str,
    **overrides,
) -> SpecWorkspace:
    defaults = dict(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        spec_root=spec_root,
        strategy="platform-managed",
        sync_status="dirty",
    )
    defaults.update(overrides)
    spec_ws = SpecWorkspace(**defaults)
    session.add(spec_ws)
    await session.commit()
    await session.refresh(spec_ws)
    return spec_ws


async def _create_pending_run(
    session: AsyncSession,
    workspace: Workspace,
    spec_ws: SpecWorkspace,
) -> AgentRun:
    """Create a pending AgentRun + AgentRunWorkspace, mimicking bootstrap()."""
    run = AgentRun(
        id=uuid.uuid4(),
        task_id=None,
        lease_id=None,
        agent_type="claude_code",
        status="pending",
        spec_strategy=spec_ws.strategy,
        profile_version=spec_ws.profile_version,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)

    session.add(
        AgentRunWorkspace(
            agent_run_id=run.id,
            workspace_id=workspace.id,
        )
    )
    await session.commit()
    return run


def _fake_agent_result(
    *,
    exit_code: int = 0,
    stdout: str = "done",
    stderr: str = "",
    redacted_output: str = "done",
    timed_out: bool = False,
) -> AgentRunResult:
    """Return a concrete AgentRunResult for testing."""
    return AgentRunResult(
        exit_code=exit_code,
        stdout=stdout,
        stderr=stderr,
        redacted_output=redacted_output,
        timed_out=timed_out,
    )


def _fake_validation_report(
    *,
    passed: bool = True,
    errors: list[ValidationIssue] | None = None,
    warnings: list[ValidationIssue] | None = None,
) -> ValidationReport:
    """Return a concrete ValidationReport for testing."""
    all_issues = (errors or []) + (warnings or [])
    return ValidationReport(passed=passed, issues=all_issues)


def _write_minimal_valid_spec(spec_root: Path) -> None:
    """Write the minimum files needed for SpecValidator to pass."""
    silly_dir = spec_root / ".sillyspec" / "projects"
    silly_dir.mkdir(parents=True, exist_ok=True)
    (silly_dir / "app.yaml").write_text("name: test-app\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------


async def _get_run(session: AsyncSession, run_id: uuid.UUID) -> AgentRun | None:
    return await session.get(AgentRun, run_id)


async def _get_spec_ws(session: AsyncSession, workspace_id: uuid.UUID) -> SpecWorkspace | None:
    stmt = select(SpecWorkspace).where(
        SpecWorkspace.workspace_id == workspace_id,
    )
    return (await session.execute(stmt)).scalars().first()


async def _get_conflicts(session: AsyncSession, workspace_id: uuid.UUID) -> list[SpecConflict]:
    stmt = select(SpecConflict).where(
        SpecConflict.workspace_id == workspace_id,
    )
    return list((await session.execute(stmt)).scalars().all())


async def _get_run_logs(session: AsyncSession, run_id: uuid.UUID) -> list[AgentRunLog]:
    stmt = select(AgentRunLog).where(AgentRunLog.run_id == run_id)
    return list((await session.execute(stmt)).scalars().all())


async def _get_audit_logs(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    action: str,
) -> list[AuditLog]:
    stmt = select(AuditLog).where(
        AuditLog.workspace_id == workspace_id,
        AuditLog.action == action,
    )
    return list((await session.execute(stmt)).scalars().all())


# ===========================================================================
# Bootstrap launch-phase tests
# ===========================================================================


class TestBootstrapReturnsPendingRunStartContract:
    """bootstrap() returns the correct pending run start response."""

    async def test_returns_required_fields(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        assert "agent_run_id" in result
        assert "stream_url" in result
        assert "status" in result
        assert "spec_root" in result
        assert "message" in result

    async def test_status_is_pending(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        assert result["status"] == "pending"

    async def test_stream_url_format(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        expected_prefix = f"/api/workspaces/{ws.id}/agent/runs/"
        assert result["stream_url"].startswith(expected_prefix)
        assert str(result["agent_run_id"]) in result["stream_url"]

    async def test_message_is_bootstrap_started(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        assert result["message"] == "Bootstrap agent run started."

    async def test_spec_root_matches_workspace(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        assert result["spec_root"] == str(spec_root)

    async def test_no_legacy_sync_fields(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        for legacy_field in (
            "stdout",
            "stderr",
            "command",
            "agent_exit_code",
            "validation_passed",
            "errors",
            "warnings",
            "sync_status",
        ):
            assert legacy_field not in result, (
                f"Legacy field '{legacy_field}' should not be in bootstrap response"
            )


class TestBootstrapCreatesClaudeCodeAgentRun:
    """bootstrap() creates AgentRun with correct agent_type and status."""

    async def test_agent_type_is_claude_code(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        run = await db_session.get(AgentRun, result["agent_run_id"])
        assert run is not None
        assert run.agent_type == "claude_code"

    async def test_status_is_pending_in_db(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        run = await db_session.get(AgentRun, result["agent_run_id"])
        assert run is not None
        assert run.status == "pending"

    async def test_task_id_is_none(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        run = await db_session.get(AgentRun, result["agent_run_id"])
        assert run.task_id is None

    async def test_lease_id_is_none(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        run = await db_session.get(AgentRun, result["agent_run_id"])
        assert run.lease_id is None

    async def test_started_at_is_none(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        run = await db_session.get(AgentRun, result["agent_run_id"])
        assert run.started_at is None

    async def test_finished_at_is_none(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        run = await db_session.get(AgentRun, result["agent_run_id"])
        assert run.finished_at is None

    async def test_exit_code_is_none(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        run = await db_session.get(AgentRun, result["agent_run_id"])
        assert run.exit_code is None

    async def test_spec_strategy_from_spec_workspace(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        run = await db_session.get(AgentRun, result["agent_run_id"])
        assert run.spec_strategy == spec_ws.strategy

    async def test_profile_version_from_spec_workspace(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        run = await db_session.get(AgentRun, result["agent_run_id"])
        assert run.profile_version == spec_ws.profile_version


class TestBootstrapCreatesAgentRunWorkspaceLink:
    """bootstrap() creates AgentRunWorkspace association."""

    async def test_link_exists(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        stmt = select(AgentRunWorkspace).where(
            AgentRunWorkspace.agent_run_id == result["agent_run_id"],
            AgentRunWorkspace.workspace_id == ws.id,
        )
        link = (await db_session.execute(stmt)).scalars().first()
        assert link is not None
        assert link.agent_run_id == result["agent_run_id"]
        assert link.workspace_id == ws.id


class TestBootstrapWritesStartAuditOnly:
    """bootstrap() writes spec_bootstrap.start audit log."""

    async def test_start_audit_exists(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        user_id = uuid.uuid4()
        svc = SpecBootstrapService(db_session)
        await svc.bootstrap(ws.id, user_id=user_id)

        stmt = select(AuditLog).where(
            AuditLog.workspace_id == ws.id,
            AuditLog.action == "spec_bootstrap.start",
        )
        audit = (await db_session.execute(stmt)).scalars().first()
        assert audit is not None
        assert audit.resource_type == "spec_workspace"
        assert audit.resource_id == ws.id
        assert audit.actor_id == user_id

    async def test_complete_audit_not_written(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        stmt = select(AuditLog).where(
            AuditLog.action == "spec_bootstrap.complete",
        )
        audit = (await db_session.execute(stmt)).scalars().first()
        assert audit is None

    async def test_start_audit_contains_spec_root(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        stmt = select(AuditLog).where(
            AuditLog.action == "spec_bootstrap.start",
        )
        audit = (await db_session.execute(stmt)).scalars().first()
        assert audit is not None
        details = json.loads(audit.details_json) if audit.details_json else {}
        assert "spec_root" in details
        assert "strategy" in details


class TestBootstrapDoesNotCallAdapterOrValidator:
    """bootstrap() must not synchronously call adapter or validator.

    The launch phase only creates records and fires a background task.
    """

    async def test_no_adapter_call_during_bootstrap(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        with patch(
            "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
            new_callable=AsyncMock,
        ) as mock_adapter:
            svc = SpecBootstrapService(db_session)
            await svc.bootstrap(ws.id, user_id=uuid.uuid4())

            mock_adapter.assert_not_called()

    async def test_no_validator_call_during_bootstrap(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        with patch(
            "app.modules.spec_workspace.validator.SpecValidator.validate",
        ) as mock_validate:
            svc = SpecBootstrapService(db_session)
            await svc.bootstrap(ws.id, user_id=uuid.uuid4())

            mock_validate.assert_not_called()

    async def test_no_subprocess_exec(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        with patch(
            "asyncio.create_subprocess_exec",
            new_callable=AsyncMock,
        ) as mock_subprocess:
            svc = SpecBootstrapService(db_session)
            await svc.bootstrap(ws.id, user_id=uuid.uuid4())

            mock_subprocess.assert_not_called()


class TestBootstrapCreatesDirectory:
    """bootstrap() creates spec_root directory on disk."""

    async def test_directory_created(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecBootstrapService(db_session)
        await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        assert spec_root.exists()
        assert spec_root.is_dir()


class TestBootstrapWorkspaceNotFound:
    """bootstrap() raises SpecWorkspaceNotFound when workspace_id is missing."""

    async def test_raises_not_found(self, db_session: AsyncSession) -> None:
        svc = SpecBootstrapService(db_session)

        with pytest.raises(SpecWorkspaceNotFound):
            await svc.bootstrap(uuid.uuid4(), user_id=uuid.uuid4())

    async def test_no_orphan_agent_run_on_missing_workspace(self, db_session: AsyncSession) -> None:
        random_id = uuid.uuid4()
        svc = SpecBootstrapService(db_session)

        with pytest.raises(SpecWorkspaceNotFound):
            await svc.bootstrap(random_id, user_id=uuid.uuid4())

        stmt = select(AgentRun)
        runs = (await db_session.execute(stmt)).scalars().all()
        assert len(runs) == 0


# ===========================================================================
# Background execution tests — _execute_bootstrap_agent_run
# ===========================================================================


class TestBackgroundExecutionAdapterBundle:
    """_execute_bootstrap_agent_run passes the correct AgentSpecBundle."""

    async def test_bundle_contains_bootstrap_task_key(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)

        captured_bundle: AgentSpecBundle | None = None

        async def _capture_bundle(*, run_id, bundle, lease_path, timeout=600, on_log=None):
            nonlocal captured_bundle
            captured_bundle = bundle
            return _fake_agent_result()

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                side_effect=_capture_bundle,
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=uuid.uuid4(),
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        assert captured_bundle is not None
        assert captured_bundle.task_key == "spec-bootstrap"

    async def test_bundle_contains_bootstrap_task_title(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)

        captured_bundle: AgentSpecBundle | None = None

        async def _capture_bundle(*, run_id, bundle, lease_path, timeout=600, on_log=None):
            nonlocal captured_bundle
            captured_bundle = bundle
            return _fake_agent_result()

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                side_effect=_capture_bundle,
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=uuid.uuid4(),
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        assert captured_bundle is not None
        assert captured_bundle.task_title == "Bootstrap spec workspace"

    async def test_bundle_contains_sillyspec_tool(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)

        captured_bundle: AgentSpecBundle | None = None

        async def _capture_bundle(*, run_id, bundle, lease_path, timeout=600, on_log=None):
            nonlocal captured_bundle
            captured_bundle = bundle
            return _fake_agent_result()

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                side_effect=_capture_bundle,
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=uuid.uuid4(),
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        assert captured_bundle is not None
        assert "sillyspec" in captured_bundle.available_tools

    async def test_bundle_allowed_paths_cover_spec_and_code_root(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)

        captured_bundle: AgentSpecBundle | None = None

        async def _capture_bundle(*, run_id, bundle, lease_path, timeout=600, on_log=None):
            nonlocal captured_bundle
            captured_bundle = bundle
            return _fake_agent_result()

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                side_effect=_capture_bundle,
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=uuid.uuid4(),
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        assert captured_bundle is not None
        assert str(spec_root) in captured_bundle.allowed_paths
        assert str(tmp_path / "code") in captured_bundle.allowed_paths

    async def test_bundle_metadata_bootstrap_true(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)

        captured_bundle: AgentSpecBundle | None = None

        async def _capture_bundle(*, run_id, bundle, lease_path, timeout=600, on_log=None):
            nonlocal captured_bundle
            captured_bundle = bundle
            return _fake_agent_result()

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                side_effect=_capture_bundle,
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=uuid.uuid4(),
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        assert captured_bundle is not None
        assert captured_bundle.platform_metadata.get("bootstrap") is True

    async def test_bundle_metadata_workspace_id(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)

        captured_bundle: AgentSpecBundle | None = None

        async def _capture_bundle(*, run_id, bundle, lease_path, timeout=600, on_log=None):
            nonlocal captured_bundle
            captured_bundle = bundle
            return _fake_agent_result()

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                side_effect=_capture_bundle,
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=uuid.uuid4(),
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        assert captured_bundle is not None
        assert captured_bundle.platform_metadata.get("workspace_id") == str(ws.id)

    async def test_bundle_task_markdown_contains_init_and_scan(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)

        captured_bundle: AgentSpecBundle | None = None

        async def _capture_bundle(*, run_id, bundle, lease_path, timeout=600, on_log=None):
            nonlocal captured_bundle
            captured_bundle = bundle
            return _fake_agent_result()

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                side_effect=_capture_bundle,
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=uuid.uuid4(),
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        assert captured_bundle is not None
        md = captured_bundle.task_markdown or ""
        assert "sillyspec init --dir" in md
        assert "sillyspec run scan --dir" in md


class TestBackgroundExecutionSuccess:
    """When adapter and validator both succeed, run should complete."""

    async def test_run_completed(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        # Write minimal valid spec so validator would pass (but we mock anyway)
        _write_minimal_valid_spec(spec_root)

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                return_value=_fake_agent_result(exit_code=0),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        # Re-query to get latest state
        await db_session.refresh(run)
        assert run.status == "completed"
        assert run.exit_code == 0

    async def test_start_and_adapter_logs_are_persisted_immediately(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()
        redis = AsyncMock()
        redis.publish = AsyncMock()

        _write_minimal_valid_spec(spec_root)

        async def _capture_bundle(*, run_id, bundle, lease_path, timeout=600, on_log=None):
            assert on_log is not None
            await on_log("stdout", "adapter first log", "2026-06-02T00:00:00")
            return _fake_agent_result(exit_code=0)

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                side_effect=_capture_bundle,
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
            patch(
                "app.modules.spec_workspace.bootstrap.get_redis",
                return_value=redis,
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        logs = await _get_run_logs(db_session, run.id)
        contents = [entry.content_redacted for entry in logs]
        assert any("Agent run started" in content for content in contents)
        assert "adapter first log" in contents
        assert redis.publish.await_count >= 1

    async def test_sync_status_clean(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        _write_minimal_valid_spec(spec_root)

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                return_value=_fake_agent_result(exit_code=0),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        await db_session.refresh(spec_ws)
        assert spec_ws.sync_status == "clean"

    async def test_last_synced_at_set(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        _write_minimal_valid_spec(spec_root)

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                return_value=_fake_agent_result(exit_code=0),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        await db_session.refresh(spec_ws)
        assert spec_ws.last_synced_at is not None

    async def test_complete_audit_written(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        _write_minimal_valid_spec(spec_root)

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                return_value=_fake_agent_result(exit_code=0),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        audits = await _get_audit_logs(db_session, ws.id, "spec_bootstrap.complete")
        assert len(audits) >= 1
        audit = audits[-1]
        details = json.loads(audit.details_json)
        assert details.get("validation_passed") is True

    async def test_no_spec_conflicts_on_success(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        _write_minimal_valid_spec(spec_root)

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                return_value=_fake_agent_result(exit_code=0),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        conflicts = await _get_conflicts(db_session, ws.id)
        assert len(conflicts) == 0


class TestBackgroundExecutionValidationFailure:
    """When adapter succeeds but validator reports errors."""

    async def test_run_failed(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        validation_errors = [
            ValidationIssue(
                severity="error",
                category="structure",
                path=str(spec_root),
                message="Required directory .sillyspec/projects/ does not exist.",
            )
        ]

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                return_value=_fake_agent_result(exit_code=0),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=False, errors=validation_errors),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        await db_session.refresh(run)
        assert run.status == "failed"

    async def test_sync_status_dirty(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        validation_errors = [
            ValidationIssue(
                severity="error",
                category="structure",
                path=str(spec_root),
                message="Required directory .sillyspec/projects/ does not exist.",
            )
        ]

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                return_value=_fake_agent_result(exit_code=0),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=False, errors=validation_errors),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        await db_session.refresh(spec_ws)
        assert spec_ws.sync_status == "dirty"

    async def test_validation_spec_conflict_created(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        validation_errors = [
            ValidationIssue(
                severity="error",
                category="structure",
                path=str(spec_root),
                message="Required directory .sillyspec/projects/ does not exist.",
            )
        ]

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                return_value=_fake_agent_result(exit_code=0),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=False, errors=validation_errors),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        conflicts = await _get_conflicts(db_session, ws.id)
        assert len(conflicts) >= 1
        # At least one conflict should be from validation
        conflict_details = [json.loads(c.details_json) for c in conflicts]
        assert any(d.get("category") == "structure" for d in conflict_details)


class TestBackgroundExecutionAdapterFailure:
    """When adapter returns non-zero exit code."""

    async def test_run_failed(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                return_value=_fake_agent_result(
                    exit_code=1, stderr="boom", redacted_output="failed"
                ),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        await db_session.refresh(run)
        assert run.status == "failed"
        assert run.exit_code == 1

    async def test_stderr_log_written(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                return_value=_fake_agent_result(
                    exit_code=1, stderr="error output here", redacted_output="failed"
                ),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        logs = await _get_run_logs(db_session, run.id)
        stderr_logs = [entry for entry in logs if entry.channel == "stderr"]
        assert len(stderr_logs) >= 1

    async def test_sync_status_dirty(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                return_value=_fake_agent_result(
                    exit_code=1, stderr="boom", redacted_output="failed"
                ),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        await db_session.refresh(spec_ws)
        assert spec_ws.sync_status == "dirty"

    async def test_command_spec_conflict_created(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                return_value=_fake_agent_result(
                    exit_code=1, stderr="boom", redacted_output="failed"
                ),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
            patch(
                "app.modules.spec_workspace.validator.SpecValidator.validate",
                return_value=_fake_validation_report(passed=True),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        conflicts = await _get_conflicts(db_session, ws.id)
        assert len(conflicts) >= 1
        command_conflicts = [c for c in conflicts if c.conflict_type == "command"]
        assert len(command_conflicts) >= 1


class TestBackgroundExecutionAdapterException:
    """When adapter throws an exception, run must not stay in 'running'."""

    async def test_run_failed_on_exception(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                side_effect=RuntimeError("adapter crashed"),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        await db_session.refresh(run)
        assert run.status == "failed"
        assert run.status != "running"

    async def test_error_written_to_output(self, db_session: AsyncSession, tmp_path: Path) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                side_effect=RuntimeError("adapter crashed"),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        await db_session.refresh(run)
        assert run.output_redacted is not None
        assert "adapter crashed" in run.output_redacted

    async def test_stderr_log_written_on_exception(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                side_effect=RuntimeError("adapter crashed"),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        logs = await _get_run_logs(db_session, run.id)
        stderr_logs = [entry for entry in logs if entry.channel == "stderr"]
        assert len(stderr_logs) >= 1

    async def test_sync_status_dirty_on_exception(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                side_effect=RuntimeError("adapter crashed"),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        await db_session.refresh(spec_ws)
        assert spec_ws.sync_status == "dirty"

    async def test_audit_written_on_exception(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        with (
            patch(
                "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
                new_callable=AsyncMock,
                side_effect=RuntimeError("adapter crashed"),
            ),
            patch(
                "app.core.db.get_session_factory",
                return_value=MagicMock(
                    return_value=MagicMock(
                        __aenter__=AsyncMock(return_value=db_session),
                        __aexit__=AsyncMock(return_value=False),
                    )
                ),
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        audits = await _get_audit_logs(db_session, ws.id, "spec_bootstrap.complete")
        assert len(audits) >= 1
        details = json.loads(audits[-1].details_json)
        assert details.get("validation_passed") is False


class TestBackgroundExecutionMissingRecords:
    """_execute_bootstrap_agent_run handles missing AgentRun / SpecWorkspace."""

    async def test_missing_run_exits_gracefully(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))
        user_id = uuid.uuid4()

        with patch(
            "app.core.db.get_session_factory",
            return_value=MagicMock(
                return_value=MagicMock(
                    __aenter__=AsyncMock(return_value=db_session),
                    __aexit__=AsyncMock(return_value=False),
                )
            ),
        ):
            # Should not raise, just log and return
            await _execute_bootstrap_agent_run(
                run_id=uuid.uuid4(),  # non-existent
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        # No new runs should have been created
        stmt = select(AgentRun)
        runs = (await db_session.execute(stmt)).scalars().all()
        assert len(runs) == 0

    async def test_missing_spec_workspace_marks_run_failed(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session, root_path=str(tmp_path / "code"))
        spec_root = tmp_path / "specs" / str(ws.id)
        spec_ws = await _create_spec_workspace(db_session, ws, str(spec_root))
        run = await _create_pending_run(db_session, ws, spec_ws)
        user_id = uuid.uuid4()

        # Delete the SpecWorkspace to simulate missing record
        await db_session.delete(spec_ws)
        await db_session.commit()

        with patch(
            "app.core.db.get_session_factory",
            return_value=MagicMock(
                return_value=MagicMock(
                    __aenter__=AsyncMock(return_value=db_session),
                    __aexit__=AsyncMock(return_value=False),
                )
            ),
        ):
            await _execute_bootstrap_agent_run(
                run_id=run.id,
                workspace_id=ws.id,
                user_id=user_id,
                spec_root=str(spec_root),
                code_root=str(tmp_path / "code"),
            )

        await db_session.refresh(run)
        assert run.status == "failed"
