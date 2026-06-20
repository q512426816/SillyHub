"""Tests for Coordinator delegation planning + MissionService (Wave 2)."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.delegation import (
    MAX_WORKERS,
    CoordinatorPlanner,
    DelegationError,
    GLMConfig,
    parse_delegations,
)
from app.modules.agent.mission import MissionService
from app.modules.agent.model import AgentMission
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# parse_delegations
# ---------------------------------------------------------------------------


def _del(**over: object) -> dict:
    base = {
        "worker_id": "w",
        "role": "arch",
        "objective": "o",
        "expected_artifact": "a.md",
        "read_only": True,
    }
    base.update(over)
    return base


def test_parse_valid() -> None:
    dels = parse_delegations(
        {
            "summary": "x",
            "delegations": [_del(), _del(worker_id="w2", role="impl", read_only=False)],
        }
    )
    assert len(dels) == 2
    assert dels[0].role == "arch" and dels[0].read_only is True
    assert dels[1].role == "impl" and dels[1].read_only is False


def test_parse_empty_rejected() -> None:
    with pytest.raises(DelegationError):
        parse_delegations({"delegations": []})


def test_parse_too_many_rejected() -> None:
    too_many = {"delegations": [_del(worker_id=f"w{i}") for i in range(MAX_WORKERS + 1)]}
    with pytest.raises(DelegationError):
        parse_delegations(too_many)


def test_parse_bad_role_rejected() -> None:
    with pytest.raises(DelegationError):
        parse_delegations({"delegations": [_del(role="manager")]})


def test_parse_read_only_not_bool_rejected() -> None:
    with pytest.raises(DelegationError):
        parse_delegations({"delegations": [_del(read_only="yes")]})


def test_parse_missing_fields_rejected() -> None:
    bad = {"worker_id": "w", "role": "arch", "read_only": True}  # no objective
    with pytest.raises(DelegationError):
        parse_delegations({"delegations": [bad]})


def test_glm_config_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://glm.test/api")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "tok")
    monkeypatch.setenv("ANTHROPIC_DEFAULT_SONNET_MODEL", "glm-5.2")
    cfg = GLMConfig.from_env()
    assert cfg is not None and cfg.token == "tok" and cfg.model == "glm-5.2"

    monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)
    assert GLMConfig.from_env() is None


# ---------------------------------------------------------------------------
# CoordinatorPlanner.plan (mocked httpx)
# ---------------------------------------------------------------------------


def _mock_client(json_payload: dict) -> MagicMock:
    fake_resp = MagicMock()
    fake_resp.raise_for_status = MagicMock(return_value=None)
    fake_resp.json = MagicMock(return_value=json_payload)
    client = MagicMock()
    client.post = AsyncMock(return_value=fake_resp)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    return client


async def test_planner_plan_parses_response() -> None:
    cfg = GLMConfig(base_url="https://glm.test/api", token="t", model="glm-5.2")
    planner = CoordinatorPlanner(cfg)
    payload = {
        "content": [
            {
                "type": "text",
                "text": '{"summary":"s","delegations":['
                '{"worker_id":"a","role":"arch","objective":"o","expected_artifact":"a.md","read_only":true}]}',
            }
        ]
    }
    with patch(
        "app.modules.agent.delegation.httpx.AsyncClient", return_value=_mock_client(payload)
    ):
        dels = await planner.plan("do something")
    assert len(dels) == 1 and dels[0].worker_id == "a"


async def test_planner_plan_unparseable_raises() -> None:
    cfg = GLMConfig(base_url="https://glm.test/api", token="t", model="glm-5.2")
    planner = CoordinatorPlanner(cfg)
    payload = {"content": [{"type": "text", "text": "no json here"}]}
    with patch(
        "app.modules.agent.delegation.httpx.AsyncClient", return_value=_mock_client(payload)
    ):
        with pytest.raises(DelegationError):
            await planner.plan("do something")


# ---------------------------------------------------------------------------
# MissionService.start_mission (db + mocked planner)
# ---------------------------------------------------------------------------


async def _make_workspace(session: AsyncSession) -> uuid.UUID:
    ws = Workspace(
        id=uuid.uuid4(),
        name="t",
        slug="t",
        root_path="/tmp",
        status="active",
    )
    session.add(ws)
    await session.commit()
    return ws.id


async def test_start_mission_creates_mission_and_worker_runs(
    db_session: AsyncSession,
) -> None:
    planner = MagicMock()
    planner.plan = AsyncMock(
        return_value=[
            MagicMock(
                worker_id="a", role="arch", objective="oa", expected_artifact="a.md", read_only=True
            ),
            MagicMock(
                worker_id="b",
                role="impl",
                objective="ob",
                expected_artifact="b.diff",
                read_only=False,
            ),
        ]
    )
    ws_id = await _make_workspace(db_session)
    svc = MissionService(db_session)
    mission, runs = await svc.start_mission(
        workspace_id=ws_id,
        objective="scan repo",
        planner=planner,
        budget_tokens=10000,
    )

    assert isinstance(mission, AgentMission)
    assert mission.objective == "scan repo"
    assert mission.budget_tokens == 10000
    assert len(runs) == 2
    assert all(r.mission_id == mission.id for r in runs)
    assert all(r.status == "pending" for r in runs)
    assert {r.role for r in runs} == {"arch", "impl"}
    # planner called once with the objective
    planner.plan.assert_awaited_once()
    args, _ = planner.plan.call_args
    assert args[0] == "scan repo"


async def test_start_mission_without_planner_raises(db_session: AsyncSession) -> None:
    ws_id = await _make_workspace(db_session)
    svc = MissionService(db_session)  # no planner
    with pytest.raises(DelegationError):
        await svc.start_mission(workspace_id=ws_id, objective="x")
