"""Tests for ctx_tokens handling in run_sync (task-06 / FR-01 / FR-03).

2026-08-27-session-token-usage-fix designated backend test：钉死 task-05 落地的
四类行为（design §5 Phase 2 / §7 守卫差异 / §9 兼容）——

- ``RunSyncService.submit_messages``（经 DaemonService facade）：提取
  ``usage.ctx_tokens``（最近一次 API 调用提示词大小，daemon 仅 main 桶
  pendingUsage 携带）并 last-write-wins 写回 ``AgentRun.ctx_tokens``。与
  input/output/cache_* 的「仅增不减 max」守卫刻意不同（ctx 是瞬时量可上可下），
  用同批/跨批后值更小仍覆盖的用例与 input 的 max 行为形成对照。
- 缺键（老 daemon / 子桶 pendingUsage）→ None 不写不报错（design §9 兼容）。
- ``publish_submitted_messages``：run channel ``messages`` summary 与 session
  channel ``tokens`` 事件两路 payload 各含 ``ctx_tokens``；None 时两路均无该键。
- ``close_interactive_run``：终态覆盖 input/output 照旧，但**不触碰**
  ``ctx_tokens``（SDK result 无 per-call 拆分，保留实时最后写入值）。

范式复用 test_run_sync_cache_parse.py（db_session + mocked_redis fixture、
DaemonService facade、_create_user/_create_runtime/_seed_* 辅助构造）。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.run_sync.service import publish_submitted_messages
from app.modules.daemon.service import DaemonService

# ── Fixtures / helpers（对齐 test_run_sync_cache_parse.py 范式） ──────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"ctx-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    return redis


@pytest.fixture()
def mocked_redis():
    """普通 AsyncMock redis：submit（publish 已移出 service）与 close 的
    session turn_completed 事件（session.service.get_redis）所需。"""
    redis = _mock_redis()
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


class _RecordingPipeline:
    """录制 pipeline：``publish(channel, payload)`` 存入共享 sink，execute 为 async no-op。

    publish_submitted_messages 用同步 ``redis.pipeline()`` 批量 publish 再
    ``await pipe.execute()``；AsyncMock 的 pipeline() 返回 coroutine 无法记录，
    故手写录制器（run channel 与 session channel 两条 pipeline 共享同一 sink）。
    """

    def __init__(self, sink: list[tuple[str, str]]) -> None:
        self._sink = sink

    def publish(self, channel: str, payload: str) -> None:
        self._sink.append((channel, payload))

    async def execute(self) -> list:
        return []


@pytest.fixture()
def recording_redis():
    """录制 publish_submitted_messages 两路 pipeline 的全部 publish 调用。

    yield 出 sink：list[(channel, payload_json_str)]，测试按 channel + event
    解析出 messages summary / tokens 事件 payload。
    """
    sink: list[tuple[str, str]] = []
    redis = AsyncMock()
    redis.pipeline = MagicMock(side_effect=lambda: _RecordingPipeline(sink))
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield sink


async def _prepare_batch_lease(
    db_session: AsyncSession, runtime_id: uuid.UUID, run_id: uuid.UUID
) -> object:
    """Create a pending batch lease with a pre-generated claim_token（同 cache_parse）。"""
    import secrets

    from app.modules.daemon.model import DaemonTaskLease

    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=run_id,
        kind="batch",
        status="pending",
        lease_expires_at=None,
        metadata_={"claim_token": secrets.token_hex(32)},
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db_session.add(lease)
    await db_session.commit()
    await db_session.refresh(lease)
    return lease


async def _seed_batch_run_for_submit(
    db_session: AsyncSession,
) -> tuple[uuid.UUID, uuid.UUID, str]:
    """Build an active batch-style lease + run + claim_token for submit_messages."""
    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)

    run_id = uuid.uuid4()
    db_session.add(
        AgentRun(
            id=run_id,
            agent_type="claude_code",
            provider="claude",
            status="pending",
            spec_strategy="oneshot",
        )
    )
    lease = await _prepare_batch_lease(db_session, rt.id, run_id)
    meta = lease.metadata_ or {}
    return lease.id, run_id, meta["claim_token"]


async def _seed_active_interactive_session(
    db_session: AsyncSession,
    *,
    run_status: str = "running",
) -> tuple[uuid.UUID, uuid.UUID, str, uuid.UUID]:
    """Build an active interactive session + lease + run + claim_token.

    Returns (lease_id, run_id, claim_token, session_id)。同 cache_parse 版本，
    额外返回 session_id（SSE 用例需定位 agent_session:{id} channel）。
    """
    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)
    placement = RunPlacementService(db_session)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=session_id,
        agent_run_id=run_id,
        user_id=uid,
        provider="claude",
        prompt="hi",
        model=None,
    )
    session = AgentSession(
        id=session_id,
        user_id=uid,
        provider="claude",
        status="active",
        config={},
        turn_count=1,
        runtime_id=rt.id,
        lease_id=dispatch.lease_id,
        last_active_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status=run_status,
        spec_strategy="interactive",
        agent_session_id=session_id,
    )
    db_session.add_all([session, run])
    await db_session.commit()
    return dispatch.lease_id, run_id, dispatch.claim_token, session_id


def _published_events(sink: list[tuple[str, str]], channel: str, event: str) -> list[dict]:
    """从录制 sink 中解析指定 channel 上指定 event 类型的全部 JSON payload。"""
    return [
        json.loads(payload)
        for ch, payload in sink
        if ch == channel and json.loads(payload).get("event") == event
    ]


# ── submit_messages: ctx_tokens 提取与缺键兼容 ───────────────────────────────


class TestSubmitMessagesCtxTokens:
    """task-06 / FR-01 FR-03：submit_messages 提取 usage.ctx_tokens（FR-03 缺键兼容）。"""

    @pytest.mark.asyncio
    async def test_ctx_tokens_written_on_submit(self, db_session, mocked_redis) -> None:
        """usage 含 ctx_tokens → AgentRun.ctx_tokens 写入（提取用例）。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] hi",
                    "usage": {
                        "input_tokens": 100,
                        "output_tokens": 50,
                        "cache_read_tokens": 60000,
                        "cache_creation_tokens": 2000,
                        # input + cache_read + cache_creation（daemon message_start 三分量和）
                        "ctx_tokens": 62000,
                    },
                }
            ],
        )

        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.ctx_tokens == 62000
        # 既有字段不回归
        assert run.input_tokens == 100
        assert run.output_tokens == 50
        assert run.cache_read_tokens == 60000
        assert run.cache_creation_tokens == 2000

    @pytest.mark.asyncio
    async def test_missing_ctx_key_keeps_none(self, db_session, mocked_redis) -> None:
        """usage 无 ctx_tokens 键（老 daemon / 子桶 pendingUsage）→ None 不写不报错。

        design §9 兼容面：老 daemon 的 usage dict 无该 key → 提取守卫不命中 →
        列保持 NULL，submit 正常完成（AgentRunLog 照常落库）。
        """
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        count = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] old daemon",
                    "usage": {"input_tokens": 100, "output_tokens": 50},
                }
            ],
        )
        assert count == 1  # 不报错，日志照常写入

        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.ctx_tokens is None
        assert run.input_tokens == 100
        assert run.output_tokens == 50


# ── submit_messages: last-write-wins 写回守卫差异 ─────────────────────────────


class TestSubmitMessagesCtxLastWriteWins:
    """task-06 / design §7 守卫差异：ctx_tokens last-write-wins（非 max）。"""

    @pytest.mark.asyncio
    async def test_same_batch_smaller_value_overwrites(self, db_session, mocked_redis) -> None:
        """同批 ctx 100→50 落库 50（后值更小也覆盖）；对照 input 同批 100→50 仍 100。

        ctx 是瞬时量（最近一次调用提示词大小）可上可下，批内最后出现值胜出；
        input 是计费量累积，max 守卫仅增不减——两守卫刻意不同。
        """
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] call1",
                    "usage": {"input_tokens": 100, "ctx_tokens": 100},
                },
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] call2",
                    "usage": {"input_tokens": 50, "ctx_tokens": 50},
                },
            ],
        )
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.ctx_tokens == 50  # last-write-wins：后值更小也覆盖
        assert run.input_tokens == 100  # 对照：max 守卫，后值更小不覆盖

    @pytest.mark.asyncio
    async def test_cross_batch_smaller_value_overwrites(self, db_session, mocked_redis) -> None:
        """跨批第二次上报更小值同样覆盖（不同 submit_messages 调用之间）。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] flush1",
                    "usage": {"input_tokens": 100, "ctx_tokens": 100},
                }
            ],
        )
        # 第二次 flush：ctx 更小（合法浮动，上下文收缩）也直接覆盖
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] flush2",
                    "usage": {"input_tokens": 50, "ctx_tokens": 50},
                }
            ],
        )
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.ctx_tokens == 50
        assert run.input_tokens == 100  # 对照：input 仅增不减


# ── publish_submitted_messages: SSE 两路 payload 透传 ─────────────────────────


class TestPublishSubmittedMessagesCtxTokens:
    """task-06 / FR-01：SSE 两路 payload（run channel summary + session channel
    tokens 事件）透传 ctx_tokens；None 时两路均无该键（design §9）。"""

    @pytest.mark.asyncio
    async def test_both_channels_carry_ctx_tokens(self, db_session, recording_redis) -> None:
        """submit 带 ctx → publish 后 run channel messages summary 与 session
        channel tokens 事件均含 ctx_tokens（实时值）。"""
        lease_id, run_id, token, session_id = await _seed_active_interactive_session(db_session)
        svc = DaemonService(db_session)
        submission = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] hi",
                    "usage": {"input_tokens": 100, "output_tokens": 50, "ctx_tokens": 62000},
                }
            ],
        )
        # 对齐 router.submit_lease_messages：commit 后调 publish_submitted_messages
        assert submission.publish_intent is not None
        await publish_submitted_messages(submission.publish_intent)

        # run channel：messages summary 含 ctx_tokens
        summaries = _published_events(recording_redis, f"agent_run:{run_id}", "messages")
        assert len(summaries) == 1
        assert summaries[0]["ctx_tokens"] == 62000

        # session channel：tokens 事件含 ctx_tokens
        token_events = _published_events(recording_redis, f"agent_session:{session_id}", "tokens")
        assert len(token_events) == 1
        assert token_events[0]["ctx_tokens"] == 62000
        # 既有字段照常透传（两路 payload 无回归）
        assert summaries[0]["input_tokens"] == 100
        assert token_events[0]["input_tokens"] == 100
        assert token_events[0]["output_tokens"] == 50

    @pytest.mark.asyncio
    async def test_none_ctx_omits_key_both_channels(self, db_session, recording_redis) -> None:
        """ctx 缺键（老 daemon）→ intent.ctx_tokens=None → 两路 payload 均无该键。

        tokens 事件照常发布（input/output 存在），只是不含 ctx_tokens 键——
        前端 onTokens 读不到该键即维持原值（JSON 加字段向后兼容，design §9）。
        """
        lease_id, run_id, token, session_id = await _seed_active_interactive_session(db_session)
        svc = DaemonService(db_session)
        submission = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] old daemon",
                    "usage": {"input_tokens": 100, "output_tokens": 50},
                }
            ],
        )
        assert submission.publish_intent is not None
        await publish_submitted_messages(submission.publish_intent)

        summaries = _published_events(recording_redis, f"agent_run:{run_id}", "messages")
        assert len(summaries) == 1
        assert "ctx_tokens" not in summaries[0]

        token_events = _published_events(recording_redis, f"agent_session:{session_id}", "tokens")
        assert len(token_events) == 1
        assert "ctx_tokens" not in token_events[0]
        # input/output 照常在场（事件本身未消失）
        assert token_events[0]["input_tokens"] == 100


# ── close_interactive_run: 终态不覆盖 ctx_tokens ──────────────────────────────


class TestCloseInteractiveRunCtxTokens:
    """task-06 / FR-01：close 终态覆盖 input/output 照旧，ctx_tokens 保留实时值。"""

    @pytest.mark.asyncio
    async def test_close_overwrites_usage_but_keeps_ctx(self, db_session, mocked_redis) -> None:
        """submit 实时写入 ctx 后调 close（带终态 input/output）→
        input/output 被终态覆盖，ctx_tokens == 实时写入值（SDK result 无
        per-call 拆分，close 不触碰该列）。"""
        lease_id, run_id, token, _session_id = await _seed_active_interactive_session(db_session)
        svc = DaemonService(db_session)
        # 轮中实时上报：submit 写入 ctx_tokens=62000
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] streaming",
                    "usage": {"input_tokens": 100, "output_tokens": 50, "ctx_tokens": 62000},
                }
            ],
        )
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.ctx_tokens == 62000  # 前置：实时值已写入

        # 终态：SDK result 的本轮 input/output（与实时值不同，验证覆盖语义）
        closed = await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="success",
            is_error=False,
            input_tokens=888888,
            output_tokens=999999,
        )
        assert closed.status == "completed"
        # input/output 被终态覆盖（权威校准语义不变）
        assert closed.input_tokens == 888888
        assert closed.output_tokens == 999999
        # ctx_tokens 保留实时写入值（显式断言，不依赖间接推断）
        assert closed.ctx_tokens == 62000

        # reload 确认 commit 生效
        reloaded = await db_session.get(AgentRun, run_id)
        assert reloaded is not None
        assert reloaded.input_tokens == 888888
        assert reloaded.output_tokens == 999999
        assert reloaded.ctx_tokens == 62000
