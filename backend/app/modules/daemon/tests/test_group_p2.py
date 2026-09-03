"""quick 群 P2 测试（2026-09-02）：置顶消息 / typing 草稿预览默认关 /
触发失败部分收集（triggered[].error + 群频道系统行）/ @我扫描窗口扩 200；
第二波三项：@全体并行触发 / 消息引用回复 / 未读位点。

覆盖：

- 置顶（``PUT/DELETE /group-chats/{gid}/pinned``）：群主置顶成功（快照字段
  log_id/pinned_by/pinned_at/content/member_name + 群频道系统行「置顶了一
  条消息」）；群列表/详情 Read 透出 ``pinned``；DELETE 取消（系统行 + Read 归
  None + 幂等重放不再发系统行）；普通成员 → 403；跨群 log → 404；脏快照
  （``_group_pinned_snapshot``）防御性回落 None；
- typing 草稿预览：默认（``typing_preview`` 缺省）入参 preview 被丢弃
  （payload preview=None）；PATCH ``settings_json.typing_preview`` 开启后透传
  （400 字上限内）；PATCH 非布尔值 → 400 中文；
- 触发失败部分收集：mock ``_trigger_group_member`` 抛 ``SESSION_LIMIT_
  REACHED`` 码 AppError（daemon 会话闸满在后端的形态）→ 消息仍 200 +
  ``triggered[].error`` 中文映射摘要 + 群频道系统行「成员「X」触发失败：…」；
  附件引擎门控（@ 两成员一 Claude 一 Codex 带附件）→ 200 + Claude 触发成功
  （error=None）+ Codex 项 ``error`` 摘要（其余成员照常触发，消息已落时间线）；
- @我扫描窗口（``GROUP_LAST_MENTION_SCAN_ROWS`` 20 → 200）：@ 后造 150 条
  噪音（@ 行落在最近第 151 条，旧 20 窗口外、新 200 窗口内）→ 群列表
  ``last_mention`` 命中；monkeypatch 回 20 反证窗口查询 limit 联动常量；
- @全体并行触发（第二波）：mock 两成员触发各 sleep 0.2 → 总耗时 < 0.35s
  （顺序执行地板 0.4s+）+ 两成员都触发 + ``triggered`` 按成员序（joined_at）
  重排（gather 保序）；
- 消息引用回复（第二波）：带 ``reply_to_log_id`` 发送 → user_input 行
  metadata ``reply_to: {log_id, member_name, content_head(60)}`` + 群频道 log
  事件 payload 透传同结构；无引用零漂移（键不出现）；跨群 log → 404；
- 未读位点（第二波）：``last_read_at`` 为 null → 未读数=全量（cap 99+）；
  ``PUT /read`` 后 unread_count=0（成员行位点落库）；新消息后 +1；发送即
  已读（发送者自身不计未读）；群详情同款字段。

夹具范式镜像 ``test_group_p1.py``（httpx ASGI + 手签 JWT + ws_hub/readiness/
redis/storage mock + GLM 离线铁律）。
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock
from unittest.mock import patch as mock_patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.daemon.group.service as group_service_module
from app.core.errors import AppError
from app.modules.agent.model import (
    AgentGroupChat,
    AgentGroupMember,
    AgentRun,
    AgentRunLog,
)
from app.modules.daemon.group.service import (
    GROUP_LAST_MENTION_SCAN_ROWS,
    GroupChatService,
    GroupMemberTriggerRead,
    _group_pinned_snapshot,
    _group_typing_preview_enabled,
)
from app.modules.daemon.tests.test_group_attachments import (
    _agent_member_row,
    _create_group,
    _seed_attachment,
)
from app.modules.daemon.tests.test_group_direct import _env_user, _make_env

# ── 共用 mock 夹具（镜像 test_group_p1.py）──────────────────────────────────


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
    """群 service 侧 Redis 替身（链登记 ping / 群频道 publish 断言源）。"""
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


@pytest.fixture()
def mocked_storage():
    """附件对象存储读打桩（多模态块读 bytes，不打桩会打真 MinIO）。"""
    backend = MagicMock()
    backend.read_bytes = AsyncMock(return_value=b"x" * 16)
    with mock_patch("app.modules.storage.factory.get_storage_backend", return_value=backend):
        yield backend


# ── 端点 helper ──────────────────────────────────────────────────────────────


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _agent_config(runtime_id: uuid.UUID, name: str = "小码", provider: str = "claude") -> dict:
    return {"display_name": name, "runtime_id": str(runtime_id), "provider": provider}


async def _send_message(
    client: AsyncClient,
    token: str,
    group_id: uuid.UUID | str,
    content: str,
    attachment_ids: list[uuid.UUID] | None = None,
    reply_to_log_id: uuid.UUID | None = None,
):
    body: dict = {"content": content}
    if attachment_ids:
        body["attachment_ids"] = [str(a) for a in attachment_ids]
    if reply_to_log_id is not None:
        body["reply_to_log_id"] = str(reply_to_log_id)
    return await client.post(
        f"/api/daemon/group-chats/{group_id}/messages", json=body, headers=_headers(token)
    )


async def _mark_read(client: AsyncClient, token: str, group_id: uuid.UUID | str):
    return await client.put(f"/api/daemon/group-chats/{group_id}/read", headers=_headers(token))


async def _send_typing(
    client: AsyncClient,
    token: str,
    group_id: uuid.UUID | str,
    *,
    preview: str | None = None,
):
    body: dict = {"typing": True}
    if preview is not None:
        body["preview"] = preview
    return await client.post(
        f"/api/daemon/group-chats/{group_id}/typing", json=body, headers=_headers(token)
    )


async def _pin(
    client: AsyncClient,
    token: str,
    group_id: uuid.UUID | str,
    log_id: uuid.UUID | str,
):
    return await client.put(
        f"/api/daemon/group-chats/{group_id}/pinned",
        json={"log_id": str(log_id)},
        headers=_headers(token),
    )


async def _unpin(client: AsyncClient, token: str, group_id: uuid.UUID | str):
    return await client.delete(
        f"/api/daemon/group-chats/{group_id}/pinned", headers=_headers(token)
    )


async def _patch_settings(
    client: AsyncClient, token: str, group_id: uuid.UUID | str, settings_json: dict
):
    return await client.patch(
        f"/api/daemon/group-chats/{group_id}",
        json={"settings_json": settings_json},
        headers=_headers(token),
    )


def _group_channel_payloads(redis: AsyncMock, group_id: uuid.UUID) -> list[dict]:
    """群频道 ``agent_session:{群id}`` 上全部已发布 payload。"""
    return [
        json.loads(call.args[1])
        for call in redis.publish.call_args_list
        if call.args[0] == f"agent_session:{group_id}"
    ]


def _system_lines(redis: AsyncMock, group_id: uuid.UUID) -> list[dict]:
    """群频道 ``channel='system'`` 系统行。"""
    return [
        p
        for p in _group_channel_payloads(redis, group_id)
        if p.get("event") == "log" and p.get("channel") == "system"
    ]


# ── 1. 置顶消息（PUT/DELETE /pinned + Read 透出 + 系统行）────────────────────


class TestGroupPinnedMessage:
    async def test_pin_and_read_exposure(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """群主置顶：响应快照五字段 + 群频道系统行 + 列表/详情 Read 透出。"""
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        group_id = uuid.UUID(data["id"])
        sent = await _send_message(client, env.owner_token, group_id, "重要结论：周会改到周三")
        assert sent.status_code == 200, sent.text
        log_id = sent.json()["log_id"]

        resp = await _pin(client, env.owner_token, group_id, log_id)
        assert resp.status_code == 200, resp.text
        pinned = resp.json()
        assert pinned["log_id"] == log_id
        assert pinned["pinned_by"] == str(env.owner.id)
        assert pinned["content"] == "重要结论：周会改到周三"
        assert pinned["member_name"] == "群主"  # 发送者成员行昵称快照
        assert pinned["pinned_at"]

        # 群频道系统行（ephemeral）。
        lines = _system_lines(mocked_group_redis, group_id)
        assert any("群主 置顶了一条消息" in line["content"] for line in lines)

        # 详情 + 列表 Read 透出 pinned。
        detail = await client.get(
            f"/api/daemon/group-chats/{group_id}", headers=_headers(env.owner_token)
        )
        assert detail.status_code == 200, detail.text
        assert detail.json()["pinned"]["log_id"] == log_id
        listing = await client.get("/api/daemon/group-chats", headers=_headers(env.owner_token))
        assert listing.status_code == 200, listing.text
        mine = next(g for g in listing.json() if g["id"] == str(group_id))
        assert mine["pinned"]["content"] == "重要结论：周会改到周三"

    async def test_unpin_clears_and_is_idempotent(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """DELETE 取消置顶：204 + 系统行 + Read 归 None；重放幂等不再发系统行。"""
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        group_id = uuid.UUID(data["id"])
        sent = await _send_message(client, env.owner_token, group_id, "置我")
        log_id = sent.json()["log_id"]
        assert (await _pin(client, env.owner_token, group_id, log_id)).status_code == 200

        resp = await _unpin(client, env.owner_token, group_id)
        assert resp.status_code == 204, resp.text
        detail = await client.get(
            f"/api/daemon/group-chats/{group_id}", headers=_headers(env.owner_token)
        )
        assert detail.json()["pinned"] is None

        lines = _system_lines(mocked_group_redis, group_id)
        assert any("群主 取消了置顶消息" in line["content"] for line in lines)

        # 幂等重放：再次 DELETE 仍 204，但不重复发系统行。
        before = len(lines)
        resp = await _unpin(client, env.owner_token, group_id)
        assert resp.status_code == 204, resp.text
        assert len(_system_lines(mocked_group_redis, group_id)) == before

    async def test_pin_requires_owner_403(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """普通成员置顶 → 403（看得到但动不了；系统行零发布）。"""
        env = await _make_env(db_session)
        peer, peer_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(peer.id)}],
        )
        group_id = uuid.UUID(data["id"])
        sent = await _send_message(client, env.owner_token, group_id, "目标消息")
        resp = await _pin(client, peer_token, group_id, sent.json()["log_id"])
        assert resp.status_code == 403, resp.text
        assert "只有群主或工作区管理员" in resp.json()["message"]
        assert _system_lines(mocked_group_redis, group_id) == []

    async def test_pin_cross_group_log_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """跨群 log（B 群消息拿到 A 群置顶）→ 404 不泄露。"""
        env = await _make_env(db_session)
        group_a = await _create_group(client, env.owner_token, project_id=env.project.id)
        group_b = await _create_group(client, env.owner_token, project_id=env.project.id)
        sent_b = await _send_message(client, env.owner_token, group_b["id"], "B 群的消息")
        resp = await _pin(client, env.owner_token, group_a["id"], sent_b.json()["log_id"])
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_GROUP_MESSAGE_NOT_FOUND"
        # A 群 settings_json 未被写入（populate_existing 刷新读最新值）。
        row = (
            (
                await db_session.execute(
                    select(AgentGroupChat)
                    .where(AgentGroupChat.id == uuid.UUID(group_a["id"]))
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .one()
        )
        assert (row.settings_json or {}).get("pinned") is None

    def test_dirty_pinned_snapshot_falls_back_none(self) -> None:
        """脏快照（缺字段/非 UUID/非 dict）读取侧防御性回落 None。"""
        assert _group_pinned_snapshot(AgentGroupChat()) is None
        assert _group_pinned_snapshot(AgentGroupChat(settings_json={})) is None
        assert _group_pinned_snapshot(AgentGroupChat(settings_json={"pinned": "bad"})) is None
        assert (
            _group_pinned_snapshot(AgentGroupChat(settings_json={"pinned": {"log_id": "x"}}))
            is None
        )
        ok = AgentGroupChat(
            settings_json={
                "pinned": {
                    "log_id": str(uuid.uuid4()),
                    "pinned_by": str(uuid.uuid4()),
                    "pinned_at": datetime.now(UTC).isoformat(),
                    "content": "有效快照",
                    "member_name": "群主",
                }
            }
        )
        assert _group_pinned_snapshot(ok) is not None


# ── 2. typing 草稿预览默认关（settings_json.typing_preview）──────────────────


class TestTypingPreviewDefaultOff:
    async def test_default_drops_preview_then_patch_enables(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """默认关：入参 preview 被丢（payload None）；PATCH 开启后原样透传。"""
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        group_id = uuid.UUID(data["id"])

        resp = await _send_typing(client, env.owner_token, group_id, preview="我的草稿内容")
        assert resp.status_code == 204, resp.text
        typing_channel = f"group_typing:{group_id}"
        events = [
            json.loads(call.args[1])
            for call in mocked_group_redis.publish.call_args_list
            if call.args[0] == typing_channel
        ]
        assert len(events) == 1
        assert events[0]["preview"] is None, "默认关：入参草稿应被丢弃"

        # PATCH 开启 → 透传（400 字上限内）。
        resp = await _patch_settings(client, env.owner_token, group_id, {"typing_preview": True})
        assert resp.status_code == 200, resp.text
        resp = await _send_typing(client, env.owner_token, group_id, preview="草" * 400)
        assert resp.status_code == 204, resp.text
        events = [
            json.loads(call.args[1])
            for call in mocked_group_redis.publish.call_args_list
            if call.args[0] == typing_channel
        ]
        assert events[-1]["preview"] == "草" * 400

    async def test_patch_typing_preview_invalid_400(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """PATCH typing_preview 非布尔值 → 400 中文（fail-loud 不静默落库）。"""
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        resp = await _patch_settings(client, env.owner_token, data["id"], {"typing_preview": "yes"})
        assert resp.status_code == 400, resp.text
        assert "必须是布尔值" in resp.json()["message"]

    def test_helper_default_and_dirty_fallback(self) -> None:
        """读 helper：缺省/NULL/脏值（非 bool）一律 False（默认关）。"""
        assert _group_typing_preview_enabled(AgentGroupChat()) is False
        assert _group_typing_preview_enabled(AgentGroupChat(settings_json={})) is False
        assert (
            _group_typing_preview_enabled(AgentGroupChat(settings_json={"typing_preview": 1}))
            is False
        )
        assert (
            _group_typing_preview_enabled(AgentGroupChat(settings_json={"typing_preview": True}))
            is True
        )


# ── 3. 触发失败部分收集（triggered[].error + 群频道系统行）───────────────────


class TestTriggerFailurePartialCollection:
    async def test_session_limit_failure_collects_error(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """mock 触发抛 SESSION_LIMIT_REACHED 码 AppError：消息仍 200 + 该成员
        ``triggered`` 项带中文映射摘要 + 群频道系统行（用户可感沉默场景）。"""

        async def _gate_rejected(*_args: object, **_kwargs: object) -> None:
            raise AppError(
                "interactive session create failed (SESSION_LIMIT_REACHED)",
                code="SESSION_LIMIT_REACHED",
                http_status=400,
            )

        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])

        with mock_patch.object(GroupChatService, "_trigger_group_member", _gate_rejected):
            resp = await _send_message(client, env.owner_token, group_id, "@小码 帮我查下")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["triggered"]) == 1
        failed = body["triggered"][0]
        assert failed["member_name"] == "小码"
        assert failed["run_id"] is None
        assert failed["error"] == "机器会话数已达上限，请稍后再试"
        # 消息本体仍落时间线（log_id 可回查）。
        assert await db_session.get(AgentRunLog, uuid.UUID(body["log_id"])) is not None

        lines = _system_lines(mocked_group_redis, group_id)
        assert any("成员「小码」触发失败：机器会话数已达上限" in line["content"] for line in lines)

    async def test_rollback_failure_then_next_member_still_triggers(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
        mocked_group_redis,
    ) -> None:
        """懒建失败（机器离线 rollback 路径）后其余成员照常触发。

        失败子链 rollback 会 expire 会话内对象——验证刷新链（group/members
        重取）后第二成员仍触发成功（quick 群 P2 部分失败收集的 ORM 口径）。
        顺序确定性：小柯（离线机）先入群，小码（在线机）后加——@ 解析按
        joined_at 排序小柯先触发失败。
        """
        from datetime import timedelta

        from app.modules.daemon.model import DaemonRuntime

        env = await _make_env(db_session)
        offline_runtime = DaemonRuntime(
            id=uuid.uuid4(),
            daemon_instance_id=env.instance.id,
            user_id=env.owner.id,
            name="p2-offline-rt",
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
            agent_members=[_agent_config(offline_runtime.id, name="小柯")],
        )
        group_id = uuid.UUID(data["id"])
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"agent": _agent_config(env.runtime.id, name="小码")},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 201, resp.text

        resp = await _send_message(client, env.owner_token, group_id, "@小柯 @小码 都看下")
        assert resp.status_code == 200, resp.text
        triggered = {t["member_name"]: t for t in resp.json()["triggered"]}
        assert "不可用或未授权" in triggered["小柯"]["error"]
        assert triggered["小柯"]["run_id"] is None
        assert triggered["小码"]["error"] is None
        assert triggered["小码"]["run_id"] is not None, "rollback 后第二成员仍触发成功"
        # 失败成员零残留（不建影子）。
        member_ke = await _agent_member_row(db_session, group_id, display_name="小柯")
        assert member_ke.shadow_session_id is None

    async def test_attachment_partial_failure_other_members_still_trigger(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
        mocked_group_redis,
        mocked_storage,
    ) -> None:
        """@ 两成员（一 Claude 一 Codex）带附件：200 + Claude 触发成功
        （error=None）+ Codex 项 error 摘要——校验类错误不再整条 400。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[
                _agent_config(env.runtime.id, name="小码"),
                _agent_config(env.runtime.id, name="小柯", provider="codex"),
            ],
        )
        group_id = uuid.UUID(data["id"])
        att = await _seed_attachment(db_session, env.owner.id)

        resp = await _send_message(
            client, env.owner_token, group_id, "@小码 @小柯 看附件", [att.id]
        )
        assert resp.status_code == 200, resp.text
        triggered = {t["member_name"]: t for t in resp.json()["triggered"]}
        assert set(triggered) == {"小码", "小柯"}
        assert triggered["小码"]["error"] is None
        assert triggered["小码"]["run_id"] is not None, "Claude 成员照常触发"
        assert triggered["小柯"]["run_id"] is None
        assert "不支持附件" in triggered["小柯"]["error"]

        lines = _system_lines(mocked_group_redis, group_id)
        assert any("成员「小柯」触发失败" in line["content"] for line in lines)
        assert not any("成员「小码」触发失败" in line["content"] for line in lines)


# ── 4. @我扫描窗口扩 200（GROUP_LAST_MENTION_SCAN_ROWS）──────────────────────


class TestLastMentionScanWindow:
    async def test_mention_found_within_200_rows(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """@ 后造 150 条噪音：@ 行在最近第 151 条（旧 20 窗口外、新 200 内）
        → 群列表 ``last_mention`` 命中；monkeypatch 回 20 反证查询 limit 联动。"""
        assert GROUP_LAST_MENTION_SCAN_ROWS == 200
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        group_id = uuid.UUID(data["id"])
        sent = await _send_message(client, env.owner_token, group_id, "@群主 记得看周报")
        assert sent.status_code == 200, sent.text

        # 造 150 条噪音（直接落库：carrier run + user_input 行，时间戳在 @ 之后）。
        group = await db_session.get(AgentGroupChat, group_id)
        assert group is not None
        base = datetime.now(UTC) + timedelta(seconds=1)
        for i in range(150):
            now = base + timedelta(seconds=i)
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
            db_session.add(
                AgentRunLog(
                    id=uuid.uuid4(),
                    run_id=carrier.id,
                    channel="user_input",
                    content_redacted=f"闲聊噪音 {i}",
                    timestamp=now,
                    metadata_={"sender_user_id": str(env.owner.id), "sender_member_name": "群主"},
                )
            )
        await db_session.commit()

        listing = await client.get("/api/daemon/group-chats", headers=_headers(env.owner_token))
        assert listing.status_code == 200, listing.text
        mine = next(g for g in listing.json() if g["id"] == str(group_id))
        assert mine["last_mention"] is not None
        assert "记得看周报" in mine["last_mention"]["content"]
        assert mine["last_mention"]["member_name"] == "群主"

        # 反证：窗口回 20 时同数据集查不到（@ 行在第 151 条）——查询 limit 与
        # 常量同源联动的可观测证据。
        monkeypatch.setattr(group_service_module, "GROUP_LAST_MENTION_SCAN_ROWS", 20)
        assert await group_service_module.get_last_mention_previews(
            db_session, user_id=env.owner.id, group_ids=[group_id]
        ) == {group_id: None}


# ── 5. @全体并行触发（群 P2 第二波：gather + 每成员独立 session）────────────


class TestParallelMentionTrigger:
    async def test_two_members_trigger_in_parallel(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """mock 两成员触发各 sleep 0.2 → 总耗时 < 0.35s（顺序地板 0.4s+）+
        两成员都触发 + ``triggered`` 按成员序（joined_at）重排（gather 保序）。

        小柯先入群（建群初始成员）、小码后加（POST members）——@ 解析排序
        按成员序小柯在前；并行下触发结果仍按该序回排。"""

        async def _slow_trigger(self, *, member, **_kwargs):
            await asyncio.sleep(0.2)
            return GroupMemberTriggerRead(
                member_id=member.id,
                member_name=member.display_name,
                shadow_session_id=member.shadow_session_id,
                queued=False,
            )

        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id, name="小柯")],
        )
        group_id = uuid.UUID(data["id"])
        resp = await client.post(
            f"/api/daemon/group-chats/{group_id}/members",
            json={"agent": _agent_config(env.runtime.id, name="小码")},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 201, resp.text

        with mock_patch.object(GroupChatService, "_trigger_group_member", _slow_trigger):
            started = time.perf_counter()
            resp = await _send_message(client, env.owner_token, group_id, "@全体 都看下")
            elapsed = time.perf_counter() - started
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert elapsed < 0.35, f"两成员各 0.2s 应并行（实测 {elapsed:.3f}s）"
        assert [t["member_name"] for t in body["triggered"]] == ["小柯", "小码"]
        assert all(t["error"] is None for t in body["triggered"])
        assert all(t["run_id"] is None for t in body["triggered"])  # mock 无 run


# ── 6. 消息引用回复（群 P2 第二波：reply_to_log_id 快照 + 事件透传）─────────


class TestReplyToMessage:
    async def test_reply_metadata_and_payload_passthrough(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """带 reply_to_log_id 发送：user_input 行 metadata ``reply_to`` 快照
        （log_id/成员名/60 字头截断）+ 群频道 log 事件 payload 透传同结构；
        无引用的普通消息零漂移（键不出现）。"""
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        group_id = uuid.UUID(data["id"])
        original = "原始结论：" + "接口地址与鉴权方案都要按新规范调整" * 5  # >60 字
        sent_a = await _send_message(client, env.owner_token, group_id, original)
        assert sent_a.status_code == 200, sent_a.text
        log_id_a = sent_a.json()["log_id"]

        sent_b = await _send_message(
            client, env.owner_token, group_id, "引用回复：确认这条", reply_to_log_id=log_id_a
        )
        assert sent_b.status_code == 200, sent_b.text
        log_id_b = sent_b.json()["log_id"]

        expected = {
            "log_id": log_id_a,
            "member_name": "群主",
            "content_head": original.strip()[:60],
        }
        row_b = await db_session.get(AgentRunLog, uuid.UUID(log_id_b))
        assert row_b is not None
        assert (row_b.metadata_ or {})["reply_to"] == expected

        # 群频道 log 事件 payload 透传同结构（按 log_id 定位本条事件）。
        payload_b = next(
            p
            for p in _group_channel_payloads(mocked_group_redis, group_id)
            if p.get("event") == "log" and p.get("log_id") == log_id_b
        )
        assert payload_b["reply_to"] == expected

        # 无引用零漂移：普通消息的 metadata 与事件不带 reply_to 键。
        row_a = await db_session.get(AgentRunLog, uuid.UUID(log_id_a))
        assert row_a is not None
        assert "reply_to" not in (row_a.metadata_ or {})
        payload_a = next(
            p
            for p in _group_channel_payloads(mocked_group_redis, group_id)
            if p.get("event") == "log" and p.get("log_id") == log_id_a
        )
        assert "reply_to" not in payload_a

    async def test_reply_cross_group_log_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """跨群 log（B 群消息拿到 A 群引用）→ 404 不泄露；零时间线残留。"""
        env = await _make_env(db_session)
        group_a = await _create_group(client, env.owner_token, project_id=env.project.id)
        group_b = await _create_group(client, env.owner_token, project_id=env.project.id)
        sent_b = await _send_message(client, env.owner_token, group_b["id"], "B 群的消息")
        resp = await _send_message(
            client,
            env.owner_token,
            group_a["id"],
            "引用 B 群消息",
            reply_to_log_id=sent_b.json()["log_id"],
        )
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_GROUP_MESSAGE_NOT_FOUND"
        # A 群时间线零残留（引用消息整条拒绝，不落半截）。
        rows = (
            (
                await db_session.execute(
                    select(AgentRunLog)
                    .join(AgentRun, AgentRunLog.run_id == AgentRun.id)
                    .where(AgentRun.agent_session_id == uuid.UUID(group_a["id"]))
                )
            )
            .scalars()
            .all()
        )
        assert rows == []


# ── 7. 未读位点（群 P2 第二波：last_read_at / PUT read / unread_count）──────


class TestUnreadPosition:
    async def test_unread_flow_mark_read_and_new_message(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """未读全流程：last_read_at null → 全量未读；PUT read → 0（成员行
        位点落库）；新消息 → +1；发送即已读（发送者自身不计）；详情同款。"""
        env = await _make_env(db_session)
        peer, peer_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(peer.id)}],
        )
        group_id = uuid.UUID(data["id"])
        for i in range(3):
            resp = await _send_message(client, env.owner_token, group_id, f"通知 {i}")
            assert resp.status_code == 200, resp.text

        async def _peer_item() -> dict:
            listing = await client.get("/api/daemon/group-chats", headers=_headers(peer_token))
            assert listing.status_code == 200, listing.text
            return next(g for g in listing.json() if g["id"] == str(group_id))

        # 初始（last_read_at null）：全量未读 + 最新消息时间戳透出。
        mine = await _peer_item()
        assert mine["unread_count"] == 3
        assert mine["last_message_at"] is not None
        # 发送即已读：发送者自身视角未读恒 0。
        owner_listing = await client.get(
            "/api/daemon/group-chats", headers=_headers(env.owner_token)
        )
        owner_mine = next(g for g in owner_listing.json() if g["id"] == str(group_id))
        assert owner_mine["unread_count"] == 0

        # PUT read → 位点落库 + 未读清零（幂等重放仍 204）。
        resp = await _mark_read(client, peer_token, group_id)
        assert resp.status_code == 204, resp.text
        assert (await _mark_read(client, peer_token, group_id)).status_code == 204
        member_row = (
            (
                await db_session.execute(
                    select(AgentGroupMember)
                    .where(
                        AgentGroupMember.group_id == group_id,
                        AgentGroupMember.user_id == peer.id,
                    )
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .one()
        )
        assert member_row.last_read_at is not None
        assert (await _peer_item())["unread_count"] == 0

        # 新消息 → 未读 +1；群详情同款字段。
        resp = await _send_message(client, env.owner_token, group_id, "追加通知")
        assert resp.status_code == 200, resp.text
        assert (await _peer_item())["unread_count"] == 1
        detail = await client.get(
            f"/api/daemon/group-chats/{group_id}", headers=_headers(peer_token)
        )
        assert detail.status_code == 200, detail.text
        assert detail.json()["unread_count"] == 1
        assert detail.json()["last_message_at"] is not None

    async def test_unread_count_capped_at_99(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """未读 cap：120 条时间线（从未标记已读）→ unread_count == 99（99+）。"""
        env = await _make_env(db_session)
        data = await _create_group(client, env.owner_token, project_id=env.project.id)
        group_id = uuid.UUID(data["id"])
        group = await db_session.get(AgentGroupChat, group_id)
        assert group is not None
        base = datetime.now(UTC)
        for i in range(120):
            now = base + timedelta(seconds=i)
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
            db_session.add(
                AgentRunLog(
                    id=uuid.uuid4(),
                    run_id=carrier.id,
                    channel="user_input",
                    content_redacted=f"刷屏 {i}",
                    timestamp=now,
                    metadata_={"sender_user_id": str(env.owner.id), "sender_member_name": "群主"},
                )
            )
        await db_session.commit()

        assert await group_service_module.get_group_unread_counts(
            db_session, user_id=env.owner.id, group_ids=[group_id]
        ) == {group_id: 99}


class TestListExtrasBatchedMultiGroup:
    """ql-20260903-024：三个列表数据族批量化后，多群不同位点的语义不回归。"""

    async def test_multi_group_thresholds_previews_mentions_batched(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_group_redis,
    ) -> None:
        """三群位点各异（全未读 / 全读后 +1 / 全读）——未读、最后消息摘要、
        最近 @我 三族批量结果互不串组。"""
        env = await _make_env(db_session)
        peer, peer_token = await _env_user(db_session, env, name="批读")
        ids = []
        for _ in range(3):
            data = await _create_group(
                client,
                env.owner_token,
                project_id=env.project.id,
                user_members=[{"user_id": str(peer.id)}],
            )
            ids.append(uuid.UUID(data["id"]))

        counter = {"i": 0}

        async def _seed(gid: uuid.UUID, contents: list[str], *, future: bool = False) -> None:
            group = await db_session.get(AgentGroupChat, gid)
            assert group is not None
            for text in contents:
                counter["i"] += 1
                now = (
                    datetime.now(UTC) + timedelta(seconds=counter["i"])
                    if future
                    else datetime.now(UTC) - timedelta(minutes=10) + timedelta(seconds=counter["i"])
                )
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
                db_session.add(
                    AgentRunLog(
                        id=uuid.uuid4(),
                        run_id=carrier.id,
                        channel="user_input",
                        content_redacted=text,
                        timestamp=now,
                        metadata_={
                            "sender_user_id": str(env.owner.id),
                            "sender_member_name": "群主",
                        },
                    )
                )
            await db_session.commit()

        # 群甲：3 条（最后一条 @peer）→ 全未读 + mention 命中。
        await _seed(ids[0], ["群甲-0", "群甲-1", "收到 @批读 请查收"])
        # 群乙：2 条 → 标记全读 → 未来时间戳 +1 条 → 未读 1。
        await _seed(ids[1], ["群乙-0", "群乙-1"])
        assert (await _mark_read(client, peer_token, ids[1])).status_code == 204
        await _seed(ids[1], ["群乙新-0"], future=True)
        # 群丙：5 条 → 标记全读 → 未读 0、无 mention。
        await _seed(ids[2], [f"群丙-{k}" for k in range(5)])
        assert (await _mark_read(client, peer_token, ids[2])).status_code == 204

        counts = await group_service_module.get_group_unread_counts(
            db_session, user_id=peer.id, group_ids=ids
        )
        assert counts == {ids[0]: 3, ids[1]: 1, ids[2]: 0}

        previews = await group_service_module.get_last_message_previews(db_session, ids)
        assert previews[ids[0]][0] == "收到 @批读 请查收"
        assert previews[ids[1]][0] == "群乙新-0"
        assert previews[ids[2]][0] == "群丙-4"
        assert all(previews[gid][1] is not None for gid in ids)

        mentions = await group_service_module.get_last_mention_previews(
            db_session, user_id=peer.id, group_ids=ids
        )
        assert mentions[ids[0]] is not None
        assert mentions[ids[0]]["member_name"] == "群主"
        assert mentions[ids[1]] is None
        assert mentions[ids[2]] is None
