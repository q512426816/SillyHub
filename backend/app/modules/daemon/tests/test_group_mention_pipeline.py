"""task-03（2026-09-01-session-group-chat）群消息与 @触发管线测试。

覆盖（design §4.1/§4.2/§4.3/§8，任务卡 acceptance）：

- @解析矩阵：全/半角 @、@全体/@all 广播、无 @、边界标点截断、长昵称前缀
  不误命中短昵称、用户昵称不触发、已移除成员不触发；
- 群背景摘要组装：身份标签（用户行 / Agent 投影行兼容）、单条 500 截断、
  总长 6000 上限（丢最旧）、当前消息行排除在背景外；
- 注入 prompt：成员简报（群名/昵称/成员列表/仅被 @ 回应）+ 背景 + 当前消息
  三段标记 + 回应要求指示行（quick 投影统一标记制：[[GROUP]] 标记用法）；
  互@来源标注参数（source_member_name）；
- 载体 run：status='completed' + started_at 落值 + spec_strategy='group_carrier'
  + user_input 原文落库 + 群频道 log 事件 publish（sender 身份字段）；
- 影子懒建：六要素 → 影子行（kind='group_member'、user_id=群主、parent 恒
  NULL、config.manual_approval=False、title）+ interactive lease（stage=
  'group_member'、pinned runtime、cwd）+ 成员表回填 + 首轮 run/user_input
  metadata（source_group_id/source_member_id/source_carrier_run_id/
  chain_depth/sender_user_id）+ SESSION_INJECT 控制指令；幂等（二次触发复用）；
- grants 两路：非群主机器无 grant → 400 fail-loud；有 workspace grant +
  DAEMON_BORROW → 放行；群主自有机器 → owner 短路放行；
- 忙轮排队：入队快照按入队时刻冻结、sender_user_id=实际发送者（非群主）、
  满 5 条 → 409 DaemonSessionQueueFull；
- 群列表最后消息摘要接通（最新 user_input/投影行首 60 字）。

夹具范式镜像 ``test_group_chat_management.py`` / ``test_session_create_config.py``
（in-memory SQLite + httpx ASGI client + 手签 JWT + ws_hub/readiness/redis
mock）；GLMConfig.from_env → None（知识库铁律：涉 LLM 路径不走出网）。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
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
from app.modules.daemon.grants.model import DaemonRuntimeGrant
from app.modules.daemon.group.service import (
    _build_group_prompt,
    _load_group_context_lines,
    _parse_group_mentions,
)
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.workspace.model import PpmProjectWorkspace, Workspace

# ── Helpers（镜像 test_group_chat_management.py 夹具范式）────────────────────


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
        email=f"grp3-{name}-{uuid.uuid4()}@example.com",
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
        key=f"grp3-{uuid.uuid4().hex[:8]}",
        name="grp3-test-role",
        description="task-03 seed",
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
        name="grp3-ws",
        slug=f"grp3-ws-{uuid.uuid4().hex[:8]}",
        root_path="C:/tmp/grp3-ws",
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
    hostname: str = "grp3-host",
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
    context_window: int | None = None,
) -> dict:
    payload: dict = {"title": title, "project_id": str(project_id)}
    if workspace_id is not None:
        payload["workspace_id"] = str(workspace_id)
    if user_members:
        payload["user_members"] = user_members
    if agent_members:
        payload["agent_members"] = agent_members
    if context_window is not None:
        payload["context_window"] = context_window
    resp = await client.post("/api/daemon/group-chats", json=payload, headers=_headers(owner_token))
    assert resp.status_code == 201, resp.text
    return resp.json()


def _agent_config(runtime_id: uuid.UUID, name: str = "小码") -> dict:
    return {"display_name": name, "runtime_id": str(runtime_id), "provider": "claude"}


async def _send_message(
    client: AsyncClient, token: str, group_id: uuid.UUID | str, content: str
) -> "object":
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


async def _shadow_sessions(
    db_session: AsyncSession,
) -> list[AgentSession]:
    return list(
        (
            await db_session.execute(
                select(AgentSession).where(AgentSession.session_kind == "group_member")
            )
        )
        .scalars()
        .all()
    )


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


def _mock_hub(*, connected: bool = True) -> MagicMock:
    """ws_hub 替身（test_session_create_config._mock_hub 先例）。"""
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


async def _seed_timeline_row(
    db_session: AsyncSession,
    *,
    group_session_id: uuid.UUID,
    channel: str,
    content: str,
    sender_user_id: uuid.UUID | None = None,
    metadata_: dict | None = None,
    timestamp: datetime | None = None,
) -> AgentRunLog:
    """直落一行群时间线行（载体 run + log）——摘要组装测试的数据源。"""
    carrier = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="group",
        status="completed",
        started_at=timestamp or datetime.now(UTC),
        finished_at=timestamp or datetime.now(UTC),
        spec_strategy="group_carrier",
        agent_session_id=group_session_id,
        user_id=sender_user_id,
    )
    db_session.add(carrier)
    await db_session.flush()
    log = AgentRunLog(
        id=uuid.uuid4(),
        run_id=carrier.id,
        channel=channel,
        content_redacted=content,
        timestamp=timestamp or datetime.now(UTC),
        metadata_=metadata_,
    )
    db_session.add(log)
    await db_session.commit()
    return log


async def _seed_shadow_with_active_run(
    db_session: AsyncSession,
    *,
    member: AgentGroupMember,
    owner_user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    run_status: str = "running",
) -> AgentSession:
    """落一行 active 影子会话 + interactive lease + 指定状态 run（测试替身）。

    ``run_status='running'`` → 忙轮（排队路径）；``'completed'`` → 空闲
    （复用注入路径）。
    """
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


async def _seed_grant(
    db_session: AsyncSession,
    *,
    daemon_instance_id: uuid.UUID,
    granted_by: uuid.UUID,
    grantee_id: uuid.UUID,
) -> DaemonRuntimeGrant:
    grant = DaemonRuntimeGrant(
        id=uuid.uuid4(),
        daemon_instance_id=daemon_instance_id,
        grantee_type="workspace",
        grantee_id=grantee_id,
        granted_by_user_id=granted_by,
        enabled=True,
    )
    db_session.add(grant)
    await db_session.commit()
    return grant


async def _seed_pending_queue(
    db_session: AsyncSession, shadow_id: uuid.UUID, sender_user_id: uuid.UUID, count: int
) -> None:
    for i in range(count):
        db_session.add(
            AgentSessionQueuedMessage(
                id=uuid.uuid4(),
                agent_session_id=shadow_id,
                sender_user_id=sender_user_id,
                prompt=f"已排队消息 {i}",
                status="pending",
                position=i,
            )
        )
    await db_session.commit()


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
    """群频道 publish 替身（group service 侧 get_redis）——log 事件断言数据源。"""
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with mock_patch("app.modules.daemon.group.service.get_redis", return_value=redis):
        yield redis


@pytest.fixture()
def readiness_ok():
    """session readiness 替身：inject 前 wait 立即返 True（免 8s 超时）。"""
    stub = MagicMock()
    stub.wait = AsyncMock(return_value=True)
    with mock_patch("app.modules.daemon.session.service.get_session_readiness", return_value=stub):
        yield stub


# ── @解析矩阵（design §4.1）─────────────────────────────────────────────────


def _member_stub(
    *,
    member_type: str = "agent",
    name: str = "小码",
    removed: bool = False,
) -> AgentGroupMember:
    m = AgentGroupMember(
        id=uuid.uuid4(),
        group_id=uuid.uuid4(),
        member_type=member_type,
        display_name=name,
        joined_at=datetime.now(UTC),
    )
    if removed:
        m.removed_at = datetime.now(UTC)
    return m


class TestParseGroupMentions:
    def test_halfwidth_and_fullwidth_at(self) -> None:
        members = [_member_stub(name="小码")]
        assert [m.display_name for m in _parse_group_mentions("@小码 帮我修一下", members)] == [
            "小码"
        ]
        assert [m.display_name for m in _parse_group_mentions("＠小码 帮我修一下", members)] == [
            "小码"
        ]

    def test_broadcast_tokens_hit_all_agent_members(self) -> None:
        members = [_member_stub(name="小码"), _member_stub(name="小助")]
        user_member = _member_stub(member_type="user", name="群主")
        hits = _parse_group_mentions("@全体 大家看下", members + [user_member])
        assert {m.display_name for m in hits} == {"小码", "小助"}
        hits = _parse_group_mentions("＠all 看下", members)
        assert {m.display_name for m in hits} == {"小码", "小助"}
        # 广播词后接标点也算（token 边界截断）。
        hits = _parse_group_mentions("@全体，看下", members)
        assert {m.display_name for m in hits} == {"小码", "小助"}

    def test_no_mention_returns_empty(self) -> None:
        members = [_member_stub(name="小码")]
        assert _parse_group_mentions("普通消息没有提及", members) == []
        # 裸 @ 不命中（\S+ 无候选词）。
        assert _parse_group_mentions("@ 大家好", members) == []

    def test_boundary_punctuation_truncates_token(self) -> None:
        members = [_member_stub(name="小码")]
        for content in (
            "@小码，帮我修复",
            "@小码。帮我修复",
            "收到@小码！马上处理",
            "(@小码)看这里",
            "@小码:看一下",
        ):
            assert [m.display_name for m in _parse_group_mentions(content, members)] == ["小码"], (
                content
            )

    def test_longer_name_prefix_does_not_hit_shorter(self) -> None:
        """「@小码二号」不得误命中「小码」（昵称后继字符非边界 → 不截断）。"""
        xiao = _member_stub(name="小码")
        xiao2 = _member_stub(name="小码二号")
        hits = _parse_group_mentions("@小码二号 来一下", [xiao, xiao2])
        assert [m.display_name for m in hits] == ["小码二号"]

    def test_user_member_nickname_not_triggered(self) -> None:
        """@用户昵称不触发（仅 agent 成员可被触发；design §4.1 路由到 agent）。"""
        user_member = _member_stub(member_type="user", name="小英")
        agent = _member_stub(name="小码")
        assert _parse_group_mentions("@小英 你看看", [user_member, agent]) == []

    def test_removed_member_not_triggered(self) -> None:
        removed = _member_stub(name="旧助手", removed=True)
        active = _member_stub(name="小码")
        assert _parse_group_mentions("@旧助手 还在吗", [removed, active]) == []

    def test_multiple_mentions_dedup(self) -> None:
        a = _member_stub(name="小码")
        b = _member_stub(name="小助")
        hits = _parse_group_mentions("@小码 先看，@小助 复核", [a, b])
        assert [m.display_name for m in hits] == ["小码", "小助"]
        # 同一成员重复 @ 去重。
        assert [m.display_name for m in _parse_group_mentions("@小码 @小码", [a])] == ["小码"]


# ── 群背景摘要组装（design §4.2）────────────────────────────────────────────


class TestGroupContextLines:
    async def test_identity_labels_user_and_projection(self, db_session: AsyncSession) -> None:
        env = await _make_env(db_session)
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
        await db_session.commit()
        group = AgentGroupChat(
            id=group_session.id,
            session_id=group_session.id,
            workspace_id=env.ws.id,
            title="测试群",
            created_by=env.owner.id,
        )
        db_session.add(group)
        xiaoying, _ = await _env_user(db_session, env, name="小英")
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
        db_session.add(
            AgentGroupMember(
                group_id=group.id,
                member_type="user",
                display_name="小英",
                user_id=xiaoying.id,
                invited_by=env.owner.id,
                joined_at=datetime.now(UTC),
            )
        )
        agent_member = AgentGroupMember(
            group_id=group.id,
            member_type="agent",
            display_name="小码",
            runtime_id=env.runtime.id,
            provider="claude",
            shadow_status="none",
            invited_by=env.owner.id,
            joined_at=datetime.now(UTC),
        )
        db_session.add(agent_member)
        await db_session.commit()

        base = datetime.now(UTC)
        # 用户行（metadata 带发送者身份——本卡写入）。
        await _seed_timeline_row(
            db_session,
            group_session_id=group_session.id,
            channel="user_input",
            content="登录页偶现白屏",
            sender_user_id=env.owner.id,
            metadata_={
                "sender_user_id": str(env.owner.id),
                "sender_member_name": "群主",
            },
            timestamp=base,
        )
        # 用户行（无 metadata——回退 run.user_id 解析成员昵称）。
        await _seed_timeline_row(
            db_session,
            group_session_id=group_session.id,
            channel="user_input",
            content="我也复现了",
            sender_user_id=xiaoying.id,
            timestamp=base + timedelta(seconds=1),
        )
        # 投影行（channel='stdout' + metadata 身份——task-05 双写，本卡查询兼容）。
        await _seed_timeline_row(
            db_session,
            group_session_id=group_session.id,
            channel="stdout",
            content="已定位：LoginForm.jsx:47 hooks 依赖",
            metadata_={
                "member_id": str(agent_member.id),
                "member_name": "小码",
                "source_log_id": str(uuid.uuid4()),
            },
            timestamp=base + timedelta(seconds=2),
        )
        # 无关行不进摘要（stdout 且无 metadata——群会话不应有，防御兼容）。
        await _seed_timeline_row(
            db_session,
            group_session_id=group_session.id,
            channel="stderr",
            content="噪音行",
            timestamp=base + timedelta(seconds=3),
        )

        members = await _member_rows(db_session, group.id)
        lines = await _load_group_context_lines(
            db_session,
            group_session_id=group_session.id,
            context_window=20,
            members=members,
        )
        assert lines == [
            "群主(用户): 登录页偶现白屏",
            "小英(用户): 我也复现了",
            "小码(Agent): 已定位：LoginForm.jsx:47 hooks 依赖",
        ]

    async def test_entry_truncated_to_500(self, db_session: AsyncSession) -> None:
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
        await db_session.commit()
        long_content = "长" * 800
        await _seed_timeline_row(
            db_session,
            group_session_id=group_session.id,
            channel="user_input",
            content=long_content,
            sender_user_id=env.owner.id,
            metadata_={"sender_member_name": "群主"},
        )
        lines = await _load_group_context_lines(
            db_session,
            group_session_id=group_session.id,
            context_window=20,
            members=[],
        )
        assert len(lines) == 1
        assert lines[0].startswith("群主(用户): " + "长" * 500)
        assert "长" * 501 not in lines[0]

    async def test_total_length_cap_drops_oldest(self, db_session: AsyncSession) -> None:
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
        await db_session.commit()
        base = datetime.now(UTC)
        # 15 条 × ~500 字 ≈ 7500 字 > 6000 上限 → 丢最旧。
        for i in range(15):
            await _seed_timeline_row(
                db_session,
                group_session_id=group_session.id,
                channel="user_input",
                content=f"消息{i:02d}-" + "内" * 480,
                sender_user_id=env.owner.id,
                metadata_={"sender_member_name": "群主"},
                timestamp=base + timedelta(seconds=i),
            )
        lines = await _load_group_context_lines(
            db_session,
            group_session_id=group_session.id,
            context_window=100,
            members=[],
        )
        assert len(lines) < 15  # 有最旧行被丢弃
        assert sum(len(line) for line in lines) <= 6000
        # 保最新：最后一条在，最旧的「消息00」不在。
        assert any("消息14" in line for line in lines)
        assert not any("消息00" in line for line in lines)
        # 时间正序（最新在末尾）。
        assert "消息14" in lines[-1]

    async def test_exclude_log_id_skips_current_message(self, db_session: AsyncSession) -> None:
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
        await db_session.commit()
        base = datetime.now(UTC)
        old_log = await _seed_timeline_row(
            db_session,
            group_session_id=group_session.id,
            channel="user_input",
            content="旧消息",
            sender_user_id=env.owner.id,
            metadata_={"sender_member_name": "群主"},
            timestamp=base,
        )
        current_log = await _seed_timeline_row(
            db_session,
            group_session_id=group_session.id,
            channel="user_input",
            content="当前消息",
            sender_user_id=env.owner.id,
            metadata_={"sender_member_name": "群主"},
            timestamp=base + timedelta(seconds=1),
        )
        lines = await _load_group_context_lines(
            db_session,
            group_session_id=group_session.id,
            context_window=20,
            members=[],
            exclude_log_id=current_log.id,
        )
        assert lines == ["群主(用户): 旧消息"]
        assert old_log.id != current_log.id


# ── 注入 prompt 组装（design §4.3）───────────────────────────────────────────


class TestBuildGroupPrompt:
    def test_prompt_contains_briefing_context_and_current(self) -> None:
        group = SimpleNamespace(title="测试群")
        member = _member_stub(name="小码")
        prompt = _build_group_prompt(
            group=group,
            member=member,
            member_lines=["群主(用户)", "小英(用户)", "小码(Agent)"],
            context_lines=["小英(用户): 登录页偶现白屏"],
            sender_member_name="鲸落",
            content="@小码 帮我修复它",
        )
        # quick-6966fcee 注入分离展示：前导块带【群聊上下文】头（前端
        # extractPreambleText 识别剥离，对话视图只显示真实消息）。
        assert prompt.startswith("【群聊上下文】\n你是群聊「测试群」中的 Agent 成员「小码」。")
        assert "成员：群主(用户)、小英(用户)、小码(Agent)。" in prompt
        assert "仅当消息 @你 或 @全体 时回应" in prompt
        assert "你的发言会以「小码」身份出现在群里" in prompt
        # 背景段标记 + 身份标签格式。
        assert "[群聊记录 · 背景，仅供了解上下文]" in prompt
        assert "小英(用户): 登录页偶现白屏" in prompt
        # 当前消息段标记。
        assert "[当前消息 · 需要你回应]" in prompt
        assert "鲸落(用户): @小码 帮我修复它" in prompt
        # 段落顺序：简报 → 背景 → 当前消息。
        assert prompt.index("你是群聊") < prompt.index("群聊记录 · 背景")
        assert prompt.index("群聊记录 · 背景") < prompt.index("当前消息 · 需要你回应")

    def test_prompt_without_context_omits_background_block(self) -> None:
        prompt = _build_group_prompt(
            group=SimpleNamespace(title="测试群"),
            member=_member_stub(name="小码"),
            member_lines=["群主(用户)", "小码(Agent)"],
            context_lines=[],
            sender_member_name="群主",
            content="@小码 你好",
        )
        assert "群聊记录 · 背景" not in prompt
        assert "群主(用户): @小码 你好" in prompt

    def test_source_member_name_labels_agent_sender(self) -> None:
        """互@来源标注（task-04 消费）：source_member_name → Agent 身份标签。"""
        prompt = _build_group_prompt(
            group=SimpleNamespace(title="测试群"),
            member=_member_stub(name="小助"),
            member_lines=["小码(Agent)", "小助(Agent)"],
            context_lines=[],
            sender_member_name="小码",
            content="@小助 复核一下",
            source_member_name="小码",
        )
        assert "小码(Agent): @小助 复核一下" in prompt

    def test_prompt_contains_reply_marker_requirement(self) -> None:
        """quick 投影统一标记制（2026-09-02）：@轮 prompt 末尾追加回应要求
        指示行——[[GROUP]]/[[/GROUP]] 标记用法（仅标记段进群时间线）。"""
        from app.modules.daemon.group.service import _GROUP_REPLY_MARKER_REQUIREMENT

        prompt = _build_group_prompt(
            group=SimpleNamespace(title="测试群"),
            member=_member_stub(name="小码"),
            member_lines=["群主(用户)", "小码(Agent)"],
            context_lines=[],
            sender_member_name="群主",
            content="@小码 帮我修复它",
        )
        assert _GROUP_REPLY_MARKER_REQUIREMENT in prompt
        assert "[[GROUP]]" in prompt
        assert "[[/GROUP]]" in prompt
        # quick-6966fcee 注入分离展示：指示行属前导块——在真实消息分隔符
        # （
        # quick-6966fcee 注入分离展示：指示行属前导块——在真实消息分隔符
        # （\n\n---\n\n）之前、prompt 不再以它结尾。
        sep = prompt.index("\n\n---\n\n")
        assert prompt.rindex(_GROUP_REPLY_MARKER_REQUIREMENT) < sep
        assert prompt.endswith("群主(用户): @小码 帮我修复它")


# ── 消息入群：载体 run + 群频道事件 + 未 @ 不触发（design §4.1）────────────


class TestGroupMessageIngest:
    async def test_unmentioned_message_lands_timeline_only(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])

        resp = await _send_message(client, env.owner_token, group_id, "没人被提及的消息")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["mentioned_member_ids"] == []
        assert body["mention_all"] is False
        assert body["triggered"] == []

        # 载体 run：completed + started_at 落值 + group_carrier + 发送者归属。
        carrier = await db_session.get(AgentRun, uuid.UUID(body["carrier_run_id"]))
        assert carrier is not None
        assert carrier.status == "completed"
        assert carrier.started_at is not None
        assert carrier.spec_strategy == "group_carrier"
        assert carrier.user_id == env.owner.id
        assert carrier.agent_session_id == uuid.UUID(data["session_id"])
        # user_input 原文落库（含发送者身份 metadata）。
        log_row = await db_session.get(AgentRunLog, uuid.UUID(body["log_id"]))
        assert log_row is not None
        assert log_row.channel == "user_input"
        assert log_row.content_redacted == "没人被提及的消息"
        assert log_row.metadata_ is not None
        assert log_row.metadata_["sender_member_name"] == "群主"
        assert log_row.metadata_["sender_user_id"] == str(env.owner.id)
        # 未 @ → 不懒建影子。
        assert await _shadow_sessions(db_session) == []
        member = await _agent_member_row(db_session, group_id)
        assert member.shadow_session_id is None
        assert member.shadow_status == "none"

    async def test_group_channel_log_event_published(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        env = await _make_env(db_session)
        member_user, member_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member_user.id), "display_name": "鲸落"}],
        )
        group_id = uuid.UUID(data["id"])
        session_id = uuid.UUID(data["session_id"])

        resp = await _send_message(client, member_token, group_id, "@全体 早上好")
        assert resp.status_code == 200, resp.text
        body = resp.json()

        # 群频道 log 事件（payload 形态照 session channel log 事件 + sender 扩展）。
        publishes = [
            (
                call.args[0],
                json.loads(call.args[1]),
            )
            for call in mocked_group_redis.publish.call_args_list
        ]
        log_events = [p for p in publishes if p[0] == f"agent_session:{session_id}"]
        assert log_events, "群频道未发布 log 事件"
        channel_name, payload = log_events[0]
        assert channel_name == f"agent_session:{session_id}"
        assert payload["event"] == "log"
        assert payload["session_id"] == str(session_id)
        assert payload["log_id"] == body["log_id"]
        assert payload["run_id"] == body["carrier_run_id"]
        assert payload["channel"] == "user_input"
        assert payload["content"] == "@全体 早上好"
        assert payload["sender_user_id"] == str(member_user.id)
        assert payload["sender_member_name"] == "鲸落"

    async def test_non_member_cannot_send(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        _outsider, outsider_token = await _env_user(db_session, env, name=" outsiders")
        resp = await _send_message(client, outsider_token, data["id"], "@全体 hi")
        assert resp.status_code == 404
        assert resp.json()["code"] == "HTTP_404_GROUP_CHAT_NOT_FOUND"

    async def test_empty_content_rejected(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        resp = await _send_message(client, env.owner_token, data["id"], "   ")
        assert resp.status_code == 400  # 纯空白 → service 层中文 400
        assert "不能为空" in resp.json()["message"]

    async def test_ended_group_rejects_message(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/end", headers=_headers(env.owner_token)
        )
        assert resp.status_code == 200, resp.text
        resp = await _send_message(client, env.owner_token, data["id"], "@全体 hi")
        assert resp.status_code == 400
        assert "解散" in resp.json()["message"]


# ── 影子懒建 + 首轮注入（design §4.3 / §8 shadow.created + member.injected）──


class TestShadowLazyCreation:
    async def test_first_mention_creates_shadow_and_dispatches(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])

        resp = await _send_message(client, env.owner_token, group_id, "@小码 帮我修复它")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [t["member_name"] for t in body["triggered"]] == ["小码"]
        trigger = body["triggered"][0]
        assert trigger["queued"] is False
        assert trigger["run_id"] is not None

        # 影子会话行：六要素 + kind/user/parent 恒 NULL/config/title（§4.3）。
        shadow = await db_session.get(AgentSession, uuid.UUID(trigger["shadow_session_id"]))
        assert shadow is not None
        assert shadow.session_kind == "group_member"
        assert shadow.user_id == env.owner.id  # 影子归属=群主（§9.2）
        assert shadow.parent_session_id is None  # D-007：恒 NULL
        assert shadow.status == "active"
        assert shadow.title == "群「测试群」·小码"
        # quick-6966fcee：影子不再设 manual_approval=False（askuser 恢复——影子
        # 会话已挂完整 SessionPanel，群主可作答 AskUserQuestion/权限请求）。
        assert shadow.config is None
        assert shadow.runtime_id == env.runtime.id
        assert shadow.workspace_id == env.ws.id  # 成员工作区锚（建群缺省=群工作区）
        assert shadow.lease_id is not None
        member = await _agent_member_row(db_session, group_id)
        assert member.shadow_session_id == shadow.id
        assert member.shadow_status == "active"

        # interactive lease：kind + pinned runtime + stage + cwd。
        lease = await db_session.get(DaemonTaskLease, shadow.lease_id)
        assert lease is not None
        assert lease.kind == "interactive"
        assert lease.runtime_id == env.runtime.id
        assert lease.metadata_ is not None
        assert lease.metadata_["stage"] == "group_member"
        assert lease.metadata_["workspace_id"] == str(env.ws.id)
        assert lease.metadata_["cwd"]

        # 首轮 run：挂影子会话、user_id=群主、spec_strategy='interactive'。
        first_run = await db_session.get(AgentRun, uuid.UUID(trigger["run_id"]))
        assert first_run is not None
        assert first_run.agent_session_id == shadow.id
        assert first_run.user_id == env.owner.id
        assert first_run.spec_strategy == "interactive"
        assert first_run.status == "pending"

        # 首轮 user_input 日志：完整组装 prompt + 群链路 metadata（§4.3/§4.4）。
        log_rows = list(
            (
                await db_session.execute(
                    select(AgentRunLog).where(AgentRunLog.run_id == first_run.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(log_rows) == 1
        user_log = log_rows[0]
        assert user_log.channel == "user_input"
        assert "你是群聊「测试群」中的 Agent 成员「小码」" in user_log.content_redacted
        assert "[当前消息 · 需要你回应]" in user_log.content_redacted
        assert "群主(用户): @小码 帮我修复它" in user_log.content_redacted
        assert user_log.metadata_ == {
            "source_group_id": str(group_id),
            "source_member_id": str(member.id),
            "source_carrier_run_id": body["carrier_run_id"],
            "chain_depth": 0,
            "sender_user_id": str(env.owner.id),
            # quick-6966fcee 注入分离展示：真实用户消息原文随 metadata 落库。
            "user_message": "@小码 帮我修复它",
        }

        # SESSION_INJECT 控制指令落库（三段式：WS 失败也 pending）。
        from app.modules.daemon.control_commands import KIND_SESSION_INJECT
        from app.modules.daemon.model import DaemonControlCommand

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
        assert payload["session_id"] == str(shadow.id)
        assert payload["run_id"] == str(first_run.id)
        assert "你是群聊「测试群」中的 Agent 成员「小码」" in payload["prompt"]
        assert "[当前消息 · 需要你回应]" in payload["prompt"]

    async def test_second_mention_reuses_shadow(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        """幂等懒建：二次触发复用影子（首轮 run 尚 pending → 忙轮中途注入）。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])

        resp1 = await _send_message(client, env.owner_token, group_id, "@小码 第一条")
        assert resp1.status_code == 200, resp1.text
        trigger1 = resp1.json()["triggered"][0]
        assert trigger1["queued"] is False
        assert trigger1["mid_turn"] is False
        shadow_id_1 = trigger1["shadow_session_id"]

        # 首轮 run 无 daemon 收口恒 pending → 第二条 @ 命中忙轮中途注入
        # （steering：沿用活跃 run，不排队不建新 run）。
        resp2 = await _send_message(client, env.owner_token, group_id, "@小码 第二条")
        assert resp2.status_code == 200, resp2.text
        trigger2 = resp2.json()["triggered"][0]
        assert trigger2["shadow_session_id"] == shadow_id_1  # 幂等复用
        assert trigger2["queued"] is False
        assert trigger2["mid_turn"] is True
        assert trigger2["run_id"] == trigger1["run_id"]  # run_id 沿用活跃轮

        # 仍只有一个影子会话；群时间线上载体 run 恒为 2（每条消息一个）。
        shadows = await _shadow_sessions(db_session)
        assert len(shadows) == 1
        carriers = list(
            (
                await db_session.execute(
                    select(AgentRun).where(
                        AgentRun.agent_session_id == uuid.UUID(data["session_id"])
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(carriers) == 2
        # 忙轮注入不落排队表。
        assert await _list_queued(db_session, uuid.UUID(shadow_id_1)) == []

    async def test_reuse_inject_when_shadow_idle(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        """影子空闲（run 已终态）→ 复用注入：新 run + 群链路 metadata。"""
        env = await _make_env(db_session)
        sender, sender_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(sender.id)}],
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])
        member = await _agent_member_row(db_session, group_id)
        shadow = await _seed_shadow_with_active_run(
            db_session,
            member=member,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
            run_status="completed",
        )

        resp = await _send_message(client, sender_token, group_id, "@小码 空闲轮注入")
        assert resp.status_code == 200, resp.text
        trigger = resp.json()["triggered"][0]
        assert trigger["queued"] is False
        assert trigger["shadow_session_id"] == str(shadow.id)
        assert trigger["run_id"] is not None

        run = await db_session.get(AgentRun, uuid.UUID(trigger["run_id"]))
        assert run is not None
        assert run.agent_session_id == shadow.id
        assert run.user_id == env.owner.id  # run 归属=影子属主（群主，§9.2）
        assert run.spec_strategy == "interactive"
        # 复用轮 user_input 日志携带群链路 metadata（sender=实际发送者）。
        log_rows = list(
            (await db_session.execute(select(AgentRunLog).where(AgentRunLog.run_id == run.id)))
            .scalars()
            .all()
        )
        assert len(log_rows) == 1
        assert log_rows[0].channel == "user_input"
        assert log_rows[0].metadata_ is not None
        assert log_rows[0].metadata_["source_group_id"] == str(group_id)
        assert log_rows[0].metadata_["sender_user_id"] == str(sender.id)
        assert log_rows[0].metadata_["chain_depth"] == 0
        assert "空闲轮注入" in log_rows[0].content_redacted
        # 空闲轮不排队。
        assert await _list_queued(db_session, shadow.id) == []

    async def test_broadcast_triggers_all_agent_members(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[
                _agent_config(env.runtime.id, name="小码"),
                _agent_config(env.runtime.id, name="小助"),
            ],
        )
        group_id = uuid.UUID(data["id"])
        resp = await _send_message(client, env.owner_token, group_id, "@全体 评审一下")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["mention_all"] is True
        assert {t["member_name"] for t in body["triggered"]} == {"小码", "小助"}
        # 各自独立影子会话。
        assert len({t["shadow_session_id"] for t in body["triggered"]}) == 2

    async def test_foreign_runtime_without_grant_400(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        """非群主机器无 grant → 400 fail-loud（D-010：不照抄 worker 豁免）。"""
        env = await _make_env(db_session)
        lender, _ = await _create_user_with_token(db_session, name="机器主人")
        _lender_instance, lender_runtime = await _seed_runtime(
            db_session, lender.id, hostname="lender-host"
        )
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(lender_runtime.id)],
        )
        group_id = uuid.UUID(data["id"])

        resp = await _send_message(client, env.owner_token, group_id, "@小码 hi")
        assert resp.status_code == 400, resp.text
        assert "无法触发" in resp.json()["message"]
        # fail-loud 零残留：不建影子/lease/run。
        assert await _shadow_sessions(db_session) == []
        member = await _agent_member_row(db_session, group_id)
        assert member.shadow_session_id is None
        assert member.shadow_status == "none"

    async def test_foreign_runtime_with_workspace_grant_passes(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        """非群主机器 + workspace grant + DAEMON_BORROW → grants 分支放行。"""
        env = await _make_env(db_session)
        # 群主补 DAEMON_BORROW（authorize_pinned_runtime workspace 分支权限闸）。
        await _grant_workspace_role(
            db_session,
            workspace_id=env.ws.id,
            user_id=env.owner.id,
            permissions=[Permission.DAEMON_BORROW],
        )
        lender, _ = await _create_user_with_token(db_session, name="机器主人2")
        lender_instance, lender_runtime = await _seed_runtime(
            db_session, lender.id, hostname="lender-host-2"
        )
        await _seed_grant(
            db_session,
            daemon_instance_id=lender_instance.id,
            granted_by=lender.id,
            grantee_id=env.ws.id,
        )
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(lender_runtime.id)],
        )
        group_id = uuid.UUID(data["id"])

        resp = await _send_message(client, env.owner_token, group_id, "@小码 hi")
        assert resp.status_code == 200, resp.text
        trigger = resp.json()["triggered"][0]
        shadow = await db_session.get(AgentSession, uuid.UUID(trigger["shadow_session_id"]))
        assert shadow is not None
        assert shadow.status == "active"
        lease = await db_session.get(DaemonTaskLease, shadow.lease_id)
        assert lease is not None
        assert lease.runtime_id == lender_runtime.id
        # 借用标记（授权分支 → borrowed lease，沙箱/审计链路同语义）。
        assert lease.metadata_.get("borrowed") is True

    async def test_offline_runtime_400(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        """成员机器离线（DB status=offline）→ 400，不静默换机。"""
        env = await _make_env(db_session)
        offline_runtime = DaemonRuntime(
            id=uuid.uuid4(),
            daemon_instance_id=env.instance.id,
            user_id=env.owner.id,
            name="offline-rt",
            provider="claude",
            status="offline",
            last_heartbeat_at=datetime.now(UTC) - timedelta(hours=1),
        )
        db_session.add(offline_runtime)
        await db_session.commit()
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(offline_runtime.id)],
        )
        resp = await _send_message(client, env.owner_token, data["id"], "@小码 hi")
        assert resp.status_code == 400
        assert await _shadow_sessions(db_session) == []


# ── 忙轮中途注入（quick 2026-09-02 群聊 steering：不排队直注活跃轮）──────────


class TestBusyMidTurnInject:
    async def test_busy_mention_injects_mid_turn_without_queue(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
    ) -> None:
        """忙轮 @ → 跳过排队直接注入活跃轮：零排队行 + SESSION_INJECT run_id=
        活跃 run + prompt 含中途标注 + triggered[].mid_turn=True。"""
        from app.modules.daemon.control_commands import KIND_SESSION_INJECT
        from app.modules.daemon.group.service import _MID_TURN_NOTICE
        from app.modules.daemon.model import DaemonControlCommand

        env = await _make_env(db_session)
        sender, sender_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(sender.id)}],
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
        busy_runs = list(
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == shadow.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(busy_runs) == 1
        busy_run_id = busy_runs[0].id

        resp = await _send_message(client, sender_token, group_id, "@小码 中途改需求，不用过程回复")
        assert resp.status_code == 200, resp.text
        trigger = resp.json()["triggered"][0]
        # 忙轮注入成功：queued=False + mid_turn=True + run_id=活跃 run。
        assert trigger["queued"] is False
        assert trigger["mid_turn"] is True
        assert trigger["shadow_session_id"] == str(shadow.id)
        assert trigger["run_id"] == str(busy_run_id)

        # 不落排队表（零行）。
        assert await _list_queued(db_session, shadow.id) == []
        # 不建新 run（单会话单活跃 run 不变式保持）。
        runs_after = list(
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == shadow.id)
                )
            )
            .scalars()
            .all()
        )
        assert [r.id for r in runs_after] == [busy_run_id]

        # SESSION_INJECT 已发：payload run_id=活跃 run、prompt 头部含中途标注。
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
        assert payload["session_id"] == str(shadow.id)
        assert payload["run_id"] == str(busy_run_id)
        assert payload["prompt"].startswith(_MID_TURN_NOTICE)
        assert "中途改需求，不用过程回复" in payload["prompt"]

        # 本轮 user_input 留痕挂同一活跃 run（群链路 metadata 照传）。
        log_rows = list(
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == busy_run_id,
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(log_rows) == 1
        assert log_rows[0].content_redacted.startswith(_MID_TURN_NOTICE)
        assert "中途改需求，不用过程回复" in log_rows[0].content_redacted
        assert log_rows[0].metadata_ is not None
        assert log_rows[0].metadata_["source_group_id"] == str(group_id)
        assert log_rows[0].metadata_["sender_user_id"] == str(sender.id)
        assert log_rows[0].metadata_["chain_depth"] == 0

    async def test_conflict_race_degrades_to_queue(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """409 竞态降级：inject 抛 DaemonSessionTurnConflict → 走既有落队分支
        （排队兜底）+ queued=True；快照按入队时刻冻结。"""
        from app.modules.daemon.group.service import _MID_TURN_NOTICE
        from app.modules.daemon.session.service import (
            DaemonSessionTurnConflict,
            SessionService,
        )

        env = await _make_env(db_session)
        sender, sender_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(sender.id)}],
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

        # 竞态替身：busy_strategy="inject" 首次调用抛 409（模拟注入瞬间轮刚好
        # 终态），其余调用（降级排队 / 后续消息）走真实实现。
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
            resp = await _send_message(client, sender_token, group_id, "@小码 第一条追问")
            assert resp.status_code == 200, resp.text
            trigger = resp.json()["triggered"][0]
            assert calls["inject_calls"] == 1
            assert trigger["queued"] is True
            assert trigger["mid_turn"] is False
            assert trigger["run_id"] is None

            entries = await _list_queued(db_session, shadow.id)
            assert len(entries) == 1
            entry = entries[0]
            # sender_user_id=实际发送者（非群主/影子属主）。
            assert entry.sender_user_id == sender.id
            assert entry.status == "pending"
            # prompt 为降级时刻完整拼装文本（链标记行在前——排队条目链透传，
            # 其后即中途标注——忙轮判定在先）。
            assert entry.prompt is not None
            assert entry.prompt.startswith("[GROUP_CHAIN carrier=")
            assert _MID_TURN_NOTICE in entry.prompt
            assert "[当前消息 · 需要你回应]" in entry.prompt
            assert "小英(用户): @小码 第一条追问" in entry.prompt

            # 入队后群里又发一条不相关消息（忙轮注入成功不排队）——快照不含。
            resp2 = await _send_message(client, env.owner_token, group_id, "后来的进展")
            assert resp2.status_code == 200, resp2.text
            entries_after = await _list_queued(db_session, shadow.id)
            assert len(entries_after) == 1
            assert "后来的进展" not in entries_after[0].prompt
            assert "第一条追问" in entries_after[0].prompt

    async def test_queue_full_returns_409(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """降级路径满 5 条 → 409 DaemonSessionQueueFull（排队兜底口径不变）。"""
        from app.modules.daemon.session.service import (
            DaemonSessionTurnConflict,
            SessionService,
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
        await _seed_pending_queue(db_session, shadow.id, env.owner.id, 5)

        original = SessionService.inject_session_as_service

        async def always_conflict(self, session_id, **kwargs):
            if kwargs.get("busy_strategy") == "inject":
                raise DaemonSessionTurnConflict(
                    "Session run just went terminal (race).",
                    details={"session_id": str(session_id)},
                )
            return await original(self, session_id, **kwargs)

        with mock_patch.object(SessionService, "inject_session_as_service", always_conflict):
            resp = await _send_message(client, env.owner_token, group_id, "@小码 第六条")
            assert resp.status_code == 409, resp.text
            assert resp.json()["code"] == "HTTP_409_DAEMON_SESSION_QUEUE_FULL"
        # 满员后不新增条目。
        assert len(await _list_queued(db_session, shadow.id)) == 5


# ── 群列表最后消息摘要（task-02 占位接通）───────────────────────────────────


class TestListLastMessage:
    async def test_last_message_preview_first_60_chars(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])

        # 无消息 → None。
        resp = await client.get("/api/daemon/group-chats", headers=_headers(env.owner_token))
        assert resp.status_code == 200
        assert resp.json()[0]["last_message"] is None

        long_content = "开" * 40 + "头" * 40  # 80 字
        resp = await _send_message(client, env.owner_token, group_id, long_content)
        assert resp.status_code == 200, resp.text

        # 投影行（更新）成为最新 → 摘要取投影行内容。
        session_id = uuid.UUID(data["session_id"])
        await _seed_timeline_row(
            db_session,
            group_session_id=session_id,
            channel="stdout",
            content="投影回复内容",
            metadata_={"member_name": "小码"},
        )

        resp = await client.get("/api/daemon/group-chats", headers=_headers(env.owner_token))
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert items[0]["last_message"] == "投影回复内容"

    async def test_long_message_truncated_to_60(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        content = "字" * 100
        resp = await _send_message(client, env.owner_token, data["id"], content)
        assert resp.status_code == 200, resp.text
        resp = await client.get("/api/daemon/group-chats", headers=_headers(env.owner_token))
        last = resp.json()[0]["last_message"]
        assert last == "字" * 60
