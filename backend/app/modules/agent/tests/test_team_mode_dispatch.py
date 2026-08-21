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

from app.modules.agent.execution import MISSION_WORKER_STAGE, MissionExecutionService
from app.modules.agent.model import AgentMission, AgentRun
from app.modules.daemon.model import DaemonTaskLease
from app.modules.workspace.model import Workspace


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


# ════════════════════════════════════════════════════════════════════════════
# task-09（2026-08-22-team-session-unify / design §5 Phase 2 / Grill NEW-2）：
# 分身派发 lease stage 常量化 MISSION_WORKER_STAGE + run.role 移 lease metadata。
#
# 原 ``stage=run.role or "mission_worker"`` 把 role 塞进 stage，daemon 谓词无法
# 可判定排除分身；改为 stage 恒 'mission_worker'（daemon isMainAgentSession 据此
# 不注入主控 5 工具，防 worker 递归派发，审查 CC-12），role 语义由 lease
# metadata["role"] 保留（execution._apply_worker_role_to_lease 补写）。
# ════════════════════════════════════════════════════════════════════════════


async def _make_worker_workspace(session: AsyncSession) -> uuid.UUID:
    """建一个最小 workspace（dispatch_worker 的 ws.root_path/default_agent 依赖）。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name="t",
        slug="t",
        root_path="/tmp/repo",
        default_branch="main",
        default_agent="claude_code",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws.id


async def _make_worker_run(
    session: AsyncSession, mission_id: uuid.UUID, *, role: str | None
) -> AgentRun:
    run = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        status="pending",
        role=role,
        objective="scan arch",
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


def _make_lease_writing_placement(session: AsyncSession) -> MagicMock:
    """fake RunPlacementService：dispatch_to_daemon 把 kwargs 落成真实 DaemonTaskLease 行。

    模拟 placement.py:421 的 ``metadata["stage"] = stage`` 写入（真 placement 需
    在线 runtime，测试内以 side_effect 直接落 lease 行 + 返回 lease id），让
    execution 的 role 补写（raw SQL 读-合并-写回）有真实 metadata 可读。
    """

    async def _write_lease(*args: object, **kwargs: object) -> uuid.UUID:
        # 前两参（agent_run_id / user_id）为位置传参，*args 吸收。
        lease_id = uuid.uuid4()
        session.add(
            DaemonTaskLease(
                id=lease_id,
                status="pending",
                metadata_={
                    "stage": kwargs.get("stage"),
                    "prompt": kwargs.get("prompt"),
                },
            )
        )
        await session.commit()
        return lease_id

    placement = MagicMock()
    placement.dispatch_to_daemon = AsyncMock(side_effect=_write_lease)
    return placement


async def _fetch_lease_meta(session: AsyncSession, lease_id: uuid.UUID) -> dict | None:
    lease = (
        (await session.execute(select(DaemonTaskLease).where(DaemonTaskLease.id == lease_id)))
        .scalars()
        .first()
    )
    if lease is None:
        return None
    # role 补写走 raw SQL UPDATE（对齐 _apply_profile_to_lease），须 refresh 刷
    # ORM 身份映射缓存再读（同 test_dispatch_profile.py:478 模式）。
    await session.refresh(lease)
    return lease.metadata_ or {}


class TestWorkerLeaseStageConstant:
    """task-09：dispatch_worker 派发 lease stage 恒 MISSION_WORKER_STAGE。"""

    @pytest.mark.asyncio
    async def test_dispatch_stage_is_mission_worker_constant(
        self, db_session: AsyncSession
    ) -> None:
        """run.role='arch' → dispatch_to_daemon(stage=MISSION_WORKER_STAGE)，非 role 值。

        谓词可判定前提：stage 不再携带 role 语义（原 ``run.role or "mission_worker"``
        会产生 stage='arch' 等任意值）。
        """
        ws_id = await _make_worker_workspace(db_session)
        mission = AgentMission(workspace_id=ws_id, objective="o")
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)
        run = await _make_worker_run(db_session, mission.id, role="arch")

        placement = _make_lease_writing_placement(db_session)
        svc = MissionExecutionService(db_session, placement=placement)

        lease_id = await svc.dispatch_worker(
            run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
        )

        assert lease_id is not None
        kwargs = placement.dispatch_to_daemon.call_args.kwargs
        assert kwargs["stage"] == MISSION_WORKER_STAGE == "mission_worker"
        assert kwargs["stage"] != run.role

    @pytest.mark.asyncio
    async def test_lease_metadata_keeps_role_and_constant_stage(
        self, db_session: AsyncSession
    ) -> None:
        """派发后 lease metadata：stage 恒 'mission_worker' + role 键含原 run.role。"""
        ws_id = await _make_worker_workspace(db_session)
        mission = AgentMission(workspace_id=ws_id, objective="o")
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)
        run = await _make_worker_run(db_session, mission.id, role="arch")

        placement = _make_lease_writing_placement(db_session)
        svc = MissionExecutionService(db_session, placement=placement)

        lease_id = await svc.dispatch_worker(
            run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
        )

        assert lease_id is not None
        meta = await _fetch_lease_meta(db_session, lease_id)
        assert meta is not None
        assert meta["stage"] == "mission_worker"
        assert meta["role"] == "arch"

    @pytest.mark.asyncio
    async def test_role_empty_writes_no_role_key(self, db_session: AsyncSession) -> None:
        """run.role=None → metadata 只含常量 stage，不写 role 键（空值不写）。"""
        ws_id = await _make_worker_workspace(db_session)
        mission = AgentMission(workspace_id=ws_id, objective="o")
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)
        run = await _make_worker_run(db_session, mission.id, role=None)

        placement = _make_lease_writing_placement(db_session)
        svc = MissionExecutionService(db_session, placement=placement)

        lease_id = await svc.dispatch_worker(
            run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=True
        )

        assert lease_id is not None
        meta = await _fetch_lease_meta(db_session, lease_id)
        assert meta is not None
        assert meta["stage"] == "mission_worker"
        assert "role" not in meta
