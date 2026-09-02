"""quick 群聊 agent 成员团队能力测试（2026-09-02，后端部分）。

覆盖（任务卡口径）：

- 懒建 lease stage：``team_enabled=True`` 成员触发懒建 → lease metadata
  stage='orchestrator'（daemon isMainAgentSession 谓词命中注入主控 5 工具）；
  缺省成员 → 'group_member'（零回归对照）；
- 成员简报：``team_enabled`` 成员注入 prompt 含团队能力段（工具名与 daemon
  mcp-server.ts 注入一致）；缺省成员不含该段；
- 引擎门控：codex 引擎开 team 建群 400 / 加成员 400 / PATCH 开 400；已开
  team 成员 PATCH 切 codex 引擎 400；用户成员 PATCH team 400；
- 热切换：team_enabled 变更且影子存在 → 机器组重建分支（影子 ended +
  shadow_status='pending' + 指针置空）；无影子时仅落库（下次触发懒建生效）；
- mission 归属兼容：影子会话（parent NULL、无 mission 行）
  resolve_mission_for_session 返回 None；懒建一条 mission 绑影子后命中
  （dispatch_worker 懒建链在群影子上可用的口径）。

夹具范式镜像 ``test_group_mention_pipeline.py``（in-memory SQLite + httpx
ASGI client + 手签 JWT + ws_hub/readiness/redis mock；GLMConfig.from_env →
None 知识库铁律）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from unittest.mock import patch as mock_patch

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import (
    AgentGroupMember,
    AgentMission,
    AgentRunLog,
    AgentSession,
)
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.workspace.model import PpmProjectWorkspace, Workspace

# ── Helpers（镜像 test_group_mention_pipeline.py 夹具范式）────────────────────


async def _token_for(user: User) -> str:
    from app.core.config import get_settings
    from app.core.security import create_access_token

    token, _ = create_access_token(
        user_id=user.id,
        email=user.email or "",
        is_admin=bool(user.is_platform_admin),
        settings=get_settings(),
    )
    return token


async def _create_user_with_token(db_session: AsyncSession, *, name: str) -> tuple[User, str]:
    user = User(
        id=uuid.uuid4(),
        email=f"grpt-{name}-{uuid.uuid4()}@example.com",
        password_hash="irrelevant",
        display_name=name,
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user, await _token_for(user)


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _grant_workspace_role(
    db_session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    role = Role(
        id=uuid.uuid4(),
        key=f"grpt-{uuid.uuid4().hex[:8]}",
        name="grpt-test-role",
        description="quick seed",
        is_system=False,
    )
    db_session.add(role)
    await db_session.flush()
    db_session.add(RolePermission(role_id=role.id, permission=Permission.TASK_RUN_AGENT))
    db_session.add(
        UserWorkspaceRole(
            user_id=user_id,
            workspace_id=workspace_id,
            role_id=role.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()


async def _make_env(db_session: AsyncSession) -> SimpleNamespace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="grpt-ws",
        slug=f"grpt-ws-{uuid.uuid4().hex[:8]}",
        root_path=f"C:/tmp/grpt-ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    project = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code=f"GRPT-{uuid.uuid4().hex[:12]}",
        project_name="团队能力测试项目",
    )
    db_session.add(project)
    await db_session.flush()
    db_session.add(PpmProjectWorkspace(ppm_project_id=project.id, workspace_id=ws.id))
    owner, owner_token = await _create_user_with_token(db_session, name="群主")
    await _grant_workspace_role(db_session, workspace_id=ws.id, user_id=owner.id)
    db_session.add(PpmProjectMember(id=uuid.uuid4(), pm_project_id=project.id, user_id=owner.id))
    instance = DaemonInstance(
        id=uuid.uuid4(),
        user_id=owner.id,
        hostname="grpt-host",
        server_url="http://test.local",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(instance)
    runtime = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=instance.id,
        user_id=owner.id,
        name="grpt-host",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(runtime)
    await db_session.commit()
    return SimpleNamespace(
        ws=ws,
        project=project,
        owner=owner,
        owner_token=owner_token,
        instance=instance,
        runtime=runtime,
    )


async def _create_group(
    client: AsyncClient,
    owner_token: str,
    *,
    project_id: uuid.UUID,
    agent_members: list[dict],
) -> dict:
    payload: dict = {
        "title": "协作群",
        "project_id": str(project_id),
        "agent_members": agent_members,
    }
    resp = await client.post("/api/daemon/group-chats", json=payload, headers=_headers(owner_token))
    assert resp.status_code == 201, resp.text
    return resp.json()


def _agent_config(
    runtime_id: uuid.UUID,
    name: str = "小码",
    *,
    provider: str = "claude",
    team_enabled: bool = False,
) -> dict:
    cfg: dict = {
        "display_name": name,
        "runtime_id": str(runtime_id),
        "provider": provider,
    }
    if team_enabled:
        cfg["team_enabled"] = True
    return cfg


async def _send_message(client: AsyncClient, token: str, group_id: str, content: str) -> object:
    return await client.post(
        f"/api/daemon/group-chats/{group_id}/messages",
        json={"content": content},
        headers=_headers(token),
    )


async def _agent_member_row(
    db_session: AsyncSession, group_id: uuid.UUID, display_name: str = "小码"
) -> AgentGroupMember:
    rows = (
        (
            await db_session.execute(
                select(AgentGroupMember).where(
                    AgentGroupMember.group_id == group_id,
                    AgentGroupMember.member_type == "agent",
                    AgentGroupMember.display_name == display_name,
                )
            )
        )
        .scalars()
        .all()
    )
    assert rows, f"agent 成员「{display_name}」不存在"
    return rows[0]


# ── 共用 mock 夹具（镜像 test_group_mention_pipeline.py）──────────────────────


@pytest.fixture(autouse=True)
def _glm_offline(monkeypatch: pytest.MonkeyPatch) -> None:
    """知识库铁律：GLM delegation 配置返 None（不走真实 LLM 网关）。"""
    from app.modules.agent.delegation import GLMConfig

    monkeypatch.setattr(GLMConfig, "from_env", classmethod(lambda cls: None))


@pytest.fixture()
def mocked_hub():
    hub = MagicMock()
    hub.is_connected.return_value = True
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=True)
    with mock_patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_group_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with mock_patch("app.modules.daemon.group.service.get_redis", return_value=redis):
        yield redis


@pytest.fixture()
def readiness_ok():
    stub = MagicMock()
    stub.wait = AsyncMock(return_value=True)
    with mock_patch("app.modules.daemon.session.service.get_session_readiness", return_value=stub):
        yield stub


# ── 懒建 lease stage + 简报段（daemon 主控谓词对接口径）──────────────────────


class TestTeamLazyCreation:
    async def test_team_member_lazy_lease_stage_orchestrator(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        """team_enabled 成员懒建：lease stage='orchestrator' + 简报含团队能力段。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id, team_enabled=True)],
        )
        resp = await _send_message(client, env.owner_token, data["id"], "@小码 派团队调研")
        assert resp.status_code == 200, resp.text
        trigger = resp.json()["triggered"][0]

        shadow = await db_session.get(AgentSession, uuid.UUID(trigger["shadow_session_id"]))
        assert shadow is not None
        lease = await db_session.get(DaemonTaskLease, shadow.lease_id)
        assert lease is not None and lease.metadata_ is not None
        # 主控谓词口径：stage='orchestrator'（cli.ts stage==''||'orchestrator'）。
        assert lease.metadata_["stage"] == "orchestrator"

        # 首轮 user_input 简报含团队能力段（工具名与 daemon 注入一致）。
        log_row = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == uuid.UUID(trigger["run_id"]),
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert log_row is not None
        assert "团队能力：" in log_row.content_redacted
        assert "由你转述" in log_row.content_redacted
        for tool in (
            "dispatch_worker",
            "list_workers",
            "get_worker_result",
            "converge_mission",
            "report_progress",
        ):
            assert tool in log_row.content_redacted, tool

    async def test_plain_member_lazy_lease_stage_group_member(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        """缺省成员（team_enabled=false）零回归：stage 仍 'group_member'、简报无团队段。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        resp = await _send_message(client, env.owner_token, data["id"], "@小码 看下")
        assert resp.status_code == 200, resp.text
        trigger = resp.json()["triggered"][0]

        shadow = await db_session.get(AgentSession, uuid.UUID(trigger["shadow_session_id"]))
        assert shadow is not None
        lease = await db_session.get(DaemonTaskLease, shadow.lease_id)
        assert lease is not None and lease.metadata_ is not None
        assert lease.metadata_["stage"] == "group_member"

        log_row = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == uuid.UUID(trigger["run_id"]),
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert log_row is not None
        assert "团队能力：" not in log_row.content_redacted
        assert "dispatch_worker" not in log_row.content_redacted

    async def test_resolve_mission_for_session_on_shadow(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        """影子（parent NULL 无 mission）解析 None；懒建 mission 绑影子后命中。

        dispatch_worker 懒建链兼容口径：主控成员调 dispatch_worker 时按
        session_id=影子懒建 AgentMission——resolve_mission_for_session 直查
        命中（影子 parent 恒 NULL 不影响）。
        """
        from app.modules.agent.model import resolve_mission_for_session

        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id, team_enabled=True)],
        )
        resp = await _send_message(client, env.owner_token, data["id"], "@小码 开工")
        assert resp.status_code == 200, resp.text
        trigger = resp.json()["triggered"][0]
        shadow_id = uuid.UUID(trigger["shadow_session_id"])

        assert await resolve_mission_for_session(db_session, shadow_id) is None

        # 懒建一条 mission 绑影子（session_id=影子——dispatch_worker allow_lazy
        # 回填口径）后命中。
        mission = AgentMission(
            workspace_id=env.ws.id,
            session_id=shadow_id,
            objective="群成员团队子任务",
            created_by=env.owner.id,
        )
        db_session.add(mission)
        await db_session.commit()
        hit = await resolve_mission_for_session(db_session, shadow_id)
        assert hit is not None and hit.id == mission.id


# ── 引擎门控（daemon 主控 5 工具仅 Claude 注入）──────────────────────────────


class TestTeamEngineGate:
    async def test_create_group_codex_team_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session)
        resp = await client.post(
            "/api/daemon/group-chats",
            json={
                "title": "codex 群",
                "project_id": str(env.project.id),
                "agent_members": [
                    _agent_config(env.runtime.id, name="小码", provider="codex", team_enabled=True)
                ],
            },
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400
        assert "团队能力" in resp.json()["message"]
        assert "Claude" in resp.json()["message"]

    async def test_add_member_codex_team_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        env = await _make_env(db_session)
        data = await _create_group(
            client, env.owner_token, project_id=env.project.id, agent_members=[]
        )
        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/members",
            json={
                "agent": _agent_config(
                    env.runtime.id, name="小达", provider="codex", team_enabled=True
                )
            },
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400
        assert "团队能力" in resp.json()["message"]

    async def test_patch_team_on_codex_member_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """codex 成员 PATCH 开 team → 400（fail-loud 不落库）。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id, name="小码", provider="codex")],
        )
        member = next(m for m in data["members"] if m["member_type"] == "agent")
        resp = await client.patch(
            f"/api/daemon/group-chats/{data['id']}/members/{member['id']}",
            json={"team_enabled": True},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400
        assert "团队能力" in resp.json()["message"]
        await db_session.reset()
        row = await _agent_member_row(db_session, uuid.UUID(data["id"]))
        assert row.team_enabled is False

    async def test_patch_provider_to_codex_with_team_on_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """已开 team 的 claude 成员 PATCH 切 codex 引擎 → 400（组合门控）。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id, team_enabled=True)],
        )
        member = next(m for m in data["members"] if m["member_type"] == "agent")
        resp = await client.patch(
            f"/api/daemon/group-chats/{data['id']}/members/{member['id']}",
            json={"provider": "codex"},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400
        assert "团队能力" in resp.json()["message"]

    async def test_user_member_patch_team_400(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """用户成员 PATCH team_enabled → 400（agent 成员专属维度）。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client, env.owner_token, project_id=env.project.id, agent_members=[]
        )
        owner_member = next(m for m in data["members"] if m.get("user_id"))
        resp = await client.patch(
            f"/api/daemon/group-chats/{data['id']}/members/{owner_member['id']}",
            json={"team_enabled": True},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 400

    async def test_team_member_patch_off_ok(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """claude 成员开/关 team 合法：Read 透出 team_enabled 落库往返。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id, team_enabled=True)],
        )
        member = next(m for m in data["members"] if m["member_type"] == "agent")
        assert member["team_enabled"] is True  # 建群携带透出

        resp = await client.patch(
            f"/api/daemon/group-chats/{data['id']}/members/{member['id']}",
            json={"team_enabled": False},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["team_enabled"] is False
        await db_session.reset()
        row = await _agent_member_row(db_session, uuid.UUID(data["id"]))
        assert row.team_enabled is False


# ── 热切换（team_enabled 变更走机器组重建分支）───────────────────────────────


class TestTeamHotSwitch:
    async def test_team_toggle_rebuilds_shadow(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
        mocked_group_redis,
    ) -> None:
        """影子存在时切 team：end 影子 + pending + 指针置空（stage 随 lease
        建时定，复用轮改不掉——必须重建才能换工具注入）。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])
        resp = await _send_message(client, env.owner_token, data["id"], "@小码 建影子")
        assert resp.status_code == 200, resp.text
        trigger = resp.json()["triggered"][0]
        old_shadow_id = uuid.UUID(trigger["shadow_session_id"])

        resp = await client.patch(
            f"/api/daemon/group-chats/{data['id']}/members/{trigger['member_id']}",
            json={"team_enabled": True},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["team_enabled"] is True
        assert body["shadow_status"] == "pending"
        assert body["shadow_session_id"] is None

        # 旧影子被 end 链收口；成员行指针置空 + pending（下次触发按新开关重懒建）。
        await db_session.reset()
        old_shadow = await db_session.get(AgentSession, old_shadow_id)
        assert old_shadow is not None and old_shadow.status == "ended"
        member = await _agent_member_row(db_session, group_id)
        assert member.team_enabled is True
        assert member.shadow_status == "pending"
        assert member.shadow_session_id is None

        # 重建后再触发：新影子 lease stage='orchestrator'。
        resp = await _send_message(client, env.owner_token, data["id"], "@小码 再触发")
        assert resp.status_code == 200, resp.text
        new_trigger = resp.json()["triggered"][0]
        assert new_trigger["shadow_session_id"] != str(old_shadow_id)
        new_shadow = await db_session.get(AgentSession, uuid.UUID(new_trigger["shadow_session_id"]))
        assert new_shadow is not None
        lease = await db_session.get(DaemonTaskLease, new_shadow.lease_id)
        assert lease is not None and lease.metadata_ is not None
        assert lease.metadata_["stage"] == "orchestrator"

    async def test_team_toggle_without_shadow_persists_only(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """无影子（未触发过）时切 team：仅落库（懒建时按新值选 stage）。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        member = next(m for m in data["members"] if m["member_type"] == "agent")
        resp = await client.patch(
            f"/api/daemon/group-chats/{data['id']}/members/{member['id']}",
            json={"team_enabled": True},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["team_enabled"] is True
        # 影子本不存在——不进重建分支（幂等，shadow_status 保持 none）。
        await db_session.reset()
        row = await _agent_member_row(db_session, uuid.UUID(data["id"]))
        assert row.team_enabled is True
        assert row.shadow_status == "none"
        assert row.shadow_session_id is None


# ── 迁移 DDL（20260902110000：agent_group_members.team_enabled）───────────────

TEAM_MIGRATION_REVISION = "20260902110000"


def _load_migration(revision_id: str):
    """按 revision id 加载迁移模块（test_group_chat_models._load_migration 同款）。"""
    import importlib
    import os
    from pathlib import Path

    backend_root = Path(__file__).resolve().parents[4]
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and revision_id in f and f != "__init__.py":
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {revision_id} in {versions_dir}")


def _run_migration_fn(engine, mod, fn_name: str) -> None:
    """在 SQLite 连接上执行迁移函数本体（alembic op 代理经 Operations.context）。"""
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            getattr(mod, fn_name)()


def _pragma_column(conn, table: str, column: str) -> tuple[str, int] | None:
    for _cid, name, col_type, notnull, _dflt, _pk in conn.execute(
        sa.text(f"PRAGMA table_info({table})")
    ):
        if name == column:
            return str(col_type), int(notnull)
    return None


class TestTeamMigration:
    def test_upgrade_downgrade_roundtrip(self) -> None:
        """upgrade：加列 BOOLEAN NOT NULL server_default false（存量行回填假值）；
        downgrade：对称删列、原列保留。"""
        engine = sa.create_engine("sqlite:///:memory:")
        with engine.begin() as conn:
            # 最小前置表（仅本迁移触碰的表；列含 NOT NULL 主干即可）。
            conn.execute(
                sa.text(
                    "CREATE TABLE agent_group_members ("
                    "id VARCHAR(36) PRIMARY KEY, "
                    "group_id VARCHAR(36) NOT NULL, "
                    "member_type VARCHAR(8) NOT NULL, "
                    "display_name VARCHAR(40) NOT NULL)"
                )
            )
            conn.execute(
                sa.text(
                    "INSERT INTO agent_group_members "
                    "(id, group_id, member_type, display_name) "
                    "VALUES ('m1', 'g1', 'agent', '小码')"
                )
            )
        mod = _load_migration(TEAM_MIGRATION_REVISION)
        assert mod.revision == TEAM_MIGRATION_REVISION
        _run_migration_fn(engine, mod, "upgrade")
        with engine.begin() as conn:
            col = _pragma_column(conn, "agent_group_members", "team_enabled")
            assert col is not None
            col_type, notnull = col
            assert col_type.upper() == "BOOLEAN"
            assert notnull == 1
            # 存量行经 server_default 回填假值（SQLite 0）。
            val = conn.execute(sa.text("SELECT team_enabled FROM agent_group_members")).scalar()
            assert val in (0, False)

        _run_migration_fn(engine, mod, "downgrade")
        with engine.begin() as conn:
            assert _pragma_column(conn, "agent_group_members", "team_enabled") is None
            assert _pragma_column(conn, "agent_group_members", "display_name") is not None
        engine.dispose()
