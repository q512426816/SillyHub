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
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

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
