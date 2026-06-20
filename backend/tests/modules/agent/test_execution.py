"""Tests for Mission Worker execution + Artifact collection (Wave 3)."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.execution import (
    MissionExecutionService,
    render_worker_prompt,
    worker_tool_config,
)
from app.modules.agent.model import AgentArtifact, AgentMission, AgentRun
from app.modules.workspace.model import Workspace


async def _make_workspace(session: AsyncSession) -> uuid.UUID:
    ws = Workspace(id=uuid.uuid4(), name="t", slug="t", root_path="/tmp", status="active")
    session.add(ws)
    await session.commit()
    return ws.id


async def _make_worker(
    session: AsyncSession, *, mission_id: uuid.UUID, role: str = "arch", objective: str = "scan"
) -> AgentRun:
    run = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        status="pending",
        role=role,
        objective=objective,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


# ---------------------------------------------------------------------------
# worker_tool_config + render_worker_prompt (pure)
# ---------------------------------------------------------------------------


def test_tool_config_read_only_is_plan_no_write_tools() -> None:
    cfg = worker_tool_config(read_only=True)
    assert cfg["mode"] == "plan"
    assert "Write" not in cfg["allowed_tools"] and "Edit" not in cfg["allowed_tools"]


def test_tool_config_write_has_edit_tools() -> None:
    cfg = worker_tool_config(read_only=False)
    assert cfg["mode"] == "acceptEdits"
    assert "Edit" in cfg["allowed_tools"] and "Write" in cfg["allowed_tools"]


def test_render_worker_prompt_includes_role_and_objective() -> None:
    run = AgentRun(id=uuid.uuid4(), agent_type="claude_code", role="test", objective="cover X")
    prompt = render_worker_prompt(run)
    assert "test" in prompt and "cover X" in prompt


# ---------------------------------------------------------------------------
# dispatch_worker (mocked placement)
# ---------------------------------------------------------------------------


async def test_dispatch_worker_calls_placement_with_role_and_tool_config(
    db_session: AsyncSession,
) -> None:
    ws_id = await _make_workspace(db_session)
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    run = await _make_worker(db_session, mission_id=mission.id, role="arch", objective="scan arch")

    fake_placement = MagicMock()
    fake_placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    svc = MissionExecutionService(db_session, placement=fake_placement)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=True
    )

    assert lease_id is not None
    fake_placement.dispatch_to_daemon.assert_awaited_once()
    kwargs = fake_placement.dispatch_to_daemon.call_args.kwargs
    assert kwargs["stage"] == "arch"
    assert kwargs["read_only"] is True
    assert "scan arch" in kwargs["prompt"]
    assert kwargs["tool_config"]["mode"] == "plan"  # read-only governance


async def test_dispatch_worker_rejects_non_pending(db_session: AsyncSession) -> None:
    ws_id = await _make_workspace(db_session)
    run = AgentRun(
        mission_id=uuid.uuid4(),
        agent_type="claude_code",
        status="running",
        role="arch",
    )
    db_session.add(run)
    await db_session.commit()
    svc = MissionExecutionService(db_session, placement=MagicMock())
    with pytest.raises(ValueError):
        await svc.dispatch_worker(run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=True)


# ---------------------------------------------------------------------------
# collect_artifact (db)
# ---------------------------------------------------------------------------


async def test_collect_artifact_persists(db_session: AsyncSession) -> None:
    run = AgentRun(
        mission_id=uuid.uuid4(), agent_type="claude_code", status="completed", role="arch"
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)

    svc = MissionExecutionService(db_session, placement=MagicMock())
    artifact = await svc.collect_artifact(run, "## 发现\n后端是 FastAPI...")
    assert isinstance(artifact, AgentArtifact)
    assert artifact.run_id == run.id
    assert artifact.kind == "summary"
    assert "FastAPI" in artifact.content_ref
