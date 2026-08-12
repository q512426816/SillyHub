"""AgentProfile propagation tests for stage dispatch (task-05,
2026-08-12-dispatch-bind-agent-profile).

Covers FR-03/FR-04: the optional ``agent_profile_id`` argument threaded through
``dispatch()`` and ``SillySpecStageDispatchService.dispatch_next_step()`` must
reach ``AgentService.start_stage_dispatch`` verbatim (whose ``agent_profile_id``
formal param already exists, task-06 §8); when omitted it stays ``None`` and the
dispatch layer falls through to ``_resolve_dispatch_profile`` 兜底链（workspace.
default_agent_profile_id → None，C-07 零回归）。

与 test_dispatch_provider.py 同模式——pin 函数/方法边界，HTTP 层端到端由 test_router 覆盖。
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
class TestDispatchAgentProfilePropagation:
    """dispatch() forwards ``agent_profile_id`` to the agent service."""

    async def test_dispatch_passes_explicit_agent_profile_id(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            path=str(tmp_path / ".sillyspec" / "changes" / "change" / "test-dispatch"),
        )
        user_id = uuid.uuid4()
        profile_id = uuid.uuid4()

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
                target_stage="brainstorm",
                user_id=user_id,
                agent_profile_id=profile_id,
            )

        assert result["dispatched"] is True
        assert mock_start.call_args.kwargs["agent_profile_id"] == profile_id

    async def test_dispatch_defaults_agent_profile_id_none(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """不传 agent_profile_id → start_stage_dispatch 收到 None（零回归）。"""
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
                target_stage="brainstorm",
                user_id=user_id,
            )

        assert mock_start.call_args.kwargs["agent_profile_id"] is None


@pytest.mark.asyncio
class TestDispatchNextStepAgentProfilePropagation:
    """dispatch_next_step() forwards ``agent_profile_id`` to the agent service."""

    async def test_dispatch_next_step_passes_explicit_agent_profile_id(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="brainstorm",
        )
        user_id = uuid.uuid4()
        profile_id = uuid.uuid4()
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
                target_stage="brainstorm",
                agent_profile_id=profile_id,
            )

        assert result["dispatched"] is True
        assert mock_start.call_args.kwargs["agent_profile_id"] == profile_id

    async def test_dispatch_next_step_defaults_agent_profile_id_none(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="brainstorm",
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
            await service.dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                target_stage="brainstorm",
            )

        assert mock_start.call_args.kwargs["agent_profile_id"] is None
