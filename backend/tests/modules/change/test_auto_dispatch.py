"""Tests for task-10: auto_dispatch_next_step + _execute_stage_run completion callback."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change.dispatch import (
    _DISPATCH_CHAIN_LIMIT,
    StageSyncResult,
    auto_dispatch_next_step,
)

# ---------------------------------------------------------------------------
# auto_dispatch_next_step tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_auto_dispatch_creates_next_run():
    """has_pending_step=True 时自动调度下一个 AgentRun。"""
    change_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()

    sync_result = StageSyncResult(
        synced=True,
        change_id=change_id,
        run_id=uuid.uuid4(),
        current_stage="propose",
        current_step="write-requirements",
        stage_completed=False,
        has_pending_step=True,
        steps_completed=["brainstorm"],
        steps_pending=["write-requirements"],
    )

    mock_session = AsyncMock(spec=AsyncSession)
    mock_change = MagicMock()
    mock_change.stages = {}
    mock_change.human_gate = "none"
    mock_change.current_stage = "propose"
    mock_session.get = AsyncMock(return_value=mock_change)

    with patch("app.modules.change.dispatch.dispatch", new_callable=AsyncMock) as mock_dispatch:
        mock_dispatch.return_value = {
            "dispatched": True,
            "agent_run_id": str(uuid.uuid4()),
            "stage": "propose",
        }
        result = await auto_dispatch_next_step(
            session=mock_session,
            workspace_id=workspace_id,
            change_id=change_id,
            user_id=user_id,
            sync_result=sync_result,
        )

    assert result["dispatched"] is True
    assert result["reason"] == "auto_dispatch"
    mock_dispatch.assert_called_once()


@pytest.mark.asyncio
async def test_auto_dispatch_stops_on_stage_completed():
    """stage_completed=True 时不自动调度。"""
    change_id = uuid.uuid4()

    sync_result = StageSyncResult(
        synced=True,
        change_id=change_id,
        run_id=uuid.uuid4(),
        current_stage="propose",
        stage_completed=True,
        has_pending_step=False,
        steps_completed=["brainstorm", "write-requirements"],
        steps_pending=[],
    )

    mock_session = AsyncMock(spec=AsyncSession)
    mock_change = MagicMock()
    mock_change.stages = {}
    mock_change.human_gate = "none"
    mock_change.current_stage = "propose"
    mock_session.get = AsyncMock(return_value=mock_change)

    with (
        patch("app.modules.change.dispatch.dispatch", new_callable=AsyncMock) as mock_dispatch,
        patch("app.modules.change.service.ChangeService.reparse", new_callable=AsyncMock),
        patch(
            "app.modules.change.service.ChangeService.complete_stage", new_callable=AsyncMock
        ) as mock_complete,
    ):
        mock_complete.return_value = MagicMock(dispatch_target=None, gate="need_proposal_review")
        result = await auto_dispatch_next_step(
            session=mock_session,
            workspace_id=uuid.uuid4(),
            change_id=change_id,
            user_id=uuid.uuid4(),
            sync_result=sync_result,
        )

    assert result["dispatched"] is False
    assert result["reason"] == "stage_completed"
    mock_dispatch.assert_not_called()


@pytest.mark.asyncio
async def test_auto_dispatch_stops_on_sync_failed():
    """synced=False 时不触发自动调度。"""
    sync_result = StageSyncResult(
        synced=False,
        change_id=uuid.uuid4(),
        run_id=uuid.uuid4(),
        error="sillyspec.db not found",
    )

    mock_session = AsyncMock(spec=AsyncSession)

    with patch("app.modules.change.dispatch.dispatch", new_callable=AsyncMock) as mock_dispatch:
        result = await auto_dispatch_next_step(
            session=mock_session,
            workspace_id=uuid.uuid4(),
            change_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            sync_result=sync_result,
        )

    assert result["dispatched"] is False
    assert result["reason"] == "sync_failed"
    mock_dispatch.assert_not_called()


@pytest.mark.asyncio
async def test_auto_dispatch_stops_on_no_pending_step():
    """has_pending_step=False + stage_completed=False 时不调度。"""
    sync_result = StageSyncResult(
        synced=True,
        change_id=uuid.uuid4(),
        run_id=uuid.uuid4(),
        current_stage="plan",
        stage_completed=False,
        has_pending_step=False,
        steps_completed=["step1"],
        steps_pending=[],
    )

    mock_session = AsyncMock(spec=AsyncSession)
    mock_change = MagicMock()
    mock_change.stages = {}
    mock_change.human_gate = "none"
    mock_change.current_stage = "plan"
    mock_session.get = AsyncMock(return_value=mock_change)

    with patch("app.modules.change.dispatch.dispatch", new_callable=AsyncMock) as mock_dispatch:
        result = await auto_dispatch_next_step(
            session=mock_session,
            workspace_id=uuid.uuid4(),
            change_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            sync_result=sync_result,
        )

    assert result["dispatched"] is False
    assert result["reason"] == "no_pending_step"
    mock_dispatch.assert_not_called()


@pytest.mark.asyncio
async def test_auto_dispatch_stops_on_chain_limit():
    """连续 dispatch 超过限制后停止。"""
    change_id = uuid.uuid4()

    sync_result = StageSyncResult(
        synced=True,
        change_id=change_id,
        run_id=uuid.uuid4(),
        current_stage="execute",
        stage_completed=False,
        has_pending_step=True,
        steps_completed=["task-01"],
        steps_pending=["task-02"],
    )

    mock_session = AsyncMock(spec=AsyncSession)
    mock_change = MagicMock()
    mock_change.stages = {"_dispatch_chain_count": _DISPATCH_CHAIN_LIMIT}
    mock_change.human_gate = "none"
    mock_change.current_stage = "execute"
    mock_session.get = AsyncMock(return_value=mock_change)

    with patch("app.modules.change.dispatch.dispatch", new_callable=AsyncMock) as mock_dispatch:
        result = await auto_dispatch_next_step(
            session=mock_session,
            workspace_id=uuid.uuid4(),
            change_id=change_id,
            user_id=uuid.uuid4(),
            sync_result=sync_result,
        )

    assert result["dispatched"] is False
    assert result["reason"] == "chain_limit_reached"
    mock_dispatch.assert_not_called()


@pytest.mark.asyncio
async def test_auto_dispatch_resets_chain_on_dispatch_failure():
    """dispatch() 返回 dispatched=False 时重置 chain_count。"""
    change_id = uuid.uuid4()

    sync_result = StageSyncResult(
        synced=True,
        change_id=change_id,
        run_id=uuid.uuid4(),
        current_stage="propose",
        stage_completed=False,
        has_pending_step=True,
        steps_completed=["brainstorm"],
        steps_pending=["write-requirements"],
    )

    mock_session = AsyncMock(spec=AsyncSession)
    mock_change = MagicMock()
    mock_change.stages = {"_dispatch_chain_count": 5}
    mock_change.human_gate = "none"
    mock_change.current_stage = "propose"
    mock_session.get = AsyncMock(return_value=mock_change)

    with patch("app.modules.change.dispatch.dispatch", new_callable=AsyncMock) as mock_dispatch:
        mock_dispatch.return_value = {
            "dispatched": False,
            "reason": "active_run_exists",
        }
        result = await auto_dispatch_next_step(
            session=mock_session,
            workspace_id=uuid.uuid4(),
            change_id=change_id,
            user_id=uuid.uuid4(),
            sync_result=sync_result,
        )

    assert result["dispatched"] is False
    # Verify chain_count was reset
    assert mock_change.stages["_dispatch_chain_count"] == 0


@pytest.mark.asyncio
async def test_auto_dispatch_increments_chain_count():
    """成功 dispatch 时递增 chain_count。"""
    change_id = uuid.uuid4()

    sync_result = StageSyncResult(
        synced=True,
        change_id=change_id,
        run_id=uuid.uuid4(),
        current_stage="execute",
        stage_completed=False,
        has_pending_step=True,
        steps_completed=["task-01"],
        steps_pending=["task-02"],
    )

    mock_session = AsyncMock(spec=AsyncSession)
    mock_change = MagicMock()
    mock_change.stages = {"_dispatch_chain_count": 3}
    mock_change.human_gate = "none"
    mock_change.current_stage = "execute"
    mock_session.get = AsyncMock(return_value=mock_change)

    with patch("app.modules.change.dispatch.dispatch", new_callable=AsyncMock) as mock_dispatch:
        mock_dispatch.return_value = {
            "dispatched": True,
            "agent_run_id": str(uuid.uuid4()),
            "stage": "execute",
        }
        result = await auto_dispatch_next_step(
            session=mock_session,
            workspace_id=uuid.uuid4(),
            change_id=change_id,
            user_id=uuid.uuid4(),
            sync_result=sync_result,
        )

    assert result["dispatched"] is True
    assert mock_change.stages["_dispatch_chain_count"] == 4


# ---------------------------------------------------------------------------
# _execute_stage_run completion callback tests
# ---------------------------------------------------------------------------
