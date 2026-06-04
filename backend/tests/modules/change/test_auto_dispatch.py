"""Tests for task-10: auto_dispatch_next_step + _execute_stage_run completion callback."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change.dispatch import (
    _DISPATCH_CHAIN_LIMIT,
    SillySpecStageDispatchService,
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


@pytest.mark.asyncio
async def test_execute_stage_run_calls_auto_dispatch_on_success():
    """AgentRun 成功完成后触发 sync + auto dispatch。"""
    from app.modules.agent.service import AgentService

    run_id = uuid.uuid4()
    change_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()

    fake_result = MagicMock()
    fake_result.exit_code = 0
    fake_result.stdout = "ok"
    fake_result.stderr = ""
    fake_result.redacted_output = "done"

    mock_session = AsyncMock(spec=AsyncSession)
    agent_run_mock = MagicMock(
        id=run_id,
        status="pending",
        started_at=None,
        finished_at=None,
        exit_code=None,
        output_redacted=None,
        diff_summary=None,
    )
    change_mock = MagicMock(stages={})
    get_call_count = [0]

    async def _get(model, pk):
        get_call_count[0] += 1
        if get_call_count[0] <= 1:
            return agent_run_mock
        return change_mock

    mock_session.get = AsyncMock(side_effect=_get)
    mock_session.add = MagicMock()
    mock_session.commit = AsyncMock()
    mock_session.execute = AsyncMock()

    mock_factory = MagicMock()
    mock_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    sync_result = StageSyncResult(
        synced=True,
        change_id=change_id,
        run_id=run_id,
        current_stage="propose",
        has_pending_step=True,
        stage_completed=False,
        steps_completed=["brainstorm"],
        steps_pending=["write-requirements"],
    )

    with (
        patch("app.core.db.get_session_factory", return_value=mock_factory),
        patch(
            "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
            new_callable=AsyncMock,
            return_value=fake_result,
        ),
        patch("app.modules.agent.service.AgentRunLog"),
        patch("app.modules.workflow.model.AuditLog"),
    ):
        with patch.object(
            SillySpecStageDispatchService,
            "sync_stage_status",
            new_callable=AsyncMock,
            return_value=sync_result,
        ) as mock_sync:
            with patch(
                "app.modules.change.dispatch.auto_dispatch_next_step",
                new_callable=AsyncMock,
            ) as mock_auto:
                mock_auto.return_value = {
                    "dispatched": True,
                    "reason": "auto_dispatch",
                }
                svc = AgentService(AsyncMock(spec=AsyncSession))
                await svc._execute_stage_run(
                    run_id=run_id,
                    prompt="Execute propose stage.",
                    work_dir=MagicMock(mkdir=MagicMock()),
                    read_only=False,
                    workspace_id=workspace_id,
                    change_id=change_id,
                    user_id=user_id,
                    stage="propose",
                )

    mock_sync.assert_called_once()
    mock_auto.assert_called_once()


@pytest.mark.asyncio
async def test_execute_stage_run_skips_auto_dispatch_on_failure():
    """AgentRun 失败时不触发 auto dispatch。"""
    from app.modules.agent.service import AgentService

    run_id = uuid.uuid4()
    change_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()

    fake_result = MagicMock()
    fake_result.exit_code = 1
    fake_result.stdout = ""
    fake_result.stderr = "error occurred"
    fake_result.redacted_output = "failed"

    mock_session = AsyncMock(spec=AsyncSession)
    agent_run_mock = MagicMock(
        id=run_id,
        status="pending",
        started_at=None,
        finished_at=None,
        exit_code=None,
        output_redacted=None,
        diff_summary=None,
    )
    change_mock = MagicMock(stages={})
    get_call_count = [0]

    async def _get(model, pk):
        get_call_count[0] += 1
        if get_call_count[0] <= 1:
            return agent_run_mock
        return change_mock

    mock_session.get = AsyncMock(side_effect=_get)
    mock_session.add = MagicMock()
    mock_session.commit = AsyncMock()
    mock_session.execute = AsyncMock()

    mock_factory = MagicMock()
    mock_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.core.db.get_session_factory", return_value=mock_factory),
        patch(
            "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
            new_callable=AsyncMock,
            return_value=fake_result,
        ),
        patch("app.modules.agent.service.AgentRunLog"),
        patch("app.modules.workflow.model.AuditLog"),
    ):
        with patch.object(
            SillySpecStageDispatchService,
            "sync_stage_status",
            new_callable=AsyncMock,
        ) as mock_sync:
            with patch(
                "app.modules.change.dispatch.auto_dispatch_next_step",
                new_callable=AsyncMock,
            ) as mock_auto:
                svc = AgentService(AsyncMock(spec=AsyncSession))
                await svc._execute_stage_run(
                    run_id=run_id,
                    prompt="Execute propose stage.",
                    work_dir=MagicMock(mkdir=MagicMock()),
                    read_only=False,
                    workspace_id=workspace_id,
                    change_id=change_id,
                    user_id=user_id,
                    stage="propose",
                )

    mock_sync.assert_not_called()
    mock_auto.assert_not_called()


@pytest.mark.asyncio
async def test_execute_stage_run_auto_dispatch_exception_does_not_affect_run():
    """auto_dispatch 异常不影响 AgentRun 完成状态。"""
    from app.modules.agent.service import AgentService

    run_id = uuid.uuid4()
    change_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()

    fake_result = MagicMock()
    fake_result.exit_code = 0
    fake_result.stdout = "ok"
    fake_result.stderr = ""
    fake_result.redacted_output = "done"

    mock_session = AsyncMock(spec=AsyncSession)
    agent_run_mock = MagicMock(
        id=run_id,
        status="pending",
        started_at=None,
        finished_at=None,
        exit_code=None,
        output_redacted=None,
        diff_summary=None,
    )
    change_mock = MagicMock(stages={})
    get_call_count = [0]

    async def _get(model, pk):
        get_call_count[0] += 1
        if get_call_count[0] <= 1:
            return agent_run_mock
        return change_mock

    mock_session.get = AsyncMock(side_effect=_get)
    mock_session.add = MagicMock()
    mock_session.commit = AsyncMock()
    mock_session.execute = AsyncMock()

    mock_factory = MagicMock()
    mock_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    sync_result = StageSyncResult(
        synced=True,
        change_id=change_id,
        run_id=run_id,
        current_stage="propose",
        has_pending_step=True,
        stage_completed=False,
    )

    with (
        patch("app.core.db.get_session_factory", return_value=mock_factory),
        patch(
            "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
            new_callable=AsyncMock,
            return_value=fake_result,
        ),
        patch("app.modules.agent.service.AgentRunLog"),
        patch("app.modules.workflow.model.AuditLog"),
    ):
        with patch.object(
            SillySpecStageDispatchService,
            "sync_stage_status",
            new_callable=AsyncMock,
            return_value=sync_result,
        ):
            with patch(
                "app.modules.change.dispatch.auto_dispatch_next_step",
                new_callable=AsyncMock,
                side_effect=RuntimeError("unexpected error"),
            ):
                svc = AgentService(AsyncMock(spec=AsyncSession))
                # Should NOT raise
                await svc._execute_stage_run(
                    run_id=run_id,
                    prompt="Execute propose stage.",
                    work_dir=MagicMock(mkdir=MagicMock()),
                    read_only=False,
                    workspace_id=workspace_id,
                    change_id=change_id,
                    user_id=user_id,
                    stage="propose",
                )

    # AgentRun should still be "completed"
    assert agent_run_mock.status == "completed"
