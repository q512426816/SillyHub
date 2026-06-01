"""Tests for stage-driven agent dispatch — clarifying stage focus.

Covers: dispatch.py (unit), transition_with_dispatch (integration), API endpoints.
"""

from __future__ import annotations

import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.agent.model import AgentRun
from app.modules.change.dispatch import (
    STAGE_AGENT_CONFIG,
    StageAgentConfig,
    dispatch,
    get_config_for_stage,
    has_active_run,
    load_prompt_template,
)
from app.modules.change.model import Change, StageEnum
from app.modules.workspace.model import Workspace

COMPONENT_FIXTURES = Path(__file__).parent / "fixtures" / "valid"
CHANGE_FIXTURES = Path(__file__).parent / "fixtures" / "changes"


# ── Unit tests: StageAgentConfig ──────────────────────────────────────────


class TestStageAgentConfig:
    """Test the STAGE_AGENT_CONFIG mapping."""

    def test_propose_config_exists(self):
        config = get_config_for_stage("propose")
        assert config is not None
        assert isinstance(config, StageAgentConfig)

    def test_propose_config_values(self):
        config = get_config_for_stage("propose")
        assert config.enabled is True
        assert config.prompt_template == "propose.md"
        assert config.phase == "Propose"
        assert config.requires_worktree is True
        assert config.read_only is False

    def test_all_expected_stages_present(self):
        expected = {
            "propose", "brainstorm", "plan",
            "execute", "verify", "scan",
            "archive", "quick",
        }
        assert set(STAGE_AGENT_CONFIG.keys()) == expected

    def test_no_config_for_non_dispatch_stages(self):
        for stage in ("draft", "rework_required", "accepted"):
            assert get_config_for_stage(stage) is None

    def test_scan_does_not_require_worktree(self):
        config = get_config_for_stage("scan")
        assert config is not None
        assert config.requires_worktree is False
        assert config.read_only is False

    def test_write_stages_require_worktree(self):
        write_stages = ["execute", "verify", "brainstorm", "propose", "plan", "archive", "quick"]
        for stage in write_stages:
            config = get_config_for_stage(stage)
            assert config is not None
            assert config.requires_worktree is True
            assert config.read_only is False


# ── Unit tests: load_prompt_template ──────────────────────────────────────


class TestLoadPromptTemplate:
    """Test prompt template loading and rendering."""

    def test_clarifying_template_loads(self):
        content = load_prompt_template("clarifying.md")
        assert content  # not empty
        assert "{{change_title}}" in content

    def test_template_variable_substitution(self):
        content = load_prompt_template(
            "clarifying.md",
            context={
                "change_title": "My Feature",
                "change_key": "2026-05-31-my-feature",
                "current_stage": "draft",
                "change_type": "feature",
                "affected_components": "backend, frontend",
            },
        )
        assert "My Feature" in content
        assert "2026-05-31-my-feature" in content
        assert "backend, frontend" in content
        # Unsubstituted variables should remain
        assert "{{" not in content or "workspace_id" in content

    def test_missing_template_returns_empty(self):
        content = load_prompt_template("nonexistent_template.md")
        assert content == ""


# ── Unit tests: has_active_run ────────────────────────────────────────────


class TestHasActiveRun:
    """Test the concurrent-run guard."""

    async def test_no_active_run(self, db_session: AsyncSession):
        change_id = uuid.uuid4()
        result = await has_active_run(db_session, change_id)
        assert result is False

    async def test_active_run_detected(self, db_session: AsyncSession):
        change_id = uuid.uuid4()
        run = AgentRun(
            id=uuid.uuid4(),
            change_id=change_id,
            agent_type="claude_code",
            status="running",
        )
        db_session.add(run)
        await db_session.commit()

        result = await has_active_run(db_session, change_id)
        assert result is True

    async def test_pending_run_detected(self, db_session: AsyncSession):
        change_id = uuid.uuid4()
        run = AgentRun(
            id=uuid.uuid4(),
            change_id=change_id,
            agent_type="claude_code",
            status="pending",
        )
        db_session.add(run)
        await db_session.commit()

        result = await has_active_run(db_session, change_id)
        assert result is True

    async def test_completed_run_not_active(self, db_session: AsyncSession):
        change_id = uuid.uuid4()
        run = AgentRun(
            id=uuid.uuid4(),
            change_id=change_id,
            agent_type="claude_code",
            status="completed",
        )
        db_session.add(run)
        await db_session.commit()

        result = await has_active_run(db_session, change_id)
        assert result is False


# ── Integration tests: dispatch ───────────────────────────────────────────


async def _create_test_change(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    change_key: str = "2026-05-31-test-dispatch",
    current_stage: str = "draft",
    path: str = "/tmp/test-change",
) -> Change:
    """Helper: create a Change row in DB."""
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=change_key,
        title="Test Dispatch Change",
        status="in_progress",
        location="active",
        path=path,
        affected_components=["backend"],
        change_type="feature",
        current_stage=current_stage,
        stages={},
    )
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return change


async def _create_test_workspace(
    session: AsyncSession,
    *,
    root_path: str = "/tmp/test-workspace",
) -> Workspace:
    """Helper: create a Workspace row in DB."""
    ws = Workspace(
        id=uuid.uuid4(),
        name="test-workspace",
        root_path=root_path,
        slug="test-workspace",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


class TestDispatch:
    """Test the dispatch() function."""

    async def test_dispatch_propose_stage(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """When transitioning to propose, dispatch should trigger an agent run."""
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            path=str(tmp_path / ".sillyspec" / "changes" / "change" / "test-dispatch"),
        )
        user_id = uuid.uuid4()

        with patch(
            "app.modules.agent.service.AgentService.start_stage_dispatch",
            new_callable=AsyncMock,
        ) as mock_start:
            mock_run = AgentRun(
                id=uuid.uuid4(),
                change_id=change.id,
                agent_type="claude_code",
                status="pending",
            )
            mock_start.return_value = mock_run

            result = await dispatch(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                target_stage="propose",
                user_id=user_id,
            )

        assert result["dispatched"] is True
        assert result["stage"] == "propose"
        assert result["phase"] == "Propose"
        assert "agent_run_id" in result

        # Verify last_dispatch recorded in stages JSON
        await db_session.refresh(change)
        assert change.stages["last_dispatch"]["stage"] == "propose"

    async def test_dispatch_no_config_for_stage(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """Stages without config (e.g. draft) should not dispatch."""
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="draft",
        )
        user_id = uuid.uuid4()

        result = await dispatch(
            session=db_session,
            workspace_id=ws.id,
            change_id=change.id,
            target_stage="draft",
            user_id=user_id,
        )

        assert result["dispatched"] is False
        assert "no_config_for_stage" in result["reason"]

    async def test_dispatch_blocked_by_active_run(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """If an active run exists, dispatch should be skipped."""
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="propose",
        )

        # Create an active run
        active_run = AgentRun(
            id=uuid.uuid4(),
            change_id=change.id,
            agent_type="claude_code",
            status="running",
        )
        db_session.add(active_run)
        await db_session.commit()

        user_id = uuid.uuid4()
        result = await dispatch(
            session=db_session,
            workspace_id=ws.id,
            change_id=change.id,
            target_stage="propose",
            user_id=user_id,
        )

        assert result["dispatched"] is False
        assert result["reason"] == "active_run_exists"

    async def test_dispatch_error_does_not_raise(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """Agent service errors should be caught and returned, not raised."""
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
        )
        user_id = uuid.uuid4()

        with patch(
            "app.modules.agent.service.AgentService.start_stage_dispatch",
            new_callable=AsyncMock,
            side_effect=RuntimeError("Agent crashed"),
        ):
            result = await dispatch(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                target_stage="propose",
                user_id=user_id,
            )

        assert result["dispatched"] is False
        assert result["reason"] == "dispatch_error"
        assert "Agent crashed" in result["error"]


# ── Integration tests: transition_with_dispatch ───────────────────────────


class TestTransitionWithDispatch:
    """Test the ChangeService.transition_with_dispatch() method."""

    async def test_draft_to_propose_triggers_dispatch(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """AC-01: draft → propose should trigger agent dispatch."""
        from app.modules.change.service import ChangeService

        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="draft",
            path=str(tmp_path / ".sillyspec" / "changes" / "change" / "test"),
        )
        user_id = uuid.uuid4()

        def _mock_factory():
            class _Ctx:
                async def __aenter__(self_inner):
                    return db_session
                async def __aexit__(self_inner, *args):
                    pass
            return _Ctx()

        with patch(
            "app.modules.agent.service.AgentService.start_stage_dispatch",
            new_callable=AsyncMock,
        ) as mock_start, patch(
            "app.core.db.get_session_factory",
            return_value=_mock_factory,
        ):
            mock_run = AgentRun(
                id=uuid.uuid4(),
                change_id=change.id,
                agent_type="claude_code",
                status="pending",
            )
            mock_start.return_value = mock_run

            svc = ChangeService(db_session)
            result = await svc.transition_with_dispatch(
                workspace_id=ws.id,
                change_id=change.id,
                target_stage="propose",
                user_role="business_user",
                reason="submit for review",
                user_id=user_id,
            )

        assert result["change"].current_stage == "propose"
        assert result["agent_dispatch"]["dispatched"] is True
        assert result["agent_dispatch"]["stage"] == "propose"

    async def test_transition_without_dispatch_when_no_user(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """Without user_id, transition should succeed but not dispatch."""
        from app.modules.change.service import ChangeService

        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="draft",
        )

        svc = ChangeService(db_session)
        result = await svc.transition_with_dispatch(
            workspace_id=ws.id,
            change_id=change.id,
            target_stage="propose",
            user_role="business_user",
            user_id=None,
        )

        assert result["change"].current_stage == "propose"
        assert result["agent_dispatch"] == {}

    async def test_transition_stages_log_recorded(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """Transition should log the stage change in stages JSON."""
        from app.modules.change.service import ChangeService

        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="draft",
        )

        svc = ChangeService(db_session)
        result = await svc.transition_with_dispatch(
            workspace_id=ws.id,
            change_id=change.id,
            target_stage="propose",
            user_role="business_user",
            user_id=None,
        )

        stages = result["change"].stages or {}
        transitions = stages.get("transitions", [])
        assert len(transitions) == 1
        assert transitions[0]["from"] == "draft"
        assert transitions[0]["to"] == "propose"
        assert transitions[0]["by_role"] == "business_user"

    async def test_invalid_transition_rejected(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """Invalid transition (e.g. draft → verify) should raise error."""
        from app.core.errors import InvalidTransition
        from app.modules.change.service import ChangeService

        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="draft",
        )

        svc = ChangeService(db_session)
        with pytest.raises(InvalidTransition):
            await svc.transition_with_dispatch(
                workspace_id=ws.id,
                change_id=change.id,
                target_stage="verify",
                user_role="business_user",
            )


# ── API endpoint tests ───────────────────────────────────────────────────


def _copy_fixtures(src: Path, tmp_path: Path, name: str = "ws") -> Path:
    dst = tmp_path / name
    shutil.copytree(src, dst)
    return dst


@pytest.fixture()
async def workspace_with_changes(
    client, tmp_path: Path, auth_headers: dict[str, str]
) -> dict:
    """Create a workspace with changes for API testing."""
    root = _copy_fixtures(COMPONENT_FIXTURES, tmp_path)
    sillyspec_changes = root / ".sillyspec" / "changes"
    shutil.copytree(CHANGE_FIXTURES, sillyspec_changes)

    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "dispatch-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]

    # Reparse to create change records
    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    return {"ws_id": ws_id}


async def _get_demo_change_id(client, ws_id, auth_headers):
    """Helper: get the demo-feature change ID."""
    list_resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        params={"location": "active"},
        headers=auth_headers,
    )
    items = list_resp.json()["items"]
    demo = next(i for i in items if i["change_key"] == "2026-05-25-demo-feature")
    return demo["id"]


class TestTransitionAPI:
    """Test the transition API endpoint with dispatch."""

    async def test_transition_draft_to_propose(
        self, client, workspace_with_changes: dict, auth_headers: dict[str, str]
    ):
        """POST /changes/{id}/transition with target_stage=propose."""
        ws_id = workspace_with_changes["ws_id"]
        change_id = await _get_demo_change_id(client, ws_id, auth_headers)

        with patch(
            "app.modules.agent.service.AgentService.start_stage_dispatch",
            new_callable=AsyncMock,
        ) as mock_start:
            mock_run = AgentRun(
                id=uuid.uuid4(),
                agent_type="claude_code",
                status="pending",
            )
            mock_start.return_value = mock_run

            resp = await client.post(
                f"/api/workspaces/{ws_id}/changes/{change_id}/transition",
                json={"target_stage": "propose"},
                headers=auth_headers,
            )

        # Should succeed (even if current stage is None/draft)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "change" in body
        assert "agent_dispatch" in body

    async def test_transition_invalid_stage_returns_error(
        self, client, workspace_with_changes: dict, auth_headers: dict[str, str]
    ):
        """Transition to a disallowed stage should return error (draft → accepted)."""
        ws_id = workspace_with_changes["ws_id"]
        change_id = await _get_demo_change_id(client, ws_id, auth_headers)

        # Use a valid StageEnum value but one not allowed from draft
        resp = await client.post(
            f"/api/workspaces/{ws_id}/changes/{change_id}/transition",
            json={"target_stage": "accepted"},
            headers=auth_headers,
        )
        # Should be 422 (InvalidTransition) since draft→accepted is not allowed
        assert resp.status_code == 422


class TestAgentStatusAPI:
    """Test the agent-status API endpoint."""

    async def test_get_agent_status(
        self, client, workspace_with_changes: dict, auth_headers: dict[str, str]
    ):
        """GET /changes/{id}/agent-status returns dispatch info."""
        ws_id = workspace_with_changes["ws_id"]
        change_id = await _get_demo_change_id(client, ws_id, auth_headers)

        resp = await client.get(
            f"/api/workspaces/{ws_id}/changes/{change_id}/agent-status",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["change_id"] == change_id
        assert "current_stage" in body
        assert "has_active_run" in body
        assert "config_enabled" in body

    async def test_agent_status_after_transition_to_propose(
        self, client, workspace_with_changes: dict, auth_headers: dict[str, str]
    ):
        """After transitioning to propose, agent-status should show config_enabled."""
        ws_id = workspace_with_changes["ws_id"]
        change_id = await _get_demo_change_id(client, ws_id, auth_headers)

        # Mock start_stage_dispatch so the agent doesn't actually run.
        # AgentService is imported lazily inside dispatch(), so patch at the source.
        with patch(
            "app.modules.agent.service.AgentService.start_stage_dispatch",
            new_callable=AsyncMock,
        ) as mock_start:
            mock_run = AgentRun(
                id=uuid.uuid4(),
                agent_type="claude_code",
                status="pending",
            )
            mock_start.return_value = mock_run

            trans_resp = await client.post(
                f"/api/workspaces/{ws_id}/changes/{change_id}/transition",
                json={"target_stage": "propose"},
                headers=auth_headers,
            )
            assert trans_resp.status_code == 200, trans_resp.text

        # Check agent status — propose has config so config_enabled should be True
        resp = await client.get(
            f"/api/workspaces/{ws_id}/changes/{change_id}/agent-status",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["config_enabled"] is True  # propose has config


class TestManualDispatchAPI:
    """Test the manual dispatch API endpoint."""

    async def test_manual_dispatch_for_propose(
        self, client, workspace_with_changes: dict, auth_headers: dict[str, str]
    ):
        """POST /changes/{id}/dispatch triggers agent for current stage."""
        ws_id = workspace_with_changes["ws_id"]
        change_id = await _get_demo_change_id(client, ws_id, auth_headers)

        # First transition to propose
        with patch(
            "app.modules.agent.service.AgentService.start_stage_dispatch",
            new_callable=AsyncMock,
        ) as mock_start:
            mock_run = AgentRun(
                id=uuid.uuid4(),
                agent_type="claude_code",
                status="pending",
            )
            mock_start.return_value = mock_run

            # Transition to propose
            await client.post(
                f"/api/workspaces/{ws_id}/changes/{change_id}/transition",
                json={"target_stage": "propose"},
                headers=auth_headers,
            )

            # Now manually dispatch
            resp = await client.post(
                f"/api/workspaces/{ws_id}/changes/{change_id}/dispatch",
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["config_enabled"] is True
        assert body["dispatch_result"] is not None
        assert body["dispatch_result"].get("dispatched") is True

    async def test_manual_dispatch_no_config(
        self, client, workspace_with_changes: dict, auth_headers: dict[str, str]
    ):
        """Manual dispatch for a stage without config should return gracefully."""
        ws_id = workspace_with_changes["ws_id"]
        change_id = await _get_demo_change_id(client, ws_id, auth_headers)

        # Don't transition — stays at None/draft stage, no config
        resp = await client.post(
            f"/api/workspaces/{ws_id}/changes/{change_id}/dispatch",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["config_enabled"] is False


# ── Full flow: draft → clarifying → design_review ─────────────────────────


class TestProposeStageFullFlow:
    """End-to-end test of the propose stage dispatch lifecycle."""

    async def test_full_propose_lifecycle(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """AC-01 through AC-05: Full propose dispatch lifecycle."""
        from app.modules.change.service import ChangeService

        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="draft",
            path=str(tmp_path / ".sillyspec" / "changes" / "change" / "test"),
        )
        user_id = uuid.uuid4()

        svc = ChangeService(db_session)

        # Step 1: draft → propose (triggers dispatch)
        # Mock the session factory to use the test session for dispatch
        def _mock_factory():
            class _Ctx:
                async def __aenter__(self_inner):
                    return db_session
                async def __aexit__(self_inner, *args):
                    pass
            return _Ctx()

        with patch(
            "app.modules.agent.service.AgentService.start_stage_dispatch",
            new_callable=AsyncMock,
        ) as mock_start, patch(
            "app.core.db.get_session_factory",
            return_value=_mock_factory,
        ):
            mock_run = AgentRun(
                id=uuid.uuid4(),
                change_id=change.id,
                agent_type="claude_code",
                status="pending",
            )
            mock_start.return_value = mock_run

            result = await svc.transition_with_dispatch(
                workspace_id=ws.id,
                change_id=change.id,
                target_stage="propose",
                user_role="business_user",
                reason="Submit for review",
                user_id=user_id,
            )

        # Verify transition
        assert result["change"].current_stage == "propose"
        assert result["agent_dispatch"]["dispatched"] is True

        # Verify dispatch was called with correct params
        mock_start.assert_called_once()
        call_kwargs = mock_start.call_args[1]
        assert call_kwargs["stage"] == "propose"
        assert call_kwargs["prompt_template"] == "propose.md"
        assert call_kwargs["read_only"] is False
        assert call_kwargs["requires_worktree"] is True

        # Step 2: Verify dispatch is blocked when active run exists
        # Create a fake active run for this change
        active = AgentRun(
            id=uuid.uuid4(),
            change_id=change.id,
            agent_type="claude_code",
            status="running",
        )
        db_session.add(active)
        await db_session.commit()

        # Directly call dispatch — should be blocked
        from app.modules.change.dispatch import dispatch as dispatch_fn
        blocked_result = await dispatch_fn(
            session=db_session,
            workspace_id=ws.id,
            change_id=change.id,
            target_stage="propose",
            user_id=user_id,
        )
        assert blocked_result["dispatched"] is False
        assert blocked_result["reason"] == "active_run_exists"

    async def test_propose_to_plan(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """After propose, reviewer can advance to plan."""
        from app.modules.change.service import ChangeService

        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="propose",
        )

        svc = ChangeService(db_session)

        def _mock_factory():
            class _Ctx:
                async def __aenter__(self_inner):
                    return db_session
                async def __aexit__(self_inner, *args):
                    pass
            return _Ctx()

        with patch(
            "app.modules.agent.service.AgentService.start_stage_dispatch",
            new_callable=AsyncMock,
        ) as mock_start, patch(
            "app.core.db.get_session_factory",
            return_value=_mock_factory,
        ):
            mock_run = AgentRun(
                id=uuid.uuid4(),
                change_id=change.id,
                agent_type="claude_code",
                status="pending",
            )
            mock_start.return_value = mock_run

            result = await svc.transition_with_dispatch(
                workspace_id=ws.id,
                change_id=change.id,
                target_stage="plan",
                user_role="reviewer",
                reason="Proposal complete",
                user_id=uuid.uuid4(),
            )

        assert result["change"].current_stage == "plan"
        assert result["agent_dispatch"]["dispatched"] is True
        assert result["agent_dispatch"]["stage"] == "plan"

    async def test_role_permission_enforcement(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """business_user cannot advance propose → plan (only reviewer)."""
        from app.core.errors import PermissionDenied
        from app.modules.change.service import ChangeService

        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="propose",
        )

        svc = ChangeService(db_session)
        with pytest.raises(PermissionDenied):
            await svc.transition_with_dispatch(
                workspace_id=ws.id,
                change_id=change.id,
                target_stage="plan",
                user_role="business_user",
            )
