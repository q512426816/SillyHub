"""quick 群 P1 三项测试（2026-09-02）：成员打断 / [[GROUP]] 兜底升级 / llm_provider 预检。

覆盖：

- 打断端点（``POST /group-chats/{gid}/members/{mid}/interrupt``）：普通成员
  打断 agent 成员活跃 run 成功（响应 DTO 四字段 + 群频道 ``channel='system'``
  系统行 + SESSION_INTERRUPT 控制指令送达 daemon——影子 run 状态不预置，
  由 daemon 侧打断结果驱动收口，此处断言指令已下发即打断生效前提）；
  影子存在但无活跃 run → 409「该成员当前没有运行中的任务」；影子未建 →
  同款 409；非群成员 → 404；打断用户成员 → 400；
- 兜底升级（run_sync ``_emit_group_mention_projection_fallback``）：@轮无
  标记 + 有 assistant 文本 → 投影行=首段摘要（剥 [ASSISTANT] 前缀、前 200
  字）+「…（完整内容见成员会话）」；thinking/工具行不进摘要（首段取首个
  可投影文本段）；整轮无可取文本 → 回退原模板行（保底不变）；
- llm_provider 预检：建群/加成员 agent 成员 ``llm_provider_id=None`` 不阻断，
  响应 ``warnings`` 含该成员提示；已指定模型 → 空 warnings。

quick 群 P1 第二批（2026-09-02，本文件追加）：

- 互@护栏参数群级可配：``settings_json.guardrails`` 读 helper（缺省/脏值回落
  默认 6/2/1800）+ PATCH 端点校验（范围外/未知键/非对象 400 中文）+ 字段级
  合并落库；判定点生效（限频超限提前、成员上限提前、链 TTL 群值）；
- 懒建行锁（并发双建修复）：懒建→复用幂等（一次影子）+ 锁重读拾取已提交
  指针（调用方持过期快照仍复用，不双建）；
- 用户 @ 入链 TTL 群级可配（登记 expire 用群值）。

夹具范式：端点侧镜像 ``test_group_direct.py``（httpx ASGI + 手签 JWT +
ws_hub/readiness/redis mock + GLM 离线铁律）；兜底侧镜像
``test_group_bridge_projection.py``（recording_redis 录制 pipeline sink）；
护栏判定侧镜像 ``test_group_cross_mention.py``（_FakeRedis + _seed_detection_env）。
"""

from __future__ import annotations

import json
import uuid
from unittest.mock import AsyncMock, MagicMock
from unittest.mock import patch as mock_patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentGroupChat, AgentGroupMember, AgentSession
from app.modules.daemon.control_commands import KIND_SESSION_INTERRUPT
from app.modules.daemon.group.service import (
    GROUP_CHAIN_TTL_SECONDS,
    GROUP_CROSS_MEMBER_TRIGGER_LIMIT,
    GROUP_RATE_LIMIT_PER_MINUTE,
    GroupChatService,
    _group_guardrail_settings,
    group_chain_key,
)
from app.modules.daemon.model import DaemonControlCommand
from app.modules.daemon.service import DaemonService
from app.modules.daemon.tests.test_group_cross_mention import (
    _FakeRedis,
    _mock_session_service,
    _run_detection,
    _seed_detection_env,
)
from app.modules.daemon.tests.test_group_direct import (
    _agent_config,
    _agent_member_row,
    _create_group,
    _env_user,
    _fetch_logs,
    _make_env,
    _seed_group_bridge,
    _send_message,
)

# ── 共用 mock 夹具（镜像 test_group_direct.py）──────────────────────────────


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


@pytest.fixture()
def guardrail_fake_redis():
    """群 service 侧 Redis 进程内替身（护栏状态全内存，镜像 test_group_cross_mention）。"""
    redis = _FakeRedis()
    with mock_patch("app.modules.daemon.group.service.get_redis", return_value=redis):
        yield redis


# ── Redis 录制（兜底升级用，对齐 test_group_bridge_projection.py）────────────


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
    yield_redis = AsyncMock()
    yield_redis.pipeline = MagicMock(side_effect=lambda: _RecordingPipeline([]))
    with (
        mock_patch("app.modules.daemon.run_sync.service.get_redis", return_value=yield_redis),
        mock_patch("app.modules.daemon.session.service.get_redis", return_value=yield_redis),
    ):
        yield yield_redis


# ── 端点 helper ──────────────────────────────────────────────────────────────


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _interrupt(
    client: AsyncClient,
    token: str,
    group_id: str,
    member_id: str,
):
    return await client.post(
        f"/api/daemon/group-chats/{group_id}/members/{member_id}/interrupt",
        headers=_headers(token),
    )


def _group_channel_system_lines(redis: AsyncMock, group_id: uuid.UUID) -> list[dict]:
    """群频道 ``agent_session:{群id}`` 上 channel='system' 的 log 事件。"""
    out = []
    for call in redis.publish.call_args_list:
        if call.args[0] != f"agent_session:{group_id}":
            continue
        payload = json.loads(call.args[1])
        if payload.get("event") == "log" and payload.get("channel") == "system":
            out.append(payload)
    return out


async def _seed_llm_provider(db_session: AsyncSession, user_id: uuid.UUID) -> uuid.UUID:
    from app.modules.llm_provider.model import LlmProvider

    provider_id = uuid.uuid4()
    db_session.add(
        LlmProvider(
            id=provider_id,
            user_id=user_id,
            name="p1-test-llm",
            agent_kind="claude",
            encrypted_api_key=b"test-key",
            key_id="test-key-id",
        )
    )
    await db_session.commit()
    return provider_id


# ── 1. 群内成员打断端点 ──────────────────────────────────────────────────────


class TestGroupMemberInterrupt:
    async def test_member_interrupts_active_run(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
        mocked_group_redis,
    ) -> None:
        """普通成员打断 agent 成员活跃 run：200 + 群频道系统行 + 控制指令送达。

        服务身份复用单聊 interrupt 路径（影子属主=群主），响应 run_id=被打断
        的活跃 run；影子 run 状态不预置（daemon 侧结果驱动收口），以
        SESSION_INTERRUPT 指令 delivered 为打断已下达的可观测证据。
        """
        env = await _make_env(db_session)
        peer, peer_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(peer.id)}],
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])

        # @ 触发懒建影子（首轮 run 恒 pending = 活跃轮）。
        resp = await _send_message(client, env.owner_token, data["id"], "@小码 建影子")
        assert resp.status_code == 200, resp.text
        trigger = resp.json()["triggered"][0]
        member = await _agent_member_row(db_session, group_id)

        resp = await _interrupt(client, peer_token, data["id"], str(member.id))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["member_id"] == str(member.id)
        assert body["display_name"] == "小码"
        assert body["run_id"] == trigger["run_id"]
        assert body["interrupted_by_name"] == "小英"

        # 群频道系统行（channel='system' 照限频提示先例，ephemeral 不落库）。
        system_lines = _group_channel_system_lines(mocked_group_redis, group_id)
        assert len(system_lines) == 1
        assert system_lines[0]["content"] == "小码 的当前任务已被 小英 打断"
        assert system_lines[0]["session_id"] == str(group_id)

        # SESSION_INTERRUPT 控制指令：落库 delivered + 指向影子会话（打断生效前提）。
        cmd = (
            (
                await db_session.execute(
                    select(DaemonControlCommand).where(
                        DaemonControlCommand.kind == KIND_SESSION_INTERRUPT
                    )
                )
            )
            .scalars()
            .one()
        )
        assert cmd.status == "delivered"
        cmd_payload = cmd.payload or {}
        assert cmd_payload["session_id"] == str(member.shadow_session_id)
        assert cmd_payload["runtime_id"] == str(env.runtime.id)

    async def test_interrupt_no_active_run_409(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
        mocked_group_redis,
    ) -> None:
        """影子存在但无活跃 run（已收口）→ 409「该成员当前没有运行中的任务」。"""
        from app.modules.daemon.tests.test_group_direct import _seed_shadow_with_active_run

        env = await _make_env(db_session)
        peer, peer_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(peer.id)}],
            agent_members=[_agent_config(env.runtime.id)],
        )
        member = await _agent_member_row(db_session, uuid.UUID(data["id"]))
        # 测试替身：影子会话 + 已收口（completed）run——无活跃轮可打断。
        await _seed_shadow_with_active_run(
            db_session,
            member=member,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
            run_status="completed",
        )

        resp = await _interrupt(client, peer_token, data["id"], str(member.id))
        assert resp.status_code == 409, resp.text
        assert "该成员当前没有运行中的任务" in resp.json()["message"]
        # 群频道零系统行（打断未发生）。
        assert _group_channel_system_lines(mocked_group_redis, uuid.UUID(data["id"])) == []

    async def test_interrupt_shadow_not_created_409(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
        mocked_group_redis,
    ) -> None:
        """影子未建（成员从未被 @ 触发）→ 同款 409（无运行中任务）。"""
        env = await _make_env(db_session)
        peer, peer_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(peer.id)}],
            agent_members=[_agent_config(env.runtime.id)],
        )
        member = await _agent_member_row(db_session, uuid.UUID(data["id"]))
        assert member.shadow_session_id is None

        resp = await _interrupt(client, peer_token, data["id"], str(member.id))
        assert resp.status_code == 409, resp.text
        assert "该成员当前没有运行中的任务" in resp.json()["message"]

    async def test_interrupt_non_member_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
        mocked_group_redis,
    ) -> None:
        """非群成员（未进成员表且非 admin）→ 404 不泄露群存在性。"""
        env = await _make_env(db_session)
        _outsider, outsider_token = await _env_user(db_session, env, name="路人")
        # 未把路人加进群。
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        member = await _agent_member_row(db_session, uuid.UUID(data["id"]))

        resp = await _interrupt(client, outsider_token, data["id"], str(member.id))
        assert resp.status_code == 404, resp.text

    async def test_interrupt_user_member_400(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
        mocked_group_redis,
    ) -> None:
        """打断目标为用户成员 → 400（仅 agent 成员支持打断任务）。"""
        env = await _make_env(db_session)
        peer, peer_token = await _env_user(db_session, env, name="小英")
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(peer.id)}],
            agent_members=[_agent_config(env.runtime.id)],
        )
        user_member_row = (
            (
                await db_session.execute(
                    select(AgentGroupMember).where(
                        AgentGroupMember.group_id == uuid.UUID(data["id"]),
                        AgentGroupMember.member_type == "user",
                        AgentGroupMember.user_id == peer.id,
                    )
                )
            )
            .scalars()
            .one()
        )

        resp = await _interrupt(client, peer_token, data["id"], str(user_member_row.id))
        assert resp.status_code == 400, resp.text
        assert "仅 agent 成员支持打断任务" in resp.json()["message"]


# ── 2. [[GROUP]] 忘标记兜底升级（run_sync 收口侧）─────────────────────────────


class TestProjectionFallbackSummary:
    async def test_fallback_summarizes_first_text_segment(
        self,
        db_session: AsyncSession,
        recording_redis,
    ) -> None:
        """@轮无标记 + 有 assistant 文本：兜底行=首段摘要（剥 [ASSISTANT] 前缀）
        +「…（完整内容见成员会话）」；thinking/工具行不进摘要。"""
        seed = await _seed_group_bridge(db_session)  # @轮（无 source 标记）
        svc = DaemonService(db_session)
        await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [
                {"event_type": "text", "content": "[THINKING] 先内部分析", "channel": "stdout"},
                {
                    "event_type": "tool_use",
                    "content": "[TOOL_USE] Bash: npm test",
                    "channel": "stdout",
                },
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 白屏根因：LoginForm.jsx:47 hooks 依赖缺失",
                    "channel": "stdout",
                },
            ],
        )
        assert await _fetch_logs(db_session, seed.carrier_run_id) == [], "无标记零投影"

        await svc.close_interactive_run(
            seed.lease_id,
            seed.shadow_run_id,
            seed.claim_token,
            status="success",
            is_error=False,
        )
        carrier_rows = await _fetch_logs(db_session, seed.carrier_run_id)
        assert len(carrier_rows) == 1
        fallback = carrier_rows[0]
        assert (
            fallback.content_redacted
            == "白屏根因：LoginForm.jsx:47 hooks 依赖缺失…（完整内容见成员会话）"
        )
        assert (fallback.metadata_ or {})["projection_fallback"] is True
        # 群频道事件同步新文案。
        system_logs = [
            json.loads(call.args[1])
            for call in recording_redis.publish.call_args_list
            if call.args[0] == f"agent_session:{seed.group_session_id}"
            and json.loads(call.args[1]).get("event") == "log"
        ]
        assert any(
            "白屏根因" in e["content"] and "完整内容见成员会话" in e["content"] for e in system_logs
        )

    async def test_fallback_summary_truncated_200(
        self,
        db_session: AsyncSession,
        recording_redis,
    ) -> None:
        """首段超长：摘要截前 200 字（超长部分不进兜底行）。"""
        from app.modules.daemon.run_sync.service import GROUP_FALLBACK_SUMMARY_CHARS

        seed = await _seed_group_bridge(db_session)
        svc = DaemonService(db_session)
        long_text = "长" * (GROUP_FALLBACK_SUMMARY_CHARS + 50)
        await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [
                {
                    "event_type": "text",
                    "content": f"[ASSISTANT] {long_text}",
                    "channel": "stdout",
                }
            ],
        )
        await svc.close_interactive_run(
            seed.lease_id,
            seed.shadow_run_id,
            seed.claim_token,
            status="success",
            is_error=False,
        )
        carrier_rows = await _fetch_logs(db_session, seed.carrier_run_id)
        assert len(carrier_rows) == 1
        expected = f"{'长' * GROUP_FALLBACK_SUMMARY_CHARS}…（完整内容见成员会话）"
        assert carrier_rows[0].content_redacted == expected

    async def test_fallback_no_text_uses_template(
        self,
        db_session: AsyncSession,
        recording_redis,
    ) -> None:
        """整轮无可取文本（纯 thinking/工具）→ 回退原模板行（保底不变）。"""
        from app.modules.daemon.run_sync.service import GROUP_PROJECTION_FALLBACK_TEMPLATE

        seed = await _seed_group_bridge(db_session)
        svc = DaemonService(db_session)
        await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [
                {"event_type": "text", "content": "[THINKING] 全程无正文输出", "channel": "stdout"},
                {
                    "event_type": "tool_use",
                    "content": "[TOOL_USE] Bash: ls",
                    "channel": "stdout",
                },
            ],
        )
        await svc.close_interactive_run(
            seed.lease_id,
            seed.shadow_run_id,
            seed.claim_token,
            status="success",
            is_error=False,
        )
        carrier_rows = await _fetch_logs(db_session, seed.carrier_run_id)
        assert len(carrier_rows) == 1
        assert carrier_rows[0].content_redacted == GROUP_PROJECTION_FALLBACK_TEMPLATE.format(
            member_name="小码"
        )
        assert (carrier_rows[0].metadata_ or {})["projection_fallback"] is True


# ── 3. 建群/加成员 llm_provider 预检 warnings ────────────────────────────────


class TestLlmProviderPrecheckWarnings:
    async def test_create_group_missing_llm_provider_warns(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """建群 agent 成员未指定模型：不阻断（201），响应 warnings 含该成员提示。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        assert data["warnings"] == [
            "成员「小码」未指定模型，将使用机器本机默认 LLM 出口"
            "（若不可用请先在成员配置中切换模型）"
        ]

    async def test_create_group_with_llm_provider_no_warning(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """agent 成员已指定模型 → 空 warnings（零提示）。"""
        env = await _make_env(db_session)
        provider_id = await _seed_llm_provider(db_session, env.owner.id)
        cfg = _agent_config(env.runtime.id)
        cfg["llm_provider_id"] = str(provider_id)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[cfg],
        )
        assert data["warnings"] == []

    async def test_add_member_missing_llm_provider_warns(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """加 agent 成员未指定模型：201 + warnings 含提示；已指定的成员零提示。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id, name="一号")],
        )
        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/members",
            json={"agent": _agent_config(env.runtime.id, name="二号")},
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["display_name"] == "二号"
        assert body["warnings"] == [
            "成员「二号」未指定模型，将使用机器本机默认 LLM 出口"
            "（若不可用请先在成员配置中切换模型）"
        ]

        # 加一个已指定模型的 agent 成员 → 零提示。
        provider_id = await _seed_llm_provider(db_session, env.owner.id)
        resp = await client.post(
            f"/api/daemon/group-chats/{data['id']}/members",
            json={
                "agent": {
                    **_agent_config(env.runtime.id, name="三号"),
                    "llm_provider_id": str(provider_id),
                }
            },
            headers=_headers(env.owner_token),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["warnings"] == []


# ── 4. 互@护栏参数群级可配（settings_json.guardrails，quick 群 P1 第二批）────


def _guardrail_notices(redis: _FakeRedis, group_id: uuid.UUID) -> list[dict]:
    """FakeRedis 发布流中群频道 ``channel='system'`` 的系统提示行。"""
    return [
        payload
        for channel, payload in redis.publishes
        if channel == f"agent_session:{group_id}" and payload.get("channel") == "system"
    ]


async def _patch_settings(
    client: AsyncClient, token: str, group_id: uuid.UUID | str, settings_json: dict
):
    return await client.patch(
        f"/api/daemon/group-chats/{group_id}",
        json={"settings_json": settings_json},
        headers=_headers(token),
    )


class TestGroupGuardrailSettingsHelper:
    def test_defaults_without_settings(self) -> None:
        """settings_json NULL / 空 dict / guardrails 非对象 → 全回落模块默认 6/2/1800。"""
        assert _group_guardrail_settings(AgentGroupChat()) == (
            GROUP_RATE_LIMIT_PER_MINUTE,
            GROUP_CROSS_MEMBER_TRIGGER_LIMIT,
            GROUP_CHAIN_TTL_SECONDS,
        )
        assert _group_guardrail_settings(AgentGroupChat(settings_json={})) == (6, 2, 1800)
        assert _group_guardrail_settings(AgentGroupChat(settings_json={"guardrails": "bad"})) == (
            6,
            2,
            1800,
        )

    def test_partial_override_and_dirty_fallback(self) -> None:
        """部分覆盖只改对应字段；脏值（字符串/bool/浮点）防御性回退默认。"""
        group = AgentGroupChat(settings_json={"guardrails": {"rate_limit_per_minute": 3}})
        assert _group_guardrail_settings(group) == (3, 2, 1800)
        dirty = AgentGroupChat(
            settings_json={
                "guardrails": {
                    "rate_limit_per_minute": "6",  # 字符串：手改库脏值
                    "member_trigger_limit": True,  # bool 是 int 子类，显式排除
                    "chain_ttl_seconds": 1.5,
                }
            }
        )
        assert _group_guardrail_settings(dirty) == (6, 2, 1800)


class TestGuardrailSettingsPatch:
    async def test_patch_guardrails_persists_field_level_merge(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """PATCH guardrails 子键：200 + 字段级合并落库（未传字段保留既有覆盖）。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        resp = await _patch_settings(
            client, env.owner_token, data["id"], {"guardrails": {"rate_limit_per_minute": 2}}
        )
        assert resp.status_code == 200, resp.text
        resp = await _patch_settings(
            client, env.owner_token, data["id"], {"guardrails": {"chain_ttl_seconds": 300}}
        )
        assert resp.status_code == 200, resp.text
        row = (
            (
                await db_session.execute(
                    select(AgentGroupChat)
                    .where(AgentGroupChat.id == uuid.UUID(data["id"]))
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .one()
        )
        assert row.settings_json == {
            "guardrails": {"rate_limit_per_minute": 2, "chain_ttl_seconds": 300}
        }

    @pytest.mark.parametrize(
        ("settings_json", "fragment"),
        [
            ({"guardrails": {"rate_limit_per_minute": 0}}, "取值需在 1-60"),
            ({"guardrails": {"rate_limit_per_minute": 61}}, "取值需在 1-60"),
            ({"guardrails": {"member_trigger_limit": 11}}, "取值需在 1-10"),
            ({"guardrails": {"member_trigger_limit": "2"}}, "取值需在 1-10"),
            ({"guardrails": {"chain_ttl_seconds": 100}}, "取值需在 300-7200"),
            ({"guardrails": {"unknown_key": 1}}, "未知的互@护栏参数"),
            ({"guardrails": "bad"}, "必须是对象"),
            ({"unknown_top": 1}, "未知的群设置键"),
        ],
    )
    async def test_patch_guardrails_invalid_400(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        settings_json: dict,
        fragment: str,
    ) -> None:
        """非法值/未知键/非对象 → 400 中文提示（fail-loud，不静默落库死配置）。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        resp = await _patch_settings(client, env.owner_token, data["id"], settings_json)
        assert resp.status_code == 400, resp.text
        assert fragment in resp.json()["message"]
        row = (
            (
                await db_session.execute(
                    select(AgentGroupChat).where(AgentGroupChat.id == uuid.UUID(data["id"]))
                )
            )
            .scalars()
            .one()
        )
        assert row.settings_json is None, "非法请求零残留"


class TestGuardrailSettingsEnforcement:
    """判定点生效：限频/成员上限/链 TTL 换用群级覆盖值（缺省回落默认）。"""

    async def test_rate_limit_override_blocks_third(
        self,
        db_session: AsyncSession,
        guardrail_fake_redis: _FakeRedis,
    ) -> None:
        """自定义 rate=2：窗口内第 3 次触发跳过 + 群内系统提示（默认 6 不会拦）。"""
        seeded = await _seed_detection_env(db_session)
        seeded.group.settings_json = {"guardrails": {"rate_limit_per_minute": 2}}
        db_session.add(seeded.group)
        await db_session.commit()

        rate_key = f"group_rate:{seeded.group.id}:{seeded.target_member.id}"
        guardrail_fake_redis._counters[rate_key] = 2  # 预置：本次 incr 后第 3 次
        service_cls, inject_mock = _mock_session_service()
        with mock_patch("app.modules.daemon.group.service.SessionService", service_cls):
            triggered = await _run_detection(db_session, seeded)
        assert triggered == []
        inject_mock.assert_not_called()
        notices = _guardrail_notices(guardrail_fake_redis, seeded.group.session_id)
        assert notices and "「小助」触发频率已达上限" in notices[0]["content"]

    async def test_default_rate_limit_allows_third(
        self,
        db_session: AsyncSession,
        guardrail_fake_redis: _FakeRedis,
    ) -> None:
        """缺省回落默认 6：窗口计数 2 时第 3 次仍放行（存量群零行为变化）。"""
        seeded = await _seed_detection_env(db_session)
        rate_key = f"group_rate:{seeded.group.id}:{seeded.target_member.id}"
        guardrail_fake_redis._counters[rate_key] = 2
        service_cls, inject_mock = _mock_session_service()
        with mock_patch("app.modules.daemon.group.service.SessionService", service_cls):
            triggered = await _run_detection(db_session, seeded)
        assert len(triggered) == 1, "默认限频 6 下第 3 次不应拦截"
        inject_mock.assert_called_once()

    async def test_member_trigger_override_blocks_second(
        self,
        db_session: AsyncSession,
        guardrail_fake_redis: _FakeRedis,
    ) -> None:
        """自定义 member_trigger=1：同链第 2 次互@跳过（默认 2 不会拦）。"""
        seeded = await _seed_detection_env(db_session)
        seeded.group.settings_json = {"guardrails": {"member_trigger_limit": 1}}
        db_session.add(seeded.group)
        await db_session.commit()

        await guardrail_fake_redis.hset(
            group_chain_key(seeded.carrier.id), str(seeded.target_member.id), "1"
        )
        service_cls, inject_mock = _mock_session_service()
        with mock_patch("app.modules.daemon.group.service.SessionService", service_cls):
            triggered = await _run_detection(db_session, seeded)
        assert triggered == []
        inject_mock.assert_not_called()

    async def test_default_member_trigger_allows_second(
        self,
        db_session: AsyncSession,
        guardrail_fake_redis: _FakeRedis,
    ) -> None:
        """缺省回落默认 2：同链计数 1 时第 2 次仍放行。"""
        seeded = await _seed_detection_env(db_session)
        await guardrail_fake_redis.hset(
            group_chain_key(seeded.carrier.id), str(seeded.target_member.id), "1"
        )
        service_cls, _inject_mock = _mock_session_service()
        with mock_patch("app.modules.daemon.group.service.SessionService", service_cls):
            triggered = await _run_detection(db_session, seeded)
        assert len(triggered) == 1, "默认成员上限 2 下第 2 次不应拦截"

    async def test_chain_ttl_override_refreshes_ttl(
        self,
        db_session: AsyncSession,
        guardrail_fake_redis: _FakeRedis,
    ) -> None:
        """自定义 chain_ttl=300：互@触发后链 TTL 刷新为群值（默认 1800 见既有用例）。"""
        seeded = await _seed_detection_env(db_session)
        seeded.group.settings_json = {"guardrails": {"chain_ttl_seconds": 300}}
        db_session.add(seeded.group)
        await db_session.commit()

        service_cls, _inject_mock = _mock_session_service()
        with mock_patch("app.modules.daemon.group.service.SessionService", service_cls):
            triggered = await _run_detection(db_session, seeded)
        assert len(triggered) == 1
        assert guardrail_fake_redis.ttls[group_chain_key(seeded.carrier.id)] == 300, (
            "链 TTL 应刷新为群级配置值"
        )


class TestChainRegistrationTtl:
    async def test_user_mention_registers_chain_with_configured_ttl(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
        mocked_group_redis,
    ) -> None:
        """群配 chain_ttl=300 后用户 @ 入链：登记 expire 用群值（非默认 1800）。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        resp = await _patch_settings(
            client, env.owner_token, data["id"], {"guardrails": {"chain_ttl_seconds": 300}}
        )
        assert resp.status_code == 200, resp.text

        resp = await _send_message(client, env.owner_token, data["id"], "@小码 看下这个")
        assert resp.status_code == 200, resp.text
        chain_expires = [
            call.args[1]
            for call in mocked_group_redis.expire.call_args_list
            if str(call.args[0]).startswith("group_chain:")
        ]
        assert chain_expires == [300], "入链登记 TTL 应为群级配置 300"


# ── 5. 懒建行锁（并发双建影子修复）───────────────────────────────────────────


class TestShadowLazyCreateRowLock:
    async def test_lazy_create_then_reuse_single_shadow(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
        mocked_group_redis,
    ) -> None:
        """懒建→复用幂等：两次 @ 触发同一成员只建一个影子，复用注入打同一会话。"""
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])

        resp = await _send_message(client, env.owner_token, data["id"], "@小码 第一问")
        assert resp.status_code == 200, resp.text
        first = resp.json()["triggered"][0]
        assert first["run_id"] is not None, "首次触发应懒建（返回首轮 run id）"

        # 复用轮打桩 SessionService（免真注入链路），断言注入打向同一影子。
        service_cls, inject_mock = _mock_session_service()
        with mock_patch("app.modules.daemon.group.service.SessionService", service_cls):
            resp = await _send_message(client, env.owner_token, data["id"], "@小码 第二问")
        assert resp.status_code == 200, resp.text
        second = resp.json()["triggered"][0]
        assert second["shadow_session_id"] == first["shadow_session_id"]
        assert inject_mock.await_args.args[0] == uuid.UUID(first["shadow_session_id"])

        shadows = (
            (
                await db_session.execute(
                    select(AgentSession).where(AgentSession.session_kind == "group_member")
                )
            )
            .scalars()
            .all()
        )
        assert len(shadows) == 1, "两次触发不得双建影子"
        member = await _agent_member_row(db_session, group_id)
        assert member.shadow_session_id == uuid.UUID(first["shadow_session_id"])

    async def test_locked_reread_reuses_committed_pointer(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        mocked_hub,
        readiness_ok,
        mocked_group_redis,
    ) -> None:
        """锁重读拾取已提交指针：调用方持过期成员快照（指针 None）仍复用不双建。

        这是并发双建修复的确定性等价断言——生产并发下第二个事务在成员行
        FOR UPDATE 等锁，首个事务 commit 回填指针后它读到指针直接复用；
        本用例以「identity map 外的过期成员对象」模拟第二个事务的快照。
        （真双协程事务并发在单连接内存 SQLite 上无法表达：StaticPool 共享
        单连接，两个 AsyncSession 并发执行会互相撕裂事务，不构成有效测试。）
        """
        env = await _make_env(db_session)
        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            agent_members=[_agent_config(env.runtime.id)],
        )
        group_id = uuid.UUID(data["id"])
        resp = await _send_message(client, env.owner_token, data["id"], "@小码 先建影子")
        assert resp.status_code == 200, resp.text
        first_shadow_id = resp.json()["triggered"][0]["shadow_session_id"]

        member = await _agent_member_row(db_session, group_id)
        assert member.shadow_session_id is not None, "前置：懒建已回填指针"
        # 构造过期成员快照：identity map 外的 transient 对象，指针仍 None
        # （模拟并发调用方在首建事务 commit 前读到的旧成员行）。
        stale = AgentGroupMember(
            id=member.id,
            group_id=member.group_id,
            member_type="agent",
            display_name=member.display_name,
            runtime_id=member.runtime_id,
            shadow_session_id=None,
            joined_at=member.joined_at,
        )
        group_row = await db_session.get(AgentGroupChat, group_id)
        assert group_row is not None

        svc = GroupChatService(db_session)
        shadow, first_run_id = await svc._ensure_shadow_session(
            group_row,
            stale,
            first_prompt="并发方 prompt",
            first_turn_metadata={},
        )
        assert first_run_id is None, "锁重读命中已回填指针 → 复用（非懒建）"
        assert shadow.id == uuid.UUID(first_shadow_id)
        shadows = (
            (
                await db_session.execute(
                    select(AgentSession).where(AgentSession.session_kind == "group_member")
                )
            )
            .scalars()
            .all()
        )
        assert len(shadows) == 1, "过期快照重入不得双建影子"
