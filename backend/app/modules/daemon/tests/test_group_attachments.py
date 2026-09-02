"""FR-05 补遗：群消息附件管线测试（2026-09 quick）。

覆盖（照单聊 2026-08-20-session-multimodal-attachments 口径的群侧落地）：

- 发送校验：附件不存在/跨用户 → 400（群错误族 GroupChatInvalid，非单聊 404
  资源隐藏——群消息整体拒绝语义）；数量超限（图>5/文>5）→ 400；纯附件空
  content 合法（D-7 看图说话豁免）；
- 物化：附件行绑定群载体会话（draft→bound，session_id=群会话 id——防 48h
  草稿清理）；
- 落库与事件：user_input 行 ``metadata_.attachments`` 摘要（file_id/name/
  size/kind）+ 群频道 log 事件 payload 同形态；
- 触发透传（首轮懒建）：prompt 末尾附件提示行（``[附件] name (file_id)``）+
  SESSION_INJECT payload ``attachments`` 列表（组装产物 disk/block，与单聊
  同形态）；
- 触发透传（复用注入）：``inject_session_as_service`` 附件通道——user_input
  标记行（单聊 D-3 ``[附件:id|kind|name]``）+ SESSION_INJECT attachments +
  **归属覆盖**（附件上传者=普通群成员发送者≠影子属主群主，按属主校验会误拒）；
- 引擎门控：非 Claude 成员 + 附件 → 400（单聊 D-6 同口径；消息已落时间线）。

夹具范式镜像 ``test_group_mention_pipeline.py``（in-memory SQLite + httpx
ASGI client + 手签 JWT + ws_hub/readiness/redis/storage mock）；GLMConfig.
from_env → None（知识库铁律：涉 LLM 路径不走出网）。
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
)
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.session_attachment.model import SessionAttachment
from app.modules.workspace.model import Workspace

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
        email=f"grpatt-{name}-{uuid.uuid4()}@example.com",
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
        key=f"grpatt-{uuid.uuid4().hex[:8]}",
        name="grpatt-test-role",
        description="attachment seed",
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


async def _make_env(db_session: AsyncSession, *, owner_name: str = "群主") -> SimpleNamespace:
    """每测试的群聊环境：workspace + 群主（TASK_RUN_AGENT 角色）+ 在线机器。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name="grpatt-ws",
        slug=f"grpatt-ws-{uuid.uuid4().hex[:8]}",
        root_path="C:/tmp/grpatt-ws",
        status="active",
    )
    db_session.add(ws)
    owner, owner_token = await _create_user_with_token(db_session, name=owner_name)
    await _grant_workspace_role(
        db_session,
        workspace_id=ws.id,
        user_id=owner.id,
        permissions=[Permission.TASK_RUN_AGENT],
    )
    instance = DaemonInstance(
        id=uuid.uuid4(),
        user_id=owner.id,
        hostname="grpatt-host",
        server_url="http://test.local",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(instance)
    runtime = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=instance.id,
        user_id=owner.id,
        name="grpatt-host",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(runtime)
    await db_session.commit()
    return SimpleNamespace(ws=ws, owner=owner, owner_token=owner_token, runtime=runtime)


async def _env_user(
    db_session: AsyncSession, env: SimpleNamespace, *, name: str
) -> tuple[User, str]:
    """在环境 workspace 内造普通成员用户（端点门 TASK_RUN_AGENT）。"""
    user, token = await _create_user_with_token(db_session, name=name)
    await _grant_workspace_role(
        db_session,
        workspace_id=env.ws.id,
        user_id=user.id,
        permissions=[Permission.TASK_RUN_AGENT],
    )
    return user, token


async def _create_group(
    client: AsyncClient,
    owner_token: str,
    *,
    workspace_id: uuid.UUID,
    agent_members: list[dict] | None = None,
    user_members: list[dict] | None = None,
) -> dict:
    payload: dict = {"title": "附件测试群", "workspace_id": str(workspace_id)}
    if agent_members:
        payload["agent_members"] = agent_members
    if user_members:
        payload["user_members"] = user_members
    resp = await client.post("/api/daemon/group-chats", json=payload, headers=_headers(owner_token))
    assert resp.status_code == 201, resp.text
    return resp.json()


def _agent_config(runtime_id: uuid.UUID, name: str = "小码", provider: str = "claude") -> dict:
    return {"display_name": name, "runtime_id": str(runtime_id), "provider": provider}


async def _seed_attachment(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    *,
    kind: str = "file",
    name: str = "需求文档.pdf",
    media_type: str = "application/pdf",
) -> SessionAttachment:
    """直落附件草稿行（上传端点产物替身——session_id NULL，design §10）。"""
    row = SessionAttachment(
        id=uuid.uuid4(),
        user_id=user_id,
        session_id=None,
        kind=kind,
        media_type=media_type,
        bytes=128,
        name=name,
        object_key=f"attachments/{user_id}/{uuid.uuid4().hex}.bin",
        sha256=uuid.uuid4().hex,
        created_at=datetime.now(UTC),
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return row


async def _send_message(
    client: AsyncClient,
    token: str,
    group_id: uuid.UUID | str,
    content: str,
    attachment_ids: list[uuid.UUID] | None = None,
):
    body: dict = {"content": content}
    if attachment_ids:
        body["attachment_ids"] = [str(a) for a in attachment_ids]
    return await client.post(
        f"/api/daemon/group-chats/{group_id}/messages",
        json=body,
        headers=_headers(token),
    )


async def _agent_member_row(
    db_session: AsyncSession, group_id: uuid.UUID, display_name: str = "小码"
) -> AgentGroupMember:
    rows = list(
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


async def _inject_commands(db_session: AsyncSession, runtime_id: uuid.UUID) -> list:
    """本机 runtime 上的 SESSION_INJECT 控制指令行（payload 断言数据源）。"""
    from app.modules.daemon.control_commands import KIND_SESSION_INJECT
    from app.modules.daemon.model import DaemonControlCommand

    return list(
        (
            await db_session.execute(
                select(DaemonControlCommand).where(
                    DaemonControlCommand.runtime_id == runtime_id,
                    DaemonControlCommand.kind == KIND_SESSION_INJECT,
                )
            )
        )
        .scalars()
        .all()
    )


async def _seed_idle_shadow(
    db_session: AsyncSession,
    *,
    member: AgentGroupMember,
    owner_user_id: uuid.UUID,
    runtime_id: uuid.UUID,
) -> AgentSession:
    """落一行空闲影子（active + lease + 终态 run）——复用注入路径测试替身。"""
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
    done_run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        started_at=datetime.now(UTC),
        finished_at=datetime.now(UTC),
        spec_strategy="interactive",
        agent_session_id=shadow.id,
        user_id=owner_user_id,
    )
    db_session.add(done_run)
    member.shadow_session_id = shadow.id
    member.shadow_status = "active"
    db_session.add(member)
    await db_session.commit()
    return shadow


# ── 共用 mock 夹具 ───────────────────────────────────────────────────────────


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
    """群频道 publish 替身（group service 侧 get_redis）——log 事件断言数据源。"""
    redis = AsyncMock()
    redis.publish = AsyncMock()
    redis.ping = AsyncMock()
    with mock_patch("app.modules.daemon.group.service.get_redis", return_value=redis):
        yield redis


@pytest.fixture()
def readiness_ok():
    """session readiness 替身：inject 前 wait 立即返 True（免 8s 超时）。"""
    stub = MagicMock()
    stub.wait = AsyncMock(return_value=True)
    with mock_patch("app.modules.daemon.session.service.get_session_readiness", return_value=stub):
        yield stub


@pytest.fixture()
def mocked_storage():
    """附件对象存储读打桩（多模态块读 bytes，不打桩会打真 MinIO）。"""
    backend = MagicMock()
    backend.read_bytes = AsyncMock(return_value=b"x" * 16)
    with mock_patch("app.modules.storage.factory.get_storage_backend", return_value=backend):
        yield backend


# ── 发送校验 + 物化 + 落库/事件 ───────────────────────────────────────────────


class TestGroupAttachmentSend:
    async def test_attachment_lands_metadata_event_and_binds_group_session(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """未 @ 附件消息：metadata 摘要 + log 事件 payload + 附件行绑定群会话。"""
        env = await _make_env(db_session)
        sender, sender_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            workspace_id=env.ws.id,
            user_members=[{"user_id": str(sender.id)}],
        )
        group_id = uuid.UUID(data["id"])
        att = await _seed_attachment(db_session, sender.id, name="截图.png", kind="image")

        resp = await _send_message(client, sender_token, group_id, "看下这个文件", [att.id])
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["mentioned_member_ids"] == []

        # user_input 行 metadata：附件摘要（file_id/name/size/kind）。
        log_row = await db_session.get(AgentRunLog, uuid.UUID(body["log_id"]))
        assert log_row is not None
        assert log_row.metadata_ is not None
        assert log_row.metadata_["attachments"] == [
            {"file_id": str(att.id), "name": "截图.png", "size": 128, "kind": "image"}
        ]

        # 群频道 log 事件 payload：attachments 摘要同形态。
        session_id = uuid.UUID(data["session_id"])
        publishes = [
            (call.args[0], json.loads(call.args[1]))
            for call in mocked_group_redis.publish.call_args_list
        ]
        log_events = [
            p
            for p in publishes
            if p[0] == f"agent_session:{session_id}" and p[1].get("event") == "log"
        ]
        assert log_events, "群频道未发布 log 事件"
        payload = log_events[0][1]
        assert payload["attachments"] == [
            {"file_id": str(att.id), "name": "截图.png", "size": 128, "kind": "image"}
        ]

        # 物化：附件行绑定群载体会话（draft→bound，防 48h 草稿清理）。
        # （populate_existing：API 走独立 session 提交，测试 session 身份映射
        # 持有落库前快照——强制刷新读最新值。）
        bound = (
            (
                await db_session.execute(
                    select(SessionAttachment)
                    .where(SessionAttachment.id == att.id)
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .one()
        )
        assert bound.session_id == session_id

    async def test_foreign_attachment_rejected_400(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """无权限附件（他人上传）→ 400 群错误族（消息不落库）。"""
        env = await _make_env(db_session)
        sender, sender_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            workspace_id=env.ws.id,
            user_members=[{"user_id": str(sender.id)}],
        )
        outsider, _ = await _env_user(db_session, env, name="路人")
        att = await _seed_attachment(db_session, outsider.id)

        resp = await _send_message(client, sender_token, data["id"], "借用一下", [att.id])
        assert resp.status_code == 400, resp.text
        assert "附件不存在或无权访问" in resp.json()["message"]

        # 整体拒绝：载体 run / 附件绑定均未落库（populate_existing 刷新读最新值）。
        group = await db_session.get(AgentGroupChat, uuid.UUID(data["id"]))
        carriers = list(
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == group.session_id)
                )
            )
            .scalars()
            .all()
        )
        assert carriers == []
        fresh = (
            (
                await db_session.execute(
                    select(SessionAttachment)
                    .where(SessionAttachment.id == att.id)
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .one()
        )
        assert fresh.session_id is None

    async def test_attachment_count_over_limit_400(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """图片 6 张（上限 5）→ 400（DTO 总量 10 内、逐 kind 校验归 service）。"""
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, workspace_id=env.ws.id)
        atts = [
            await _seed_attachment(
                db_session, env.owner.id, kind="image", name=f"i{n}.png", media_type="image/png"
            )
            for n in range(6)
        ]

        resp = await _send_message(
            client, env.owner_token, data["id"], "图集", [a.id for a in atts]
        )
        assert resp.status_code == 400, resp.text
        assert "附件数量超限" in resp.json()["message"]

    async def test_attachment_only_empty_content_allowed(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """纯附件空 content 合法（D-7 看图说话豁免，对齐单聊口径）。"""
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, workspace_id=env.ws.id)
        att = await _seed_attachment(db_session, env.owner.id, kind="image", name="图.png")

        resp = await _send_message(client, env.owner_token, data["id"], "", [att.id])
        assert resp.status_code == 200, resp.text
        log_row = await db_session.get(AgentRunLog, uuid.UUID(resp.json()["log_id"]))
        assert log_row is not None
        assert log_row.content_redacted == ""
        assert log_row.metadata_ is not None
        assert log_row.metadata_["attachments"][0]["file_id"] == str(att.id)

    async def test_empty_content_without_attachments_still_400(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """无附件纯空 content → 400 既有语义零回归。"""
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, workspace_id=env.ws.id)
        resp = await _send_message(client, env.owner_token, data["id"], "   ")
        assert resp.status_code == 400
        assert "不能为空" in resp.json()["message"]


# ── 触发透传（首轮懒建 / 复用注入 / 引擎门控）────────────────────────────────


class TestGroupAttachmentTrigger:
    async def test_first_round_inject_carries_attachments(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
        mocked_group_redis,
        mocked_storage,
    ) -> None:
        """首轮懒建：prompt 末尾附件提示行 + SESSION_INJECT payload attachments。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            workspace_id=env.ws.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])
        att = await _seed_attachment(db_session, env.owner.id)

        resp = await _send_message(client, env.owner_token, group_id, "@小码 看附件", [att.id])
        assert resp.status_code == 200, resp.text
        trigger = resp.json()["triggered"][0]

        # 首轮 user_input：prompt 末尾附件提示行（[附件] name (file_id)）。
        log_rows = list(
            (
                await db_session.execute(
                    select(AgentRunLog).where(AgentRunLog.run_id == uuid.UUID(trigger["run_id"]))
                )
            )
            .scalars()
            .all()
        )
        assert len(log_rows) == 1
        content = log_rows[0].content_redacted or ""
        assert f"[附件] 需求文档.pdf ({att.id})" in content
        assert "[当前消息附件" in content

        # SESSION_INJECT payload：attachments 列表（组装产物 disk 形态——无
        # 供应商行 gate 保守不支持 → 文件/PDF 均落盘）。
        commands = await _inject_commands(db_session, env.runtime.id)
        assert commands, "未下发 SESSION_INJECT"
        payload = commands[0].payload
        assert payload is not None
        assert payload["attachments"] == [
            {
                "id": str(att.id),
                "kind": "file",
                "media_type": "application/pdf",
                "name": "需求文档.pdf",
                "bytes": 128,
                "deliver": "disk",
                "object_key": att.object_key,
            }
        ]

    async def test_reuse_inject_carries_attachments_with_owner_override(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
        mocked_group_redis,
        mocked_storage,
    ) -> None:
        """复用注入：标记行 + attachments + 归属覆盖（发送者≠影子属主群主）。"""
        env = await _make_env(db_session)
        sender, sender_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            workspace_id=env.ws.id,
            user_members=[{"user_id": str(sender.id)}],
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])
        member = await _agent_member_row(db_session, group_id)
        shadow = await _seed_idle_shadow(
            db_session,
            member=member,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
        )
        # 附件属主=普通成员发送者（影子属主是群主——归属覆盖必须生效才不误 404）。
        att = await _seed_attachment(db_session, sender.id)

        resp = await _send_message(client, sender_token, group_id, "@小码 看这个", [att.id])
        assert resp.status_code == 200, resp.text
        trigger = resp.json()["triggered"][0]
        assert trigger["queued"] is False
        assert trigger["shadow_session_id"] == str(shadow.id)

        # 复用轮 user_input：单聊 D-3 标记行（[附件:id|kind|name]）+ 群链路
        # metadata（发送者=实际发送者）。
        log_rows = list(
            (
                await db_session.execute(
                    select(AgentRunLog).where(AgentRunLog.run_id == uuid.UUID(trigger["run_id"]))
                )
            )
            .scalars()
            .all()
        )
        assert len(log_rows) == 1
        content = log_rows[0].content_redacted or ""
        assert f"[附件:{att.id}|file|需求文档.pdf]" in content
        assert log_rows[0].metadata_ is not None
        assert log_rows[0].metadata_["sender_user_id"] == str(sender.id)

        # SESSION_INJECT payload attachments 透传。
        commands = await _inject_commands(db_session, env.runtime.id)
        assert commands, "未下发 SESSION_INJECT"
        payload = commands[-1].payload
        assert payload is not None
        assert payload["attachments"][0]["id"] == str(att.id)
        assert payload["attachments"][0]["deliver"] == "disk"

    async def test_non_claude_member_rejects_attachments_400(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
        mocked_group_redis,
    ) -> None:
        """codex 成员 + 附件 → 400（引擎门控下沉触发侧；消息已落时间线）。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            workspace_id=env.ws.id,
            agent_members=[_agent_config(env.runtime.id, name="小柯", provider="codex")],
        )
        group_id = uuid.UUID(data["id"])
        att = await _seed_attachment(db_session, env.owner.id)

        resp = await _send_message(client, env.owner_token, group_id, "@小柯 看附件", [att.id])
        assert resp.status_code == 400, resp.text
        assert "不支持附件" in resp.json()["message"]

        # 失败语义（design §4.1）：载体消息已在时间线（附件已绑定群会话）。
        group = await db_session.get(AgentGroupChat, group_id)
        carriers = list(
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == group.session_id)
                )
            )
            .scalars()
            .all()
        )
        assert len(carriers) == 1
        bound = (
            (
                await db_session.execute(
                    select(SessionAttachment)
                    .where(SessionAttachment.id == att.id)
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .one()
        )
        assert bound.session_id == group.session_id
