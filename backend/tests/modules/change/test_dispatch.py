"""Tests for stage-driven agent dispatch.

Covers: StageAgentConfig lookup, has_active_run, dispatch(), and
load_prompt_template for the clarifying stage.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unittest.mock import AsyncMock, patch

from app.modules.agent.model import AgentRun
from app.modules.change.dispatch import (
    STAGE_AGENT_CONFIG,
    StageAgentConfig,
    SillySpecStageDispatchService,
    dispatch,
    get_config_for_stage,
    has_active_run,
    load_prompt_template,
)
from app.modules.change.model import Change


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_change(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID | None = None,
    current_stage: str = "clarifying",
) -> Change:
    """Create a minimal Change row for testing."""
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id or uuid.uuid4(),
        change_key=f"test-{uuid.uuid4().hex[:8]}",
        title="Test change for dispatch",
        status="draft",
        location="active",
        path="/tmp/test",
        current_stage=current_stage,
        stages={},
    )
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return change


async def _create_agent_run(
    session: AsyncSession,
    *,
    change_id: uuid.UUID,
    status: str = "pending",
) -> AgentRun:
    """Create a minimal AgentRun row linked to a change."""
    run = AgentRun(
        id=uuid.uuid4(),
        change_id=change_id,
        agent_type="claude_code",
        status=status,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _create_workspace(session: AsyncSession) -> uuid.UUID:
    """Create a minimal Workspace row and return its id."""
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name=f"test-ws-{uuid.uuid4().hex[:6]}",
        slug=f"test-ws-{uuid.uuid4().hex[:6]}",
        root_path="/tmp/test-workspace",
        status="active",
    )
    session.add(ws)
    await session.commit()
    return ws.id


# ===================================================================
# 1. StageAgentConfig lookup
# ===================================================================


def test_get_config_for_propose() -> None:
    """Propose stage has a valid config."""
    config = get_config_for_stage("propose")
    assert config is not None
    assert config.enabled is True
    assert config.prompt_template == "propose.md"
    assert config.requires_worktree is True
    assert config.read_only is False


def test_get_config_for_draft_returns_none() -> None:
    """Draft stage has no agent config."""
    assert get_config_for_stage("draft") is None


def test_get_config_for_archived_returns_none() -> None:
    """Archived stage has no agent config."""
    assert get_config_for_stage("archived") is None


def test_all_configured_stages_have_templates() -> None:
    """Every stage in STAGE_AGENT_CONFIG has a non-empty template name."""
    for stage, config in STAGE_AGENT_CONFIG.items():
        assert config.prompt_template, f"Stage \'{stage}\' missing prompt_template"
        assert config.phase, f"Stage \'{stage}\' missing phase"


# ===================================================================
# 2. has_active_run
# ===================================================================


async def test_has_active_run_false_when_no_runs(db_session: AsyncSession) -> None:
    """No AgentRun rows -> has_active_run is False."""
    change_id = uuid.uuid4()
    assert await has_active_run(db_session, change_id) is False


async def test_has_active_run_true_with_pending(db_session: AsyncSession) -> None:
    """A pending AgentRun -> has_active_run is True."""
    change = await _create_change(db_session)
    await _create_agent_run(db_session, change_id=change.id, status="pending")
    assert await has_active_run(db_session, change.id) is True


async def test_has_active_run_true_with_running(db_session: AsyncSession) -> None:
    """A running AgentRun -> has_active_run is True."""
    change = await _create_change(db_session)
    await _create_agent_run(db_session, change_id=change.id, status="running")
    assert await has_active_run(db_session, change.id) is True


async def test_has_active_run_false_with_completed(db_session: AsyncSession) -> None:
    """A completed AgentRun -> has_active_run is False."""
    change = await _create_change(db_session)
    await _create_agent_run(db_session, change_id=change.id, status="completed")
    assert await has_active_run(db_session, change.id) is False


async def test_has_active_run_false_with_failed(db_session: AsyncSession) -> None:
    """A failed AgentRun -> has_active_run is False."""
    change = await _create_change(db_session)
    await _create_agent_run(db_session, change_id=change.id, status="failed")
    assert await has_active_run(db_session, change.id) is False


# ===================================================================
# 3. dispatch() — propose stage
# ===================================================================


async def test_dispatch_no_config_for_stage(db_session: AsyncSession) -> None:
    """Draft stage has no config -> dispatch returns early."""
    result = await dispatch(
        session=db_session,
        workspace_id=uuid.uuid4(),
        change_id=uuid.uuid4(),
        target_stage="draft",
        user_id=uuid.uuid4(),
    )
    assert result["dispatched"] is False
    assert "no_config" in result["reason"]


async def test_dispatch_active_run_blocks(db_session: AsyncSession) -> None:
    """An existing running agent blocks new dispatch."""
    change = await _create_change(db_session, current_stage="draft")
    await _create_agent_run(db_session, change_id=change.id, status="running")

    result = await dispatch(
        session=db_session,
        workspace_id=change.workspace_id,
        change_id=change.id,
        target_stage="propose",
        user_id=uuid.uuid4(),
    )
    assert result["dispatched"] is False
    assert result["reason"] == "active_run_exists"


async def test_dispatch_change_not_found(db_session: AsyncSession) -> None:
    """Non-existent change_id -> dispatch returns gracefully."""
    result = await dispatch(
        session=db_session,
        workspace_id=uuid.uuid4(),
        change_id=uuid.uuid4(),
        target_stage="propose",
        user_id=uuid.uuid4(),
    )
    assert result["dispatched"] is False
    assert result["reason"] == "change_not_found"


async def test_dispatch_updates_last_dispatch_in_stages(db_session: AsyncSession) -> None:
    """Dispatch writes last_dispatch info into change.stages JSON."""
    change = await _create_change(db_session, current_stage="draft")

    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch(
        "app.modules.agent.service.AgentService"
    ) as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        result = await dispatch(
            session=db_session,
            workspace_id=change.workspace_id,
            change_id=change.id,
            target_stage="propose",
            user_id=uuid.uuid4(),
        )

    assert result["dispatched"] is True
    assert result["stage"] == "propose"

    # Verify stages JSON was updated
    await db_session.refresh(change)
    last_dispatch = change.stages.get("last_dispatch")
    assert last_dispatch is not None
    assert last_dispatch["stage"] == "propose"
    assert "at" in last_dispatch
    assert "config" in last_dispatch
    assert last_dispatch["config"]["prompt_template"] == "propose.md"


# ===================================================================
# 4. load_prompt_template
# ===================================================================


def test_load_clarifying_template() -> None:
    """Clarifying template loads and contains expected sections."""
    content = load_prompt_template("clarifying.md")
    assert content
    assert "Clarification Agent" in content
    assert "READ-ONLY" in content


def test_load_template_with_context() -> None:
    """Template placeholders are replaced with context values."""
    content = load_prompt_template(
        "clarifying.md",
        context={
            "change_title": "My Test Change",
            "change_key": "test-001",
            "current_stage": "draft",
        },
    )
    assert "My Test Change" in content
    assert "test-001" in content


def test_load_missing_template_returns_empty() -> None:
    """Missing template file returns empty string."""
    content = load_prompt_template("nonexistent_template.md")
    assert content == ""


# ===================================================================
# 5. SillySpecStageDispatchService — dispatch_next_step
# ===================================================================


from app.core.errors import ChangeNotFound


async def test_dispatch_next_step_creates_agent_run(db_session: AsyncSession) -> None:
    """dispatch_next_step creates an AgentRun and returns dispatched=True."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch(
        "app.modules.agent.service.AgentService"
    ) as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="propose",
        )

    assert result["dispatched"] is True
    assert result["stage"] == "propose"
    assert result["agent_run_id"] is not None
    # Validate UUID format
    uuid.UUID(result["agent_run_id"])


async def test_dispatch_next_step_passes_prompt_template(db_session: AsyncSession) -> None:
    """AgentService.start_stage_dispatch receives correct stage and prompt_template."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch(
        "app.modules.agent.service.AgentService"
    ) as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        service = SillySpecStageDispatchService(db_session)
        await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="propose",
        )

        # Verify start_stage_dispatch was called with correct params
        call_kwargs = mock_svc.start_stage_dispatch.call_args[1]
        assert call_kwargs["stage"] == "propose"
        assert call_kwargs["prompt_template"] == "propose.md"


async def test_dispatch_next_step_unconfigured_stage(db_session: AsyncSession) -> None:
    """Unknown stage returns dispatched=False, reason=stage_not_configured."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    service = SillySpecStageDispatchService(db_session)
    result = await service.dispatch_next_step(
        session=db_session,
        workspace_id=workspace_id,
        change_id=change.id,
        user_id=uuid.uuid4(),
        target_stage="unknown",
    )

    assert result["dispatched"] is False
    assert result["reason"] == "stage_not_configured"
    assert result["stage"] == "unknown"


async def test_dispatch_next_step_active_run_exists(db_session: AsyncSession) -> None:
    """Existing pending AgentRun blocks new dispatch."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)
    await _create_agent_run(db_session, change_id=change.id, status="pending")

    service = SillySpecStageDispatchService(db_session)
    result = await service.dispatch_next_step(
        session=db_session,
        workspace_id=workspace_id,
        change_id=change.id,
        user_id=uuid.uuid4(),
        target_stage="propose",
    )

    assert result["dispatched"] is False
    assert result["reason"] == "active_run_exists"
    assert result["stage"] == "propose"


async def test_dispatch_next_step_change_not_found(db_session: AsyncSession) -> None:
    """Non-existent change_id raises ChangeNotFound."""
    workspace_id = await _create_workspace(db_session)

    service = SillySpecStageDispatchService(db_session)
    with pytest.raises(ChangeNotFound):
        await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            target_stage="propose",
        )


async def test_dispatch_next_step_bundle_build_error(db_session: AsyncSession) -> None:
    """_build_stage_bundle failure returns dispatched=False, reason=bundle_build_error."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    service = SillySpecStageDispatchService(db_session)
    with patch.object(
        service,
        "_build_stage_bundle",
        new_callable=AsyncMock,
        side_effect=RuntimeError("DB error"),
    ):
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="propose",
        )

    assert result["dispatched"] is False
    assert result["reason"] == "bundle_build_error"
    assert result["stage"] == "propose"


async def test_dispatch_next_step_agent_start_error(db_session: AsyncSession) -> None:
    """AgentService.start_stage_dispatch failure returns dispatched=False, reason=agent_start_error."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    with patch(
        "app.modules.agent.service.AgentService"
    ) as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(
            side_effect=RuntimeError("Agent crashed")
        )

        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="propose",
        )

    assert result["dispatched"] is False
    assert result["reason"] == "agent_start_error"
    assert result["stage"] == "propose"

    # Verify the AgentRun was marked as failed
    from sqlalchemy import select as sa_select
    from sqlmodel import col as sa_col

    stmt = sa_select(AgentRun).where(
        sa_col(AgentRun.change_id) == change.id,
        sa_col(AgentRun.status) == "failed",
    )
    failed_run = (await db_session.execute(stmt)).scalars().first()
    assert failed_run is not None
    assert "Agent start failed" in (failed_run.output_redacted or "")


async def test_dispatch_next_step_records_last_dispatch(db_session: AsyncSession) -> None:
    """Dispatch writes last_dispatch info into change.stages JSON."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch(
        "app.modules.agent.service.AgentService"
    ) as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="propose",
        )

    assert result["dispatched"] is True

    await db_session.refresh(change)
    last_dispatch = change.stages.get("last_dispatch")
    assert last_dispatch is not None
    assert last_dispatch["stage"] == "propose"
    assert last_dispatch["run_id"] is not None
    assert last_dispatch["config"]["phase"] == "Propose"
    assert last_dispatch["config"]["requires_worktree"] is True


async def test_dispatch_next_step_creates_workspace_association(db_session: AsyncSession) -> None:
    """Dispatch creates AgentRunWorkspace record linking run to workspace."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)

    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch(
        "app.modules.agent.service.AgentService"
    ) as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        service = SillySpecStageDispatchService(db_session)
        result = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=uuid.uuid4(),
            target_stage="propose",
        )

    assert result["dispatched"] is True
    run_id = uuid.UUID(result["agent_run_id"])

    # Verify AgentRunWorkspace association exists
    from sqlalchemy import select as sa_select
    from sqlmodel import col as sa_col
    from app.modules.workspace.model import AgentRunWorkspace

    stmt = sa_select(AgentRunWorkspace).where(
        sa_col(AgentRunWorkspace.agent_run_id) == run_id,
        sa_col(AgentRunWorkspace.workspace_id) == workspace_id,
    )
    assoc = (await db_session.execute(stmt)).scalars().first()
    assert assoc is not None


# ===================================================================
# 6. Idempotency — dispatch twice in a row
# ===================================================================


async def test_dispatch_next_step_idempotency(db_session: AsyncSession) -> None:
    """Dispatching the same change twice: first succeeds, second blocked by active_run."""
    workspace_id = await _create_workspace(db_session)
    change = await _create_change(db_session, workspace_id=workspace_id)
    user_id = uuid.uuid4()

    mock_run = type("FakeRun", (), {"id": uuid.uuid4()})()
    with patch(
        "app.modules.agent.service.AgentService"
    ) as MockAgentService:
        mock_svc = MockAgentService.return_value
        mock_svc.start_stage_dispatch = AsyncMock(return_value=mock_run)

        service = SillySpecStageDispatchService(db_session)

        # First dispatch succeeds
        result1 = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            target_stage="propose",
        )
        assert result1["dispatched"] is True

        # Second dispatch blocked by active run
        result2 = await service.dispatch_next_step(
            session=db_session,
            workspace_id=workspace_id,
            change_id=change.id,
            user_id=user_id,
            target_stage="propose",
        )
        assert result2["dispatched"] is False
        assert result2["reason"] == "active_run_exists"
