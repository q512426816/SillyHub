"""Tests for stage-driven agent dispatch.

Covers: StageAgentConfig lookup, has_active_run, dispatch(), and
load_prompt_template for the clarifying stage.
"""

from __future__ import annotations

import uuid

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
        assert config.prompt_template, f"Stage '{stage}' missing prompt_template"
        assert config.phase, f"Stage '{stage}' missing phase"


# ===================================================================
# 2. has_active_run
# ===================================================================


async def test_has_active_run_false_when_no_runs(db_session: AsyncSession) -> None:
    """No AgentRun rows → has_active_run is False."""
    change_id = uuid.uuid4()
    assert await has_active_run(db_session, change_id) is False


async def test_has_active_run_true_with_pending(db_session: AsyncSession) -> None:
    """A pending AgentRun → has_active_run is True."""
    change = await _create_change(db_session)
    await _create_agent_run(db_session, change_id=change.id, status="pending")
    assert await has_active_run(db_session, change.id) is True


async def test_has_active_run_true_with_running(db_session: AsyncSession) -> None:
    """A running AgentRun → has_active_run is True."""
    change = await _create_change(db_session)
    await _create_agent_run(db_session, change_id=change.id, status="running")
    assert await has_active_run(db_session, change.id) is True


async def test_has_active_run_false_with_completed(db_session: AsyncSession) -> None:
    """A completed AgentRun → has_active_run is False."""
    change = await _create_change(db_session)
    await _create_agent_run(db_session, change_id=change.id, status="completed")
    assert await has_active_run(db_session, change.id) is False


async def test_has_active_run_false_with_failed(db_session: AsyncSession) -> None:
    """A failed AgentRun → has_active_run is False."""
    change = await _create_change(db_session)
    await _create_agent_run(db_session, change_id=change.id, status="failed")
    assert await has_active_run(db_session, change.id) is False


# ===================================================================
# 3. dispatch() — propose stage
# ===================================================================


async def test_dispatch_no_config_for_stage(db_session: AsyncSession) -> None:
    """Draft stage has no config → dispatch returns early."""
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
    """Non-existent change_id → dispatch returns gracefully."""
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

    # Patch AgentService.start_stage_dispatch to avoid real agent execution.
    # The import happens locally inside dispatch(), so we patch the source class.
    from unittest.mock import AsyncMock, patch

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
