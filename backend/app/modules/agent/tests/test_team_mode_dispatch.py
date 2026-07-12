"""Team-mode dispatch transparency tests (Wave 1, 2026-07-12-team-mode-platform-wide).

Covers task-01 (MissionCreateRequest mode/session_id fields) + task-02
(router create_mission forwarding both into ``constraints``) at the HTTP
boundary, without invoking the real GLM planner:

1. ``mode="team"`` is forwarded → ``AgentMission.constraints["mode"] == "team"``.
2. ``session_id=<uuid>`` is forwarded → ``constraints["session_id"] == str(uuid)``.
3. No ``mode`` in body → ``constraints`` has no ``mode`` key (single zero-regression).
4. ``mode="single"`` explicit → ``constraints["mode"] == "single"`` (forwarded, not split).

Constraints:
- The GLM planner is mocked (``CoordinatorPlanner.plan`` returns ``("", [])``) so
  no worker Runs are created and the daemon-dispatch loop is never entered; the
  test only asserts the constraints forwarding into the persisted ``AgentMission``.
- ``GLMConfig.from_env`` is mocked to a non-None sentinel so the router does not
  short-circuit to 503 (test env has no ANTHROPIC_* configured).
- Wave 1 is "transparent forwarding only": ``route()`` is NOT called here and no
  ``session_id`` model column is added (stored in ``constraints`` per R-B).
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission


def _planner_stub() -> MagicMock:
    """A fake ``CoordinatorPlanner`` whose ``plan`` returns empty delegations.

    Empty delegations → ``start_mission`` persists the Mission but no Worker
    Runs → the router's dispatch loop is skipped → no daemon is contacted.
    The summary is empty so it is NOT merged into ``constraints`` (which would
    otherwise muddy the mode/session_id assertions below).
    """
    planner = MagicMock()
    planner.plan = AsyncMock(return_value=("", []))
    return planner


@pytest.fixture()
def _glm_enabled():
    """Mock ``GLMConfig.from_env`` to a non-None sentinel + ``CoordinatorPlanner``
    to a stub returning empty delegations, for the duration of one request.

    Yields the planner stub so individual tests can additionally assert on the
    constraints the router built and passed to ``plan`` / ``start_mission``.
    """
    planner = _planner_stub()
    with (
        patch("app.modules.agent.router.GLMConfig") as glm_cls,
        patch("app.modules.agent.router.CoordinatorPlanner", return_value=planner),
    ):
        glm_cls.from_env.return_value = MagicMock(base_url="x", token="x", model="x")
        yield planner


async def _create_mission(client, headers: dict[str, str], ws_id: uuid.UUID, body: dict) -> dict:
    resp = await client.post(
        f"/api/workspaces/{ws_id}/missions",
        json=body,
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _fetch_mission_constraints(
    db_session: AsyncSession, mission_id: uuid.UUID
) -> dict | None:
    mission = (
        (await db_session.execute(select(AgentMission).where(AgentMission.id == mission_id)))
        .scalars()
        .first()
    )
    return None if mission is None else (mission.constraints or {})


class TestModeForwarded:
    @pytest.mark.asyncio
    async def test_mode_team_forwarded_into_constraints(
        self, client, db_session, auth_headers, _glm_enabled
    ) -> None:
        """POST body ``{objective, mode:"team"}`` → 落库 constraints["mode"]=="team"。"""
        ws_id = uuid.uuid4()
        body = {"objective": "分析整体架构", "mode": "team"}

        data = await _create_mission(client, auth_headers, ws_id, body)

        constraints = await _fetch_mission_constraints(db_session, uuid.UUID(data["id"]))
        assert constraints is not None
        assert constraints.get("mode") == "team"


class TestSessionIdForwarded:
    @pytest.mark.asyncio
    async def test_session_id_forwarded_as_string(
        self, client, db_session, auth_headers, _glm_enabled
    ) -> None:
        """POST body ``{objective, session_id:<uuid>}`` → 落库 constraints["session_id"]==str(uuid)。"""
        ws_id = uuid.uuid4()
        sid = uuid.uuid4()
        body = {"objective": "分析整体架构", "session_id": str(sid)}

        data = await _create_mission(client, auth_headers, ws_id, body)

        constraints = await _fetch_mission_constraints(db_session, uuid.UUID(data["id"]))
        assert constraints is not None
        # router.py:749 str(payload.session_id) — stored as string, not UUID
        assert constraints.get("session_id") == str(sid)


class TestSingleZeroRegression:
    @pytest.mark.asyncio
    async def test_no_mode_in_body_leaves_constraints_without_mode_key(
        self, client, db_session, auth_headers, _glm_enabled
    ) -> None:
        """POST body ``{objective}``（不带 mode）→ constraints 无 mode 键（single 零回归）。

        Wave 1 设计：前端默认不传 mode，router 不写入 mode，constraints 保持干净，
        避免下游 route() 误判为显式 single（D-003/D-004）。
        """
        ws_id = uuid.uuid4()
        body = {"objective": "改个按钮文案"}

        data = await _create_mission(client, auth_headers, ws_id, body)

        constraints = await _fetch_mission_constraints(db_session, uuid.UUID(data["id"]))
        assert constraints is not None
        assert "mode" not in constraints, (
            f"未传 mode 时 constraints 不应包含 mode 键，实际={constraints}"
        )


class TestModeSingleExplicit:
    @pytest.mark.asyncio
    async def test_mode_single_explicit_forwarded(
        self, client, db_session, auth_headers, _glm_enabled
    ) -> None:
        """POST body ``{objective, mode:"single"}`` → constraints["mode"]=="single"。

        透传但不分流（Wave 1 不调 route()）；显式 single 与"未传 mode"语义有别：
        前者写入 mode 键供下游显式判断，后者不写入。
        """
        ws_id = uuid.uuid4()
        body = {"objective": "改个按钮文案", "mode": "single"}

        data = await _create_mission(client, auth_headers, ws_id, body)

        constraints = await _fetch_mission_constraints(db_session, uuid.UUID(data["id"]))
        assert constraints is not None
        assert constraints.get("mode") == "single"
