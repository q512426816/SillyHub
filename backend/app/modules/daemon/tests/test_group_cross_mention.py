"""task-04（2026-09-01-session-group-chat）互@协作护栏与配置热切换测试。

覆盖（design §4.4/§4.5/§8 member.config.switched，任务卡 acceptance）：

- 护栏矩阵：开关关闭纯文本零触发 / 同链同成员去重 / 深度 2 到顶不再触发 /
  限频超限 + 群频道系统提示 / 不自我触发（@自己忽略）；
- 互@触发：命中成员走与用户 @ 相同触发管线——注入 prompt 当前消息标注
  「来自 Agent 成员的协作请求」（来源 Agent 身份标签），链沿用原链
  （source_carrier_run_id 不变）、深度 +1；Redis 链状态（去重集/深度/TTL）；
- 用户 @ 入链：send_group_message 触发的成员写进 group_chain:{载体run_id}；
- 热切换两分支：模型切换（llm_provider diff）→ 影子三列同步 + 静默切换轮
  （run 直接 completed）+ SESSION_SWITCH_CONFIG 下发（providerConfig 快照）；
  机器切换（runtime diff）→ 影子 end + shadow_status='pending' + 指针置空；
  纯引擎切换 → 三列同步零下发；
- 排队轮链 metadata 透传（task-03 遗留补线）：忙轮排队 prompt 头部
  ``[GROUP_CHAIN carrier=… depth=…]`` 标记行，派发侧剥离还原写进新 run 的
  user_input metadata（task-05 投影 fail-open 缺口闭合）。

夹具范式镜像 ``test_group_mention_pipeline.py``（in-memory SQLite + httpx
ASGI client + 手签 JWT + ws_hub/readiness stub）；Redis 用进程内 fake
（哈希/计数/发布全内存，无外部依赖）。
"""

from __future__ import annotations

import json
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
from app.modules.daemon.group.service import (
    GROUP_CHAIN_DEPTH_FIELD,
    _build_group_prompt,
    detect_cross_mentions,
    group_chain_key,
    run_cross_mention_detection,
)
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.daemon.session.service import (
    DAEMON_MSG_SESSION_SWITCH_CONFIG,
    SessionService,
    _prepend_group_chain_marker,
    _split_group_chain_marker,
)
from app.modules.llm_provider.model import LlmProvider
from app.modules.workspace.model import Workspace

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


async def _create_user_with_token(
    db_session: AsyncSession, *, name: str, admin: bool = False
) -> tuple[User, str]:
    user = User(
        id=uuid.uuid4(),
        email=f"grp4-{name}-{uuid.uuid4()}@example.com",
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
        key=f"grp4-{uuid.uuid4().hex[:8]}",
        name="grp4-test-role",
        description="task-04 seed",
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
        name="grp4-ws",
        slug=f"grp4-ws-{uuid.uuid4().hex[:8]}",
        root_path="C:/tmp/grp4-ws",
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
    hostname: str = "grp4-host",
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


async def _make_env(db_session: AsyncSession, *, owner_name: str = "群主") -> SimpleNamespace:
    ws = await _make_workspace(db_session)
    owner, owner_token = await _create_user_with_token(db_session, name=owner_name)
    await _grant_workspace_role(
        db_session,
        workspace_id=ws.id,
        user_id=owner.id,
        permissions=[Permission.TASK_RUN_AGENT],
    )
    instance, runtime = await _seed_runtime(db_session, owner.id)
    return SimpleNamespace(
        ws=ws, owner=owner, owner_token=owner_token, instance=instance, runtime=runtime
    )


async def _seed_llm_provider(
    db_session: AsyncSession,
    owner_id: uuid.UUID,
    *,
    name: str = "GLM-测试",
) -> LlmProvider:
    from app.core.crypto import get_cipher

    cipher = get_cipher()
    ct, key_id = cipher.encrypt("sk-test-key")
    row = LlmProvider(
        id=uuid.uuid4(),
        user_id=owner_id,
        name=name,
        agent_kind="claude",
        encrypted_api_key=ct,
        key_id=key_id,
        model="glm-4.7",
        is_default=False,
        api_format="anthropic",
    )
    db_session.add(row)
    await db_session.commit()
    return row


async def _create_group(
    client: AsyncClient,
    owner_token: str,
    *,
    workspace_id: uuid.UUID,
    title: str = "测试群",
    agent_members: list[dict] | None = None,
) -> dict:
    payload: dict = {"title": title, "workspace_id": str(workspace_id)}
    if agent_members:
        payload["agent_members"] = agent_members
    resp = await client.post("/api/daemon/group-chats", json=payload, headers=_headers(owner_token))
    assert resp.status_code == 201, resp.text
    return resp.json()


def _agent_config(runtime_id: uuid.UUID, name: str = "小码") -> dict:
    return {"display_name": name, "runtime_id": str(runtime_id), "provider": "claude"}


async def _send_message(client: AsyncClient, token: str, group_id: uuid.UUID | str, content: str):
    return await client.post(
        f"/api/daemon/group-chats/{group_id}/messages",
        json={"content": content},
        headers=_headers(token),
    )


async def _member_rows(db_session: AsyncSession, group_id: uuid.UUID) -> list[AgentGroupMember]:
    return list(
        (
            await db_session.execute(
                select(AgentGroupMember).where(AgentGroupMember.group_id == group_id)
            )
        )
        .scalars()
        .all()
    )


async def _agent_member_row(
    db_session: AsyncSession, group_id: uuid.UUID, display_name: str = "小码"
) -> AgentGroupMember:
    rows = [
        m
        for m in await _member_rows(db_session, group_id)
        if m.member_type == "agent" and m.display_name == display_name
    ]
    assert rows, f"agent 成员「{display_name}」不存在"
    return rows[0]


def _mock_hub(*, connected: bool = True) -> MagicMock:
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


# ── Redis fake（护栏状态全内存；publish 记录供断言）──────────────────────────


class _FakeRedis:
    """群护栏所需 Redis 命令的进程内替身（哈希/计数/TTL/发布）。"""

    def __init__(self) -> None:
        self._hash: dict[str, dict[str, str]] = {}
        self._counters: dict[str, int] = {}
        self.ttls: dict[str, int] = {}
        self.publishes: list[tuple[str, dict]] = []

    async def ping(self) -> bool:
        return True

    async def hsetnx(self, key: str, field: str, value: str) -> int:
        h = self._hash.setdefault(key, {})
        if field in h:
            return 0
        h[field] = value
        return 1

    async def hset(self, key: str, field: str, value: str) -> int:
        h = self._hash.setdefault(key, {})
        existed = field in h
        h[field] = value
        return 0 if existed else 1

    async def hget(self, key: str, field: str) -> str | None:
        return self._hash.get(key, {}).get(field)

    async def hincrby(self, key: str, field: str, amount: int = 1) -> int:
        h = self._hash.setdefault(key, {})
        current = int(h.get(field, "0"))
        current += amount
        h[field] = str(current)
        return current

    async def expire(self, key: str, seconds: int) -> bool:
        self.ttls[key] = seconds
        return True

    async def incr(self, key: str) -> int:
        self._counters[key] = self._counters.get(key, 0) + 1
        return self._counters[key]

    async def publish(self, channel: str, message: str) -> int:
        try:
            payload = json.loads(message)
        except Exception:
            payload = {"raw": message}
        self.publishes.append((channel, payload))
        return 1

    # ── 断言辅助 ────────────────────────────────────────────────────────────

    def chain_set(self, carrier_run_id: uuid.UUID) -> set[str]:
        return set(self._hash.get(group_chain_key(carrier_run_id), {}))

    def chain_depth(self, carrier_run_id: uuid.UUID) -> int:
        raw = self._hash.get(group_chain_key(carrier_run_id), {}).get(GROUP_CHAIN_DEPTH_FIELD)
        return int(raw) if raw else 0


@pytest.fixture()
def fake_group_redis():
    redis = _FakeRedis()
    with mock_patch("app.modules.daemon.group.service.get_redis", return_value=redis):
        yield redis


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    with mock_patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_session_redis():
    """session service 侧 Redis 替身（_publish_session_event publish 免真连）。"""
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with mock_patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


@pytest.fixture(autouse=True)
def _glm_offline(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.modules.agent.delegation import GLMConfig

    monkeypatch.setattr(GLMConfig, "from_env", classmethod(lambda cls: None))


# ── 检测环境种子：群 + 两 agent 成员（各带影子）+ 载体 run + 投影回复 ─────────


async def _seed_detection_env(
    db_session: AsyncSession,
    *,
    reply_text: str = "@小助 帮我复核下登录页白屏",
    agent_cross_mention: bool = True,
) -> SimpleNamespace:
    """直落检测所需全套行（群/成员/影子/载体 run/源轮 run/投影行）。"""
    env = await _make_env(db_session)
    now = datetime.now(UTC)
    group_session = AgentSession(
        id=uuid.uuid4(),
        user_id=env.owner.id,
        provider="group",
        status="active",
        session_kind="group",
        workspace_id=env.ws.id,
        turn_count=0,
    )
    db_session.add(group_session)
    await db_session.flush()
    group = AgentGroupChat(
        id=group_session.id,
        session_id=group_session.id,
        workspace_id=env.ws.id,
        title="测试群",
        created_by=env.owner.id,
        agent_cross_mention=agent_cross_mention,
        cross_mention_depth=2,
        created_at=now,
    )
    db_session.add(group)
    db_session.add(
        AgentGroupMember(
            group_id=group.id,
            member_type="user",
            display_name="群主",
            user_id=env.owner.id,
            invited_by=env.owner.id,
            joined_at=now,
        )
    )

    async def _agent_member(
        name: str,
    ) -> tuple[AgentGroupMember, AgentSession, DaemonTaskLease]:
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=env.runtime.id,
            kind="interactive",
            status="active",
            created_at=now,
            updated_at=now,
        )
        db_session.add(lease)
        await db_session.flush()
        shadow = AgentSession(
            id=uuid.uuid4(),
            user_id=env.owner.id,
            runtime_id=env.runtime.id,
            lease_id=lease.id,
            provider="claude",
            status="active",
            turn_count=1,
            created_at=now,
            session_kind="group_member",
        )
        db_session.add(shadow)
        await db_session.flush()
        member = AgentGroupMember(
            group_id=group.id,
            member_type="agent",
            display_name=name,
            runtime_id=env.runtime.id,
            workspace_id=env.ws.id,
            provider="claude",
            shadow_status="active",
            shadow_session_id=shadow.id,
            invited_by=env.owner.id,
            joined_at=now,
        )
        db_session.add(member)
        return member, shadow, lease

    source_member, source_shadow, _ = await _agent_member("小码")
    target_member, target_shadow, _ = await _agent_member("小助")
    third_member, _third_shadow, _ = await _agent_member("小三")
    await db_session.commit()

    # 载体 run（用户消息）+ user_input 原文。
    carrier = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="group",
        status="completed",
        started_at=now,
        finished_at=now,
        spec_strategy="group_carrier",
        agent_session_id=group.session_id,
        user_id=env.owner.id,
    )
    db_session.add(carrier)
    await db_session.flush()
    db_session.add(
        AgentRunLog(
            id=uuid.uuid4(),
            run_id=carrier.id,
            channel="user_input",
            content_redacted="@小码 帮我看下登录页白屏",
            timestamp=now,
            metadata_={"sender_user_id": str(env.owner.id), "sender_member_name": "群主"},
        )
    )
    # 源成员本轮 turn run（completed）+ user_input 链 metadata（链沿用载体、深度 1）。
    source_run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        started_at=now,
        finished_at=now,
        spec_strategy="interactive",
        agent_session_id=source_shadow.id,
        user_id=env.owner.id,
    )
    db_session.add(source_run)
    await db_session.flush()
    db_session.add(
        AgentRunLog(
            id=uuid.uuid4(),
            run_id=source_run.id,
            channel="user_input",
            content_redacted="注入 prompt 原文",
            timestamp=now,
            metadata_={
                "source_group_id": str(group.id),
                "source_member_id": str(source_member.id),
                "source_carrier_run_id": str(carrier.id),
                "chain_depth": 1,
                "sender_user_id": str(env.owner.id),
            },
        )
    )
    # 载体 run 上的投影行（task-05 双写）= 源成员本轮在群内的最终回复文本。
    db_session.add(
        AgentRunLog(
            id=uuid.uuid4(),
            run_id=carrier.id,
            channel="stdout",
            content_redacted=reply_text,
            timestamp=now,
            metadata_={
                "member_id": str(source_member.id),
                "member_name": "小码",
                "source_log_id": str(uuid.uuid4()),
            },
        )
    )
    # 他人投影行（同载体——同一条用户消息 @ 多成员时共用载体 run）：不参与
    # 本成员的互@检测（member 过滤），其中的 @小三 不得触发（若过滤失效，
    # 小三 会被误触发 → triggered 数 >1 断言兜底）。
    db_session.add(
        AgentRunLog(
            id=uuid.uuid4(),
            run_id=carrier.id,
            channel="stdout",
            content_redacted="@小三 别人的轮次里也 @了你",
            timestamp=now,
            metadata_={
                "member_id": str(target_member.id),
                "member_name": "小助",
                "source_log_id": str(uuid.uuid4()),
            },
        )
    )
    await db_session.commit()
    return SimpleNamespace(
        env=env,
        group=group,
        group_session=group_session,
        carrier=carrier,
        source_member=source_member,
        source_shadow=source_shadow,
        source_run=source_run,
        target_member=target_member,
        target_shadow=target_shadow,
        third_member=third_member,
    )


def _mock_session_service() -> tuple[MagicMock, AsyncMock]:
    """替身 SessionService：inject_session_as_service 记录调用并返回即时轮。"""
    inject_mock = AsyncMock(
        return_value=SimpleNamespace(queued=False, agent_run=SimpleNamespace(id=uuid.uuid4()))
    )
    service_cls = MagicMock()
    service_cls.return_value.inject_session_as_service = inject_mock
    return service_cls, inject_mock


async def _run_detection(db_session: AsyncSession, seeded: SimpleNamespace) -> list:
    return await run_cross_mention_detection(
        db_session,
        group_id=seeded.group.id,
        member_id=seeded.source_member.id,
        member_name="小码",
        run=seeded.source_run,
    )


# ── 纯函数：detect_cross_mentions（design §4.4）──────────────────────────────


def _member_stub(*, name: str, member_type: str = "agent") -> AgentGroupMember:
    return AgentGroupMember(
        id=uuid.uuid4(),
        group_id=uuid.uuid4(),
        member_type=member_type,
        display_name=name,
        joined_at=datetime.now(UTC),
    )


class TestDetectCrossMentions:
    def test_hits_other_agent_members(self) -> None:
        source = _member_stub(name="小码")
        target = _member_stub(name="小助")
        hits = detect_cross_mentions("@小助 复核一下", [source, target], source_member_id=source.id)
        assert [m.display_name for m in hits] == ["小助"]

    def test_self_mention_ignored(self) -> None:
        """不自我触发：回复 @自己 忽略（design §4.4 护栏 4）。"""
        source = _member_stub(name="小码")
        target = _member_stub(name="小助")
        hits = detect_cross_mentions(
            "@小码 我自己再看看，@小助 你复核", [source, target], source_member_id=source.id
        )
        assert [m.display_name for m in hits] == ["小助"]
        assert (
            detect_cross_mentions("@小码 只有自己", [source, target], source_member_id=source.id)
            == []
        )

    def test_user_members_not_triggered(self) -> None:
        source = _member_stub(name="小码")
        user_member = _member_stub(name="小英", member_type="user")
        assert (
            detect_cross_mentions("@小英 你看看", [source, user_member], source_member_id=source.id)
            == []
        )


# ── 互@检测编排 + 护栏矩阵（design §4.4）────────────────────────────────────


class TestCrossMentionOrchestration:
    async def test_trigger_injects_with_source_annotation_and_chain(
        self,
        db_session: AsyncSession,
        fake_group_redis: _FakeRedis,
    ) -> None:
        """A 回复含 @B → 触发 B：注入标注来源成员、链沿用原链、深度 +1。"""
        seeded = await _seed_detection_env(db_session)
        service_cls, inject_mock = _mock_session_service()
        with mock_patch("app.modules.daemon.group.service.SessionService", service_cls):
            triggered = await _run_detection(db_session, seeded)

        assert len(triggered) == 1
        assert triggered[0].member_id == seeded.target_member.id
        assert triggered[0].queued is False
        # 他人投影行（@小三）不参与本成员检测——小三 未被触发。
        assert all(t.member_id != seeded.third_member.id for t in triggered)
        # 触发管线调用参数：prompt 标注协作请求 + 来源 Agent 身份；链沿用原载体。
        inject_mock.assert_awaited_once()
        kwargs = inject_mock.await_args.kwargs
        prompt = kwargs["prompt"]
        assert "[当前消息 · 来自 Agent 成员的协作请求，需要你回应]" in prompt
        assert "小码(Agent): @小助 帮我复核下登录页白屏" in prompt
        assert kwargs["queue_when_busy"] is True
        turn_metadata = kwargs["turn_metadata"]
        assert turn_metadata["source_carrier_run_id"] == str(seeded.carrier.id)
        assert turn_metadata["chain_depth"] == 2  # 源轮 1 + 本次互@ 1
        assert turn_metadata["sender_member_kind"] == "agent"
        # Redis 链状态：目标成员入去重集、深度 2、TTL 刷新。
        chain_set = fake_group_redis.chain_set(seeded.carrier.id)
        assert str(seeded.target_member.id) in chain_set
        assert fake_group_redis.chain_depth(seeded.carrier.id) == 2
        assert fake_group_redis.ttls[group_chain_key(seeded.carrier.id)] == 30 * 60
        # agent typing 自动事件（群 typing 频道）。
        typing_events = [
            payload
            for channel, payload in fake_group_redis.publishes
            if channel.startswith("group_typing:") and payload.get("event") == "typing"
        ]
        assert typing_events and typing_events[0]["member_name"] == "小助"

    async def test_switch_off_replies_are_plain_text(
        self,
        db_session: AsyncSession,
        fake_group_redis: _FakeRedis,
    ) -> None:
        """关闭 agent_cross_mention：agent 回复中的 @ 为纯文本零触发。"""
        seeded = await _seed_detection_env(db_session, agent_cross_mention=False)
        service_cls, inject_mock = _mock_session_service()
        with mock_patch("app.modules.daemon.group.service.SessionService", service_cls):
            triggered = await _run_detection(db_session, seeded)
        assert triggered == []
        inject_mock.assert_not_called()

    async def test_depth_cap_skips_trigger(
        self,
        db_session: AsyncSession,
        fake_group_redis: _FakeRedis,
    ) -> None:
        """深度 2 到顶：链 depth 已 2（= cross_mention_depth）→ @作纯文本。"""
        seeded = await _seed_detection_env(db_session)
        await fake_group_redis.hincrby(
            group_chain_key(seeded.carrier.id), GROUP_CHAIN_DEPTH_FIELD, 2
        )
        service_cls, inject_mock = _mock_session_service()
        with mock_patch("app.modules.daemon.group.service.SessionService", service_cls):
            triggered = await _run_detection(db_session, seeded)
        assert triggered == []
        inject_mock.assert_not_called()

    async def test_same_chain_member_trigger_cap(
        self,
        db_session: AsyncSession,
        fake_group_redis: _FakeRedis,
    ) -> None:
        """同链同成员互@计数达上限（预置 2 次）→ 第 3 次跳过。

        ql-20260902 讨论场景修复后的语义：去重不是"一次即止"，而是互@触发
        计数上限 GROUP_CROSS_MEMBER_TRIGGER_LIMIT=2（防 A↔B 死循环兜底）。
        """
        seeded = await _seed_detection_env(db_session)
        await fake_group_redis.hset(
            group_chain_key(seeded.carrier.id), str(seeded.target_member.id), "2"
        )
        service_cls, inject_mock = _mock_session_service()
        with mock_patch("app.modules.daemon.group.service.SessionService", service_cls):
            triggered = await _run_detection(db_session, seeded)
        assert triggered == []
        inject_mock.assert_not_called()

    async def test_direct_trigger_not_counted_for_cross_mention(
        self,
        db_session: AsyncSession,
        fake_group_redis: _FakeRedis,
    ) -> None:
        """直接触发（占位 0）不占互@名额：用户 @ 双人讨论场景可继续互@转交。

        silly大家庭 真实场景回归：用户消息同时 @A@B（直接触发登记计数 0），
        A 的回复 @B 时 B 仍可被互@触发（计数 1 ≤ 上限）——讨论不被去重掐断。
        """
        seeded = await _seed_detection_env(db_session)
        await fake_group_redis.hsetnx(
            group_chain_key(seeded.carrier.id), str(seeded.target_member.id), "0"
        )
        service_cls, inject_mock = _mock_session_service()
        with mock_patch("app.modules.daemon.group.service.SessionService", service_cls):
            triggered = await _run_detection(db_session, seeded)
        assert len(triggered) == 1, "直接触发占位 0 不应拦截互@触发"
        inject_mock.assert_called_once()

    async def test_rate_limit_publishes_system_notice(
        self,
        db_session: AsyncSession,
        fake_group_redis: _FakeRedis,
    ) -> None:
        """限频超限（窗口内第 7 次）→ 跳过 + 群频道系统提示行。"""
        seeded = await _seed_detection_env(db_session)
        rate_key = f"group_rate:{seeded.group.id}:{seeded.target_member.id}"
        fake_group_redis._counters[rate_key] = 6  # 测试预置窗口计数（第 7 次超限）
        service_cls, inject_mock = _mock_session_service()
        with mock_patch("app.modules.daemon.group.service.SessionService", service_cls):
            triggered = await _run_detection(db_session, seeded)
        assert triggered == []
        inject_mock.assert_not_called()
        notices = [
            payload
            for channel, payload in fake_group_redis.publishes
            if channel == f"agent_session:{seeded.group.session_id}"
            and payload.get("channel") == "system"
        ]
        assert notices, "限频超限应发群频道系统提示"
        assert "「小助」触发频率已达上限" in notices[0]["content"]

    async def test_missing_chain_metadata_skips(
        self,
        db_session: AsyncSession,
        fake_group_redis: _FakeRedis,
    ) -> None:
        """源轮 user_input 无链 metadata（非群链路轮）→ 零触发。"""
        seeded = await _seed_detection_env(db_session)
        for row in (
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == seeded.source_run.id,
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .all()
        ):
            row.metadata_ = None
        await db_session.commit()
        service_cls, inject_mock = _mock_session_service()
        with mock_patch("app.modules.daemon.group.service.SessionService", service_cls):
            triggered = await _run_detection(db_session, seeded)
        assert triggered == []
        inject_mock.assert_not_called()

    async def test_redis_unavailable_skips_all(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Redis 不可用 → fail-closed（跳过全部互@触发防环）。"""
        seeded = await _seed_detection_env(db_session)

        def _raise() -> None:
            raise RuntimeError("redis down")

        with mock_patch("app.modules.daemon.group.service.get_redis", side_effect=_raise):
            triggered = await _run_detection(db_session, seeded)
        assert triggered == []

    async def test_empty_reply_text_skips(
        self,
        db_session: AsyncSession,
        fake_group_redis: _FakeRedis,
    ) -> None:
        """无投影行（本轮无进群回复文本）→ 零触发。"""
        seeded = await _seed_detection_env(db_session, reply_text="没有提及任何人")
        service_cls, inject_mock = _mock_session_service()
        with mock_patch("app.modules.daemon.group.service.SessionService", service_cls):
            triggered = await _run_detection(db_session, seeded)
        assert triggered == []
        inject_mock.assert_not_called()


class TestUserMentionRegistersChain:
    async def test_send_message_registers_chain_members(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        fake_group_redis: _FakeRedis,
    ) -> None:
        """用户 @ 直接触发的成员入链（深度 0）——后续互@去重的基线。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            workspace_id=env.ws.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])
        member = await _agent_member_row(db_session, group_id)
        # 影子已存在（免懒建路径）——触发走复用注入（替身承接）。
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=env.runtime.id,
            kind="interactive",
            status="active",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db_session.add(lease)
        await db_session.flush()
        shadow = AgentSession(
            id=uuid.uuid4(),
            user_id=env.owner.id,
            runtime_id=env.runtime.id,
            lease_id=lease.id,
            provider="claude",
            status="active",
            turn_count=1,
            created_at=datetime.now(UTC),
            session_kind="group_member",
        )
        db_session.add(shadow)
        await db_session.flush()
        member.shadow_session_id = shadow.id
        member.shadow_status = "active"
        db_session.add(member)
        await db_session.commit()

        service_cls, inject_mock = _mock_session_service()
        with mock_patch("app.modules.daemon.group.service.SessionService", service_cls):
            resp = await _send_message(client, env.owner_token, group_id, "@小码 hi")
        assert resp.status_code == 200, resp.text
        inject_mock.assert_awaited_once()
        carrier_id = uuid.UUID(resp.json()["carrier_run_id"])
        assert fake_group_redis.chain_set(carrier_id) == {str(member.id)}
        assert fake_group_redis.chain_depth(carrier_id) == 0
        # 即时注入轮链 metadata：链 id=载体、深度 0。
        metadata = inject_mock.await_args.kwargs["turn_metadata"]
        assert metadata["source_carrier_run_id"] == str(carrier_id)
        assert metadata["chain_depth"] == 0


# ── 注入 prompt 协作请求标注（design §4.4/§4.3）──────────────────────────────


class TestPromptSourceAnnotation:
    def test_agent_source_header_and_label(self) -> None:
        prompt = _build_group_prompt(
            group=SimpleNamespace(title="测试群"),
            member=_member_stub(name="小助"),
            member_lines=["小码(Agent)", "小助(Agent)"],
            context_lines=[],
            sender_member_name="群主",
            content="@小助 复核一下",
            source_member_name="小码",
        )
        assert "[当前消息 · 来自 Agent 成员的协作请求，需要你回应]" in prompt
        assert "小码(Agent): @小助 复核一下" in prompt

    def test_user_source_header_unchanged(self) -> None:
        prompt = _build_group_prompt(
            group=SimpleNamespace(title="测试群"),
            member=_member_stub(name="小码"),
            member_lines=["群主(用户)", "小码(Agent)"],
            context_lines=[],
            sender_member_name="群主",
            content="@小码 hi",
        )
        assert "[当前消息 · 需要你回应]" in prompt
        assert "来自 Agent 成员" not in prompt


# ── 配置热切换两分支（design §4.5 / §8 member.config.switched）───────────────


async def _seed_switch_env(
    db_session: AsyncSession, *, run_status: str = "completed"
) -> SimpleNamespace:
    """群 + 单 agent 成员 + 空闲影子（lease/runtime 齐备，run 终态）。"""
    env = await _make_env(db_session)
    group_session = AgentSession(
        id=uuid.uuid4(),
        user_id=env.owner.id,
        provider="group",
        status="active",
        session_kind="group",
        workspace_id=env.ws.id,
    )
    db_session.add(group_session)
    await db_session.flush()
    group = AgentGroupChat(
        id=group_session.id,
        session_id=group_session.id,
        workspace_id=env.ws.id,
        title="热切换群",
        created_by=env.owner.id,
        created_at=datetime.now(UTC),
    )
    db_session.add(group)
    db_session.add(
        AgentGroupMember(
            group_id=group.id,
            member_type="user",
            display_name="群主",
            user_id=env.owner.id,
            invited_by=env.owner.id,
            joined_at=datetime.now(UTC),
        )
    )
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=env.runtime.id,
        kind="interactive",
        status="active",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db_session.add(lease)
    await db_session.flush()
    shadow = AgentSession(
        id=uuid.uuid4(),
        user_id=env.owner.id,
        runtime_id=env.runtime.id,
        lease_id=lease.id,
        provider="claude",
        status="active",
        turn_count=1,
        created_at=datetime.now(UTC),
        session_kind="group_member",
        workspace_id=env.ws.id,
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
            user_id=env.owner.id,
        )
    )
    member = AgentGroupMember(
        group_id=group.id,
        member_type="agent",
        display_name="小码",
        runtime_id=env.runtime.id,
        workspace_id=env.ws.id,
        provider="claude",
        shadow_status="active",
        shadow_session_id=shadow.id,
        invited_by=env.owner.id,
        joined_at=datetime.now(UTC),
    )
    db_session.add(member)
    await db_session.commit()
    return SimpleNamespace(env=env, group=group, member=member, shadow=shadow)


class TestHotSwitch:
    async def test_model_switch_sends_session_switch_config(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub: MagicMock,
    ) -> None:
        """llm_provider diff → 影子三列同步 + 静默切换轮 + SESSION_SWITCH_CONFIG。"""
        seeded = await _seed_switch_env(db_session)
        llm = await _seed_llm_provider(db_session, seeded.env.owner.id)
        # 等一会（重置 mock 前的杂音不关心，直接 reset）。
        mocked_hub.send_session_control.reset_mock()

        resp = await client.patch(
            f"/api/daemon/group-chats/{seeded.group.id}/members/{seeded.member.id}",
            json={"llm_provider_id": str(llm.id)},
            headers=_headers(seeded.env.owner_token),
        )
        assert resp.status_code == 200, resp.text

        # 影子三列同步。
        await db_session.reset()
        shadow = await db_session.get(AgentSession, seeded.shadow.id)
        assert shadow is not None and shadow.llm_provider_id == llm.id
        # 静默切换轮：新 run 直接 completed（无 LLM turn）。
        runs = list(
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == shadow.id)
                )
            )
            .scalars()
            .all()
        )
        switch_runs = [r for r in runs if r.llm_provider_id == llm.id]
        assert switch_runs and switch_runs[0].status == "completed"
        # SESSION_SWITCH_CONFIG 下发（providerConfig 快照照 :3909-3936 惯例）。
        mocked_hub.send_session_control.assert_awaited()
        args = mocked_hub.send_session_control.await_args.args
        assert args[1] == DAEMON_MSG_SESSION_SWITCH_CONFIG
        payload = args[2]
        assert payload["sessionId"] == str(shadow.id)
        assert payload["providerConfig"] is not None
        assert payload["providerConfig"]["model"] == "glm-4.7"
        # 成员表/快照同步。
        member = await db_session.get(AgentGroupMember, seeded.member.id)
        assert member is not None
        assert member.llm_provider_id == llm.id
        assert (member.config_snapshot or {}).get("model") == "GLM-测试"

    async def test_machine_switch_ends_shadow_and_marks_pending(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub: MagicMock,
    ) -> None:
        """runtime diff → 影子 end + shadow_status='pending' + 指针置空。"""
        seeded = await _seed_switch_env(db_session)
        _inst2, runtime2 = await _seed_runtime(
            db_session, seeded.env.owner.id, hostname="grp4-host-2"
        )

        resp = await client.patch(
            f"/api/daemon/group-chats/{seeded.group.id}/members/{seeded.member.id}",
            json={"runtime_id": str(runtime2.id)},
            headers=_headers(seeded.env.owner_token),
        )
        assert resp.status_code == 200, resp.text

        await db_session.reset()
        shadow = await db_session.get(AgentSession, seeded.shadow.id)
        assert shadow is not None
        assert shadow.status == "ended"
        assert shadow.ended_at is not None
        member = await db_session.get(AgentGroupMember, seeded.member.id)
        assert member is not None
        assert member.shadow_status == "pending"
        assert member.shadow_session_id is None
        assert member.runtime_id == runtime2.id
        # 下次触发懒重建：再次 @ 会建新影子（shadow_session_id 为空 → 懒建路径）。

    async def test_engine_only_switch_syncs_columns_without_dispatch(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub: MagicMock,
    ) -> None:
        """纯引擎 diff（provider 无 profile/llm 变更）→ 三列同步、零切换下发。"""
        seeded = await _seed_switch_env(db_session)
        mocked_hub.send_session_control.reset_mock()

        resp = await client.patch(
            f"/api/daemon/group-chats/{seeded.group.id}/members/{seeded.member.id}",
            json={"provider": "codex"},
            headers=_headers(seeded.env.owner_token),
        )
        assert resp.status_code == 200, resp.text

        await db_session.reset()
        shadow = await db_session.get(AgentSession, seeded.shadow.id)
        assert shadow is not None and shadow.provider == "codex"
        mocked_hub.send_session_control.assert_not_called()

    async def test_no_shadow_no_switch_actions(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub: MagicMock,
    ) -> None:
        """影子不存在（尚未触发过）→ 六要素只落成员表，零热切换动作。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            workspace_id=env.ws.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])
        member = await _agent_member_row(db_session, group_id)
        llm = await _seed_llm_provider(db_session, env.owner.id)
        mocked_hub.send_session_control.reset_mock()

        resp = await client.patch(
            f"/api/daemon/group-chats/{group_id}/members/{member.id}",
            json={"llm_provider_id": str(llm.id)},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 200, resp.text
        await db_session.reset()
        member = await _agent_member_row(db_session, group_id)
        assert member.llm_provider_id == llm.id
        assert member.shadow_status == "none"
        mocked_hub.send_session_control.assert_not_called()


# ── 排队轮链 metadata 透传闭合（task-03 遗留补线）────────────────────────────


class TestQueuedChainPassthrough:
    def test_marker_roundtrip(self) -> None:
        metadata = {
            "source_group_id": str(uuid.uuid4()),
            "source_carrier_run_id": str(uuid.uuid4()),
            "chain_depth": 3,
        }
        prompt = _prepend_group_chain_marker("正文内容", metadata)
        assert prompt.startswith("[GROUP_CHAIN carrier=")
        stripped, parsed = _split_group_chain_marker(prompt)
        assert stripped == "正文内容"
        assert parsed is not None
        assert parsed["source_carrier_run_id"] == metadata["source_carrier_run_id"]
        assert parsed["chain_depth"] == 3

    def test_non_chain_prompt_untouched(self) -> None:
        assert _prepend_group_chain_marker("普通消息", None) == "普通消息"
        assert _prepend_group_chain_marker("普通消息", {"chain_depth": 0}) == "普通消息"
        stripped, parsed = _split_group_chain_marker("普通消息")
        assert stripped == "普通消息"
        assert parsed is None

    async def test_queued_entry_carries_chain_and_dispatch_restores_metadata(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        fake_group_redis: _FakeRedis,
        mocked_hub: MagicMock,
        mocked_session_redis: AsyncMock,
    ) -> None:
        """队条目 → 派发 run：链 id/深度进新 run user_input metadata（缺口闭合）。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            workspace_id=env.ws.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])
        member = await _agent_member_row(db_session, group_id)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=env.runtime.id,
            kind="interactive",
            status="active",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db_session.add(lease)
        await db_session.flush()
        shadow = AgentSession(
            id=uuid.uuid4(),
            user_id=env.owner.id,
            runtime_id=env.runtime.id,
            lease_id=lease.id,
            provider="claude",
            status="active",
            turn_count=1,
            created_at=datetime.now(UTC),
            session_kind="group_member",
        )
        db_session.add(shadow)
        await db_session.flush()
        busy_run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="running",
            spec_strategy="interactive",
            agent_session_id=shadow.id,
            user_id=env.owner.id,
        )
        db_session.add(busy_run)
        await db_session.flush()
        member.shadow_session_id = shadow.id
        member.shadow_status = "active"
        db_session.add(member)
        await db_session.commit()

        # 忙轮发送 → 排队条目 prompt 头部带链标记行。
        resp = await _send_message(client, env.owner_token, group_id, "@小码 排队的追问")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["triggered"][0]["queued"] is True
        carrier_id = uuid.UUID(body["carrier_run_id"])
        entries = list(
            (
                await db_session.execute(
                    select(AgentSessionQueuedMessage).where(
                        AgentSessionQueuedMessage.agent_session_id == shadow.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(entries) == 1
        entry = entries[0]
        assert entry.prompt is not None
        assert entry.prompt.startswith(f"[GROUP_CHAIN carrier={carrier_id} depth=0]")
        assert "@小码 排队的追问" in entry.prompt

        # 本轮结束（busy run 置终态）→ 派发：新 run 的 user_input metadata 带链。
        shadow_id = shadow.id
        busy = await db_session.get(AgentRun, busy_run.id)
        assert busy is not None
        busy.status = "completed"
        busy.finished_at = datetime.now(UTC)
        await db_session.commit()

        await SessionService(db_session).dispatch_queued_messages(shadow_id)

        remaining = list(
            (
                await db_session.execute(
                    select(AgentSessionQueuedMessage).where(
                        AgentSessionQueuedMessage.agent_session_id == shadow_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert remaining == []  # 派发成功即删行
        new_runs = list(
            (
                await db_session.execute(
                    select(AgentRun)
                    .where(AgentRun.agent_session_id == shadow_id)
                    .order_by(AgentRun.created_at)
                )
            )
            .scalars()
            .all()
        )
        assert len(new_runs) == 2
        new_run = new_runs[-1]
        # 派发轮 run 落库 pending（daemon 上报驱动后续状态流转）。
        assert new_run.status in ("pending", "running")
        log_rows = list(
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == new_run.id,
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(log_rows) == 1
        metadata = log_rows[0].metadata_
        assert metadata is not None
        assert metadata["source_carrier_run_id"] == str(carrier_id)
        assert metadata["chain_depth"] == 0
        # 标记行已剥离——daemon 看到的 prompt 与即时注入轮一致。
        assert log_rows[0].content_redacted is not None
        assert "[GROUP_CHAIN" not in log_rows[0].content_redacted
        assert "@小码 排队的追问" in log_rows[0].content_redacted
