"""Provider propagation tests for stage dispatch (task-06,
2026-06-14-agent-runtime-selection).

Covers FR-02: the optional ``provider`` argument threaded through
``dispatch()`` and ``SillySpecStageDispatchService.dispatch_next_step()`` must
reach ``AgentService.start_stage_dispatch`` verbatim, so manual stage-dispatch
entry points can override the runtime; when omitted it stays ``None`` and the
dispatch layer falls through to ``workspace.default_agent``.

HTTP-layer propagation (transition_change body / manual_dispatch query /
execute_change query) is verified end-to-end by the task-15 suite; these unit
tests pin the function/method boundary.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.change.dispatch import SillySpecStageDispatchService, dispatch
from app.modules.change.tests.test_dispatch import (
    _create_test_change,
    _create_test_workspace,
)

_START = "app.modules.agent.service.AgentService.start_stage_dispatch"


@pytest.mark.asyncio
class TestDispatchProviderPropagation:
    """dispatch() forwards ``provider`` to the agent service."""

    async def test_dispatch_passes_explicit_provider(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            path=str(tmp_path / ".sillyspec" / "changes" / "change" / "test-dispatch"),
        )
        user_id = uuid.uuid4()

        with patch(_START, new_callable=AsyncMock) as mock_start:
            mock_start.return_value = AgentRun(
                id=uuid.uuid4(),
                change_id=change.id,
                agent_type="claude_code",
                status="pending",
            )
            result = await dispatch(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                target_stage="propose",
                user_id=user_id,
                provider="codex",
            )

        assert result["dispatched"] is True
        assert mock_start.call_args.kwargs["provider"] == "codex"

    async def test_dispatch_defaults_provider_none(self, db_session: AsyncSession, tmp_path: Path):
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            path=str(tmp_path / ".sillyspec" / "changes" / "change" / "test-dispatch"),
        )
        user_id = uuid.uuid4()

        with patch(_START, new_callable=AsyncMock) as mock_start:
            mock_start.return_value = AgentRun(
                id=uuid.uuid4(),
                change_id=change.id,
                agent_type="claude_code",
                status="pending",
            )
            await dispatch(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                target_stage="propose",
                user_id=user_id,
            )

        assert mock_start.call_args.kwargs["provider"] is None


@pytest.mark.asyncio
class TestDispatchNextStepProviderPropagation:
    """dispatch_next_step() forwards ``provider`` to the agent service."""

    async def test_dispatch_next_step_passes_explicit_provider(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="propose",
        )
        user_id = uuid.uuid4()
        service = SillySpecStageDispatchService(db_session)

        with (
            patch.object(
                SillySpecStageDispatchService,
                "_build_stage_bundle",
                new=AsyncMock(),
            ),
            patch(_START, new_callable=AsyncMock) as mock_start,
        ):
            mock_start.return_value = AgentRun(
                id=uuid.uuid4(),
                change_id=change.id,
                agent_type="claude_code",
                status="pending",
            )
            result = await service.dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                target_stage="propose",
                provider="codex",
            )

        assert result["dispatched"] is True
        assert mock_start.call_args.kwargs["provider"] == "codex"
