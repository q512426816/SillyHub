"""quick 影子直聊+选择性回群投影测试（2026-09-02，后端部分）。

覆盖（任务卡口径）：

- 直聊端点：群主 200（注入 prompt 含 [[GROUP]] 标记说明 + 本轮 user_input
  metadata ``source="shadow_direct"`` + 直聊载体 run 零日志行）；普通成员 403；
  非成员 404；影子未建 400；忙轮中途注入（``busy_strategy="inject"`` 调用
  断言 + mid_turn=True + run_id 沿用活跃 run + 零排队行）；
- 投影过滤：直聊轮无标记 → 零投影行 + 零群频道事件；[[GROUP]] 段 → 仅该段
  投影（标记剥离 + 成员身份 metadata）+ 影子原文完整保留（含标记）；多段
  依次各一行投影；partial 半截行不解析（完整行到达统一抽段）；
- 排队标记 source 透传：直聊轮排队条目 prompt 头链标记带 ``source=
  shadow_direct``，``_split_group_chain_marker`` 还原（老标记无 source 段
  兼容零回归）；
- 回归：群 @ 轮（无 source 标记）投影行为零变化（全投影照旧）；
- 互@护栏：直聊轮 turn_completed 后不触发互@协作（run_cross_mention_detection
  直聊轮早退）。

夹具范式：端点侧镜像 ``test_group_team.py``（httpx ASGI + 手签 JWT +
ws_hub/readiness/redis mock；GLMConfig.from_env → None 知识库铁律）；投影侧
镜像 ``test_group_bridge_projection.py``（recording_redis 录制 pipeline sink）。
"""

from __future__ import annotations

import json
import secrets
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from unittest.mock import patch as mock_patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import (
    AgentGroupChat,
    AgentGroupMember,
    AgentRun,
    AgentRunLog,
    AgentSession,
    AgentSessionQueuedMessage,
)
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.daemon.run_sync.service import publish_submitted_messages
from app.modules.daemon.service import DaemonService
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.workspace.model import PpmProjectWorkspace, Workspace

# segmentId 用 daemon 格式（${prefix}:${mid}:${type}，main 前缀 = 主 agent）。
SEG = "main:msg_direct01:text"

# ── 端点侧 Helpers（镜像 test_group_team.py 夹具范式）─────────────────────────


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


async def _create_user_with_token(
    db_session: AsyncSession, *, name: str, admin: bool = False
) -> tuple[User, str]:
    user = User(
        id=uuid.uuid4(),
        email=f"grpd-{name}-{uuid.uuid4()}@example.com",
        password_hash="irrelevant",
        display_name=name,
        status="active",
        is_platform_admin=admin,
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
        key=f"grpd-{uuid.uuid4().hex[:8]}",
        name="grpd-test-role",
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
        name="grpd-ws",
        slug=f"grpd-ws-{uuid.uuid4().hex[:8]}",
        root_path=f"C:/tmp/grpd-ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    project = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code=f"GRPD-{uuid.uuid4().hex[:12]}",
        project_name="影子直聊测试项目",
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
        hostname="grpd-host",
        server_url="http://test.local",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(instance)
    runtime = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=instance.id,
        user_id=owner.id,
        name="grpd-host",
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


async def _env_user(
    db_session: AsyncSession, env: SimpleNamespace, *, name: str
) -> tuple[User, str]:
    user, token = await _create_user_with_token(db_session, name=name)
    await _grant_workspace_role(db_session, workspace_id=env.ws.id, user_id=user.id)
    db_session.add(PpmProjectMember(id=uuid.uuid4(), pm_project_id=env.project.id, user_id=user.id))
    await db_session.commit()
    return user, token


async def _create_group(
    client: AsyncClient,
    owner_token: str,
    *,
    project_id: uuid.UUID,
    user_members: list[dict] | None = None,
    agent_members: list[dict],
) -> dict:
    payload: dict = {
        "title": "直聊测试群",
        "project_id": str(project_id),
        "agent_members": agent_members,
    }
    if user_members:
        payload["user_members"] = user_members
    resp = await client.post("/api/daemon/group-chats", json=payload, headers=_headers(owner_token))
    assert resp.status_code == 201, resp.text
    return resp.json()


def _agent_config(runtime_id: uuid.UUID, name: str = "小码") -> dict:
    return {"display_name": name, "runtime_id": str(runtime_id), "provider": "claude"}


async def _send_message(client: AsyncClient, token: str, group_id: str, content: str) -> "object":
    return await client.post(
        f"/api/daemon/group-chats/{group_id}/messages",
        json={"content": content},
        headers=_headers(token),
    )


async def _direct_message(
    client: AsyncClient,
    token: str,
    group_id: str,
    member_id: str,
    content: str,
) -> "object":
    return await client.post(
        f"/api/daemon/group-chats/{group_id}/members/{member_id}/direct-message",
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


async def _list_queued(
    db_session: AsyncSession, session_id: uuid.UUID
) -> list[AgentSessionQueuedMessage]:
    return list(
        (
            await db_session.execute(
                select(AgentSessionQueuedMessage).where(
                    AgentSessionQueuedMessage.agent_session_id == session_id
                )
            )
        )
        .scalars()
        .all()
    )


async def _seed_shadow_with_active_run(
    db_session: AsyncSession,
    *,
    member: AgentGroupMember,
    owner_user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    run_status: str = "running",
) -> AgentSession:
    """落一行 active 影子会话 + interactive lease + 指定状态 run（测试替身）。

    ``run_status='running'`` → 忙轮（busy_strategy="inject" 路径）；
    ``'completed'`` → 空闲（普通注入新 run 路径）。
    """
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        kind="interactive",
        status="active",
        metadata_={"claim_token": secrets.token_hex(32)},
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db_session.add(lease)
    await db_session.flush()
    shadow = AgentSession(
        id=uuid.uuid4(),
        user_id=owner_user_id,
        runtime_id=runtime_id,
        lease_id=lease.id,
        provider="claude",
        status="active",
        turn_count=1,
        created_at=datetime.now(UTC),
        session_kind="group_member",
    )
    db_session.add(shadow)
    await db_session.flush()
    db_session.add(
        AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status=run_status,
            spec_strategy="interactive",
            agent_session_id=shadow.id,
            user_id=owner_user_id,
        )
    )
    member.shadow_session_id = shadow.id
    member.shadow_status = "active"
    db_session.add(member)
    await db_session.commit()
    return shadow


# ── 共用 mock 夹具（镜像 test_group_team.py）──────────────────────────────────


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


# ── 直聊端点 ─────────────────────────────────────────────────────────────────


class TestDirectMessageEndpoint:
    async def test_owner_direct_message_ok(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
        mocked_group_redis,
    ) -> None:
        """群主直聊 200：prompt 含 [[GROUP]] 标记说明 + metadata source=shadow_direct
        + 直聊载体 run 零日志行（群时间线零可见）。"""
        from app.modules.daemon.group.service import SHADOW_DIRECT_SOURCE

        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])
        # 先 @ 触发懒建影子（直聊前置）。
        resp = await _send_message(client, env.owner_token, data["id"], "@小码 建影子")
        assert resp.status_code == 200, resp.text
        trigger = resp.json()["triggered"][0]
        shadow_id = trigger["shadow_session_id"]

        member = await _agent_member_row(db_session, group_id)
        # 首轮 run 恒 pending（无 daemon 收口）→ 直聊命中忙轮中途注入路径。
        resp = await _direct_message(
            client, env.owner_token, data["id"], member.id, "登录页白屏的根因是什么？"
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["shadow_session_id"] == shadow_id
        assert body["queued"] is False
        assert body["mid_turn"] is True
        assert body["run_id"] == trigger["run_id"]  # 沿用活跃 run
        assert body["carrier_run_id"]

        # 直聊载体 run：挂群会话、group_carrier、零日志行（直聊内容不进群时间线）。
        carrier = await db_session.get(AgentRun, uuid.UUID(body["carrier_run_id"]))
        assert carrier is not None
        assert carrier.agent_session_id == group_id
        assert carrier.spec_strategy == "group_carrier"
        carrier_logs = (
            (await db_session.execute(select(AgentRunLog).where(AgentRunLog.run_id == carrier.id)))
            .scalars()
            .all()
        )
        assert list(carrier_logs) == []

        # 影子侧本轮 user_input：直聊头（含 [[GROUP]] 标记说明）+ 用户内容；
        # metadata source=shadow_direct + 直聊载体 + 发送者。忙轮注入挂同一
        # 活跃 run（其上已有 @ 触发轮的 user_input）——取最新一条。
        log_row = (
            (
                await db_session.execute(
                    select(AgentRunLog)
                    .where(
                        AgentRunLog.run_id == uuid.UUID(body["run_id"]),
                        AgentRunLog.channel == "user_input",
                    )
                    .order_by(AgentRunLog.timestamp.desc(), AgentRunLog.id.desc())
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
        assert log_row is not None
        assert "[[GROUP]]" in log_row.content_redacted
        assert "[[/GROUP]]" in log_row.content_redacted
        assert "独立会话" in log_row.content_redacted
        assert "不会出现在群里" in log_row.content_redacted
        assert "登录页白屏的根因是什么？" in log_row.content_redacted
        # 不套群简报（直聊非群消息）。
        assert "群聊记录" not in log_row.content_redacted
        meta = log_row.metadata_ or {}
        assert meta["source"] == SHADOW_DIRECT_SOURCE
        assert meta["source_carrier_run_id"] == body["carrier_run_id"]
        assert meta["source_group_id"] == str(group_id)
        assert meta["sender_user_id"] == str(env.owner.id)

        # 群频道零直聊内容事件（@ 触发轮的既有事件之外无新增 log 事件）。
        group_logs = [
            json.loads(call.args[1])
            for call in mocked_group_redis.publish.call_args_list
            if call.args[0] == f"agent_session:{group_id}"
            and json.loads(call.args[1]).get("event") == "log"
        ]
        assert all("登录页白屏的根因" not in (e.get("content") or "") for e in group_logs)

    async def test_regular_member_direct_message_403(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        """普通用户成员（可见群）直聊 → 403（写=群主/admin）。"""
        env = await _make_env(db_session)
        sender, sender_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(sender.id)}],
            agent_members=[_agent_config(env.runtime.id)],
        )
        member = await _agent_member_row(db_session, uuid.UUID(data["id"]))
        resp = await _direct_message(client, sender_token, data["id"], member.id, "私聊一下")
        assert resp.status_code == 403, resp.text

    async def test_non_member_direct_message_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        """非群成员直聊 → 404（不泄露群存在性）。"""
        env = await _make_env(db_session)
        outsider, outsider_token = await _create_user_with_token(db_session, name="路人")
        # 补 TASK_RUN_AGENT 权限过登录门（无群成员行 → 404）。
        await _grant_workspace_role(db_session, workspace_id=env.ws.id, user_id=outsider.id)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        member = await _agent_member_row(db_session, uuid.UUID(data["id"]))
        resp = await _direct_message(client, outsider_token, data["id"], member.id, "私聊一下")
        assert resp.status_code == 404, resp.text

    async def test_shadow_not_created_400(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        """影子未建（未 @ 过）直聊 → 400（先群内 @ 触发懒建）。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        member = await _agent_member_row(db_session, uuid.UUID(data["id"]))
        assert member.shadow_session_id is None
        resp = await _direct_message(client, env.owner_token, data["id"], member.id, "私聊一下")
        assert resp.status_code == 400, resp.text
        assert "独立会话尚未创建" in resp.json()["message"]

    async def test_busy_direct_message_injects_mid_turn(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        """忙轮直聊：busy_strategy="inject" 调用断言 + mid_turn=True + run_id 沿用
        活跃 run + 零排队行 + prompt 头含中途标注。"""
        from app.modules.daemon.control_commands import KIND_SESSION_INJECT
        from app.modules.daemon.group.service import _MID_TURN_NOTICE
        from app.modules.daemon.model import DaemonControlCommand
        from app.modules.daemon.session.service import SessionService

        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])
        member = await _agent_member_row(db_session, group_id)
        shadow = await _seed_shadow_with_active_run(
            db_session,
            member=member,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
        )
        busy_run_id = (
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == shadow.id)
                )
            )
            .scalars()
            .first()
        ).id

        # busy_strategy 断言替身：记录 kwargs 后走真实实现。
        original = SessionService.inject_session_as_service
        seen_kwargs: list[dict] = []

        async def _spy(self, session_id, **kwargs):
            seen_kwargs.append(dict(kwargs))
            return await original(self, session_id, **kwargs)

        with mock_patch.object(SessionService, "inject_session_as_service", _spy):
            resp = await _direct_message(
                client, env.owner_token, data["id"], member.id, "中途追问：影响范围多大？"
            )
            assert resp.status_code == 200, resp.text
        assert any(kw.get("busy_strategy") == "inject" for kw in seen_kwargs), (
            "直聊忙轮必须走 busy_strategy=inject 中途注入路径"
        )

        body = resp.json()
        assert body["queued"] is False
        assert body["mid_turn"] is True
        assert body["run_id"] == str(busy_run_id)
        assert await _list_queued(db_session, shadow.id) == []

        # SESSION_INJECT payload：run_id=活跃 run、prompt 头中途标注 + 直聊头。
        commands = list(
            (
                await db_session.execute(
                    select(DaemonControlCommand).where(
                        DaemonControlCommand.runtime_id == env.runtime.id,
                        DaemonControlCommand.kind == KIND_SESSION_INJECT,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert commands, "未下发 SESSION_INJECT"
        payload = commands[0].payload
        assert payload is not None
        assert payload["run_id"] == str(busy_run_id)
        assert payload["prompt"].startswith(_MID_TURN_NOTICE)
        assert "[[GROUP]]" in payload["prompt"]
        assert "中途追问：影响范围多大？" in payload["prompt"]

    async def test_idle_direct_message_creates_new_run(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        """影子空闲（run 已终态）直聊：普通注入新 run + metadata source 落库。"""
        from app.modules.daemon.group.service import SHADOW_DIRECT_SOURCE

        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])
        member = await _agent_member_row(db_session, group_id)
        await _seed_shadow_with_active_run(
            db_session,
            member=member,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
            run_status="completed",
        )

        resp = await _direct_message(client, env.owner_token, data["id"], member.id, "空闲直聊")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["queued"] is False
        assert body["mid_turn"] is False
        assert body["run_id"] is not None

        log_row = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == uuid.UUID(body["run_id"]),
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert log_row is not None
        assert (log_row.metadata_ or {})["source"] == SHADOW_DIRECT_SOURCE
        assert (log_row.metadata_ or {})["sender_user_id"] == str(env.owner.id)

    async def test_direct_message_queue_fallback_carries_source(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        """409 竞态降级排队：排队条目 prompt 头链标记带 source=shadow_direct
        （派发侧 _split_group_chain_marker 还原，投影判定不回退成全投影）。"""
        from app.modules.daemon.session.service import (
            DaemonSessionTurnConflict,
            SessionService,
            _split_group_chain_marker,
        )

        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])
        member = await _agent_member_row(db_session, group_id)
        shadow = await _seed_shadow_with_active_run(
            db_session,
            member=member,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
        )

        original = SessionService.inject_session_as_service
        calls = {"inject_calls": 0}

        async def conflict_once(self, session_id, **kwargs):
            if kwargs.get("busy_strategy") == "inject":
                calls["inject_calls"] += 1
                if calls["inject_calls"] == 1:
                    raise DaemonSessionTurnConflict(
                        "Session run just went terminal (race).",
                        details={"session_id": str(session_id)},
                    )
            return await original(self, session_id, **kwargs)

        with mock_patch.object(SessionService, "inject_session_as_service", conflict_once):
            resp = await _direct_message(
                client, env.owner_token, data["id"], member.id, "竞态降级排队"
            )
            assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["queued"] is True
        assert body["mid_turn"] is False
        assert body["run_id"] is None

        entries = await _list_queued(db_session, shadow.id)
        assert len(entries) == 1
        assert entries[0].sender_user_id == env.owner.id
        _prompt, chain_meta = _split_group_chain_marker(entries[0].prompt or "")
        assert chain_meta is not None
        assert chain_meta.get("source") == "shadow_direct"
        assert "竞态降级排队" in (entries[0].prompt or "")


# ── 投影侧种子（镜像 test_group_bridge_projection.py）─────────────────────────


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"grpd-bridge-{uid}@example.com",
            password_hash="x",
            display_name="群主",
            status="active",
        )
    )
    await db_session.commit()
    return uid


async def _create_runtime(db_session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="grpd-bridge-daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    return rt


async def _seed_group_bridge(
    db_session: AsyncSession,
    *,
    member_name: str = "小码",
    turn_source: str | None = None,
) -> SimpleNamespace:
    """落一套完整群桥接底座（群会话/群行/agent 成员/影子会话/影子 run/载体 run/
    影子 run 的 user_input 轮 metadata）。

    ``turn_source``：写入轮 metadata ``source`` 字段——"shadow_direct" 模拟
    直聊轮（投影过滤判定锚）；None = 群 @ 触发轮（既有形态，回归对照）。
    """
    owner_id = await _create_user(db_session)
    rt = await _create_runtime(db_session, owner_id)
    ws = Workspace(
        id=uuid.uuid4(),
        name="grpd-bridge-ws",
        slug=f"grpd-bridge-ws-{uuid.uuid4().hex[:8]}",
        root_path="C:/tmp/grpd-bridge-ws",
        status="active",
    )
    db_session.add(ws)
    await db_session.flush()

    group_session_id = uuid.uuid4()
    db_session.add(
        AgentSession(
            id=group_session_id,
            user_id=owner_id,
            provider="group",
            status="active",
            title="直聊桥接测试群",
            turn_count=0,
            created_at=datetime.now(UTC),
            session_kind="group",
        )
    )
    await db_session.flush()
    db_session.add(
        AgentGroupChat(
            id=group_session_id,
            session_id=group_session_id,
            workspace_id=ws.id,
            title="直聊桥接测试群",
            created_by=owner_id,
        )
    )
    await db_session.flush()

    # 载体 run（spec_strategy='group_carrier'）。
    carrier_run_id = uuid.uuid4()
    now = datetime.now(UTC)
    db_session.add(
        AgentRun(
            id=carrier_run_id,
            agent_type="claude_code",
            provider="group",
            status="completed",
            started_at=now,
            finished_at=now,
            spec_strategy="group_carrier",
            agent_session_id=group_session_id,
            user_id=owner_id,
        )
    )

    # 影子会话 + lease + 影子 run + 本轮 user_input 轮 metadata。
    claim_token = secrets.token_hex(32)
    shadow_session_id = uuid.uuid4()
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=rt.id,
        kind="interactive",
        status="active",
        metadata_={"claim_token": claim_token, "session_id": str(shadow_session_id)},
        created_at=now,
        updated_at=now,
    )
    db_session.add(lease)
    await db_session.flush()
    db_session.add(
        AgentSession(
            id=shadow_session_id,
            user_id=owner_id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            status="active",
            turn_count=1,
            created_at=now,
            session_kind="group_member",
        )
    )

    member = AgentGroupMember(
        group_id=group_session_id,
        member_type="agent",
        display_name=member_name,
        runtime_id=rt.id,
        workspace_id=ws.id,
        provider="claude",
        shadow_status="active",
        shadow_session_id=shadow_session_id,
        invited_by=owner_id,
        joined_at=now,
    )
    db_session.add(member)

    shadow_run_id = uuid.uuid4()
    db_session.add(
        AgentRun(
            id=shadow_run_id,
            agent_type="claude_code",
            provider="claude",
            status="pending",
            spec_strategy="interactive",
            agent_session_id=shadow_session_id,
            user_id=owner_id,
        )
    )
    await db_session.flush()
    turn_metadata: dict = {
        "source_group_id": str(group_session_id),
        "source_member_id": str(member.id),
        "source_carrier_run_id": str(carrier_run_id),
        "chain_depth": 0,
        "sender_user_id": str(owner_id),
    }
    if turn_source is not None:
        turn_metadata["source"] = turn_source
    db_session.add(
        AgentRunLog(
            id=uuid.uuid4(),
            run_id=shadow_run_id,
            channel="user_input",
            content_redacted="@小码 帮我看下登录页白屏",
            timestamp=now,
            metadata_=turn_metadata,
        )
    )
    await db_session.commit()
    return SimpleNamespace(
        owner_id=owner_id,
        runtime_id=rt.id,
        group_session_id=group_session_id,
        member=member,
        shadow_session_id=shadow_session_id,
        lease_id=lease.id,
        claim_token=claim_token,
        shadow_run_id=shadow_run_id,
        carrier_run_id=carrier_run_id,
    )


class _RecordingPipeline:
    """录制 pipeline：publish(channel, payload) 入 sink，execute 为 async no-op。"""

    def __init__(self, sink: list[tuple[str, str]]) -> None:
        self._sink = sink

    def publish(self, channel: str, payload: str) -> None:
        self._sink.append((channel, payload))

    async def execute(self) -> list:
        return []


@pytest.fixture()
def recording_redis():
    """录制 publish_submitted_messages 各路 publish（pipeline 批量 + 直发）。"""
    sink: list[tuple[str, str]] = []
    redis = AsyncMock()
    redis.pipeline = MagicMock(side_effect=lambda: _RecordingPipeline(sink))
    with (
        mock_patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        mock_patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield sink, redis


@pytest.fixture()
def mocked_redis():
    """普通 AsyncMock redis（不需要检视 publish 内容的用例）。"""
    redis = AsyncMock()
    redis.pipeline = MagicMock(side_effect=lambda: _RecordingPipeline([]))
    with (
        mock_patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        mock_patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


async def _fetch_logs(db_session: AsyncSession, run_id: uuid.UUID) -> list[AgentRunLog]:
    rows = (
        (
            await db_session.execute(
                select(AgentRunLog)
                .where(AgentRunLog.run_id == run_id)
                .order_by(AgentRunLog.timestamp, AgentRunLog.id)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


def _group_log_events(sink: list[tuple[str, str]], group_id: uuid.UUID) -> list[dict]:
    """解析群频道 agent_session:{group_id} 上的全部 log 事件 payload。"""
    channel = f"agent_session:{group_id}"
    return [
        json.loads(payload)
        for ch, payload in sink
        if ch == channel and json.loads(payload).get("event") == "log"
    ]


# ── 投影过滤：直聊轮零投影 + [[GROUP]] 段例外 ─────────────────────────────────


class TestDirectTurnProjection:
    async def test_direct_turn_no_marker_zero_projection(
        self,
        db_session: AsyncSession,
        recording_redis,
    ) -> None:
        """直聊轮无 [[GROUP]] 标记 → 零投影行 + 零群频道事件（直聊内容只留影子）。"""
        sink, _redis = recording_redis
        seed = await _seed_group_bridge(db_session, turn_source="shadow_direct")
        svc = DaemonService(db_session)
        result = await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 根因是 hooks 依赖缺失",
                    "channel": "stdout",
                },
                {"event_type": "text", "content": "[THINKING] 内部分析", "channel": "stdout"},
            ],
        )
        assert result == 2

        # 影子 run 照常落 2 行；直聊载体 run 零投影行。
        shadow_rows = [
            r
            for r in await _fetch_logs(db_session, seed.shadow_run_id)
            if r.channel != "user_input"
        ]
        assert len(shadow_rows) == 2
        assert await _fetch_logs(db_session, seed.carrier_run_id) == []

        await publish_submitted_messages(result.publish_intent)
        # 群频道零 log 事件（投影行零 → 群分支直聊模式零发布）。
        assert _group_log_events(sink, seed.group_session_id) == []
        # 影子会话频道照旧（run/session 两路不受直聊投影模式影响）。
        shadow_channel_events = [
            json.loads(payload)
            for ch, payload in sink
            if ch == f"agent_session:{seed.shadow_session_id}"
        ]
        assert len(shadow_channel_events) == 2

    async def test_direct_turn_group_marker_projects_segment_only(
        self,
        db_session: AsyncSession,
        recording_redis,
    ) -> None:
        """[[GROUP]] 段 → 仅该段投影（标记剥离 + 成员身份）；影子原文完整保留
        （含标记）；群频道事件 log_id=投影行 id、content=段文本。"""
        sink, _redis = recording_redis
        seed = await _seed_group_bridge(db_session, turn_source="shadow_direct")
        svc = DaemonService(db_session)
        full_reply = (
            "[ASSISTANT] 根因已定位：useEffect 依赖缺失。\n"
            "[[GROUP]]\n登录页白屏已修复：useEffect 缺失依赖导致状态不更新。\n[[/GROUP]]\n"
            "其余细节只在本会话可见。"
        )
        result = await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [{"event_type": "text", "content": full_reply, "channel": "stdout"}],
        )
        assert result == 1

        # 影子行原文完整（含标记）。
        shadow_rows = [
            r
            for r in await _fetch_logs(db_session, seed.shadow_run_id)
            if r.channel != "user_input"
        ]
        assert len(shadow_rows) == 1
        assert shadow_rows[0].content_redacted == full_reply

        # 载体 run 仅一段投影行：标记剥离、stdout、身份 metadata 齐全。
        carrier_rows = await _fetch_logs(db_session, seed.carrier_run_id)
        assert len(carrier_rows) == 1
        proj = carrier_rows[0]
        assert proj.content_redacted == "登录页白屏已修复：useEffect 缺失依赖导致状态不更新。"
        assert "[[GROUP]]" not in proj.content_redacted
        assert proj.channel == "stdout"
        meta = proj.metadata_ or {}
        assert meta["member_id"] == str(seed.member.id)
        assert meta["member_name"] == "小码"
        assert meta["source_log_id"] == str(shadow_rows[0].id)
        assert meta["projection"] is True

        await publish_submitted_messages(result.publish_intent)
        events = _group_log_events(sink, seed.group_session_id)
        assert len(events) == 1, "直聊轮只有 [[GROUP]] 段进群频道"
        event = events[0]
        assert event["log_id"] == str(proj.id)
        assert event["content"] == "登录页白屏已修复：useEffect 缺失依赖导致状态不更新。"
        assert event["member_id"] == str(seed.member.id)
        assert event["member_name"] == "小码"
        assert event["member_session_id"] == str(seed.shadow_session_id)

    async def test_direct_turn_multiple_segments_projected_in_order(
        self,
        db_session: AsyncSession,
        recording_redis,
    ) -> None:
        """同轮多段 [[GROUP]]：每段一行投影、保序；段间非标记内容零投影。"""
        sink, _redis = recording_redis
        seed = await _seed_group_bridge(db_session, turn_source="shadow_direct")
        svc = DaemonService(db_session)
        result = await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [
                {
                    "event_type": "text",
                    "content": (
                        "[ASSISTANT] 分析完成。\n"
                        "[[GROUP]]第一段：白屏根因[[/GROUP]]\n"
                        "中间私密内容。\n"
                        "[[GROUP]]第二段：修复建议[[/GROUP]]"
                    ),
                    "channel": "stdout",
                }
            ],
        )
        assert result == 1

        carrier_rows = await _fetch_logs(db_session, seed.carrier_run_id)
        assert [r.content_redacted for r in carrier_rows] == [
            "第一段：白屏根因",
            "第二段：修复建议",
        ]
        for row in carrier_rows:
            assert (row.metadata_ or {})["member_name"] == "小码"

        await publish_submitted_messages(result.publish_intent)
        events = _group_log_events(sink, seed.group_session_id)
        assert [e["content"] for e in events] == ["第一段：白屏根因", "第二段：修复建议"]
        assert [e["log_id"] for e in events] == [str(r.id) for r in carrier_rows]

    async def test_direct_turn_partial_not_parsed_until_complete(
        self,
        db_session: AsyncSession,
        recording_redis,
    ) -> None:
        """partial 半截行不解析（标记可能被流式截断）：partial 零投影，完整行
        到达统一抽段投影（影子侧 partial 被既有收敛 DELETE，只剩完整行）。"""
        _sink, _redis = recording_redis
        seed = await _seed_group_bridge(db_session, turn_source="shadow_direct")
        svc = DaemonService(db_session)

        first = await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 分析中……[[GRO",
                    "channel": "stdout",
                    "metadata": {"segmentId": SEG, "isPartial": True},
                }
            ],
        )
        assert first == 1
        # partial 零投影（直聊模式不解析半截行）。
        assert await _fetch_logs(db_session, seed.carrier_run_id) == []

        second = await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 完成。[[GROUP]]结论段[[/GROUP]]",
                    "channel": "stdout",
                    "metadata": {"segmentId": SEG, "isComplete": True},
                }
            ],
        )
        assert second == 1
        carrier_rows = await _fetch_logs(db_session, seed.carrier_run_id)
        assert [r.content_redacted for r in carrier_rows] == ["结论段"]

    async def test_mention_turn_projection_unchanged(
        self,
        db_session: AsyncSession,
        recording_redis,
    ) -> None:
        """回归：群 @ 轮（无 source 标记）投影零变化——assistant 文本全投影。"""
        sink, _redis = recording_redis
        seed = await _seed_group_bridge(db_session)  # turn_source=None
        svc = DaemonService(db_session)
        result = await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 已定位：LoginForm.jsx:47 hooks 依赖缺失",
                    "channel": "stdout",
                    "dedup_key": "dd-direct-regress",
                },
                {"event_type": "text", "content": "[THINKING] 思考", "channel": "stdout"},
            ],
        )
        assert result == 2

        carrier_rows = await _fetch_logs(db_session, seed.carrier_run_id)
        assert [r.content_redacted for r in carrier_rows] == [
            "[ASSISTANT] 已定位：LoginForm.jsx:47 hooks 依赖缺失"
        ]
        assert carrier_rows[0].dedup_key == "dd-direct-regress"

        await publish_submitted_messages(result.publish_intent)
        events = _group_log_events(sink, seed.group_session_id)
        assert len(events) == 1
        assert events[0]["log_id"] == str(carrier_rows[0].id)
        assert events[0]["content"] == "[ASSISTANT] 已定位：LoginForm.jsx:47 hooks 依赖缺失"


# ── 标记解析纯函数 + 排队标记 source 透传 ─────────────────────────────────────


class TestMarkerParsing:
    def test_extract_segments_variants(self) -> None:
        """纯函数矩阵：多段保序 / 去空白 / 未闭合不匹配 / 大小写敏感 / 无标记空。"""
        from app.modules.daemon.run_sync.service import extract_group_broadcast_segments

        assert extract_group_broadcast_segments("无标记文本") == []
        assert extract_group_broadcast_segments("[[GROUP]]单段[[/GROUP]]") == ["单段"]
        assert extract_group_broadcast_segments(
            "前[[GROUP]]  A  [[/GROUP]]中[[GROUP]]B[[/GROUP]]后"
        ) == ["A", "B"]
        # 未闭合 → 不匹配（不转发半截）。
        assert extract_group_broadcast_segments("[[GROUP]]没闭合") == []
        # 空白段丢弃。
        assert extract_group_broadcast_segments("[[GROUP]]   [[/GROUP]]") == []
        # 大小写敏感（[[group]] 不命中）。
        assert extract_group_broadcast_segments("[[group]]x[[/GROUP]]") == []

    def test_chain_marker_source_roundtrip(self) -> None:
        """排队链标记 source 段往返：带 source 还原；老标记（无 source）兼容。"""
        from app.modules.daemon.session.service import (
            _prepend_group_chain_marker,
            _split_group_chain_marker,
        )

        carrier = str(uuid.uuid4())
        meta = {
            "source": "shadow_direct",
            "source_carrier_run_id": carrier,
            "chain_depth": 0,
        }
        prompt = _prepend_group_chain_marker("正文", meta)
        rest, parsed = _split_group_chain_marker(prompt)
        assert rest == "正文"
        assert parsed is not None
        assert parsed["source"] == "shadow_direct"
        assert parsed["source_carrier_run_id"] == carrier
        assert parsed["chain_depth"] == 0

        # 老（群 @ 轮）标记：无 source 段 → metadata 不带 source 键。
        old_prompt = f"[GROUP_CHAIN carrier={carrier} depth=2]\n正文"
        rest_old, parsed_old = _split_group_chain_marker(old_prompt)
        assert rest_old == "正文"
        assert parsed_old is not None
        assert "source" not in parsed_old


# ── 互@护栏：直聊轮不触发互@协作 ───────────────────────────────────────────────


class TestDirectTurnCrossMentionGuard:
    async def test_direct_turn_skips_cross_mention_detection(
        self,
        db_session: AsyncSession,
        recording_redis,
    ) -> None:
        """直聊轮回复带 @其他成员 也零互@触发（run_cross_mention_detection 直聊
        轮早退——独立会话不自动触发群成员）。"""
        _sink, _redis = recording_redis
        seed = await _seed_group_bridge(db_session, turn_source="shadow_direct")
        # 群内再放一个 agent 成员「小助」（互@候选）。
        db_session.add(
            AgentGroupMember(
                group_id=seed.group_session_id,
                member_type="agent",
                display_name="小助",
                runtime_id=seed.runtime_id,
                provider="claude",
                shadow_status="none",
                invited_by=seed.owner_id,
                joined_at=datetime.now(UTC),
            )
        )
        await db_session.commit()
        # 群开关默认开（agent_cross_mention）。
        group = await db_session.get(AgentGroupChat, seed.group_session_id)
        assert group is not None and group.agent_cross_mention

        svc = DaemonService(db_session)
        await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [
                {
                    "event_type": "text",
                    "content": "[[GROUP]]@小助 帮忙复核下[[/GROUP]]",
                    "channel": "stdout",
                }
            ],
        )
        result = await svc.close_interactive_run(
            seed.lease_id,
            seed.shadow_run_id,
            seed.claim_token,
            status="success",
            is_error=False,
        )
        assert result is not None
        # 小助未被触发（无影子、无排队）。
        members = (
            (
                await db_session.execute(
                    select(AgentGroupMember).where(
                        AgentGroupMember.group_id == seed.group_session_id
                    )
                )
            )
            .scalars()
            .all()
        )
        for m in members:
            assert m.shadow_session_id is None or m.id == seed.member.id
        queued = (await db_session.execute(select(AgentSessionQueuedMessage))).scalars().all()
        assert list(queued) == []
