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

from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.daemon.model import DaemonTaskLease
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
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

        async def _get_active_mission_for_session(db, session_id):  # type: ignore[no-untyped-def]
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
            runs,  # type: ignore[no-untyped-def]
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


def _plain_user_token(db_session, user_id: uuid.UUID, email: str) -> str:  # type: ignore[no-untyped-def]
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
