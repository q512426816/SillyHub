"""task-05（2026-09-01-session-group-chat）桥接投影测试——design §5.2 两个改动点
（quick 投影统一标记制 2026-09-02 适配：@轮与直聊轮同款，仅 [[GROUP]] 段投影）。

覆盖（任务卡 acceptance）：

- 双写投影行：影子行 + 投影行共存无 PK 冲突（新 uuid id）、投影行 run_id=载体
  run、channel='stdout'、content=标记段剥离文本、metadata_ 身份齐全
  （member_id/member_name/source_log_id/projection）；段投影 dedup_key 恒 None
  （不撞载体 run 的 (run_id, dedup_key) 部分唯一索引）；
- 仅 assistant 文本投影：thinking / tool_call / [TOOL_USE] / stderr / [SYSTEM] /
  [TASK_*] 行不进群时间线（前端 classifySessionLog reply 口径复刻）；
- 群频道事件：publish_submitted_messages 群分支向 agent_session:{群id} 发 log
  事件，log_id=投影行 id（实时与回放读库同 id）+ 成员身份三字段；
- partial 不投影（标记可能被流式截断，完整行到达统一抽段）：override 到达
  仅撤影子 run 侧 partial、载体 run 恒零行、群频道零 stale 信号；
- 身份按落库时刻快照：成员改名后新行新名、旧行不回填；
- 非群场景（普通单聊 / worker 形态子会话）零行为变化——无投影行、PublishIntent
  群标量全空、无群频道事件；
- close_interactive_run：影子 run 收口 → 群频道 turn_completed 带
  member_id/member_name/member_session_id；非群会话不发（@轮无标记兜底行的
  专测见 test_group_direct.py）。

范式复用 test_run_sync_ctx_tokens.py（recording_redis 录制 pipeline sink）+
test_group_mention_pipeline.py（群/影子/载体 run 种子）。
"""

from __future__ import annotations

import json
import secrets
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import (
    AgentGroupChat,
    AgentGroupMember,
    AgentRun,
    AgentRunLog,
    AgentSession,
)
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.run_sync.service import publish_submitted_messages
from app.modules.daemon.service import DaemonService
from app.modules.workspace.model import Workspace

# segmentId 用 daemon 格式（${prefix}:${mid}:${type}，main 前缀 = 主 agent）。
SEG = "main:msg_abc123:text"


# ── 基础种子（对齐 test_run_sync_ctx_tokens.py / test_group_mention_pipeline.py）──


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"bridge-{uid}@example.com",
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
        name="bridge-daemon",
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
) -> SimpleNamespace:
    """落一套完整群桥接底座：群会话 + 群行 + agent 成员（带影子指针）+ 影子
    会话（kind='group_member'）+ 影子 run + 群载体 run + 影子 run 的 user_input
    轮链 metadata（task-03 写入口径）。

    submit_messages 判定链：影子会话 kind → 成员表反向指针 → user_input
    metadata_.source_carrier_run_id → 载体 run（投影行 run_id 指向）。
    """
    owner_id = await _create_user(db_session)
    rt = await _create_runtime(db_session, owner_id)
    ws = Workspace(
        id=uuid.uuid4(),
        name="bridge-ws",
        slug=f"bridge-ws-{uuid.uuid4().hex[:8]}",
        root_path="C:/tmp/bridge-ws",
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
            title="桥接测试群",
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
            title="桥接测试群",
            created_by=owner_id,
        )
    )
    await db_session.flush()

    # 载体 run（触发本轮的群消息载体，spec_strategy='group_carrier'）。
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

    # 影子会话 + lease（claim_token + 绑定 session_id——close_interactive_run
    # bind check 需要 lease.metadata.session_id == run.agent_session_id）。
    claim_token = secrets.token_hex(32)
    shadow_session_id = uuid.uuid4()
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=rt.id,
        kind="interactive",
        status="active",
        metadata_={
            "claim_token": claim_token,
            "session_id": str(shadow_session_id),
        },
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

    # agent 成员行（影子反向指针 §5.1）。
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

    # 影子 run（pending，submit_messages 首条消息推进 running）+ 本轮 user_input
    # 日志（轮链 metadata——投影判定链的载体 run 来源）。
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
    db_session.add(
        AgentRunLog(
            id=uuid.uuid4(),
            run_id=shadow_run_id,
            channel="user_input",
            content_redacted="@小码 帮我看下登录页白屏",
            timestamp=now,
            metadata_={
                "source_group_id": str(group_session_id),
                "source_member_id": str(member.id),
                "source_carrier_run_id": str(carrier_run_id),
                "chain_depth": 0,
                "sender_user_id": str(owner_id),
            },
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


async def _seed_plain_session(
    db_session: AsyncSession,
    *,
    parent_session_id: uuid.UUID | None = None,
) -> SimpleNamespace:
    """普通单聊（kind 默认 'chat'；parent 非 None = worker 形态子会话）。"""
    owner_id = await _create_user(db_session)
    rt = await _create_runtime(db_session, owner_id)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    claim_token = secrets.token_hex(32)
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=rt.id,
        kind="interactive",
        status="active",
        metadata_={"claim_token": claim_token, "session_id": str(session_id)},
        created_at=now,
        updated_at=now,
    )
    db_session.add(lease)
    await db_session.flush()
    db_session.add(
        AgentSession(
            id=session_id,
            user_id=owner_id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            status="active",
            turn_count=1,
            created_at=now,
            parent_session_id=parent_session_id,
        )
    )
    db_session.add(
        AgentRun(
            id=run_id,
            agent_type="claude_code",
            provider="claude",
            status="pending",
            spec_strategy="interactive",
            agent_session_id=session_id,
            user_id=owner_id,
        )
    )
    await db_session.commit()
    return SimpleNamespace(
        owner_id=owner_id,
        session_id=session_id,
        run_id=run_id,
        lease_id=lease.id,
        claim_token=claim_token,
    )


# ── Redis 录制（对齐 test_run_sync_ctx_tokens.py）────────────────────────────


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
    """录制 publish_submitted_messages 各路 publish（pipeline 批量 + 直发）。

    yield 出 (sink, redis)：sink 收 pipeline publish；redis.publish 为 AsyncMock
    （close_interactive_run 的 turn_completed 直发路径记录在 redis.publish）。
    """
    sink: list[tuple[str, str]] = []
    redis = AsyncMock()
    redis.pipeline = MagicMock(side_effect=lambda: _RecordingPipeline(sink))
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield sink, redis


@pytest.fixture()
def mocked_redis():
    """普通 AsyncMock redis（不需要检视 publish 内容的用例）。"""
    redis = AsyncMock()
    redis.pipeline = MagicMock(side_effect=lambda: _RecordingPipeline([]))
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
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


async def _fetch_stdout_logs(db_session: AsyncSession, run_id: uuid.UUID) -> list[AgentRunLog]:
    """影子 run 的 stdout 日志行（排除种子 user_input 轮链 metadata 行）。"""
    return [r for r in await _fetch_logs(db_session, run_id) if r.channel == "stdout"]


def _group_log_events(sink: list[tuple[str, str]], group_id: uuid.UUID) -> list[dict]:
    """解析群频道 agent_session:{group_id} 上的全部 log 事件 payload。"""
    channel = f"agent_session:{group_id}"
    return [
        json.loads(payload)
        for ch, payload in sink
        if ch == channel and json.loads(payload).get("event") == "log"
    ]


# ── 改动点①：submit_messages 事务内双写投影行 ─────────────────────────────────


class TestGroupBridgeDoubleWrite:
    """双写投影行——新 PK 共存、字段齐全、仅 assistant 文本 [[GROUP]] 段投影。"""

    async def test_projection_row_double_written_no_pk_conflict(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """影子行 + 投影行共存：新 uuid PK、run_id=载体 run、content=标记段
        剥离文本、dedup_key=None（段投影不携带，不同 run 本就不撞唯一索引）、
        metadata 身份齐全（member_id/member_name/source_log_id/projection）。"""
        seed = await _seed_group_bridge(db_session)
        svc = DaemonService(db_session)
        result = await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [
                {
                    "event_type": "text",
                    "content": (
                        "[ASSISTANT] 已定位：LoginForm.jsx:47 hooks 依赖缺失\n"
                        "[[GROUP]]登录页白屏根因：hooks 依赖缺失。[[/GROUP]]"
                    ),
                    "channel": "stdout",
                    "dedup_key": "dd-1",
                }
            ],
        )
        assert result == 1

        shadow_rows = await _fetch_stdout_logs(db_session, seed.shadow_run_id)
        assert len(shadow_rows) == 1
        shadow_row = shadow_rows[0]
        assert shadow_row.dedup_key == "dd-1"

        carrier_rows = await _fetch_logs(db_session, seed.carrier_run_id)
        assert len(carrier_rows) == 1, "assistant 文本应双写一段投影到载体 run"
        proj = carrier_rows[0]
        # 新 PK（≠影子行 id）+ 同事务共存（无 IntegrityError——提交成功即证）。
        assert proj.id != shadow_row.id
        assert proj.run_id == seed.carrier_run_id
        assert proj.channel == "stdout"
        assert proj.content_redacted == "登录页白屏根因：hooks 依赖缺失。"
        assert "[[GROUP]]" not in proj.content_redacted
        assert proj.dedup_key is None, "段投影 dedup_key 恒 None（同源多段不撞唯一索引）"
        assert proj.segment_id is None
        meta = proj.metadata_ or {}
        assert meta["member_id"] == str(seed.member.id)
        assert meta["member_name"] == "小码"
        assert meta["source_log_id"] == str(shadow_row.id)
        assert meta["projection"] is True

    async def test_only_assistant_text_projected(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """thinking / tool_call / [TOOL_USE] / [TOOL_RESULT] / stderr / [SYSTEM] /
        [TASK_*] 行照常落影子 run，但不投影进群时间线（仅 [[GROUP]] 段投影）。"""
        seed = await _seed_group_bridge(db_session)
        svc = DaemonService(db_session)
        result = await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [
                {"event_type": "text", "content": "[THINKING] 内部分析过程", "channel": "stdout"},
                {"event_type": "tool_use", "content": "[TOOL_USE] Bash: ls", "channel": "stdout"},
                {
                    "event_type": "tool_use",
                    "content": json.dumps({"tool": "Bash", "args": {"command": "ls"}}),
                    "channel": "tool_call",
                },
                {
                    "event_type": "tool_result",
                    "content": "[TOOL_RESULT] file1.py file2.py",
                    "channel": "stdout",
                },
                {"event_type": "error", "content": "boom", "channel": "stderr"},
                {"event_type": "text", "content": "[SYSTEM] session ready", "channel": "stdout"},
                {
                    "event_type": "text",
                    "content": '[TASK_STARTED] {"taskId":"t1"}',
                    "channel": "stdout",
                },
                {
                    "event_type": "text",
                    "content": "[[GROUP]]裸文本回复的标记段投影[[/GROUP]]",
                    "channel": "stdout",
                },
            ],
        )
        assert result == 8
        # 影子 run 落满 8 行（stdout/tool_call/stderr 全渠道，不含种子 user_input）。
        assert (
            len(
                [
                    r
                    for r in await _fetch_logs(db_session, seed.shadow_run_id)
                    if r.channel != "user_input"
                ]
            )
            == 8
        )

        carrier_rows = await _fetch_logs(db_session, seed.carrier_run_id)
        assert [r.content_redacted for r in carrier_rows] == ["裸文本回复的标记段投影"], (
            "仅 assistant 文本的 [[GROUP]] 标记段投影，过程信息一律不进群时间线"
        )

    async def test_group_channel_log_event_uses_projection_log_id(
        self, db_session: AsyncSession, recording_redis
    ) -> None:
        """群频道 log 事件 log_id=投影行 id（实时与回放读库同 id），payload 带
        成员身份三字段；非投影行不产生群频道事件。"""
        sink, _redis = recording_redis
        seed = await _seed_group_bridge(db_session)
        svc = DaemonService(db_session)
        result = await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 分析中\n[[GROUP]]修复完成[[/GROUP]]",
                    "channel": "stdout",
                    "usage": {"input_tokens": 10, "output_tokens": 5},
                },
                {"event_type": "text", "content": "[THINKING] 思考", "channel": "stdout"},
            ],
        )
        await publish_submitted_messages(result.publish_intent)

        proj_rows = await _fetch_logs(db_session, seed.carrier_run_id)
        assert len(proj_rows) == 1
        events = _group_log_events(sink, seed.group_session_id)
        assert len(events) == 1, "thinking 行不发群频道"
        event = events[0]
        assert event["log_id"] == str(proj_rows[0].id), "群事件 log_id 必须是投影行 id"
        assert event["session_id"] == str(seed.group_session_id)
        assert event["run_id"] == str(seed.shadow_run_id)
        assert event["channel"] == "stdout"
        assert event["content"] == "修复完成"
        assert event["member_id"] == str(seed.member.id)
        assert event["member_name"] == "小码"
        assert event["member_session_id"] == str(seed.shadow_session_id)

    async def test_partial_not_projected_override_keeps_carrier_empty(
        self, db_session: AsyncSession, recording_redis
    ) -> None:
        """partial 半截行不投影（标记可能被流式截断）；[ASSISTANT_OVERRIDE]
        信号到达仅撤影子 run 侧 partial——载体 run 恒零行、群频道零事件
        （partial 从未投影，无渲染可撤）。"""
        sink, _redis = recording_redis
        seed = await _seed_group_bridge(db_session)
        svc = DaemonService(db_session)

        first = await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 半截[[GRO",
                    "channel": "stdout",
                    "metadata": {"segmentId": SEG, "isPartial": True},
                }
            ],
        )
        await publish_submitted_messages(first.publish_intent)
        assert await _fetch_logs(db_session, seed.carrier_run_id) == [], "partial 不投影"
        assert _group_log_events(sink, seed.group_session_id) == [], "partial 不进群频道"

        second = await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [
                {
                    "event_type": "text",
                    "content": f"[ASSISTANT_OVERRIDE] {SEG}",
                    "channel": "stdout",
                    "metadata": {"segmentId": SEG, "stale": True},
                }
            ],
        )
        assert second == 0
        await publish_submitted_messages(second.publish_intent)

        assert await _fetch_logs(db_session, seed.carrier_run_id) == []
        # 群频道零事件（含 stale 令箭——群内无渲染可撤）。
        assert _group_log_events(sink, seed.group_session_id) == []
        # 影子 run 侧 partial 照常被既有机制 DELETE（override 信号语义保留）。
        shadow_partial = [
            r for r in await _fetch_logs(db_session, seed.shadow_run_id) if r.segment_id == SEG
        ]
        assert shadow_partial == []

    async def test_partial_then_complete_converges_to_segment_projection(
        self, db_session: AsyncSession, recording_redis
    ) -> None:
        """完整行迟到（跨 submit 调用）：影子 run 收敛只剩完整行（既有机制）；
        载体 run 由完整行统一抽段落一段投影行（segment_id=None）；群频道只发
        段事件、零 stale 令箭（partial 从未投影）。"""
        sink, _redis = recording_redis
        seed = await _seed_group_bridge(db_session)
        svc = DaemonService(db_session)

        await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 半截",
                    "channel": "stdout",
                    "metadata": {"segmentId": SEG, "isPartial": True},
                }
            ],
        )
        second = await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] 完整回复\n[[GROUP]]结论段：已修复[[/GROUP]]",
                    "channel": "stdout",
                    "metadata": {"segmentId": SEG, "isComplete": True},
                }
            ],
        )
        await publish_submitted_messages(second.publish_intent)

        carrier_rows = await _fetch_logs(db_session, seed.carrier_run_id)
        assert [r.content_redacted for r in carrier_rows] == ["结论段：已修复"]
        assert carrier_rows[0].segment_id is None
        # 群频道：仅完整行的段投影事件（无 stale 令箭——partial 从未投影）。
        events = _group_log_events(sink, seed.group_session_id)
        assert len(events) == 1
        assert events[0]["log_id"] == str(carrier_rows[0].id)
        assert events[0]["content"] == "结论段：已修复"
        assert all(e.get("stale") is not True for e in events)

    async def test_identity_snapshot_on_member_rename(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """身份按落库时刻快照：改名后新投影行用新名，历史行不回填。"""
        seed = await _seed_group_bridge(db_session)
        svc = DaemonService(db_session)

        await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [{"event_type": "text", "content": "[[GROUP]]第一句[[/GROUP]]", "channel": "stdout"}],
        )
        first_rows = await _fetch_logs(db_session, seed.carrier_run_id)
        assert len(first_rows) == 1
        assert (first_rows[0].metadata_ or {})["member_name"] == "小码"

        member = await db_session.get(AgentGroupMember, seed.member.id)
        member.display_name = "小码二号"
        db_session.add(member)
        await db_session.commit()

        await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [{"event_type": "text", "content": "[[GROUP]]第二句[[/GROUP]]", "channel": "stdout"}],
        )
        rows = await _fetch_logs(db_session, seed.carrier_run_id)
        assert len(rows) == 2
        assert (rows[0].metadata_ or {})["member_name"] == "小码", "旧行不回填"
        assert (rows[1].metadata_ or {})["member_name"] == "小码二号", "新行新名"


# ── 非群场景零行为变化 ───────────────────────────────────────────────────────


class TestNonGroupZeroChange:
    """单聊 / worker 形态子会话：无投影行、PublishIntent 群标量全空、无群频道事件。"""

    async def test_plain_chat_no_projection(
        self, db_session: AsyncSession, recording_redis
    ) -> None:
        sink, _redis = recording_redis
        seed = await _seed_plain_session(db_session)
        svc = DaemonService(db_session)
        result = await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.run_id,
            [
                {"event_type": "text", "content": "[ASSISTANT] 单聊回复", "channel": "stdout"},
                {"event_type": "text", "content": "[THINKING] 思考", "channel": "stdout"},
            ],
        )
        assert result == 2

        intent = result.publish_intent
        assert intent.group_id is None
        assert intent.member_id is None
        assert intent.member_name is None
        assert intent.member_session_id is None
        assert intent.projection_log_id is None

        rows = await _fetch_logs(db_session, seed.run_id)
        assert len(rows) == 2
        assert all(not r.metadata_ for r in rows), "单聊日志行不写身份 metadata"
        # 全库无投影行（无任何 metadata 非空 dict 的日志行）。注：本栈 JSON 列
        # 会把 ORM 写入的 None 序列化成文本 'null'（SQL 级 IS NOT NULL 误命中），
        # 断言按 ORM 反序列化后的真值判空，不受该方言怪癖影响。
        all_rows = (await db_session.execute(select(AgentRunLog))).scalars().all()
        assert not any(r.metadata_ for r in all_rows)

        await publish_submitted_messages(intent)
        # 两路既有频道照旧（run + 本会话），不得出现任何第三路（群频道）。
        extra_channels = {
            ch
            for ch, _payload in sink
            if ch not in {f"agent_run:{seed.run_id}", f"agent_session:{seed.session_id}"}
        }
        assert extra_channels == set()

    async def test_worker_style_subsession_no_projection(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """worker 形态（parent_session_id 非空、kind 仍 'chat'）同样零投影。"""
        seed = await _seed_plain_session(db_session)
        child = await _seed_plain_session(db_session, parent_session_id=seed.session_id)
        svc = DaemonService(db_session)
        result = await svc.submit_messages(
            child.lease_id,
            child.claim_token,
            child.run_id,
            [{"event_type": "text", "content": "[ASSISTANT] 子代理回复", "channel": "stdout"}],
        )
        assert result == 1
        assert result.publish_intent.group_id is None
        assert len(await _fetch_logs(db_session, child.run_id)) == 1


# ── 改动点②：close_interactive_run 群 turn_completed ─────────────────────────


class TestGroupTurnCompleted:
    async def test_close_publishes_group_turn_completed_with_member_identity(
        self, db_session: AsyncSession, recording_redis
    ) -> None:
        """影子 run 收口 → 群频道 turn_completed 带 member_id/member_name/
        member_session_id（turn 计数/token 照原事件字段）。"""
        _sink, redis = recording_redis
        seed = await _seed_group_bridge(db_session)
        # run 需处非终态（close 幂等守卫：已终态 no-op）。
        svc = DaemonService(db_session)
        await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.shadow_run_id,
            [{"event_type": "text", "content": "[ASSISTANT] 回复", "channel": "stdout"}],
        )
        await svc.close_interactive_run(
            seed.lease_id,
            seed.shadow_run_id,
            seed.claim_token,
            status="success",
            is_error=False,
            input_tokens=120,
            output_tokens=45,
        )

        group_events = [
            json.loads(call.args[1])
            for call in redis.publish.call_args_list
            if call.args[0] == f"agent_session:{seed.group_session_id}"
        ]
        completed = [e for e in group_events if e.get("event") == "turn_completed"]
        assert len(completed) == 1
        event = completed[0]
        assert event["session_id"] == str(seed.group_session_id)
        assert event["run_id"] == str(seed.shadow_run_id)
        assert event["status"] == "completed"
        assert event["exit_code"] == 0
        assert event["input_tokens"] == 120
        assert event["output_tokens"] == 45
        assert event["member_id"] == str(seed.member.id)
        assert event["member_name"] == "小码"
        assert event["member_session_id"] == str(seed.shadow_session_id)

    async def test_close_plain_chat_no_group_turn_completed(
        self, db_session: AsyncSession, recording_redis
    ) -> None:
        """普通单聊收口：只发 agent_run:{id} status_changed 与本会话频道
        turn_completed，无任何群频道事件。"""
        _sink, redis = recording_redis
        seed = await _seed_plain_session(db_session)
        svc = DaemonService(db_session)
        await svc.submit_messages(
            seed.lease_id,
            seed.claim_token,
            seed.run_id,
            [{"event_type": "text", "content": "[ASSISTANT] ok", "channel": "stdout"}],
        )
        await svc.close_interactive_run(
            seed.lease_id,
            seed.run_id,
            seed.claim_token,
            status="success",
            is_error=False,
        )

        channels = {call.args[0] for call in redis.publish.call_args_list}
        # facade._publish_session_event 走 session.service.get_redis（同一 mock）；
        # 单聊只有 run 频道 + 本会话频道两路。
        assert channels == {
            f"agent_run:{seed.run_id}",
            f"agent_session:{seed.session_id}",
        }
