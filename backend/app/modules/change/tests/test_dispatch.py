"""Tests for stage-driven agent dispatch — clarifying stage focus.

Covers: dispatch.py (unit), transition_with_dispatch (integration), API endpoints.
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.change.dispatch import (
    STAGE_AGENT_CONFIG,
    StageAgentConfig,
    dispatch,
    get_config_for_stage,
    has_active_run,
    load_prompt_template,
)
from app.modules.change.model import Change
from app.modules.workspace.model import Workspace

COMPONENT_FIXTURES = Path(__file__).parent / "fixtures" / "valid"
CHANGE_FIXTURES = Path(__file__).parent / "fixtures" / "changes"


# ── Unit tests: StageAgentConfig ──────────────────────────────────────────


class TestStageAgentConfig:
    """Test the STAGE_AGENT_CONFIG mapping."""

    def test_brainstorm_config_exists(self):
        config = get_config_for_stage("brainstorm")
        assert config is not None
        assert isinstance(config, StageAgentConfig)

    def test_brainstorm_config_values(self):
        config = get_config_for_stage("brainstorm")
        assert config.enabled is True
        assert config.prompt_template == "brainstorm.md"
        assert config.phase == "Brainstorm"
        assert config.requires_worktree is True
        assert config.read_only is False

    def test_all_expected_stages_present(self):
        expected = {
            "brainstorm",
            "plan",
            "execute",
            "verify",
            "archive",
        }
        assert set(STAGE_AGENT_CONFIG.keys()) == expected

    def test_no_config_for_non_dispatch_stages(self):
        for stage in ("draft", "blocked", "archived"):
            assert get_config_for_stage(stage) is None

    def test_write_stages_require_worktree(self):
        # D-004: verify 不再要求 worktree（daemon-client + host-fs-delegate 定位 spec_root）
        write_stages = ["execute", "brainstorm", "plan", "archive"]
        for stage in write_stages:
            config = get_config_for_stage(stage)
            assert config is not None
            assert config.requires_worktree is True
            assert config.read_only is False
        verify_config = get_config_for_stage("verify")
        assert verify_config is not None
        assert verify_config.requires_worktree is False
        assert verify_config.read_only is False


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

    async def test_dispatch_brainstorm_stage(self, db_session: AsyncSession, tmp_path: Path):
        """When transitioning to brainstorm, dispatch should trigger an agent run."""
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
                target_stage="brainstorm",
                user_id=user_id,
            )

        assert result["dispatched"] is True
        assert result["stage"] == "brainstorm"
        assert result["phase"] == "Brainstorm"
        assert "agent_run_id" in result

        # Verify last_dispatch recorded in stages JSON
        await db_session.refresh(change)
        assert change.stages["last_dispatch"]["stage"] == "brainstorm"

    async def test_dispatch_no_config_for_stage(self, db_session: AsyncSession, tmp_path: Path):
        """Stages without config (e.g. draft) should not dispatch."""
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="scan",
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

    async def test_dispatch_blocked_by_active_run(self, db_session: AsyncSession, tmp_path: Path):
        """If an active run exists, dispatch should be skipped."""
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="brainstorm",
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
            target_stage="brainstorm",
            user_id=user_id,
        )

        assert result["dispatched"] is False
        assert result["reason"] == "active_run_exists"

    async def test_dispatch_error_does_not_raise(self, db_session: AsyncSession, tmp_path: Path):
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
                target_stage="brainstorm",
                user_id=user_id,
            )

        assert result["dispatched"] is False
        assert result["reason"] == "dispatch_error"
        assert "Agent crashed" in result["error"]


# ── Integration tests: transition_with_dispatch ───────────────────────────


class TestTransitionWithDispatch:
    """Test the ChangeService.transition_with_dispatch() method."""

    async def test_draft_to_brainstorm_triggers_dispatch(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """AC-01: brainstorm → plan should trigger agent dispatch."""
        from app.modules.change.service import ChangeService

        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="brainstorm",
            path=str(tmp_path / ".sillyspec" / "changes" / "change" / "test"),
        )
        user_id = uuid.uuid4()

        def _mock_factory():
            class _Ctx:
                async def __aenter__(self):
                    return db_session

                async def __aexit__(self, *args):
                    pass

            return _Ctx()

        with (
            patch(
                "app.modules.agent.service.AgentService.start_stage_dispatch",
                new_callable=AsyncMock,
            ) as mock_start,
            patch(
                "app.core.db.get_session_factory",
                return_value=_mock_factory,
            ),
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
                target_stage="plan",
                user_role="admin",
                reason="submit for review",
                user_id=user_id,
            )

        assert result["change"].current_stage == "plan"
        assert result["agent_dispatch"]["dispatched"] is True
        assert result["agent_dispatch"]["stage"] == "plan"

    async def test_transition_without_dispatch_when_no_user(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """Without user_id, transition should succeed but not dispatch."""
        from app.modules.change.service import ChangeService

        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="brainstorm",
        )

        svc = ChangeService(db_session)
        result = await svc.transition_with_dispatch(
            workspace_id=ws.id,
            change_id=change.id,
            target_stage="plan",
            user_role="admin",
            user_id=None,
        )

        assert result["change"].current_stage == "plan"
        assert result["agent_dispatch"] == {}

    async def test_transition_stages_log_recorded(self, db_session: AsyncSession, tmp_path: Path):
        """Transition should log the stage change in stages JSON."""
        from app.modules.change.service import ChangeService

        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="brainstorm",
        )

        svc = ChangeService(db_session)
        result = await svc.transition_with_dispatch(
            workspace_id=ws.id,
            change_id=change.id,
            target_stage="plan",
            user_role="admin",
            user_id=None,
        )

        stages = result["change"].stages or {}
        transitions = stages.get("transitions", [])
        assert len(transitions) == 1
        assert transitions[0]["from"] == "brainstorm"
        assert transitions[0]["to"] == "plan"
        assert transitions[0]["by_role"] == "admin"

    async def test_invalid_transition_rejected(self, db_session: AsyncSession, tmp_path: Path):
        """Invalid transition (e.g. brainstorm → verify) should raise error."""
        from app.core.errors import InvalidTransition
        from app.modules.change.service import ChangeService

        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="brainstorm",
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
async def workspace_with_changes(client, tmp_path: Path, auth_headers: dict[str, str]) -> dict:
    """Create a workspace with changes for API testing.

    2026-07-10-remove-server-local-workspace-mode: fixture 落到服务器 spec_root。
    """
    from conftest import seed_spec_root

    root = _copy_fixtures(COMPONENT_FIXTURES, tmp_path)

    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "dispatch-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]

    # COMPONENT_FIXTURES（包裹式）展平到 spec_root + CHANGE_FIXTURES 覆盖 changes/
    spec_root = seed_spec_root(ws_id, COMPONENT_FIXTURES)
    changes_root = Path(spec_root) / "changes"
    changes_root.mkdir(parents=True, exist_ok=True)
    shutil.copytree(CHANGE_FIXTURES, changes_root, dirs_exist_ok=True)

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

    async def test_transition_draft_to_brainstorm(
        self, client, workspace_with_changes: dict, auth_headers: dict[str, str]
    ):
        """POST /changes/{id}/transition with target_stage=brainstorm."""
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

            # demo change 解析后落在 brainstorm（ql-20260702-001 stage fallback），
            # 故 transition 到下一合法阶段 plan（brainstorm→plan）。
            resp = await client.post(
                f"/api/workspaces/{ws_id}/changes/{change_id}/transition",
                json={"target_stage": "plan"},
                headers=auth_headers,
            )

        # Should succeed
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
            json={"target_stage": "archived"},
            headers=auth_headers,
        )
        # Should be 422 (InvalidTransition) since draft→archived is not allowed
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

    async def test_agent_status_after_transition_to_brainstorm(
        self, client, workspace_with_changes: dict, auth_headers: dict[str, str]
    ):
        """After transitioning to brainstorm, agent-status should show config_enabled."""
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

            # demo 在 brainstorm，transition 到 plan（plan 同样有 config）。
            trans_resp = await client.post(
                f"/api/workspaces/{ws_id}/changes/{change_id}/transition",
                json={"target_stage": "plan"},
                headers=auth_headers,
            )
            assert trans_resp.status_code == 200, trans_resp.text

        # Check agent status — plan has config so config_enabled should be True
        resp = await client.get(
            f"/api/workspaces/{ws_id}/changes/{change_id}/agent-status",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["config_enabled"] is True  # plan has config

    async def test_agent_status_fallback_filters_by_change_id(
        self,
        client,
        db_session: AsyncSession,
        workspace_with_changes: dict,
        auth_headers: dict[str, str],
    ):
        """ql-20260706-004：last_dispatch 缺失时 fallback 必须按 change_id 过滤。

        旧实现只按 workspace 取最近 run，把 change_id=NULL 的 run（如 scan）当
        本变更日志返回（串台根因）。修复后 fallback 按 AgentRun.change_id == change_id
        取，demo change 无绑定 run → last_dispatch 为 None。
        """
        from datetime import UTC, datetime

        from app.modules.workspace.model import AgentRunWorkspace

        ws_id = workspace_with_changes["ws_id"]
        change_id = await _get_demo_change_id(client, ws_id, auth_headers)

        # workspace 下插一条 change_id=NULL 的 run（模拟 scan / 未绑变更的执行），
        # 并经 AgentRunWorkspace 关联到本 workspace——旧 fallback 经此 join 取到它。
        scan_run = AgentRun(
            id=uuid.uuid4(),
            change_id=None,
            agent_type="claude_code",
            status="completed",
            started_at=datetime.now(UTC),
        )
        db_session.add(scan_run)
        db_session.add(
            AgentRunWorkspace(
                agent_run_id=scan_run.id,
                workspace_id=uuid.UUID(ws_id),
            )
        )
        await db_session.commit()

        # demo change 新建、stages 为空 → fallback 触发
        resp = await client.get(
            f"/api/workspaces/{ws_id}/changes/{change_id}/agent-status",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # 修复后：fallback 按 change_id 过滤；demo change 没有任何绑定的 run，
        # last_dispatch 必须为 None（修前会取到 scan_run → 串台）。
        assert body["last_dispatch"] is None, (
            f"fallback 不应返回 change_id=NULL 的 run：{body['last_dispatch']}"
        )


class TestManualDispatchAPI:
    """Test the manual dispatch API endpoint."""

    async def test_manual_dispatch_for_brainstorm(
        self, client, workspace_with_changes: dict, auth_headers: dict[str, str]
    ):
        """POST /changes/{id}/dispatch triggers agent for current stage."""
        ws_id = workspace_with_changes["ws_id"]
        change_id = await _get_demo_change_id(client, ws_id, auth_headers)

        # First transition to brainstorm
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

            # Transition to brainstorm
            await client.post(
                f"/api/workspaces/{ws_id}/changes/{change_id}/transition",
                json={"target_stage": "brainstorm"},
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

        # demo 解析为 brainstorm（有 config）。为覆盖 router manual_dispatch 的
        # "current_stage 无 config → config_enabled=False" 分支，patch
        # get_config_for_stage 返回 None 模拟该场景。
        with patch("app.modules.change.dispatch.get_config_for_stage", return_value=None):
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

    async def test_full_brainstorm_lifecycle(self, db_session: AsyncSession, tmp_path: Path):
        """AC-01 through AC-05: Full plan-stage dispatch lifecycle (brainstorm → plan)."""
        from app.modules.change.service import ChangeService

        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="brainstorm",
            path=str(tmp_path / ".sillyspec" / "changes" / "change" / "test"),
        )
        user_id = uuid.uuid4()

        svc = ChangeService(db_session)

        # Step 1: draft → brainstorm (triggers dispatch)
        def _mock_factory():
            class _Ctx:
                async def __aenter__(self):
                    return db_session

                async def __aexit__(self, *args):
                    pass

            return _Ctx()

        with (
            patch(
                "app.modules.agent.service.AgentService.start_stage_dispatch",
                new_callable=AsyncMock,
            ) as mock_start,
            patch(
                "app.core.db.get_session_factory",
                return_value=_mock_factory,
            ),
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
                user_role="admin",
                reason="Submit for review",
                user_id=user_id,
            )

        # Verify transition
        assert result["change"].current_stage == "plan"
        assert result["agent_dispatch"]["dispatched"] is True

        # Verify dispatch was called with correct params
        mock_start.assert_called_once()
        call_kwargs = mock_start.call_args[1]
        assert call_kwargs["stage"] == "plan"
        assert call_kwargs["prompt_template"] == "plan.md"
        assert call_kwargs["read_only"] is False
        assert call_kwargs["requires_worktree"] is True

        # Step 2: Verify dispatch is blocked when active run exists
        active = AgentRun(
            id=uuid.uuid4(),
            change_id=change.id,
            agent_type="claude_code",
            status="running",
        )
        db_session.add(active)
        await db_session.commit()

        from app.modules.change.dispatch import dispatch as dispatch_fn

        blocked_result = await dispatch_fn(
            session=db_session,
            workspace_id=ws.id,
            change_id=change.id,
            target_stage="plan",
            user_id=user_id,
        )
        assert blocked_result["dispatched"] is False
        assert blocked_result["reason"] == "active_run_exists"

    async def test_propose_to_plan(self, db_session: AsyncSession, tmp_path: Path):
        """After propose, reviewer can advance to plan."""
        pytest.skip("propose stage removed from StageEnum (task-01)")
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
                async def __aenter__(self):
                    return db_session

                async def __aexit__(self, *args):
                    pass

            return _Ctx()

        with (
            patch(
                "app.modules.agent.service.AgentService.start_stage_dispatch",
                new_callable=AsyncMock,
            ) as mock_start,
            patch(
                "app.core.db.get_session_factory",
                return_value=_mock_factory,
            ),
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

    async def test_role_permission_enforcement(self, db_session: AsyncSession, tmp_path: Path):
        """business_user cannot advance propose → plan (only reviewer)."""
        pytest.skip("propose stage removed from StageEnum (task-01)")
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
