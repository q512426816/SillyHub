"""task-06（2026-09-01-session-group-chat）实时通道测试——typing/presence/audience。

覆盖（design §5.4 / §5.3 / 任务卡 acceptance）：

- typing 端点：POST /group-chats/{id}/typing → publish ``group_typing:{群id}``
  payload 形态（event/member_name/member_kind='user'/typing/preview/ts）、
  preview ≤400 字（DTO max_length 422 + 服务端 400 字裁剪双保险）、
  typing=False 停止事件、非成员 404、**不落库**（群时间
  线零新行——ephemeral 纪律）；
- agent typing 自动事件：@触发命中（影子 run 开始，非排队）→ member_kind=
  'agent' typing 事件；忙轮排队（run 未开始）不发；
- 运行态可见 quick（2026-09-02）：触发路径 typing payload 带 member_id +
  reply_to_log_id（触发消息行=回复锚点）；409 竞态排队兜底不发 typing；
  close_interactive_run 群分支终态止息（completed/failed → typing=false 带
  member 身份；非群 run 零止息）；群详情 members[] shadow_running 四态兜底
  （活跃/无活跃 run/影子未建/用户成员），群列表端点不加；
- presence：群 SSE 生成器循环 touch（``SET key "1" EX 60``）+ 间隔节流（首
  轮立即 touch）；``get_online_member_ids`` 读 ``group_presence:{gid}:*``
  keys（脏 key 容错 / Redis 故障降级空数组）；群列表/详情 ``online_member_ids``
  接通（task-02 占位字段填充）；
- audience：``_stream_sessions_events`` 过滤「user_id 命中 or in
  audience_user_ids」（成员收 / 非成员不收）；群操作（建群/解散）publish
  ``agent_sessions:changed`` payload 内嵌全部用户成员 id；
- 多路订阅合流：``stream_session_logs(typing_channel=...)`` 双 pubsub 订阅
  agent_session:{id} + group_typing:{id}，log 与 typing 事件同流合流、静默期
  typing 事件顶掉 keepalive 帧；消费方断开（aclose）后**两个** pubsub 都
  unsubscribe + aclose（防 Redis 订阅连接泄漏）；单聊调用点不传可选参数 →
  仅创建一个 pubsub（单订阅路径零改动护栏）。

夹具范式镜像 ``test_group_mention_pipeline.py`` / ``test_session_sse.py`` /
``test_sessions_events_stream.py``（in-memory SQLite + httpx ASGI client +
手签 JWT + fake redis/pubsub mock）；GLMConfig.from_env → None（知识库铁律：
涉 LLM 路径不走出网）。
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from unittest.mock import patch as mock_patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import (
    AgentGroupMember,
    AgentRunLog,
    AgentSession,
)
from app.modules.agent.service import (
    GROUP_PRESENCE_TTL_SEC,
    AgentService,
)
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.daemon.group.service import get_online_member_ids
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.daemon.router import _stream_sessions_events
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session_events import SESSIONS_CHANGED_CHANNEL
from app.modules.daemon.tests.test_group_bridge_projection import (
    _seed_group_bridge,
    _seed_plain_session,
)
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.workspace.model import PpmProjectWorkspace, Workspace

# ── Helpers（镜像 test_group_mention_pipeline.py 夹具范式）────────────────────


async def _token_for(user: User) -> str:
    """为用户行手签 JWT（get_current_principal Bearer 路径）。"""
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
        email=f"grp6-{name}-{uuid.uuid4()}@example.com",
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
    permissions: list[Permission],
) -> None:
    role = Role(
        id=uuid.uuid4(),
        key=f"grp6-{uuid.uuid4().hex[:8]}",
        name="grp6-test-role",
        description="task-06 seed",
        is_system=False,
    )
    db_session.add(role)
    await db_session.flush()
    for p in permissions:
        db_session.add(RolePermission(role_id=role.id, permission=p))
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


async def _make_workspace(db_session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="grp6-ws",
        slug=f"grp6-ws-{uuid.uuid4().hex[:8]}",
        root_path="C:/tmp/grp6-ws",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _seed_runtime(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    *,
    hostname: str = "grp6-host",
) -> tuple[DaemonInstance, DaemonRuntime]:
    instance = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=hostname,
        server_url="http://test.local",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(instance)
    runtime = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=instance.id,
        user_id=user_id,
        name=hostname,
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(runtime)
    await db_session.commit()
    return instance, runtime


async def _make_project(db_session: AsyncSession) -> PpmProjectMaintenance:
    """PPM 项目行（quick 群 PPM 项目化：建群 project_id 口径）。"""
    project = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code=f"GRP-{uuid.uuid4().hex[:12]}",
        project_name="群聊测试项目",
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    return project


async def _link_project_workspace(
    db_session: AsyncSession, *, ppm_project_id: uuid.UUID, workspace_id: uuid.UUID
) -> None:
    db_session.add(PpmProjectWorkspace(ppm_project_id=ppm_project_id, workspace_id=workspace_id))
    await db_session.commit()


async def _add_project_member(
    db_session: AsyncSession, *, ppm_project_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    db_session.add(PpmProjectMember(id=uuid.uuid4(), pm_project_id=ppm_project_id, user_id=user_id))
    await db_session.commit()


async def _make_env(db_session: AsyncSession, *, owner_name: str = "群主") -> SimpleNamespace:
    """每测试群聊环境：workspace + 群主（TASK_RUN_AGENT 角色）+ 在线机器。"""
    ws = await _make_workspace(db_session)
    project = await _make_project(db_session)
    await _link_project_workspace(db_session, ppm_project_id=project.id, workspace_id=ws.id)
    owner, owner_token = await _create_user_with_token(db_session, name=owner_name)
    await _grant_workspace_role(
        db_session,
        workspace_id=ws.id,
        user_id=owner.id,
        permissions=[Permission.TASK_RUN_AGENT],
    )
    await _add_project_member(db_session, ppm_project_id=project.id, user_id=owner.id)
    instance, runtime = await _seed_runtime(db_session, owner.id)
    return SimpleNamespace(
        ws=ws,
        project=project,
        owner=owner,
        owner_token=owner_token,
        instance=instance,
        runtime=runtime,
    )


async def _env_user(
    db_session: AsyncSession, env: SimpleNamespace, *, name: str, admin: bool = False
) -> tuple[User, str]:
    user, token = await _create_user_with_token(db_session, name=name, admin=admin)
    await _grant_workspace_role(
        db_session,
        workspace_id=env.ws.id,
        user_id=user.id,
        permissions=[Permission.TASK_RUN_AGENT],
    )
    await _add_project_member(db_session, ppm_project_id=env.project.id, user_id=user.id)
    return user, token


async def _create_group(
    client: AsyncClient,
    owner_token: str,
    *,
    project_id: uuid.UUID,
    workspace_id: uuid.UUID | None = None,
    title: str = "测试群",
    user_members: list[dict] | None = None,
    agent_members: list[dict] | None = None,
) -> dict:
    payload: dict = {"title": title, "project_id": str(project_id)}
    if workspace_id is not None:
        payload["workspace_id"] = str(workspace_id)
    if user_members:
        payload["user_members"] = user_members
    if agent_members:
        payload["agent_members"] = agent_members
    resp = await client.post("/api/daemon/group-chats", json=payload, headers=_headers(owner_token))
    assert resp.status_code == 201, resp.text
    return resp.json()


def _agent_config(runtime_id: uuid.UUID, name: str = "小码") -> dict:
    return {"display_name": name, "runtime_id": str(runtime_id), "provider": "claude"}


async def _send_typing(
    client: AsyncClient,
    token: str,
    group_id: uuid.UUID | str,
    *,
    typing: bool = True,
    preview: str | None = None,
):
    body: dict = {"typing": typing}
    if preview is not None:
        body["preview"] = preview
    return await client.post(
        f"/api/daemon/group-chats/{group_id}/typing", json=body, headers=_headers(token)
    )


async def _send_message(client: AsyncClient, token: str, group_id: uuid.UUID | str, content: str):
    return await client.post(
        f"/api/daemon/group-chats/{group_id}/messages",
        json={"content": content},
        headers=_headers(token),
    )


async def _agent_member_row(
    db_session: AsyncSession, group_id: uuid.UUID, display_name: str = "小码"
) -> AgentGroupMember:
    rows = list(
        (
            await db_session.execute(
                select(AgentGroupMember).where(AgentGroupMember.group_id == group_id)
            )
        )
        .scalars()
        .all()
    )
    hits = [m for m in rows if m.member_type == "agent" and m.display_name == display_name]
    assert hits, f"agent 成员「{display_name}」不存在"
    return hits[0]


async def _seed_shadow_with_active_run(
    db_session: AsyncSession,
    *,
    member: AgentGroupMember,
    owner_user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    run_status: str = "running",
) -> AgentSession:
    """落一行 active 影子会话 + 指定状态 run（忙轮排队路径测试替身）。"""
    from app.modules.agent.model import AgentRun
    from app.modules.daemon.model import DaemonTaskLease

    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        kind="interactive",
        status="active",
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


def _mock_hub(*, connected: bool = True) -> MagicMock:
    """ws_hub 替身（test_session_create_config._mock_hub 先例）。"""
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


def _build_mock_pubsub(
    messages: list[dict[str, Any] | None],
    *,
    drain_silence: bool = False,
) -> MagicMock:
    """假 pubsub：get_message 依序吐出 ``messages``，耗尽后永远返回 None。

    ``None`` 条目建模静默（timeout 路径）；dict 条目为真实 Redis pub/sub
    消息形态（``{"type": "message", "data": raw}``）。typing 频道的非阻塞
    抽干轮询（``_drain_typing_frames``）共用同一 fake（kwargs 兼容两种调用
    形态：``timeout=25`` / ``ignore_subscribe_messages=True, timeout=0.0``）。
    """
    state = {"remaining": list(messages)}

    pubsub = MagicMock()
    pubsub.subscribe = AsyncMock()
    pubsub.unsubscribe = AsyncMock()
    pubsub.aclose = AsyncMock()

    async def fake_get_message(**kwargs: Any) -> dict[str, Any] | None:
        if state["remaining"]:
            return state["remaining"].pop(0)
        return None  # 耗尽 → 永久静默（消费方 break + aclose 收尾）

    pubsub.get_message = fake_get_message
    return pubsub


def _mock_redis_with_pubsubs(pubsubs: list[MagicMock]) -> MagicMock:
    """假 redis：``pubsub()`` 依序吐出给定 pubsub（多路订阅测试数据源）。"""
    redis = MagicMock()
    redis.set = AsyncMock()
    redis.pubsub = MagicMock(side_effect=list(pubsubs))
    return redis


async def _collect(gen: Any, limit: int) -> list[str]:
    """驱动生成器收集前 ``limit`` 帧，然后显式 aclose（触发 finally 清理）。"""
    collected: list[str] = []
    async for ev in gen:
        collected.append(ev)
        if len(collected) >= limit:
            break
    await gen.aclose()
    return collected


def _typing_publishes(redis: AsyncMock | MagicMock, group_id: uuid.UUID) -> list[dict]:
    """从 fake redis publish 调用记录中筛出 typing 频道事件 payload。"""
    out = []
    for call in redis.publish.call_args_list:
        channel, raw = call.args[0], call.args[1]
        if channel == f"group_typing:{group_id}":
            out.append(json.loads(raw))
    return out


# ── 共用 mock 夹具 ───────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _glm_offline(monkeypatch: pytest.MonkeyPatch) -> None:
    """知识库铁律：GLM delegation 配置返 None（不走真实 LLM 网关）。"""
    from app.modules.agent.delegation import GLMConfig

    monkeypatch.setattr(GLMConfig, "from_env", classmethod(lambda cls: None))


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    with mock_patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_group_redis():
    """群频道 publish 替身（group service 侧 get_redis）——typing/log 事件断言源。"""
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with mock_patch("app.modules.daemon.group.service.get_redis", return_value=redis):
        yield redis


@pytest.fixture()
def mocked_sessions_events_redis():
    """agent_sessions:changed publish 替身（session_events 模块侧）。"""
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with mock_patch("app.modules.daemon.session_events.get_redis", return_value=redis):
        yield redis


@pytest.fixture()
def readiness_ok():
    """session readiness 替身：inject 前 wait 立即返 True（免 8s 超时）。"""
    stub = MagicMock()
    stub.wait = AsyncMock(return_value=True)
    with mock_patch("app.modules.daemon.session.service.get_session_readiness", return_value=stub):
        yield stub


@pytest.fixture()
def instant_keepalive(monkeypatch: pytest.MonkeyPatch) -> None:
    """keepalive 间隔置 0——静默/跳过即触发（test_sessions_events_stream 先例）。"""
    monkeypatch.setattr("app.modules.daemon.router.SESSIONS_EVENTS_KEEPALIVE_INTERVAL_SEC", 0.0)


# ── typing 端点（design §5.4）────────────────────────────────────────────────


class TestTypingEndpoint:
    async def test_typing_publish_payload_shape_and_preview_limit(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """payload 形态 + preview 群级开关（quick 群 P2 默认关）+ 不落时间线。

        默认（``settings_json.typing_preview`` 缺省 False）：入参 preview 被丢
        （payload preview=None——只显示「正在输入」不发草稿）；PATCH 开启后
        400 字（DTO 上限）原样透传；401+ → 422（DTO max_length 与服务端裁剪
        口径一致，P2-6 修复：原来是 4000 进 400 裁，现提前拦）。
        """
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        group_id = uuid.UUID(data["id"])

        # 默认关：带 preview 的心跳被强制去草稿。
        resp = await _send_typing(client, env.owner_token, group_id, preview="草" * 400)
        assert resp.status_code == 204, resp.text
        events = _typing_publishes(mocked_group_redis, group_id)
        assert len(events) == 1
        payload = events[0]
        assert payload["event"] == "typing"
        assert payload["member_name"] == "群主"  # 建群者成员行昵称
        assert payload["member_kind"] == "user"
        assert payload["typing"] is True
        assert payload["preview"] is None  # quick 群 P2：默认关入参草稿丢弃
        assert payload["ts"]

        # PATCH 开启 typing_preview 后透传；401+ 仍 422（DTO 上限拦截不变）。
        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}",
            json={"settings_json": {"typing_preview": True}},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 200, resp.text
        resp = await _send_typing(client, env.owner_token, group_id, preview="草" * 400)
        assert resp.status_code == 204, resp.text
        resp = await _send_typing(client, env.owner_token, group_id, preview="草" * 401)
        assert resp.status_code == 422, resp.text

        events = _typing_publishes(mocked_group_redis, group_id)
        assert len(events) == 2  # 422 请求不 publish
        assert events[-1]["preview"] == "草" * 400  # 开启后上限内原样透传

        # 不落库：typing 纯 ephemeral——库内零 AgentRunLog 行（无载体 run /
        # 无投影 / 无任何时间线残留）。
        all_logs = list((await db_session.execute(select(AgentRunLog))).scalars().all())
        assert all_logs == []

    async def test_typing_stop_event_without_preview(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """typing=False（发送后冲掉指示器）：preview 缺省 None。"""
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        group_id = uuid.UUID(data["id"])

        resp = await _send_typing(client, env.owner_token, group_id, typing=False)
        assert resp.status_code == 204, resp.text

        events = _typing_publishes(mocked_group_redis, group_id)
        assert len(events) == 1
        assert events[0]["typing"] is False
        assert events[0]["preview"] is None

    async def test_typing_non_member_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """非群成员 typing → 404 不泄露存在性（零 publish）。"""
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        _outsider, outsider_token = await _env_user(db_session, env, name="圈外人")

        resp = await _send_typing(client, outsider_token, data["id"])
        assert resp.status_code == 404
        assert resp.json()["code"] == "HTTP_404_GROUP_CHAT_NOT_FOUND"
        assert _typing_publishes(mocked_group_redis, uuid.UUID(data["id"])) == []


# ── agent typing 自动事件（design §5.4：影子 run 开始）───────────────────────


class TestAgentTypingAutoEvent:
    async def test_mention_trigger_publishes_agent_typing(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
        mocked_group_redis,
    ) -> None:
        """@命中（影子 run 开始，非排队）→ member_kind='agent' typing 事件。

        运行态可见 quick（2026-09-02）：payload 补 member_id（成员行 id，前端
        按成员聚合指示器）+ reply_to_log_id（触发消息的群时间线 user_input 行
        id=发送响应 log_id——「正在响应哪句话」回复锚点）。
        """
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])
        member = await _agent_member_row(db_session, group_id)

        resp = await _send_message(client, env.owner_token, group_id, "@小码 帮我看下")
        assert resp.status_code == 200, resp.text
        trigger = resp.json()["triggered"][0]
        assert trigger["queued"] is False

        events = _typing_publishes(mocked_group_redis, group_id)
        assert len(events) == 1
        payload = events[0]
        assert payload["event"] == "typing"
        assert payload["member_name"] == "小码"
        assert payload["member_kind"] == "agent"
        assert payload["typing"] is True
        assert payload["preview"] is None  # 后端不产草稿
        assert payload["member_id"] == str(member.id)
        # 回复锚点=本轮触发消息行（载体 run 下的群时间线 user_input 行）。
        assert payload["reply_to_log_id"] == resp.json()["log_id"]

    async def test_queued_fallback_trigger_does_not_publish_agent_typing(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """409 竞态排队兜底（queued=True，run 未开始）不发 agent typing——锁定
        现状抑制语义（typing=正在生成；排队轮尚未开始，TTL 指示器不应亮起）。"""
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
            run_status="running",
        )

        from app.modules.daemon.session.service import (
            DaemonSessionTurnConflict,
            SessionService,
        )

        calls = {"n": 0}

        async def fake_inject(*args: Any, **kwargs: Any) -> SimpleNamespace:
            calls["n"] += 1
            if calls["n"] == 1:
                # 首调（busy_strategy="inject"）竞态 409 → 调用点降级排队。
                raise DaemonSessionTurnConflict("轮竞态测试替身")
            # 排队兜底轮：queued=True、无新 run。
            return SimpleNamespace(agent_session=None, agent_run=None, queued=True, mid_turn=False)

        with mock_patch.object(
            SessionService, "inject_session_as_service", side_effect=fake_inject
        ):
            resp = await _send_message(client, env.owner_token, group_id, "@小码 排队追问")
        assert resp.status_code == 200, resp.text
        assert resp.json()["triggered"][0]["queued"] is True
        assert _typing_publishes(mocked_group_redis, group_id) == []


# ── 终态 typing 止息（群聊运行态可见 quick，2026-09-02）──────────────────────


@pytest.fixture()
def mocked_close_redis(mocked_group_redis: AsyncMock):
    """close_interactive_run 全链路 redis 替身：run_sync + session 侧补丁复用
    群侧同一实例（止息断言源=群侧 ``group_typing:{gid}`` publish 记录）。"""
    with (
        mock_patch(
            "app.modules.daemon.run_sync.service.get_redis", return_value=mocked_group_redis
        ),
        mock_patch("app.modules.daemon.session.service.get_redis", return_value=mocked_group_redis),
    ):
        yield mocked_group_redis


class TestTerminalTypingStop:
    """close_interactive_run 群分支：turn_completed 后发 typing 止息冲掉指示器。"""

    @staticmethod
    async def _close_group_run(
        db_session: AsyncSession, seed: SimpleNamespace, **close_kwargs: Any
    ) -> None:
        """推进影子 run 至非终态后按给定终态参数收口（close 幂等守卫前置）。"""
        svc = DaemonService(db_session)
        await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [{"event_type": "text", "content": "[ASSISTANT] 回复", "channel": "stdout"}],
        )
        await svc.close_interactive_run(
            seed.lease_id, seed.shadow_run_id, seed.claim_token, **close_kwargs
        )

    async def test_close_completed_publishes_typing_stop_with_member_identity(
        self, db_session: AsyncSession, mocked_close_redis: AsyncMock
    ) -> None:
        """completed 群轮收口 → ``group_typing:{gid}`` 止息（typing=false）带
        member_id/member_name/member_kind='agent'（前端确定性地冲掉指示器）。"""
        seed = await _seed_group_bridge(db_session)
        await self._close_group_run(
            db_session, seed, status="success", is_error=False, input_tokens=10, output_tokens=5
        )

        events = _typing_publishes(mocked_close_redis, seed.group_session_id)
        assert len(events) == 1, "终态止息应恰好一条（run 开始的 typing=true 不在本链路）"
        stop = events[0]
        assert stop["event"] == "typing"
        assert stop["member_id"] == str(seed.member.id)
        assert stop["member_name"] == "小码"
        assert stop["member_kind"] == "agent"
        assert stop["typing"] is False
        assert stop["preview"] is None
        assert stop["ts"]
        assert "reply_to_log_id" not in stop  # 止息无回复锚点

    async def test_close_failed_publishes_typing_stop(
        self, db_session: AsyncSession, mocked_close_redis: AsyncMock
    ) -> None:
        """failed 群轮收口同样发止息——无论成败成员都不再「正在输入」。"""
        seed = await _seed_group_bridge(db_session)
        await self._close_group_run(
            db_session, seed, status="error_during_execution", is_error=True
        )

        events = _typing_publishes(mocked_close_redis, seed.group_session_id)
        assert len(events) == 1
        assert events[0]["typing"] is False
        assert events[0]["member_id"] == str(seed.member.id)
        assert events[0]["member_kind"] == "agent"

    async def test_close_plain_chat_zero_typing_stop(
        self, db_session: AsyncSession, mocked_close_redis: AsyncMock
    ) -> None:
        """非群 run（普通单聊）收口：零群频道事件、零 typing 止息。"""
        seed = await _seed_plain_session(db_session)
        svc = DaemonService(db_session)
        await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.run_id,
            [{"event_type": "text", "content": "[ASSISTANT] ok", "channel": "stdout"}],
        )
        await svc.close_interactive_run(
            seed.lease_id, seed.run_id, seed.claim_token, status="success", is_error=False
        )

        channels = {call.args[0] for call in mocked_close_redis.publish.call_args_list}
        # 单聊只有 run 频道 + 本会话频道两路（照 test_group_bridge_projection
        # 同款断言）——零群频道、零 typing 止息。
        assert channels == {
            f"agent_run:{seed.run_id}",
            f"agent_session:{seed.session_id}",
        }


# ── 群详情运行态兜底 shadow_running（2026-09-02 quick）───────────────────────


class TestGroupDetailShadowRunning:
    async def test_detail_members_shadow_running_four_states(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """四态：活跃 run True / 影子已建无活跃 run False / 影子未建 False /
        用户成员 False；群列表端点 members 不带该字段（不加约定）。"""
        env = await _make_env(db_session)
        invited, _invited_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(invited.id), "display_name": "鲸落"}],
            agent_members=[
                _agent_config(env.runtime.id, name="小码"),
                _agent_config(env.runtime.id, name="二码"),
                _agent_config(env.runtime.id, name="三码"),
            ],
        )
        group_id = uuid.UUID(data["id"])

        # 小码：影子 + 活跃 run（running）→ True。
        xiaoma = await _agent_member_row(db_session, group_id, display_name="小码")
        await _seed_shadow_with_active_run(
            db_session,
            member=xiaoma,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
            run_status="running",
        )
        # 二码：影子已建但 run 已终态（completed）→ False。
        erma = await _agent_member_row(db_session, group_id, display_name="二码")
        await _seed_shadow_with_active_run(
            db_session,
            member=erma,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
            run_status="completed",
        )
        # 三码：从未触发（影子未建）→ False；群主/小英（用户成员）→ False。

        resp = await client.get(
            f"/api/daemon/group-chats/{group_id}", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 200, resp.text
        members = resp.json()["members"]
        by_name = {m["display_name"]: m["shadow_running"] for m in members}
        assert by_name["小码"] is True
        assert by_name["二码"] is False
        assert by_name["三码"] is False
        assert by_name["鲸落"] is False
        assert by_name["群主"] is False

        # 群列表端点不加：members 仍为基线读体（无 shadow_running 字段）。
        fake_redis = AsyncMock()
        # quick 群 P1：presence 读已换 SCAN（单批游标归 0，零在线）。
        fake_redis.scan = AsyncMock(return_value=(0, []))
        with mock_patch("app.modules.daemon.group.service.get_redis", return_value=fake_redis):
            resp = await client.get("/api/daemon/group-chats", headers=_headers(env.owner_token))
        assert resp.status_code == 200
        item = next(it for it in resp.json() if it["id"] == str(group_id))
        for m in item["members"]:
            assert "shadow_running" not in m

    async def test_queued_trigger_does_not_publish_agent_typing(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """忙轮排队（run 未开始）不发 agent typing——typing 语义=正在生成。"""
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
            run_status="running",
        )

        resp = await _send_message(client, env.owner_token, group_id, "@小码 追问")
        assert resp.status_code == 200, resp.text
        # ql quick-8170ca59 忙轮策略翻转：不再排队而是中途注入（mid_turn=True，
        # run_id=活跃轮）——注入即开始生成，agent typing 照发。断言随之对齐。
        assert resp.json()["triggered"][0]["mid_turn"] is True
        assert _typing_publishes(mocked_group_redis, group_id) != []


# ── presence（design §5.4：touch / TTL / 在线集读取）─────────────────────────


class TestPresence:
    async def test_stream_touches_presence_with_ttl(self, db_session: AsyncSession) -> None:
        """群 SSE 连接建立即内联首触：SET key "1" EX 60（确定性，不依赖任务调度）。"""
        session_ps = _build_mock_pubsub([])
        typing_ps = _build_mock_pubsub([])
        redis = _mock_redis_with_pubsubs([session_ps, typing_ps])
        sid = uuid.uuid4()
        presence_key = f"group_presence:{sid}:{uuid.uuid4()}"

        svc = AgentService(db_session)
        gen = svc.stream_session_logs(
            sid, typing_channel=f"group_typing:{sid}", presence_key=presence_key
        )
        with mock_patch("app.modules.agent.service.get_redis", return_value=redis):
            collected = await _collect(gen, limit=3)

        assert collected[0] == ": connected\n\n"
        # touch 落 key + TTL 60（design §5.4）。
        assert redis.set.await_count >= 1
        first_call = redis.set.await_args_list[0]
        assert first_call.args == (presence_key, "1")
        assert first_call.kwargs == {"ex": GROUP_PRESENCE_TTL_SEC}
        assert GROUP_PRESENCE_TTL_SEC == 60
        # 双订阅照常建立（touch 不影响流主体）。
        session_ps.subscribe.assert_called_once_with(f"agent_session:{sid}")
        typing_ps.subscribe.assert_called_once_with(f"group_typing:{sid}")

    async def test_presence_touch_throttled_by_interval(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """间隔节流：默认 45s；间隔置 0 后续期任务高频 touch。

        ql-20260903-007：touch 移出流循环（独立 asyncio 任务）——帧产出与
        touch 节奏解耦后，断言改为轮询等待任务侧 set 次数（不再依赖「每轮
        循环各触一次」的旧耦合）。
        """
        monkeypatch.setattr("app.modules.agent.service.GROUP_PRESENCE_TOUCH_INTERVAL_SEC", 0.0)
        session_ps = _build_mock_pubsub([])
        typing_ps = _build_mock_pubsub([])
        redis = _mock_redis_with_pubsubs([session_ps, typing_ps])
        sid = uuid.uuid4()

        svc = AgentService(db_session)
        gen = svc.stream_session_logs(
            sid, typing_channel=f"group_typing:{sid}", presence_key=f"group_presence:{sid}:u"
        )
        with mock_patch("app.modules.agent.service.get_redis", return_value=redis):
            collected: list[str] = []
            async for ev in gen:
                collected.append(ev)
                if len(collected) >= 4:
                    break
            # 后台任务间隔 0 → 持续续触；轮询至 ≥3 次（内联首触 1 + 任务 ≥2）。
            deadline = asyncio.get_running_loop().time() + 2.0
            while redis.set.await_count < 3:
                assert asyncio.get_running_loop().time() < deadline, (
                    "独立续期任务未按间隔续触（间隔 0 应高频 set）"
                )
                await asyncio.sleep(0.01)
            await gen.aclose()

        assert redis.set.await_count >= 3
        for call in redis.set.await_args_list:
            assert call.kwargs == {"ex": GROUP_PRESENCE_TTL_SEC}

    async def test_presence_touch_survives_backpressure(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """生成器停在 yield（慢消费端 SSE 背压）时续期照常（ql-20260903-007）。

        旧实现 touch 在流循环顶部——生成器卡在 ``yield``（客户端 TCP 背压）时
        touch 一并停摆，60s 后在线绿点被 TTL 误回收；独立任务不受产出节奏影响。
        """
        monkeypatch.setattr("app.modules.agent.service.GROUP_PRESENCE_TOUCH_INTERVAL_SEC", 0.0)
        session_ps = _build_mock_pubsub([])
        typing_ps = _build_mock_pubsub([])
        redis = _mock_redis_with_pubsubs([session_ps, typing_ps])
        sid = uuid.uuid4()

        svc = AgentService(db_session)
        gen = svc.stream_session_logs(
            sid, typing_channel=f"group_typing:{sid}", presence_key=f"group_presence:{sid}:u"
        )
        with mock_patch("app.modules.agent.service.get_redis", return_value=redis):
            # 拉到 keepalive 帧（订阅/首触/任务均已就绪）后不再驱动生成器——
            # 模拟消费端背压：生成器停在循环内 yield 上。
            first = await gen.__anext__()
            second = await gen.__anext__()
            assert first == ": connected\n\n"
            assert second == ": keepalive\n\n"
            baseline = redis.set.await_count  # 内联首触
            deadline = asyncio.get_running_loop().time() + 2.0
            while redis.set.await_count < baseline + 2:
                assert asyncio.get_running_loop().time() < deadline, (
                    "生成器挂起期间独立任务应继续续期（背压不熄绿点）"
                )
                await asyncio.sleep(0.01)
            await gen.aclose()

    async def test_get_online_member_ids_parses_keys_and_tolerates_dirty(
        self,
    ) -> None:
        """SCAN 游标扫（多批）→ 用户 id 集；脏 key 跳过；Redis 故障降级空数组。

        quick 群 P1 审计（2026-09-02）：KEYS 前缀扫换 SCAN 游标分批——本用例
        同时锁游标循环（首批返回非 0 游标 → 续扫到游标归 0）。
        """
        gid = uuid.uuid4()
        u1, u2 = uuid.uuid4(), uuid.uuid4()
        redis = AsyncMock()
        # 首批：非 0 游标（还有下一批）；脏 key / 他人群 key 一并混入。
        redis.scan = AsyncMock(
            side_effect=[
                (
                    17,
                    [
                        f"group_presence:{gid}:{u1}",
                        f"group_presence:{gid}:garbage",  # 脏 key（截断/残留）
                        "group_presence:other:noise",
                    ],
                ),
                (0, [f"group_presence:{gid}:{u2}"]),
            ]
        )
        with mock_patch("app.modules.daemon.group.service.get_redis", return_value=redis):
            online = await get_online_member_ids(gid)
        assert sorted(online, key=str) == sorted([u1, u2], key=str)
        assert redis.scan.await_count == 2, "非 0 游标应续扫直至归 0"

        broken = AsyncMock()
        broken.scan = AsyncMock(side_effect=ConnectionError("redis down"))
        with mock_patch("app.modules.daemon.group.service.get_redis", return_value=broken):
            assert await get_online_member_ids(gid) == []

    async def test_list_and_detail_return_online_member_ids(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """群列表/详情 online_member_ids 接通（task-02 占位字段填充）。"""
        env = await _make_env(db_session)
        member_user, _member_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member_user.id), "display_name": "鲸落"}],
        )
        group_id = uuid.UUID(data["id"])

        fake_redis = AsyncMock()
        # SCAN 单批游标归 0（quick 群 P1：KEYS → SCAN）。
        fake_redis.scan = AsyncMock(return_value=(0, [f"group_presence:{group_id}:{env.owner.id}"]))
        with mock_patch("app.modules.daemon.group.service.get_redis", return_value=fake_redis):
            resp = await client.get("/api/daemon/group-chats", headers=_headers(env.owner_token))
            assert resp.status_code == 200
            items = resp.json()
            assert len(items) == 1
            assert items[0]["online_member_ids"] == [str(env.owner.id)]

            resp = await client.get(
                f"/api/daemon/group-chats/{group_id}", headers=_headers(env.owner_token)
            )
            assert resp.status_code == 200
            assert resp.json()["online_member_ids"] == [str(env.owner.id)]


# ── audience 投影（design §5.3：过滤 + 群操作发布）───────────────────────────


def _signal(
    user_id: str,
    event: str = "status_changed",
    audience: list[str] | None = None,
) -> str:
    """构造与 publish_sessions_changed 同构的信号 JSON（含可选 audience）。"""
    payload: dict[str, Any] = {
        "event": event,
        "session_id": str(uuid.uuid4()),
        "user_id": user_id,
        "at": "2026-09-01T08:00:00+00:00",
    }
    if audience is not None:
        payload["audience_user_ids"] = audience
    return json.dumps(payload)


class TestAudienceFilter:
    async def test_audience_member_receives_group_event(self, instant_keepalive: None) -> None:
        """成员收（audience 命中）/ 非成员不收（无 audience 的他人信号过滤）。"""
        me = str(uuid.uuid4())
        other = str(uuid.uuid4())
        audience_raw = _signal(other, audience=[me])  # 群事件：user_id=群主，我在受众
        foreign_raw = _signal(other)  # 他人普通信号（无 audience）→ 过滤
        own_raw = _signal(me)  # 本人单聊信号 → 命中（存量行为零漂移）
        pubsub = _build_mock_pubsub(
            [
                {"type": "message", "data": audience_raw},
                {"type": "message", "data": foreign_raw},
                {"type": "message", "data": own_raw},
            ]
        )
        redis = MagicMock()
        redis.pubsub.return_value = pubsub

        gen = _stream_sessions_events(me)
        with mock_patch("app.modules.daemon.router.get_redis", return_value=redis):
            collected = await _collect(gen, limit=5)

        joined = "".join(collected)
        assert collected[0] == ": connected\n\n"
        assert f"data: {audience_raw}\n\n" in joined  # 成员收
        assert f"data: {own_raw}\n\n" in joined  # user_id 命中（原路径）
        assert f"data: {foreign_raw}\n\n" not in joined  # 非成员不收
        pubsub.subscribe.assert_called_once_with(SESSIONS_CHANGED_CHANNEL)
        pubsub.unsubscribe.assert_called_once_with(SESSIONS_CHANGED_CHANNEL)
        pubsub.aclose.assert_called_once()

    async def test_non_list_audience_payload_not_break_stream(
        self, instant_keepalive: None
    ) -> None:
        """audience_user_ids 非 list（脏 payload）不炸流——防御 isinstance 分支。"""
        me = str(uuid.uuid4())
        dirty_raw = _signal(str(uuid.uuid4()), audience=None)
        # 手工构造非 list audience（发布侧不会产生，防御订阅侧健壮性）。
        dirty = json.loads(dirty_raw)
        dirty["audience_user_ids"] = "not-a-list"
        dirty_raw = json.dumps(dirty)
        own_raw = _signal(me)
        pubsub = _build_mock_pubsub(
            [
                {"type": "message", "data": dirty_raw},
                {"type": "message", "data": own_raw},
            ]
        )
        redis = MagicMock()
        redis.pubsub.return_value = pubsub

        gen = _stream_sessions_events(me)
        with mock_patch("app.modules.daemon.router.get_redis", return_value=redis):
            collected = await _collect(gen, limit=4)

        joined = "".join(collected)
        assert f"data: {dirty_raw}\n\n" not in joined
        assert f"data: {own_raw}\n\n" in joined
        pubsub.aclose.assert_called_once()

    async def test_group_create_publishes_audience(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_sessions_events_redis,
    ) -> None:
        """建群 → agent_sessions:changed payload 内嵌全部用户成员 id。"""
        env = await _make_env(db_session)
        invited, _invited_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(invited.id), "display_name": "鲸落"}],
        )

        publishes = [
            (call.args[0], json.loads(call.args[1]))
            for call in mocked_sessions_events_redis.publish.call_args_list
        ]
        signals = [p for p in publishes if p[0] == SESSIONS_CHANGED_CHANNEL]
        assert signals, "建群未发布 agent_sessions:changed"
        _channel, payload = signals[0]
        assert payload["event"] == "created"
        assert payload["session_id"] == data["session_id"]
        assert payload["user_id"] == str(env.owner.id)  # 群主位
        assert sorted(payload["audience_user_ids"]) == sorted([str(env.owner.id), str(invited.id)])

    async def test_group_end_publishes_status_changed_with_audience(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_sessions_events_redis,
    ) -> None:
        """解散 → status_changed 信号全员受众（剩余用户成员 id）。"""
        env = await _make_env(db_session)
        invited, _invited_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(invited.id), "display_name": "鲸落"}],
        )
        mocked_sessions_events_redis.publish.reset_mock()

        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/end", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 200, resp.text

        publishes = [
            json.loads(call.args[1])
            for call in mocked_sessions_events_redis.publish.call_args_list
            if call.args[0] == SESSIONS_CHANGED_CHANNEL
        ]
        assert publishes, "解散未发布 agent_sessions:changed"
        payload = publishes[-1]
        assert payload["event"] == "status_changed"
        assert sorted(payload["audience_user_ids"]) == sorted([str(env.owner.id), str(invited.id)])


# ── 多路订阅合流（design §5.4：双 pubsub + 释放）────────────────────────────


class TestGroupStreamMultiSubscription:
    async def test_log_and_typing_events_merged_and_dual_released(
        self, db_session: AsyncSession
    ) -> None:
        """log（agent_session 频道）与 typing（group_typing 频道）同流合流；
        断开后两个 pubsub 都 unsubscribe + aclose（防泄漏）。"""
        sid = uuid.uuid4()
        log_raw = json.dumps(
            {
                "event": "log",
                "session_id": str(sid),
                "run_id": str(uuid.uuid4()),
                "log_id": str(uuid.uuid4()),
                "channel": "user_input",
                "content": "@小码 hi",
                "timestamp": "2026-09-01T08:00:00Z",
            }
        )
        typing_raw = json.dumps(
            {
                "event": "typing",
                "member_name": "小码",
                "member_kind": "agent",
                "typing": True,
                "preview": None,
                "ts": "2026-09-01T08:00:01Z",
            }
        )
        session_ps = _build_mock_pubsub([{"type": "message", "data": log_raw}])
        typing_ps = _build_mock_pubsub([{"type": "message", "data": typing_raw}])
        redis = _mock_redis_with_pubsubs([session_ps, typing_ps])

        svc = AgentService(db_session)
        gen = svc.stream_session_logs(sid, typing_channel=f"group_typing:{sid}")
        with mock_patch("app.modules.agent.service.get_redis", return_value=redis):
            collected = await _collect(gen, limit=4)

        assert collected[0] == ": connected\n\n"
        # 合流顺序：日志帧后立刻抽干 typing 频道（同一 SSE 流）。
        assert collected[1] == f"data: {log_raw}\n\n"
        assert collected[2] == f"data: {typing_raw}\n\n"
        # 双订阅建立 + 双释放（任务卡 constraints：防 Redis 连接泄漏）。
        session_ps.subscribe.assert_called_once_with(f"agent_session:{sid}")
        typing_ps.subscribe.assert_called_once_with(f"group_typing:{sid}")
        session_ps.unsubscribe.assert_called_once_with(f"agent_session:{sid}")
        session_ps.aclose.assert_called_once()
        typing_ps.unsubscribe.assert_called_once_with(f"group_typing:{sid}")
        typing_ps.aclose.assert_called_once()

    async def test_typing_event_delivered_on_silence(self, db_session: AsyncSession) -> None:
        """静默期（日志频道无消息）typing 事件照常下发，顶掉该轮 keepalive。"""
        sid = uuid.uuid4()
        typing_raw = json.dumps(
            {
                "event": "typing",
                "member_name": "群主",
                "member_kind": "user",
                "typing": True,
                "preview": "在打字…",
                "ts": "2026-09-01T08:00:00Z",
            }
        )
        session_ps = _build_mock_pubsub([])  # 日志频道永久静默
        typing_ps = _build_mock_pubsub([{"type": "message", "data": typing_raw}])
        redis = _mock_redis_with_pubsubs([session_ps, typing_ps])

        svc = AgentService(db_session)
        gen = svc.stream_session_logs(sid, typing_channel=f"group_typing:{sid}")
        with mock_patch("app.modules.agent.service.get_redis", return_value=redis):
            collected = await _collect(gen, limit=2)

        assert collected[0] == ": connected\n\n"
        # typing 事件帧而非 keepalive（typing 频道有流量时不出空转注释帧）。
        assert collected[1] == f"data: {typing_raw}\n\n"
        typing_ps.aclose.assert_called_once()

    async def test_single_chat_path_creates_single_pubsub(self, db_session: AsyncSession) -> None:
        """单聊零改动护栏：不传可选参数 → 仅创建一个 pubsub（无 typing 订阅）。"""
        sid = uuid.uuid4()
        session_ps = _build_mock_pubsub([])
        redis = _mock_redis_with_pubsubs([session_ps])

        svc = AgentService(db_session)
        gen = svc.stream_session_logs(sid)
        with mock_patch("app.modules.agent.service.get_redis", return_value=redis):
            collected = await _collect(gen, limit=2)

        assert collected[0] == ": connected\n\n"
        assert collected[1] == ": keepalive\n\n"
        redis.pubsub.assert_called_once()
        session_ps.subscribe.assert_called_once_with(f"agent_session:{sid}")
        # presence 未启用 → 无 touch。
        redis.set.assert_not_called()
        session_ps.aclose.assert_called_once()
