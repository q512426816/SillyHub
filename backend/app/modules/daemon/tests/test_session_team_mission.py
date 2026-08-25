"""task-03 单测：会话团队触发/列表端点（2026-08-22-team-session-unify）。

钉死 POST /api/daemon/sessions/{id}/team-mission 与 GET .../team-missions：
- 预建落库——scope_workspace_ids/project_id 冻结快照、objective 空落占位
  （SESSION_OBJECTIVE_PLACEHOLDER）、不建主控 AgentRun、不派 daemon lease；
- 活跃冲突 409（R-07）；已终态（cancelled_at 置位）后可再建；
- scope 未传取 session.workspace_id，会话无工作区且未传 → 422（CC-10 同款语义）；
- 项目维度校验复用——非项目经理 403 + scope 越界（∉ 项目关联工作区）422 +
  anchor 缺省 backend-code 优先（对齐 agent/router.py 旧项目端点口径）；
- 列表按 created_at 倒序 + workers 过滤 role != orchestrator（D-009），
  status 用扩展后 derive_status（含 awaiting_input 档，会话维度入参）；
- 归属校验 404 同 get_session_detail 口径（跨用户/不存在同语义）。

task-02 并行契约（derive_status 扩展签名 / get_active_mission_for_session）
以「缺失才 stub」的兜底方式处理联调时序：真实现已落地时直接用真实现（联调
覆盖），仅符号/签名尚未就绪时才装同语义局部 stub（autouse fixture）。
"""

from __future__ import annotations

import inspect
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

import pytest
from sqlalchemy import event, select

from app.modules.agent.model import AgentMission, AgentRun, AgentRunLog, AgentSession
from app.modules.daemon.model import DaemonTaskLease
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import PpmProjectWorkspace, Workspace

# ── task-02 并行契约 stub（仅缺失时装载，联调时序兜底）────────────────────────


@pytest.fixture(autouse=True)
def _stub_task02_mission_contracts(monkeypatch: pytest.MonkeyPatch) -> None:
    """task-02 契约缺失时的同语义兜底 stub（真实现落地后零 patch、走真链路）。

    - ``get_active_mission_for_session(db, session_id)``：按 session_id 取活跃
      mission（converged_at IS NULL 且 cancelled_at IS NULL）最新一条，无则 None；
    - ``derive_status(runs, cancelled, *, converged, has_session,
      session_active_turn)``：design §5 Phase1 判据矩阵（含 awaiting_input 档）。

    daemon/router.py 内为延迟 import（调用时取模块属性），patch 模块属性即可
    生效；task-02 落地后本 fixture 检测到真符号/签名齐全则不 patch——测试跑
    的就是真实现（联调验证），仅并行时序未就绪时退回 stub。
    """
    import app.modules.agent.mission as mission_mod

    if not hasattr(mission_mod, "get_active_mission_for_session"):

        async def _get_active_mission_for_session(db, session_id):
            stmt = (
                select(AgentMission)
                .where(
                    AgentMission.session_id == session_id,
                    AgentMission.converged_at.is_(None),
                    AgentMission.cancelled_at.is_(None),
                )
                .order_by(AgentMission.created_at.desc())
                .limit(1)
            )
            return (await db.execute(stmt)).scalars().first()

        monkeypatch.setattr(
            mission_mod,
            "get_active_mission_for_session",
            _get_active_mission_for_session,
            raising=False,
        )

    _derive_params = set(inspect.signature(mission_mod.derive_status).parameters)
    if not {"converged", "has_session", "session_active_turn"} <= _derive_params:
        active = {"pending", "running"}
        done = {"completed"}
        failed = {"failed", "killed"}

        def _derive_status(
            runs,
            cancelled: bool = False,
            *,
            converged: bool = False,
            has_session: bool = False,
            session_active_turn: bool = False,
        ) -> str:
            if cancelled:
                return "cancelled"
            worker_runs = [r for r in runs if r.role != "orchestrator"]
            has_orchestrator = any(r.role == "orchestrator" for r in runs)
            if not worker_runs and not has_orchestrator:
                return "planning"
            if any(r.status in active for r in runs):
                return "running"
            if not converged and not session_active_turn and has_session:
                return "awaiting_input"
            has_completed = any(r.status in done for r in runs)
            has_failed = any(r.status in failed for r in runs)
            if has_completed and has_failed:
                return "degraded"
            if has_completed:
                return "done"
            return "failed"

        monkeypatch.setattr(mission_mod, "derive_status", _derive_status, raising=False)


# ── Seeding helpers ──────────────────────────────────────────────────────────


async def _admin_id(db_session) -> uuid.UUID:
    from app.modules.auth.model import User

    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin.id


def _ws(name: str, ws_type: str, tmp_path) -> Workspace:
    ws_id = uuid.uuid4()
    return Workspace(
        id=ws_id,
        name=f"{name} Workspace",
        slug=f"{name}-{ws_id.hex[:8]}",
        root_path=str(tmp_path / name),
        status="active",
        type=ws_type,
    )


async def _seed_env(
    db_session,
    tmp_path,
    *,
    owner_id: uuid.UUID | None = None,
    session_workspace_id: uuid.UUID | None = None,
    with_project: bool = False,
) -> dict:
    """建 backend/frontend 两工作区（+ 可选项目与关联）+ owner 的 AgentSession。"""
    if owner_id is None:
        owner_id = await _admin_id(db_session)
    ws_backend = _ws("backend", "backend-code", tmp_path)
    ws_frontend = _ws("frontend", "frontend-code", tmp_path)
    db_session.add_all([ws_backend, ws_frontend])

    env: dict = {"backend_ws": ws_backend, "frontend_ws": ws_frontend}

    if with_project:
        manager_id = owner_id
        project = PpmProjectMaintenance(
            id=uuid.uuid4(),
            project_name="Test Project",
            project_code="TP001",
            project_status="进行中",
            project_type="研发",
            created_by=manager_id,
        )
        db_session.add(project)
        # owner 成为项目经理（role_name=项目经理，data_scope.manager_project_ids 命中）
        db_session.add(
            PpmProjectMember(
                pm_project_id=project.id,
                user_id=manager_id,
                role_name="项目经理",
            )
        )
        # 仅 backend 关联项目——frontend 留作越界用例
        db_session.add(PpmProjectWorkspace(ppm_project_id=project.id, workspace_id=ws_backend.id))
        db_session.add(PpmProjectWorkspace(ppm_project_id=project.id, workspace_id=ws_frontend.id))
        env["project"] = project

    sid = uuid.uuid4()
    db_session.add(
        AgentSession(
            id=sid,
            user_id=owner_id,
            provider="claude",
            status="active",
            workspace_id=session_workspace_id,
        )
    )
    await db_session.commit()
    env["session_id"] = sid
    return env


def _plain_user_token(db_session, user_id: uuid.UUID, email: str) -> str:
    from app.core.config import get_settings
    from app.core.security import create_access_token

    token, _ = create_access_token(
        user_id=user_id,
        email=email,
        is_admin=False,
        settings=get_settings(),
    )
    return token


# ── POST /sessions/{id}/team-mission（预建）───────────────────────────────────


class TestTriggerSessionTeamMission:
    @pytest.mark.asyncio
    async def test_prebuild_freezes_scope_and_placeholder_objective(
        self, client, auth_headers, db_session, tmp_path
    ) -> None:
        """预建落库：scope/project/budget/preset 冻结快照 + objective 空落占位 +
        anchor 缺省 scope 内 backend-code 优先；不建主控 run、不派 lease。"""
        from app.modules.agent.orchestrator import SESSION_OBJECTIVE_PLACEHOLDER

        env = await _seed_env(db_session, tmp_path, with_project=True)
        resp = await client.post(
            f"/api/daemon/sessions/{env['session_id']}/team-mission",
            headers=auth_headers,
            json={
                "scope_workspace_ids": [
                    str(env["frontend_ws"].id),
                    str(env["backend_ws"].id),
                ],
                "project_id": str(env["project"].id),
                "budget_usd": 5.0,
                "worker_preset": [{"role": "dev", "agent_type": "claude_code"}],
                "main_agent_config": {"provider": "claude"},
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == "planning"  # 无任何 run → planning
        assert body["objective"] == SESSION_OBJECTIVE_PLACEHOLDER
        assert body["scope_workspace_ids"] == [
            str(env["frontend_ws"].id),
            str(env["backend_ws"].id),
        ]
        assert body["budget_usd"] == 5.0
        assert body["workers"] == []

        mission = (
            await db_session.execute(
                select(AgentMission).where(AgentMission.id == uuid.UUID(body["mission_id"]))
            )
        ).scalar_one()
        # session_id 列落库（会话锚点）
        assert mission.session_id == env["session_id"]
        # 冻结快照：scope（str 列表）/ project / budget / preset / main_agent_config
        assert mission.scope_workspace_ids == [
            str(env["frontend_ws"].id),
            str(env["backend_ws"].id),
        ]
        assert mission.project_id == env["project"].id
        assert mission.budget_usd == 5.0
        assert mission.worker_preset == [{"role": "dev", "agent_type": "claude_code"}]
        assert mission.main_agent_config == {"provider": "claude"}
        assert mission.objective == SESSION_OBJECTIVE_PLACEHOLDER
        # anchor 缺省：scope 内 type=backend-code 优先（frontend 在前也不抢）
        assert mission.workspace_id == env["backend_ws"].id
        # 预建不建主控 AgentRun、不派 daemon lease
        run_count = len(
            (await db_session.execute(select(AgentRun).where(AgentRun.mission_id == mission.id)))
            .scalars()
            .all()
        )
        assert run_count == 0
        lease_count = len((await db_session.execute(select(DaemonTaskLease))).scalars().all())
        assert lease_count == 0

    @pytest.mark.asyncio
    async def test_prebuild_uses_explicit_objective(
        self, client, auth_headers, db_session, tmp_path
    ) -> None:
        """显式传 objective 时原样落库（不落占位）。"""
        env = await _seed_env(db_session, tmp_path, session_workspace_id=None)
        resp = await client.post(
            f"/api/daemon/sessions/{env['session_id']}/team-mission",
            headers=auth_headers,
            json={
                "objective": "帮我分析这个仓库的架构",
                "scope_workspace_ids": [str(env["backend_ws"].id)],
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["objective"] == "帮我分析这个仓库的架构"

    @pytest.mark.asyncio
    async def test_scope_defaults_to_session_workspace(
        self, client, auth_headers, db_session, tmp_path
    ) -> None:
        """scope 未传 → 取会话绑定工作区；单工作区 anchor 即该工作区。"""
        env = await _seed_env(db_session, tmp_path)
        sid = env["session_id"]
        ws_backend: Workspace = env["backend_ws"]
        agent_session = await db_session.get(AgentSession, sid)
        assert agent_session is not None
        agent_session.workspace_id = ws_backend.id
        await db_session.commit()

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/team-mission",
            headers=auth_headers,
            json={},
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["scope_workspace_ids"] == [str(ws_backend.id)]
        mission = (
            await db_session.execute(
                select(AgentMission).where(AgentMission.id == uuid.UUID(body["mission_id"]))
            )
        ).scalar_one()
        assert mission.workspace_id == ws_backend.id  # anchor = 会话工作区
        assert mission.session_id == sid

    @pytest.mark.asyncio
    async def test_missing_scope_and_workspace_422(
        self, client, auth_headers, db_session, tmp_path
    ) -> None:
        """会话无工作区且未传 scope_workspace_ids → 422。"""
        env = await _seed_env(db_session, tmp_path, session_workspace_id=None)
        resp = await client.post(
            f"/api/daemon/sessions/{env['session_id']}/team-mission",
            headers=auth_headers,
            json={},
        )
        assert resp.status_code == 422, resp.text

    @pytest.mark.asyncio
    async def test_active_conflict_409_then_recreate_after_terminal(
        self, client, auth_headers, db_session, tmp_path
    ) -> None:
        """已有活跃 mission（未终态）再预建 → 409；cancelled_at 置位后可再建。"""
        env = await _seed_env(db_session, tmp_path)
        sid = env["session_id"]
        ws_backend: Workspace = env["backend_ws"]
        agent_session = await db_session.get(AgentSession, sid)
        assert agent_session is not None
        agent_session.workspace_id = ws_backend.id
        await db_session.commit()

        first = await client.post(
            f"/api/daemon/sessions/{sid}/team-mission", headers=auth_headers, json={}
        )
        assert first.status_code == 201, first.text

        conflict = await client.post(
            f"/api/daemon/sessions/{sid}/team-mission", headers=auth_headers, json={}
        )
        assert conflict.status_code == 409, conflict.text

        # 终态化（cancelled_at 置位）后可再建
        mission = (
            await db_session.execute(select(AgentMission).where(AgentMission.session_id == sid))
        ).scalar_one()
        mission.cancelled_at = datetime.now(UTC)
        await db_session.commit()

        second = await client.post(
            f"/api/daemon/sessions/{sid}/team-mission", headers=auth_headers, json={}
        )
        assert second.status_code == 201, second.text
        assert second.json()["mission_id"] != first.json()["mission_id"]

    @pytest.mark.asyncio
    async def test_non_project_manager_403(
        self, client, auth_headers, db_session, tmp_path
    ) -> None:
        """非项目经理（非超管且非项目成员）创建项目维度 mission → 403。"""
        from app.core.security import password_hasher
        from app.modules.auth.model import User

        outsider = User(
            id=uuid.uuid4(),
            email=f"outsider-{uuid.uuid4().hex[:8]}@example.com",
            password_hash=password_hasher.hash("Pass123!"),
            display_name="Outsider",
            status="active",
            is_platform_admin=False,
        )
        db_session.add(outsider)
        await db_session.commit()

        # 项目归 admin（项目经理），会话归 outsider——用 outsider 身份触发
        admin = await _admin_id(db_session)
        env = await _seed_env(db_session, tmp_path, owner_id=admin, with_project=True)
        # scope 用项目关联工作区（先过 scope 校验语义；403 在其之前拦截）
        outsider_session = uuid.uuid4()
        db_session.add(
            AgentSession(
                id=outsider_session,
                user_id=outsider.id,
                provider="claude",
                status="active",
                workspace_id=env["backend_ws"].id,
            )
        )
        await db_session.commit()

        token = _plain_user_token(db_session, outsider.id, outsider.email)
        resp = await client.post(
            f"/api/daemon/sessions/{outsider_session}/team-mission",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "project_id": str(env["project"].id),
                "scope_workspace_ids": [str(env["backend_ws"].id)],
            },
        )
        assert resp.status_code == 403, resp.text

    @pytest.mark.asyncio
    async def test_project_scope_out_of_bounds_422(
        self, client, auth_headers, db_session, tmp_path
    ) -> None:
        """scope 含项目未关联工作区 → 422（admin 超管绕过经理校验，专测越界）。"""
        env = await _seed_env(db_session, tmp_path, with_project=True)
        # orphan 工作区未关联项目（_seed_env 已关联 backend+frontend）
        orphan = _ws("orphan", "business-doc", tmp_path)
        db_session.add(orphan)
        await db_session.commit()
        resp = await client.post(
            f"/api/daemon/sessions/{env['session_id']}/team-mission",
            headers=auth_headers,
            json={
                "project_id": str(env["project"].id),
                "scope_workspace_ids": [
                    str(env["backend_ws"].id),
                    str(orphan.id),
                ],
            },
        )
        assert resp.status_code == 422, resp.text

    @pytest.mark.asyncio
    async def test_cross_user_session_404(self, client, auth_headers, db_session, tmp_path) -> None:
        """跨用户会话 → 404（同 get_session_detail 资源隐藏口径）。"""
        from app.core.security import password_hasher
        from app.modules.auth.model import User

        other = User(
            id=uuid.uuid4(),
            email=f"other-{uuid.uuid4().hex[:8]}@example.com",
            password_hash=password_hasher.hash("Pass123!"),
            display_name="Other",
            status="active",
            is_platform_admin=False,
        )
        db_session.add(other)
        sid = uuid.uuid4()
        db_session.add(
            AgentSession(
                id=sid,
                user_id=other.id,
                provider="claude",
                status="active",
            )
        )
        await db_session.commit()

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/team-mission",
            headers=auth_headers,
            json={},
        )
        assert resp.status_code == 404, resp.text

        resp_get = await client.get(
            f"/api/daemon/sessions/{sid}/team-missions", headers=auth_headers
        )
        assert resp_get.status_code == 404, resp_get.text


# ── GET /sessions/{id}/team-missions（列表）───────────────────────────────────


class TestListSessionTeamMissions:
    @pytest.mark.asyncio
    async def test_list_desc_and_workers_exclude_orchestrator(
        self, client, auth_headers, db_session, tmp_path
    ) -> None:
        """列表倒序 + workers 过滤 role!=orchestrator + 扩展 derive 派生
        awaiting_input（全终态未 converge 无活跃 turn 的会话 mission）。"""
        from app.modules.agent.orchestrator import SESSION_OBJECTIVE_PLACEHOLDER

        env = await _seed_env(db_session, tmp_path)
        sid = env["session_id"]

        # 直接 ORM 预建两场 mission（第二场 created_at 更晚 → 倒序在前）。旧场
        # 置 converged_at 终态——uq_agent_missions_session_active 部分唯一索引
        # 要求一个会话至多一场活跃 mission（R-07），列表历史均为终态场。
        m_old = AgentMission(
            workspace_id=env["backend_ws"].id,
            session_id=sid,
            objective=SESSION_OBJECTIVE_PLACEHOLDER,
            scope_workspace_ids=[str(env["backend_ws"].id)],
            converged_at=datetime.now(UTC),
        )
        db_session.add(m_old)
        await db_session.commit()

        m_new = AgentMission(
            workspace_id=env["backend_ws"].id,
            session_id=sid,
            objective="第二场任务",
            scope_workspace_ids=[str(env["backend_ws"].id)],
        )
        db_session.add(m_new)
        # 主控轮 run（role=orchestrator，D-009 双标记）+ 两分身 run（一成一败）
        db_session.add(
            AgentRun(
                mission_id=m_new.id,
                agent_type="claude_code",
                status="completed",
                role="orchestrator",
                objective="主控轮",
            )
        )
        db_session.add(
            AgentRun(
                mission_id=m_new.id,
                agent_type="claude_code",
                status="completed",
                role="dev",
                objective="分身A",
            )
        )
        db_session.add(
            AgentRun(
                mission_id=m_new.id,
                agent_type="claude_code",
                status="failed",
                role="dev",
                objective="分身B",
            )
        )
        await db_session.commit()

        resp = await client.get(f"/api/daemon/sessions/{sid}/team-missions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        items = resp.json()
        assert len(items) == 2
        # 倒序：m_new（后建）在前
        assert items[0]["mission_id"] == str(m_new.id)
        assert items[1]["mission_id"] == str(m_old.id)
        # m_new：全终态 + 未 converge + 无会话活跃 turn + has_session → awaiting_input
        assert items[0]["status"] == "awaiting_input"
        # workers 只含分身 run（orchestrator 不进），含 run_id/role/status/objective
        workers = items[0]["workers"]
        assert {w["role"] for w in workers} == {"dev"}
        by_objective = {w["objective"]: w for w in workers}
        assert by_objective["分身A"]["status"] == "completed"
        assert by_objective["分身B"]["status"] == "failed"
        run_ids = {w["run_id"] for w in workers}
        assert "orchestrator" not in {w["role"] for w in workers}
        assert all(uuid.UUID(rid) for rid in run_ids)
        # m_old：无任何 run → planning
        assert items[1]["status"] == "planning"
        assert items[1]["workers"] == []
        # scope 概要缺省回落 [workspace_id]
        assert items[1]["scope_workspace_ids"] == [str(env["backend_ws"].id)]

    @pytest.mark.asyncio
    async def test_list_empty(self, client, auth_headers, db_session, tmp_path) -> None:
        """会话无 mission → 200 空列表。"""
        env = await _seed_env(db_session, tmp_path)
        resp = await client.get(
            f"/api/daemon/sessions/{env['session_id']}/team-missions", headers=auth_headers
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == []


# ════════════════════════════════════════════════════════════════════════════
# task-09（2026-08-24-session-team-mission-context）：create 路径预建 + E2 解析
# ════════════════════════════════════════════════════════════════════════════
# design §5.A create 路径 / §5.E1 / §5.E2、D-009@v2 / D-010@v1 / D-014@v1：
# - create 携 team_mission → flush-only 预建 mission（objective=block.objective
#   非空否则直取首句 prompt，不经占位回填）+ 首 run 双标记（mission_id +
#   role='orchestrator'）+ 首 prompt 团队简报前缀（lease metadata 携带、
#   user_input / SESSION_INJECT 干净）；
# - create 中途异常 → 整体回滚无孤儿 session/mission/run/lease（flush-only +
#   create 单 commit，R-04）；
# - E2 orchestrator_workspace_id：∉scope 422 / (W, 创建者) binding 缺失或
#   runtime_id 空 422「该工作区未绑定你的机器」（D-014，不借他人 binding）/
#   命中 → workspace_id=W + cwd=W.root_path + binding.runtime_id 钉定 + 未显式
#   选 agent_profile_id/llm_provider_id/runtime_id 时 provider/model 落
#   W.default_agent/W.default_model（显式优先，R-09）；
# - 无 team_mission 的 create 行为零回归。
# 夹具范式镜像 test_session_create_config.py（mocked hub/redis + in-memory
# SQLite）；binding 的 daemon_id 留空 → 简报 git 探测走 HostFsDelegateUnavailable
# → "unknown" 降级，不触 RPC（断言与探测通道解耦）。


def _t09_mock_hub(*, connected: bool = True):
    from unittest.mock import AsyncMock, MagicMock

    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


@pytest.fixture()
def t09_mocked_hub():
    from unittest.mock import patch

    hub = _t09_mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def t09_mocked_redis():
    from unittest.mock import AsyncMock, patch

    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


async def _t09_create_user(db_session) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"t09-{uid}@example.com",
            password_hash="x",
            display_name="T09",
            status="active",
        )
    )
    await db_session.commit()
    return uid


async def _t09_create_runtime(db_session, user_id: uuid.UUID, *, provider: str = "claude"):
    from app.modules.daemon.model import DaemonRuntime

    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name=f"daemon-{provider}",
        provider=provider,
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    return rt


async def _t09_make_workspace(
    db_session,
    *,
    name: str = "t09-ws",
    root_path: str | None = None,
    ws_type: str = "backend-code",
    default_agent: str | None = None,
    default_model: str | None = None,
) -> Workspace:
    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name=name,
        slug=f"{name}-{ws_id.hex[:8]}",
        # root_path 唯一约束：缺省按 ws id 派生，多工作区用例不撞库。
        root_path=root_path or f"/tmp/t09-{ws_id.hex[:12]}",
        status="active",
        type=ws_type,
        default_agent=default_agent,
        default_model=default_model,
    )
    db_session.add(ws)
    await db_session.commit()
    return ws


async def _t09_count(db_session, model) -> int:
    rows = (await db_session.execute(select(model))).scalars().all()
    return len(rows)


def _t09_block(**kwargs):
    from app.modules.daemon.schema import TeamMissionCreateBlock

    return TeamMissionCreateBlock(**kwargs)


class TestCreateSessionTeamMissionPrebuild:
    """create 携 team_mission：flush-only 预建 + 双标记 + 简报前缀 + 回滚原子性。"""

    @pytest.mark.asyncio
    async def test_prebuilds_mission_and_tags_first_run(
        self, db_session, t09_mocked_hub, t09_mocked_redis
    ) -> None:
        """携 team_mission → mission 行（session 模式快照透传）+ 首 run 双标记。"""
        from app.modules.daemon.service import DaemonService

        uid = await _t09_create_user(db_session)
        await _t09_create_runtime(db_session, uid)
        ws = await _t09_make_workspace(db_session)

        preset = [{"role": "coder", "agent_type": "claude_code"}]
        mac = {"style": "strict"}
        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider="claude",
            prompt="开始团队任务",
            team_mission=_t09_block(
                objective="完成服务重构",
                scope_workspace_ids=[ws.id],
                budget_usd=1.5,
                worker_preset=preset,
                main_agent_config=mac,
            ),
        )

        missions = (await db_session.execute(select(AgentMission))).scalars().all()
        assert len(missions) == 1
        m = missions[0]
        assert m.session_id == result.agent_session.id
        assert m.workspace_id == ws.id  # 单工作区 anchor 即该工作区
        assert m.objective == "完成服务重构"
        assert m.scope_workspace_ids == [str(ws.id)]
        assert m.budget_usd == 1.5
        assert m.worker_preset == preset
        assert m.main_agent_config == mac
        assert m.created_by == uid
        assert m.converged_at is None and m.cancelled_at is None

        # 首 run 双标记（对齐 _inject_into_session 既有口径）。
        assert result.agent_run.mission_id == m.id
        assert result.agent_run.role == "orchestrator"

    @pytest.mark.asyncio
    async def test_objective_falls_back_to_first_prompt(
        self, db_session, t09_mocked_hub, t09_mocked_redis
    ) -> None:
        """objective 缺省 → 直取首句 prompt（create 路径不经占位回填）。"""
        from app.modules.agent.orchestrator import SESSION_OBJECTIVE_PLACEHOLDER
        from app.modules.daemon.service import DaemonService

        uid = await _t09_create_user(db_session)
        await _t09_create_runtime(db_session, uid)
        ws = await _t09_make_workspace(db_session)

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider="claude",
            prompt="用第一句话当目标",
            team_mission=_t09_block(scope_workspace_ids=[ws.id]),
        )

        m = (await db_session.execute(select(AgentMission))).scalars().one()
        assert m.session_id == result.agent_session.id
        assert m.objective == "用第一句话当目标"
        assert m.objective != SESSION_OBJECTIVE_PLACEHOLDER

    @pytest.mark.asyncio
    async def test_first_prompt_carries_briefing_prefix_and_user_log_stays_clean(
        self, db_session, t09_mocked_hub, t09_mocked_redis
    ) -> None:
        """lease metadata prompt 含团队简报前缀；user_input 与 SESSION_INJECT 干净。"""
        from app.modules.daemon.protocol import DAEMON_MSG_SESSION_INJECT
        from app.modules.daemon.service import DaemonService

        uid = await _t09_create_user(db_session)
        await _t09_create_runtime(db_session, uid)
        ws = await _t09_make_workspace(db_session)

        user_prompt = "开始团队任务"
        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider="claude",
            prompt=user_prompt,
            team_mission=_t09_block(objective="简报目标", scope_workspace_ids=[ws.id]),
        )

        # lease metadata prompt：简报前缀 + 分隔线 + 用户消息。
        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        assert lease is not None
        meta_prompt = (lease.metadata_ or {}).get("prompt", "")
        assert "【团队任务简报" in meta_prompt
        mission = (await db_session.execute(select(AgentMission))).scalars().one()
        assert str(mission.id) in meta_prompt
        assert meta_prompt.index("【团队任务简报") < meta_prompt.index(user_prompt)
        assert "\n\n---\n\n" in meta_prompt

        # AgentRunLog(user_input)：干净用户原文（不含简报）。
        log_row = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == result.agent_run.id,
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert log_row is not None
        assert log_row.content_redacted == user_prompt
        assert "【团队任务简报" not in (log_row.content_redacted or "")

        # 首 turn SESSION_INJECT payload prompt 仍写干净原文。
        payload = next(
            call.args[2]
            for call in t09_mocked_hub.send_session_control.call_args_list
            if len(call.args) >= 3
            and call.args[1] == DAEMON_MSG_SESSION_INJECT
            and call.args[2].get("run_id") == str(result.agent_run.id)
        )
        assert payload["prompt"] == user_prompt

    @pytest.mark.asyncio
    async def test_create_midway_failure_rolls_back_all_rows(
        self, db_session, t09_mocked_hub, t09_mocked_redis, monkeypatch
    ) -> None:
        """placement 抛 NoOnlineDaemonError（事务中途）→ 整体回滚无孤儿行。"""
        from app.modules.agent.placement import (
            NoOnlineDaemonError,
            RunPlacementService,
        )
        from app.modules.daemon.service import DaemonService

        uid = await _t09_create_user(db_session)
        await _t09_create_runtime(db_session, uid)
        ws = await _t09_make_workspace(db_session)

        async def _boom(*args, **kwargs):
            raise NoOnlineDaemonError(user_id=uid)

        monkeypatch.setattr(RunPlacementService, "prepare_interactive_dispatch", _boom)

        svc = DaemonService(db_session)
        with pytest.raises(NoOnlineDaemonError):
            await svc.create_session(
                uid,
                provider="claude",
                prompt="中途失败",
                team_mission=_t09_block(scope_workspace_ids=[ws.id]),
            )

        assert await _t09_count(db_session, AgentSession) == 0
        assert await _t09_count(db_session, AgentMission) == 0
        assert await _t09_count(db_session, AgentRun) == 0
        assert await _t09_count(db_session, DaemonTaskLease) == 0

    @pytest.mark.asyncio
    async def test_create_without_team_mission_is_regression_free(
        self, db_session, t09_mocked_hub, t09_mocked_redis
    ) -> None:
        """无 team_mission：零分支进入——无 mission 行、首 run 无标记、prompt 原样。"""
        from app.modules.daemon.service import DaemonService

        uid = await _t09_create_user(db_session)
        await _t09_create_runtime(db_session, uid)

        svc = DaemonService(db_session)
        result = await svc.create_session(uid, provider="claude", prompt="普通对话")

        assert await _t09_count(db_session, AgentMission) == 0
        assert result.agent_run.mission_id is None
        assert result.agent_run.role is None
        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        assert (lease.metadata_ or {}).get("prompt") == "普通对话"


class TestCreateSessionOrchestratorWorkspaceE2:
    """E2 主 agent 工作区解析（design §5.E2 / D-010@v1 / D-014@v1 / R-09）。"""

    @pytest.mark.asyncio
    async def test_workspace_not_in_scope_422(
        self, db_session, t09_mocked_hub, t09_mocked_redis
    ) -> None:
        """orchestrator_workspace_id ∉ scope → 422，无半成品落库。"""
        from app.modules.daemon.service import DaemonService
        from app.modules.daemon.session.service import DaemonSessionTeamMissionInvalid

        uid = await _t09_create_user(db_session)
        await _t09_create_runtime(db_session, uid)
        ws_in = await _t09_make_workspace(db_session, name="t09-in")
        ws_out = await _t09_make_workspace(db_session, name="t09-out")

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionTeamMissionInvalid) as exc_info:
            await svc.create_session(
                uid,
                provider="claude",
                prompt="越界",
                team_mission=_t09_block(
                    scope_workspace_ids=[ws_in.id],
                    orchestrator_workspace_id=ws_out.id,
                ),
            )
        assert exc_info.value.http_status == 422
        assert await _t09_count(db_session, AgentSession) == 0
        assert await _t09_count(db_session, AgentMission) == 0

    @pytest.mark.asyncio
    async def test_binding_row_missing_422(
        self, db_session, t09_mocked_hub, t09_mocked_redis
    ) -> None:
        """(W, 创建者) 无 WorkspaceMemberRuntime 行 → 422（D-014，不借他人 binding）。"""
        from app.modules.daemon.service import DaemonService
        from app.modules.daemon.session.service import DaemonSessionTeamMissionInvalid

        uid = await _t09_create_user(db_session)
        await _t09_create_runtime(db_session, uid)
        ws = await _t09_make_workspace(db_session)

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionTeamMissionInvalid) as exc_info:
            await svc.create_session(
                uid,
                provider="claude",
                prompt="未绑定",
                team_mission=_t09_block(
                    scope_workspace_ids=[ws.id],
                    orchestrator_workspace_id=ws.id,
                ),
            )
        assert exc_info.value.http_status == 422
        assert "未绑定" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_binding_runtime_id_empty_422(
        self, db_session, t09_mocked_hub, t09_mocked_redis
    ) -> None:
        """binding 行存在但 runtime_id 为空 → 同 422「该工作区未绑定你的机器」。"""
        from app.modules.daemon.service import DaemonService
        from app.modules.daemon.session.service import DaemonSessionTeamMissionInvalid

        uid = await _t09_create_user(db_session)
        await _t09_create_runtime(db_session, uid)
        ws = await _t09_make_workspace(db_session)
        db_session.add(
            WorkspaceMemberRuntime(
                workspace_id=ws.id,
                user_id=uid,
                runtime_id=None,
                root_path="/tmp/t09-root",
                path_source="daemon",
            )
        )
        await db_session.commit()

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionTeamMissionInvalid) as exc_info:
            await svc.create_session(
                uid,
                provider="claude",
                prompt="绑定缺机器",
                team_mission=_t09_block(
                    scope_workspace_ids=[ws.id],
                    orchestrator_workspace_id=ws.id,
                ),
            )
        assert exc_info.value.http_status == 422

    @pytest.mark.asyncio
    async def test_hit_overrides_workspace_cwd_pins_binding_and_applies_defaults(
        self, db_session, t09_mocked_hub, t09_mocked_redis
    ) -> None:
        """命中：workspace_id=W + cwd=W.root_path + binding.runtime_id 钉定 +
        未显式选三入口时 provider/model 落 W 默认配置。"""
        from app.modules.daemon.service import DaemonService

        uid = await _t09_create_user(db_session)
        rt = await _t09_create_runtime(db_session, uid, provider="codex")
        ws = await _t09_make_workspace(
            db_session,
            root_path="/e2/ws-root",
            default_agent="codex",
            default_model="codex-model-x",
        )
        db_session.add(
            WorkspaceMemberRuntime(
                workspace_id=ws.id,
                user_id=uid,
                runtime_id=rt.id,
                root_path="/e2/ws-root",
                path_source="daemon",
            )
        )
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider="claude",
            prompt="主 agent 落 W",
            team_mission=_t09_block(
                objective="E2 命中",
                scope_workspace_ids=[ws.id],
                orchestrator_workspace_id=ws.id,
            ),
        )

        s = result.agent_session
        assert s.workspace_id == ws.id
        assert s.cwd == "/e2/ws-root"
        # provider/model 落 W 默认（用户未显式传 agent_profile_id/llm_provider_id/runtime_id）。
        assert s.provider == "codex"
        assert result.agent_run.provider == "codex"
        assert (s.config or {}).get("model") == "codex-model-x"
        assert result.agent_run.model == "codex-model-x"
        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        assert lease is not None
        assert lease.runtime_id == rt.id  # binding.runtime_id 钉定
        assert (lease.metadata_ or {}).get("provider") == "codex"
        assert (lease.metadata_ or {}).get("model") == "codex-model-x"
        # 预建 mission 照常落库（anchor=W）。
        mission = (await db_session.execute(select(AgentMission))).scalars().one()
        assert mission.workspace_id == ws.id
        assert mission.session_id == s.id

    @pytest.mark.asyncio
    async def test_explicit_runtime_id_wins_over_workspace_defaults(
        self, db_session, t09_mocked_hub, t09_mocked_redis
    ) -> None:
        """显式 runtime_id 优先（R-09）：钉定/引擎/模型走显式值，W 仅决定
        workspace_id/cwd；不因显式机器 ≠ binding 机器而 422。"""
        from app.modules.daemon.service import DaemonService

        uid = await _t09_create_user(db_session)
        rt_explicit = await _t09_create_runtime(db_session, uid, provider="claude")
        rt_binding = await _t09_create_runtime(db_session, uid, provider="codex")
        ws = await _t09_make_workspace(
            db_session,
            root_path="/e2/explicit-root",
            default_agent="codex",
            default_model="ws-default-model",
        )
        db_session.add(
            WorkspaceMemberRuntime(
                workspace_id=ws.id,
                user_id=uid,
                runtime_id=rt_binding.id,
                root_path="/e2/explicit-root",
                path_source="daemon",
            )
        )
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider=None,
            prompt="显式机器优先",
            runtime_id=str(rt_explicit.id),
            team_mission=_t09_block(
                scope_workspace_ids=[ws.id],
                orchestrator_workspace_id=ws.id,
            ),
        )

        s = result.agent_session
        # 显式 runtime 赢得钉定与引擎派生。
        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        assert lease is not None
        assert lease.runtime_id == rt_explicit.id
        assert s.provider == "claude"
        assert s.runtime_id == rt_explicit.id
        # W 默认配置不应用（显式选择逐字节优先）：无 model 落点。
        assert (lease.metadata_ or {}).get("model") is None
        assert "model" not in (s.config or {})
        # W 仍决定 workspace_id / cwd。
        assert s.workspace_id == ws.id
        assert s.cwd == "/e2/explicit-root"


async def test_summary_scope_workspaces_enriched(
    client, auth_headers, db_session, tmp_path
) -> None:
    """ql-20260825-003：summary.scope_workspaces 带 id+name（范围徽标名称化）。"""
    env = await _seed_env(db_session, tmp_path)
    sid = env["session_id"]
    missing_id = uuid.uuid4()  # 无 Workspace 行的 scope 条目
    m = AgentMission(
        workspace_id=env["backend_ws"].id,
        session_id=sid,
        objective="范围名称化",
        scope_workspace_ids=[str(env["backend_ws"].id), str(missing_id)],
    )
    db_session.add(m)
    await db_session.commit()

    resp = await client.get(f"/api/daemon/sessions/{sid}/team-missions", headers=auth_headers)
    assert resp.status_code == 200
    summary = next(x for x in resp.json() if x["mission_id"] == str(m.id))
    refs = {w["id"]: w["name"] for w in summary["scope_workspaces"]}
    assert refs[str(env["backend_ws"].id)] == "backend Workspace"
    # 查无行的条目 name=None（前端回落 #id 徽标）
    assert refs[str(missing_id)] is None


# ═════════════════════════════════════════════════════════════════════════════
# task-08（2026-08-26-team-subsession-recursion / design §5.E / FR-08）：
# workers 保持一层直查 + 孙层折叠计数 sub_workers_count
# ═════════════════════════════════════════════════════════════════════════════


async def _t08_seed_worker_session(
    db_session, parent_id: uuid.UUID, *, tree_depth: int = 1
) -> AgentSession:
    """建分身子会话行（parent 入参——根=一层 / 一层=孙），无 run。"""
    s = AgentSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="claude",
        status="active",
        parent_session_id=parent_id,
        tree_depth=tree_depth,
    )
    db_session.add(s)
    await db_session.commit()
    return s


async def _t08_seed_worker_first_run(
    db_session, mission: AgentMission, worker_session: AgentSession, *, role: str = "impl"
) -> AgentRun:
    """建分身首 run（mission_id + role 双标记，行化锚）。"""
    r = AgentRun(
        mission_id=mission.id,
        agent_type="claude_code",
        status="completed",
        role=role,
        objective=f"{role} 任务",
        agent_session_id=worker_session.id,
    )
    db_session.add(r)
    await db_session.commit()
    return r


# ═════════════════════════════════════════════════════════════════════════════
# 2026-08-26 审计修复 F03 守护测试（docs/qa/subsession-backend-audit-2026-08-26.md
# §A.3）：_team_mission_summary 批量化——查询预算（≈14+Nd → ~6）+ status 口径
# 与 mission_derive_status 等价（本地展开防 A 组 mission.py 漂移）。
# ═════════════════════════════════════════════════════════════════════════════


@contextmanager
def _count_sql(session) -> Iterator[dict[str, int]]:
    """统计会话执行期发出的 SQL 条数（before_cursor_execute 事件计数）。"""
    counter = {"n": 0}

    def _incr(*_args, **_kwargs) -> None:
        counter["n"] += 1

    engine = session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", _incr)
    try:
        yield counter
    finally:
        event.remove(engine, "before_cursor_execute", _incr)


async def _f03_seed_mission(db_session, sid: uuid.UUID, ws_id: uuid.UUID) -> AgentMission:
    m = AgentMission(
        workspace_id=ws_id,
        session_id=sid,
        objective="F03 批量化",
        scope_workspace_ids=[str(ws_id)],
    )
    db_session.add(m)
    await db_session.commit()
    return m


class TestTeamMissionSummaryQueryBudget:
    async def test_summary_query_count_bounded(
        self, db_session, tmp_path, auth_admin_token
    ) -> None:
        """单 mission 查询预算 ≤7（旧 ≈14+Nd：三口径各自枚举 + mission 行重复；审计 F03 后 ~6 + UX 走查③ latest_action 批量 1 条 = 7，仍恒定有界）
        get 4 次 + done 分身逐个查询）。

        场景：1 个 done 分身（旧 Nd=1）+ 1 个 idle 分身——新实现 6 条恒定：
        全量 run 1 + 全树 1 + 批量活跃 turn 1 + 根会话 get（identity map 命中
        则免，这里播种后同会话命中 → 0）+ 首 run 批查 1 + scope 名称 1。
        """
        from app.modules.daemon.router import _team_mission_summary

        env = await _seed_env(db_session, tmp_path)
        sid = env["session_id"]
        ws_id = env["backend_ws"].id
        m = await _f03_seed_mission(db_session, sid, ws_id)

        w1 = await _t08_seed_worker_session(db_session, sid)
        w1.worker_done_at = datetime.now(UTC)
        db_session.add(w1)
        await _t08_seed_worker_first_run(db_session, m, w1)
        w2 = await _t08_seed_worker_session(db_session, sid)
        await _t08_seed_worker_first_run(db_session, m, w2)
        await db_session.commit()

        mission = (
            (await db_session.execute(select(AgentMission).where(AgentMission.id == m.id)))
            .scalars()
            .one()
        )
        with _count_sql(db_session) as counter:
            summary = await _team_mission_summary(db_session, mission)
        assert counter["n"] <= 7, f"summary 查询应 ≤7 条，实际 {counter['n']}"
        # 行为不变：一层两行、done 分身 completed、idle 分身 running。
        by_sub = {str(w.sub_session_id): w.status for w in summary.workers}
        assert by_sub == {str(w1.id): "completed", str(w2.id): "running"}


class TestTeamMissionSummaryDeriveEquivalence:
    """F03 等价守护：summary 的本地 derive 展开与 mission.mission_derive_status
    同数据同结果（mission.py 归审计 A 组并行修复，本测试防两套口径漂移）。"""

    async def _summary_status(self, db_session, mission_id) -> str:
        from app.modules.daemon.router import _team_mission_summary

        mission = (
            (await db_session.execute(select(AgentMission).where(AgentMission.id == mission_id)))
            .scalars()
            .one()
        )
        return (await _team_mission_summary(db_session, mission)).status

    async def _derive_status(self, db_session, mission_id) -> str:
        from app.modules.agent.mission import mission_derive_status

        return await mission_derive_status(db_session, mission_id)

    async def test_status_shapes_equivalent(self, db_session, tmp_path, auth_admin_token) -> None:
        from app.modules.agent.mission import (
            BUDGET_FORCE_ENDED_AT_KEY,
            WORKER_FORCE_ENDED_AT_KEY,
        )

        env = await _seed_env(db_session, tmp_path)
        sid = env["session_id"]
        ws_id = env["backend_ws"].id

        # 形态 1：idle 未 done 分身 → running
        m1 = await _f03_seed_mission(db_session, sid, ws_id)
        w = await _t08_seed_worker_session(db_session, sid)
        await _t08_seed_worker_first_run(db_session, m1, w)
        assert await self._summary_status(db_session, m1.id) == "running"
        assert await self._summary_status(db_session, m1.id) == await self._derive_status(
            db_session, m1.id
        )

        # 形态 2：全 done 未收敛、根无活跃 turn → awaiting_input
        w.worker_done_at = datetime.now(UTC)
        db_session.add(w)
        await db_session.commit()
        assert await self._summary_status(db_session, m1.id) == "awaiting_input"
        assert await self._summary_status(db_session, m1.id) == await self._derive_status(
            db_session, m1.id
        )

        # 形态 3：一成一败（预算强收 ended 未 done）→ degraded
        # （R-07 单活跃约束：同会话下一场前先终态化上一场）
        m1.converged_at = datetime.now(UTC)
        db_session.add(m1)
        await db_session.commit()
        m2 = await _f03_seed_mission(db_session, sid, ws_id)
        m2.constraints = {BUDGET_FORCE_ENDED_AT_KEY: datetime.now(UTC).isoformat()}
        db_session.add(m2)
        w_ok = await _t08_seed_worker_session(db_session, sid)
        w_ok.worker_done_at = datetime.now(UTC)
        db_session.add(w_ok)
        await _t08_seed_worker_first_run(db_session, m2, w_ok)
        w_dead = await _t08_seed_worker_session(db_session, sid)
        w_dead.status = "ended"
        db_session.add(w_dead)
        await _t08_seed_worker_first_run(db_session, m2, w_dead)
        # 会话 mission 全终态但未收敛时 awaiting_input 先于 degraded（derive
        # 判据矩阵序）——收敛后落 degraded。
        assert await self._summary_status(db_session, m2.id) == "awaiting_input"
        assert await self._summary_status(db_session, m2.id) == await self._derive_status(
            db_session, m2.id
        )
        m2.converged_at = datetime.now(UTC)
        db_session.add(m2)
        await db_session.commit()
        assert await self._summary_status(db_session, m2.id) == "degraded"
        assert await self._summary_status(db_session, m2.id) == await self._derive_status(
            db_session, m2.id
        )

        # 形态 3b：worker_force_ended_at 标记（审计 F01，与 budget 标记同象）——
        # ended 未 done 分身映射 failed，收敛后 degraded。
        m2b = await _f03_seed_mission(db_session, sid, ws_id)
        m2b.constraints = {WORKER_FORCE_ENDED_AT_KEY: datetime.now(UTC).isoformat()}
        db_session.add(m2b)
        w_ok2 = await _t08_seed_worker_session(db_session, sid)
        w_ok2.worker_done_at = datetime.now(UTC)
        db_session.add(w_ok2)
        await _t08_seed_worker_first_run(db_session, m2b, w_ok2)
        w_dead2 = await _t08_seed_worker_session(db_session, sid)
        w_dead2.status = "ended"
        db_session.add(w_dead2)
        await _t08_seed_worker_first_run(db_session, m2b, w_dead2)
        m2b.converged_at = datetime.now(UTC)
        db_session.add(m2b)
        await db_session.commit()
        assert await self._summary_status(db_session, m2b.id) == "degraded"
        assert await self._summary_status(db_session, m2b.id) == await self._derive_status(
            db_session, m2b.id
        )

        # 形态 4：无分身 run 的空 mission → planning；主控轮活跃 → running。
        # （新根会话——树枚举按根挂载，同根旧 mission 的子会话会进新 mission 的
        # 树口径（治理枚举按会话树不按 mission 归属），换根隔离形态。）
        sid4 = uuid.uuid4()
        db_session.add(
            AgentSession(
                id=sid4,
                user_id=(await _admin_id(db_session)),
                provider="claude",
                status="active",
                workspace_id=ws_id,
            )
        )
        await db_session.commit()
        m3 = await _f03_seed_mission(db_session, sid4, ws_id)
        assert await self._summary_status(db_session, m3.id) == "planning"
        db_session.add(
            AgentRun(
                mission_id=m3.id,
                agent_type="claude_code",
                status="running",
                role="orchestrator",
                objective="主控轮",
            )
        )
        await db_session.commit()
        assert await self._summary_status(db_session, m3.id) == "running"
        assert await self._summary_status(db_session, m3.id) == await self._derive_status(
            db_session, m3.id
        )


async def test_summary_sub_workers_count_folded(client, auth_headers, db_session, tmp_path) -> None:
    """task-08：workers 行保持一层（孙不展开成行），一层分身的孙后代数折进
    sub_workers_count；无孙分身 / 存量 batch 行保持默认 None（FR-08 零回归）。"""
    env = await _seed_env(db_session, tmp_path)
    sid = env["session_id"]
    m = AgentMission(
        workspace_id=env["backend_ws"].id,
        session_id=sid,
        objective="孙折叠计数",
        scope_workspace_ids=[str(env["backend_ws"].id)],
    )
    db_session.add(m)
    await db_session.commit()

    # w1（一层分身）带 2 个孙（g1/g2，孙首 run 带 mission_id+role 也不独立成行）
    w1 = await _t08_seed_worker_session(db_session, sid)
    await _t08_seed_worker_first_run(db_session, m, w1)
    g1 = await _t08_seed_worker_session(db_session, w1.id, tree_depth=2)
    g2 = await _t08_seed_worker_session(db_session, w1.id, tree_depth=2)
    for g in (g1, g2):
        await _t08_seed_worker_first_run(db_session, m, g, role="sub")
    # w2（一层分身）无孙 → sub_workers_count None
    w2 = await _t08_seed_worker_session(db_session, sid)
    await _t08_seed_worker_first_run(db_session, m, w2, role="solo")

    resp = await client.get(f"/api/daemon/sessions/{sid}/team-missions", headers=auth_headers)
    assert resp.status_code == 200
    summary = next(x for x in resp.json() if x["mission_id"] == str(m.id))
    workers = summary["workers"]
    # 行保持一层：仅 w1/w2 两行（孙 g1/g2 折叠不独立成行）
    assert {w["sub_session_id"] for w in workers} == {str(w1.id), str(w2.id)}
    by_sub = {w["sub_session_id"]: w for w in workers}
    assert by_sub[str(w1.id)]["sub_workers_count"] == 2
    assert by_sub[str(w2.id)]["sub_workers_count"] is None
    # 存量 batch 行（无 sub_session）字段默认 None——无孙 mission 零变化
    assert all("sub_workers_count" in w for w in workers)


# ── UX 走查③（2026-08-26）：运行中分身 latest_action 预览 ──


class TestWorkerLatestAction:
    async def _seed_running_sub(self, session, *, with_log: str | None):
        """主控根会话 + 一个 running 分身子会话（可选最新日志行）。"""
        from datetime import UTC, datetime

        from app.modules.agent.model import AgentMission, AgentRun, AgentRunLog, AgentSession

        now = datetime.now(UTC)
        root = AgentSession(
            user_id=self._uid,
            provider="claude",
            status="active",
            config={},
            turn_count=1,
            tree_depth=0,
            created_at=now,
        )
        session.add(root)
        await session.flush()
        sub = AgentSession(
            user_id=self._uid,
            provider="claude",
            status="active",
            config={},
            turn_count=1,
            parent_session_id=root.id,
            tree_depth=1,
            created_at=now,
        )
        session.add(sub)
        await session.flush()
        mission = AgentMission(
            workspace_id=self._ws_id,
            session_id=root.id,
            objective="obj",
            constraints=None,
            created_by=self._uid,
        )
        session.add(mission)
        await session.flush()
        first = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="running",
            role="impl",
            objective="do",
            agent_session_id=sub.id,
        )
        session.add(first)
        await session.flush()
        if with_log is not None:
            session.add(
                AgentRunLog(
                    run_id=first.id,
                    timestamp=now,
                    channel="assistant",
                    content_redacted=with_log,
                )
            )
        await session.commit()
        return mission

    _uid = None
    _ws_id = None

    async def test_running_sub_gets_latest_action(self, db_session):
        """running 分身行带 latest_action（最新日志行截断 80 字符）。"""
        from app.modules.auth.model import User
        from app.modules.workspace.model import Workspace

        uid = uuid.uuid4()
        db_session.add(
            User(
                id=uid,
                email=f"la-{uid}@x.com",
                password_hash="x",
                display_name="T",
                status="active",
            )
        )
        ws = Workspace(name="ws-la", slug=f"ws-la-{uid.hex[:6]}", root_path="C:/tmp")
        db_session.add(ws)
        await db_session.commit()
        self._uid, self._ws_id = uid, ws.id
        long_text = (
            "正在修改 backend/app/modules/agent/mcp_tools.py 的第 1234 行附近逻辑，" + "x" * 100
        )
        from app.modules.daemon.router import _team_mission_summary

        mission = await self._seed_running_sub(db_session, with_log=long_text)
        await db_session.refresh(mission)

        summary = await _team_mission_summary(db_session, mission)
        running_rows = [w for w in summary.workers if w.sub_session_id is not None]
        assert len(running_rows) == 1
        assert running_rows[0].status == "running"
        la = running_rows[0].latest_action
        assert la is not None and la.startswith("正在修改")
        assert len(la) == 80

    async def test_no_log_or_terminal_rows_have_none(self, db_session):
        """无日志的 running 行 / 存量 batch 行 latest_action 恒 None。"""
        from app.modules.agent.model import AgentRun
        from app.modules.auth.model import User
        from app.modules.workspace.model import Workspace

        uid = uuid.uuid4()
        db_session.add(
            User(
                id=uid,
                email=f"lb-{uid}@x.com",
                password_hash="x",
                display_name="T",
                status="active",
            )
        )
        ws = Workspace(name="ws-lb", slug=f"ws-lb-{uid.hex[:6]}", root_path="C:/tmp")
        db_session.add(ws)
        await db_session.commit()
        self._uid, self._ws_id = uid, ws.id
        from app.modules.daemon.router import _team_mission_summary

        mission = await self._seed_running_sub(db_session, with_log=None)
        # 追加一条存量 batch run（无子会话）
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                status="running",
                role="test",
                objective="legacy",
            )
        )
        await db_session.commit()
        await db_session.refresh(mission)

        summary = await _team_mission_summary(db_session, mission)
        for w in summary.workers:
            assert w.latest_action is None
