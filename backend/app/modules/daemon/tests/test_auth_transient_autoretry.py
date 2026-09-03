"""ql-20260903-011 单测：CLI 合成鉴权错误（远端 401 误报 Not logged in）自动重投一次。

钉死 run_sync ``_maybe_autoretry_auth_transient_turn`` 行为：
- CLI 鉴权瞬时失败（error.raw 命中 "Not logged in · Please run /login" 签名）→
  本 run 的 user_input 追加为排队消息（pending，携带 run 的 llm_provider_id
  快照），由 close 末尾既有排队派发钩子（ql-20260825-011）随即重放。
- 防循环：紧邻上一条同会话 run 同为 CLI 鉴权失败且 user_input 相同 → 不再
  追加（本 run 已是那次自动重投的结果，网关持续性故障交回用户处理）。
- 非鉴权错误（429 等）/ 成功 run / 无 user_input 日志 → 一律不追加。

参照 test_close_interactive_run_model_error.py 的 _seed_session_and_run +
mocked_redis 范式（同目录）。派发协程打补丁不真跑（避免后台任务回写测试库
与断言竞态）——本文件只钉「入队」行为，派发语义由 dispatch 既有测试覆盖。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import (
    AgentRun,
    AgentRunLog,
    AgentSession,
    AgentSessionQueuedMessage,
)
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.model_error import ModelErrorDTO, ModelErrorType
from app.modules.daemon.service import DaemonService

# ── Fixtures ─────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"ql0911-{uid}@example.com",
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
    redis = _mock_redis()
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


def _cli_auth_error() -> ModelErrorDTO:
    """CLI 合成鉴权错误（2026-09-03 会话 cb56fabf 事故实形）：daemon 回传
    type=unknown / retryable=false，raw 为 CLI 误导文案。"""
    return ModelErrorDTO(
        type=ModelErrorType.UNKNOWN,
        code=None,
        message="运行失败",
        retryable=False,
        hint=None,
        raw="Not logged in · Please run /login",
    )


async def _seed_session_run_with_input(
    db_session: AsyncSession,
    *,
    prompt: str | None = "改了什么呀？",
    llm_provider_id: uuid.UUID | None = None,
    started_at: datetime | None = None,
) -> tuple[uuid.UUID, uuid.UUID, str, uuid.UUID, uuid.UUID]:
    """构造 active 会话 + running run（含 user_input 日志），返回
    (lease_id, run_id, claim_token, session_id, user_id)。"""
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
        prompt=prompt or "hi",
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
        status="running",
        spec_strategy="interactive",
        agent_session_id=session_id,
        change_id=None,
        user_id=uid,
        started_at=started_at or datetime.now(UTC),
        llm_provider_id=llm_provider_id,
    )
    db_session.add_all([session, run])
    if prompt is not None:
        db_session.add(
            AgentRunLog(
                run_id=run_id,
                channel="user_input",
                content_redacted=prompt,
                timestamp=datetime.now(UTC),
            )
        )
    await db_session.commit()
    return dispatch.lease_id, run_id, dispatch.claim_token, session_id, uid


async def _queued_entries(
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


# ── CLI 鉴权瞬时失败 → 自动入队重投 ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_auth_transient_failure_enqueues_retry(
    db_session: AsyncSession, mocked_redis
) -> None:
    """error.raw 命中 CLI 鉴权签名 → user_input 追加为 pending 排队消息，
    携带 run 的 llm_provider_id 快照与发送者归属。"""
    provider_id = uuid.uuid4()
    lease_id, run_id, token, session_id, uid = await _seed_session_run_with_input(
        db_session, llm_provider_id=provider_id
    )
    with patch(
        "app.modules.daemon.session.service.dispatch_next_queued_message",
        new=AsyncMock(),
    ):
        svc = DaemonService(db_session)
        run = await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="error",
            is_error=True,
            error=_cli_auth_error(),
        )
    assert run.status == "failed"

    entries = await _queued_entries(db_session, session_id)
    assert len(entries) == 1
    entry = entries[0]
    assert entry.prompt == "改了什么呀？"
    assert entry.status == "pending"
    assert entry.sender_user_id == uid
    assert entry.llm_provider_id == str(provider_id)
    assert entry.position == 0

    # 重读规避 identity map 缓存，确认真正落库。
    db_session.expire_all()
    entries = await _queued_entries(db_session, session_id)
    assert len(entries) == 1


# ── 防副作用重复：本 run 已有工具活动 → 不重投（ql-20260904-M1）───────────────


@pytest.mark.asyncio
async def test_tool_activity_skips_enqueue(db_session: AsyncSession, mocked_redis) -> None:
    """401 发生在 turn 中途（已有 tool_call 日志）→ 不自动重投——重放会再执行
    一遍已落地的工具副作用；交回用户决定（错误卡可见）。"""
    lease_id, run_id, token, session_id, _uid = await _seed_session_run_with_input(db_session)
    db_session.add(
        AgentRunLog(
            run_id=run_id,
            channel="tool_call",
            content_redacted='{"tool":"Bash","command":"git commit -m x"}',
            timestamp=datetime.now(UTC),
        )
    )
    await db_session.commit()
    with patch(
        "app.modules.daemon.session.service.dispatch_next_queued_message",
        new=AsyncMock(),
    ):
        svc = DaemonService(db_session)
        run = await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="error",
            is_error=True,
            error=_cli_auth_error(),
        )
    assert run.status == "failed"

    # 无排队条目追加（不重投）。
    assert await _queued_entries(db_session, session_id) == []
    db_session.expire_all()
    assert await _queued_entries(db_session, session_id) == []


# ── 防循环：上一条同会话同 prompt run 已鉴权失败 → 不再追加 ──────────────────


@pytest.mark.asyncio
async def test_loop_guard_skips_second_enqueue(db_session: AsyncSession, mocked_redis) -> None:
    """紧邻上一条同会话 run 同为 CLI 鉴权失败且 user_input 相同 → 本 run 已是
    自动重投的结果（网关持续性故障），不再追加（防无限循环）。"""
    now = datetime.now(UTC)
    lease_id, run_id, token, session_id, uid = await _seed_session_run_with_input(
        db_session, started_at=now
    )
    # 上一条 run：更早启动、同样鉴权失败、同样 prompt。
    prev_run_id = uuid.uuid4()
    db_session.add(
        AgentRun(
            id=prev_run_id,
            agent_type="claude_code",
            provider="claude",
            status="failed",
            spec_strategy="interactive",
            agent_session_id=session_id,
            change_id=None,
            user_id=uid,
            started_at=now - timedelta(minutes=1),
            finished_at=now - timedelta(minutes=1),
            error_detail={
                "type": "unknown",
                "code": None,
                "message": "运行失败",
                "retryable": False,
                "hint": None,
                "raw": "Not logged in · Please run /login",
            },
        )
    )
    db_session.add(
        AgentRunLog(
            run_id=prev_run_id,
            channel="user_input",
            content_redacted="改了什么呀？",
            timestamp=now - timedelta(minutes=1),
        )
    )
    await db_session.commit()

    with patch(
        "app.modules.daemon.session.service.dispatch_next_queued_message",
        new=AsyncMock(),
    ):
        svc = DaemonService(db_session)
        await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="error",
            is_error=True,
            error=_cli_auth_error(),
        )

    assert await _queued_entries(db_session, session_id) == []


# ── 非鉴权错误 / 成功 run / 无 user_input → 不追加 ───────────────────────────


@pytest.mark.asyncio
async def test_non_auth_error_not_enqueued(db_session: AsyncSession, mocked_redis) -> None:
    """429 等普通模型错误不误伤——只有 CLI 鉴权签名才自动重投。"""
    lease_id, run_id, token, session_id, _ = await _seed_session_run_with_input(db_session)
    with patch(
        "app.modules.daemon.session.service.dispatch_next_queued_message",
        new=AsyncMock(),
    ):
        svc = DaemonService(db_session)
        await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="error",
            is_error=True,
            error=ModelErrorDTO(
                type=ModelErrorType.RATE_LIMITED,
                code="429",
                message="触发限流",
                retryable=True,
                hint="请稍后再试",
                raw="API Error: Request rejected (429) · rate limit",
            ),
        )
    assert await _queued_entries(db_session, session_id) == []


@pytest.mark.asyncio
async def test_success_run_not_enqueued(db_session: AsyncSession, mocked_redis) -> None:
    """成功 run 不触发重投。"""
    lease_id, run_id, token, session_id, _ = await _seed_session_run_with_input(db_session)
    with patch(
        "app.modules.daemon.session.service.dispatch_next_queued_message",
        new=AsyncMock(),
    ):
        svc = DaemonService(db_session)
        await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="success",
            is_error=False,
        )
    assert await _queued_entries(db_session, session_id) == []


@pytest.mark.asyncio
async def test_missing_user_input_not_enqueued(db_session: AsyncSession, mocked_redis) -> None:
    """run 无 user_input 日志（如服务身份轮）→ 无原文可重投，静默跳过。"""
    lease_id, run_id, token, session_id, _ = await _seed_session_run_with_input(
        db_session, prompt=None
    )
    with patch(
        "app.modules.daemon.session.service.dispatch_next_queued_message",
        new=AsyncMock(),
    ):
        svc = DaemonService(db_session)
        await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="error",
            is_error=True,
            error=_cli_auth_error(),
        )
    assert await _queued_entries(db_session, session_id) == []
