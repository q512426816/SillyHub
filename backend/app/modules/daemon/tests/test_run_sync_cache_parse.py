"""Tests for prompt-cache token parsing in run_sync (task-07 / FR-02).

Covers the interactive-path cache token handling added by change
2026-06-24-runtime-usage-stats task-07. This file is the task-07 / task-15
designated backend test for interactive-path cache parsing
(``test_run_sync_cache_parse.py`` per task-15 allowed_paths).

- ``RunSyncService.submit_messages`` (via DaemonService facade): parse
  ``usage.cache_read_tokens`` / ``cache_creation_tokens`` with the same
  "take max, only overwrite on growth" guard as ``input_tokens`` /
  ``output_tokens`` (defends against Claude's intermediate stream events
  whose usage is always 0/0).
- ``close_interactive_run`` (via DaemonService facade): two new keyword-only
  args ``cache_read_tokens`` / ``cache_creation_tokens`` propagate the
  SDKResultSuccess terminal usage directly onto ``AgentRun.cache_*`` (no max
  — terminal one-shot write, mirrors the existing ``input_tokens`` /
  ``output_tokens`` terminal overwrite).

Task-05 added the ``AgentRun.cache_read_tokens`` / ``cache_creation_tokens``
columns; this file exercises the service-layer parsers that fill them.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService

# ── Fixtures ─────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"cache-{uid}@example.com",
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


def _mock_hub(*, connected: bool = True) -> MagicMock:
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    return redis


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = _mock_redis()
    # run_sync + session 子 service 都 patch get_redis（facade 走 session 子包）。
    # DaemonService.submit_messages / close_interactive_run 已委托 RunSyncService
    # （task-04），publish 路径在 run_sync.service.get_redis；close 的 session
    # turn_completed 经 _publish_session_event（session.service.get_redis）。
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


async def _prepare_batch_lease(
    db_session: AsyncSession, runtime_id: uuid.UUID, run_id: uuid.UUID
) -> DaemonTaskLease:
    """Create a pending batch lease with a pre-generated claim_token.

    submit_messages requires a lease with a valid claim_token bound to the run.
    Mirrors DaemonTaskLease construction in test_lease_service.py / gap-2 tests
    (metadata_ passed in the constructor, project convention).
    """
    import secrets

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
    """Build an active batch-style lease + run + claim_token for submit_messages.

    submit_messages validates lease claim_token and writes to AgentRun / AgentRunLog.
    Returns (lease_id, run_id, claim_token).
    """
    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)

    run_id = uuid.uuid4()
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status="pending",
        spec_strategy="oneshot",
    )
    # 先 add run 再建 lease（lease.agent_run_id 外键引用 run.id，同事务内
    # 提交保证引用完整性；in-memory SQLite 不强制 FK 但保持顺序清晰）。
    db_session.add(run)
    lease = await _prepare_batch_lease(db_session, rt.id, run_id)

    meta = lease.metadata_ or {}
    return lease.id, run_id, meta["claim_token"]


async def _seed_active_interactive_session(
    db_session: AsyncSession,
    *,
    run_status: str = "running",
) -> tuple[uuid.UUID, uuid.UUID, str]:
    """Build an active interactive session + lease + run + claim_token.

    Returns (lease_id, run_id, claim_token). Mirrors the helper in
    test_interactive_lifecycle_patch.py.
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
    return dispatch.lease_id, run_id, dispatch.claim_token


# ── submit_messages: cache token max-accumulation parsing ────────────────────


class TestSubmitMessagesCacheTokens:
    """task-07 / FR-02：submit_messages 解析 usage.cache_*（沿用 input/output max 逻辑）。"""

    @pytest.mark.asyncio
    async def test_cache_tokens_written_on_submit(self, db_session, mocked_redis) -> None:
        """usage 含 cache_read/cache_creation → AgentRun 两字段写入（AC-1）。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        messages = [
            {
                "event_type": "text",
                "content": "[ASSISTANT] hi",
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "cache_read_tokens": 5400000,
                    "cache_creation_tokens": 300000,
                },
            }
        ]
        await svc.submit_messages(lease_id, token, run_id, messages)

        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.cache_read_tokens == 5400000
        assert run.cache_creation_tokens == 300000
        # input/output 既有逻辑不回归
        assert run.input_tokens == 100
        assert run.output_tokens == 50

    @pytest.mark.asyncio
    async def test_cache_tokens_take_max_on_out_of_order(self, db_session, mocked_redis) -> None:
        """乱序防御：先 submit 大值，再 submit 小值，AgentRun 取 max 不被覆盖（AC-2）。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        # 第一次：大值
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] turn1",
                    "usage": {"cache_read_tokens": 1000, "cache_creation_tokens": 800},
                }
            ],
        )
        # 第二次：小值（Claude 中间事件乱序）
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] turn2",
                    "usage": {"cache_read_tokens": 500, "cache_creation_tokens": 300},
                }
            ],
        )
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.cache_read_tokens == 1000  # max，不被 500 覆盖
        assert run.cache_creation_tokens == 800

    @pytest.mark.asyncio
    async def test_cache_token_zero_filtered(self, db_session, mocked_redis) -> None:
        """cache_read_tokens=0（Claude 中间事件）被 > 0 过滤，AgentRun 保持 None（AC-3）。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] mid",
                    "usage": {
                        "input_tokens": 10,
                        "output_tokens": 5,
                        "cache_read_tokens": 0,
                        "cache_creation_tokens": 0,
                    },
                }
            ],
        )
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.cache_read_tokens is None  # 0 被 > 0 过滤
        assert run.cache_creation_tokens is None
        # input/output 仍写入（> 0）
        assert run.input_tokens == 10
        assert run.output_tokens == 5

    @pytest.mark.asyncio
    async def test_no_cache_key_keeps_none(self, db_session, mocked_redis) -> None:
        """usage 无 cache key（老 daemon / codex）→ AgentRun 两字段 None，无副作用（AC-4）。"""
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
                    "usage": {"input_tokens": 100, "output_tokens": 50},
                }
            ],
        )
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.cache_read_tokens is None
        assert run.cache_creation_tokens is None

    @pytest.mark.asyncio
    async def test_mixed_input_output_cache_no_regression(self, db_session, mocked_redis) -> None:
        """四字段混合（input/output/cache_read/cache_creation）全部正确，无回归（AC-5）。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        # 第一批
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] a",
                    "usage": {
                        "input_tokens": 100,
                        "output_tokens": 50,
                        "cache_read_tokens": 1000,
                        "cache_creation_tokens": 200,
                    },
                }
            ],
        )
        # 第二批：部分增长、部分乱序
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": "[ASSISTANT] b",
                    "usage": {
                        "input_tokens": 200,  # 增长
                        "output_tokens": 30,  # 乱序（小于 50）
                        "cache_read_tokens": 800,  # 乱序（小于 1000）
                        "cache_creation_tokens": 500,  # 增长
                    },
                }
            ],
        )
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.input_tokens == 200  # max
        assert run.output_tokens == 50  # 50 > 30，保持
        assert run.cache_read_tokens == 1000  # 1000 > 800，保持
        assert run.cache_creation_tokens == 500  # max


# ── close_interactive_run: cache token terminal propagation ──────────────────


class TestCloseInteractiveRunCacheTokens:
    """task-07 / FR-02：close_interactive_run 透传 cache（终态直接覆盖，无 max）。"""

    @pytest.mark.asyncio
    async def test_close_propagates_cache_tokens(self, db_session, mocked_redis) -> None:
        """传 cache_read_tokens/cache_creation_tokens → AgentRun 两字段写入（AC-6）。"""
        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        svc = DaemonService(db_session)
        run = await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="success",
            is_error=False,
            cache_read_tokens=5400000,
            cache_creation_tokens=300000,
        )
        assert run.cache_read_tokens == 5400000
        assert run.cache_creation_tokens == 300000
        # reload 确认 commit 生效
        reloaded = await db_session.get(AgentRun, run_id)
        assert reloaded is not None
        assert reloaded.cache_read_tokens == 5400000
        assert reloaded.cache_creation_tokens == 300000

    @pytest.mark.asyncio
    async def test_close_none_keeps_existing_cache(self, db_session, mocked_redis) -> None:
        """不传 cache 两参数（默认 None）→ AgentRun 原值不变，向后兼容（AC-7）。"""
        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        # 预置值
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        run.cache_read_tokens = 9999
        run.cache_creation_tokens = 8888
        await db_session.commit()

        svc = DaemonService(db_session)
        run2 = await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="success",
            is_error=False,
            # cache 两参数省略（默认 None）
        )
        assert run2.cache_read_tokens == 9999
        assert run2.cache_creation_tokens == 8888

    @pytest.mark.asyncio
    async def test_close_idempotent_on_already_terminal(self, db_session, mocked_redis) -> None:
        """AgentRun 已 terminal → close 幂等 no-op，cache 不被改写（AC-8）。"""
        lease_id, run_id, token = await _seed_active_interactive_session(
            db_session, run_status="completed"
        )
        # 预置 cache 值
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        run.cache_read_tokens = 1111
        run.cache_creation_tokens = 2222
        await db_session.commit()

        svc = DaemonService(db_session)
        run2 = await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="success",
            is_error=False,
            # 即使传了 cache，已 terminal 也应 no-op（不被改写）
            cache_read_tokens=5400000,
            cache_creation_tokens=300000,
        )
        assert run2.status == "completed"  # 仍 terminal，未翻转
        assert run2.cache_read_tokens == 1111  # 既有值保留
        assert run2.cache_creation_tokens == 2222

    @pytest.mark.asyncio
    async def test_close_overwrites_smaller_value(self, db_session, mocked_redis) -> None:
        """终态一次写入直接覆盖（无 max 守卫）——即使新值小于既有值也覆盖。

        对齐既有 input/output 终态覆盖模式（close_interactive_run 是 SDKResultSuccess
        真实值，不与中间事件 max 比较）。这验证了 submit(max) 与 close(直接覆盖)
        两条路径语义各自与对应 input/output 字段保持一致，不引入新模式。
        """
        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        # 预置较大值（来自 submit_messages 中间事件累积）
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        run.cache_read_tokens = 9999
        run.cache_creation_tokens = 8888
        await db_session.commit()

        svc = DaemonService(db_session)
        run2 = await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="success",
            is_error=False,
            cache_read_tokens=100,  # 小于既有 9999，但终态直接覆盖
            cache_creation_tokens=50,
        )
        assert run2.cache_read_tokens == 100
        assert run2.cache_creation_tokens == 50


class TestSubmitSubagentAttribution:
    """2026-06-28-daemon-subagent-transcript task-13 / FR-07 / D-008：
    submit_messages 把 flat record 的归属字段落库到 AgentRunLog 三列
    （parent_tool_use_id / subagent_type / depth）。覆盖 flat msg 直传 + SDK 原始
    message 经 _extract_sdk_messages 展开每条注入两条路径。主 agent / 历史日志
    无归属 → NULL（brownfield 兼容，design §9）。"""

    @pytest.mark.asyncio
    async def test_flat_record_attribution_persisted_to_columns(
        self, db_session, mocked_redis
    ) -> None:
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        messages = [
            {
                "event_type": "text",
                "content": "[ASSISTANT] 子代理回复",
                "channel": "stdout",
                "parent_tool_use_id": "toolu_sub_1",
                "subagent_type": "general-purpose",
                "depth": 1,
            },
            {
                "event_type": "text",
                "content": "[ASSISTANT] 主 agent 回复",
                "channel": "stdout",
            },
        ]
        count = await svc.submit_messages(lease_id, token, run_id, messages)
        assert count == 2

        rows = (
            (
                await db_session.execute(
                    select(AgentRunLog)
                    .where(AgentRunLog.run_id == run_id)
                    .order_by(AgentRunLog.timestamp)
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 2
        # 子代理行（先到）：归属三列写入
        sub_row = rows[0]
        assert sub_row.parent_tool_use_id == "toolu_sub_1"
        assert sub_row.subagent_type == "general-purpose"
        assert sub_row.depth == 1
        # 主 agent 行（后到，无归属字段）→ NULL
        main_row = rows[1]
        assert main_row.parent_tool_use_id is None
        assert main_row.subagent_type is None
        assert main_row.depth is None

    @pytest.mark.asyncio
    async def test_sdk_message_attribution_persisted_via_extract(
        self, db_session, mocked_redis
    ) -> None:
        """SDK 原始 assistant message（顶层带归属）经 _extract_sdk_messages 展开后，
        每条 flat record 带归属 → 落库三列（task-08 每条注入 + task-09 落库端到端）。"""
        lease_id, run_id, token = await _seed_batch_run_for_submit(db_session)
        svc = DaemonService(db_session)
        messages = [
            {
                "type": "assistant",
                "parent_tool_use_id": "toolu_sdk",
                "subagent_type": "Explore",
                "depth": 2,
                "message": {
                    "id": "msg-sdk",
                    "role": "assistant",
                    "content": [
                        {"type": "thinking", "thinking": "子代理思考"},
                        {"type": "text", "text": "子代理文本"},
                    ],
                },
            }
        ]
        count = await svc.submit_messages(lease_id, token, run_id, messages)
        assert count >= 2  # thinking + text 至少 2 条

        rows = (
            (await db_session.execute(select(AgentRunLog).where(AgentRunLog.run_id == run_id)))
            .scalars()
            .all()
        )
        assert len(rows) >= 2
        # D-008：每条 flat record 都带归属（同 message 多 block 同属一代理）
        for row in rows:
            assert row.parent_tool_use_id == "toolu_sdk"
            assert row.subagent_type == "Explore"
            assert row.depth == 2
