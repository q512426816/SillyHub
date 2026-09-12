"""2026-09-12-chat-turn-auto-recovery task-04 单测：三分支自动恢复判定序。

钉死 ``maybe_auto_recover_failed_turn``（经 ``close_interactive_run`` 全链调用）：
- 分支 A：quota_exceeded + reset_at → 定时消息（dispatch_at=reset_at+120s）；
- 分支 B 干净轮：瞬时四类 → 原 prompt 重放（带 origin）；
- 分支 B 工具活动：→ RESUME_NUDGE_PROMPT（不重放原文）；
- 分支 C：auth_failed/model_not_found/unknown/quota 无 reset_at → 不动作；
- G0 守卫：开关关闭/非最新轮/空输入/双表幂等；
- 链上限：transient 紧链 2 / quota 链 3；
- 静默容错：恢复路径异常不影响已 commit 终态。

夹具范式沿用 test_auth_transient_autoretry.py（同目录）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import (
    AgentRun,
    AgentRunLog,
    AgentSession,
    AgentSessionQueuedMessage,
    AgentSessionScheduledMessage,
)
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.model_error import ModelErrorDTO, ModelErrorType
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service.auto_resume import (
    QUOTA_CHAIN_LIMIT,
    QUOTA_DISPATCH_BUFFER_SECONDS,
    QUOTA_NUDGE_PROMPT,
    RESUME_NUDGE_PROMPT,
    TRANSIENT_ERROR_TYPES,
)

# 动态未来时间（+2h，北京时间格式）：固定历史日期会触发「已过重置时间→尽快派发」分支。
RESET_AT = (
    (datetime.now(UTC) + timedelta(hours=2)).astimezone(timezone(timedelta(hours=8)))
).strftime("%Y-%m-%dT%H:%M:%S+08:00")


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"ar-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


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


async def _seed(
    db_session: AsyncSession,
    *,
    prompt: str = "继续任务",
    config: dict | None = None,
) -> tuple[uuid.UUID, uuid.UUID, str, uuid.UUID, uuid.UUID]:
    """active 主会话 + running run（含 user_input 日志）。返回
    (lease_id, run_id, claim_token, session_id, user_id)。范式对齐
    test_auth_transient_autoretry._seed_session_run_with_input。"""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"ar2-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await db_session.commit()
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=uid,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    placement = RunPlacementService(db_session)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=session_id,
        agent_run_id=run_id,
        user_id=uid,
        provider="claude",
        prompt=prompt,
        model=None,
    )
    db_session.add_all(
        [
            AgentSession(
                id=session_id,
                user_id=uid,
                provider="claude",
                status="active",
                config=dict(config) if config is not None else {},
                turn_count=1,
                runtime_id=rt.id,
                lease_id=dispatch.lease_id,
                last_active_at=datetime.now(UTC),
                created_at=datetime.now(UTC),
            ),
            AgentRun(
                id=run_id,
                agent_type="claude_code",
                provider="claude",
                status="running",
                spec_strategy="interactive",
                agent_session_id=session_id,
                user_id=uid,
                started_at=datetime.now(UTC),
            ),
            AgentRunLog(
                run_id=run_id,
                channel="user_input",
                content_redacted=prompt,
                timestamp=datetime.now(UTC),
            ),
        ]
    )
    await db_session.commit()
    return dispatch.lease_id, run_id, dispatch.claim_token, session_id, uid


async def _close_failed(
    db_session: AsyncSession,
    lease_id: uuid.UUID,
    run_id: uuid.UUID,
    token: str,
    error: ModelErrorDTO,
) -> AgentRun:
    with patch(
        "app.modules.daemon.session.service.dispatch_next_queued_message",
        new=AsyncMock(),
    ):
        svc = DaemonService(db_session)
        return await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="error",
            is_error=True,
            error=error,
        )


def _transient_error(
    t: str = "provider_error", raw: str = "Stream ended without finish_reason"
) -> ModelErrorDTO:
    assert t in {x.value for x in ModelErrorType} | TRANSIENT_ERROR_TYPES
    return ModelErrorDTO(
        type=ModelErrorType(t),
        code=None,
        message="运行失败",
        retryable=True,
        hint=None,
        raw=raw,
    )


def _quota_error(reset_at: str | None = RESET_AT) -> ModelErrorDTO:
    return ModelErrorDTO(
        type=ModelErrorType.QUOTA_EXCEEDED,
        code="1308",
        message="额度或配额已耗尽",
        retryable=False,
        hint=None,
        raw="[1308][已达到 5 小时的使用上限。您的限额将在 2026-09-12 10:03:59 重置。]",
        reset_at=reset_at,
    )


async def _queued(db_session, session_id) -> list[AgentSessionQueuedMessage]:
    return list(
        (
            await db_session.execute(
                select(AgentSessionQueuedMessage).where(
                    AgentSessionQueuedMessage.agent_session_id == session_id
                )
            )
        ).scalars()
    )


async def _scheduled(db_session, session_id) -> list[AgentSessionScheduledMessage]:
    return list(
        (
            await db_session.execute(
                select(AgentSessionScheduledMessage).where(
                    AgentSessionScheduledMessage.agent_session_id == session_id
                )
            )
        ).scalars()
    )


async def _add_prev_run(
    db_session: AsyncSession,
    session_id: uuid.UUID,
    uid: uuid.UUID,
    *,
    minutes_before: int = 10,
    metadata_: dict | None = None,
    error_detail: dict | None = None,
    status: str = "failed",
) -> uuid.UUID:
    """手工插入历史 run（链计数/非最新守卫用）。"""
    rid = uuid.uuid4()
    db_session.add(
        AgentRun(
            id=rid,
            user_id=uid,
            agent_session_id=session_id,
            agent_type="claude_code",
            status=status,
            created_at=datetime.now(UTC) - timedelta(minutes=minutes_before),
            error_detail=error_detail,
            metadata_=metadata_,
        )
    )
    await db_session.commit()
    return rid


# ── 分支 B：瞬时错误 ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_transient_clean_replay(db_session: AsyncSession, mocked_redis) -> None:
    """瞬时+干净轮 → 原 prompt 重放，带 origin + 快照。"""
    lease_id, run_id, token, session_id, _ = await _seed(db_session)
    run = await _close_failed(db_session, lease_id, run_id, token, _transient_error())
    assert run.status == "failed"

    entries = await _queued(db_session, session_id)
    assert len(entries) == 1
    assert entries[0].prompt == "继续任务"
    assert entries[0].origin == f"auto_resume:{run_id}"
    assert entries[0].status == "pending"
    assert await _scheduled(db_session, session_id) == []


@pytest.mark.asyncio
async def test_transient_tool_activity_nudge(db_session: AsyncSession, mocked_redis) -> None:
    """瞬时+有工具活动 → nudge（不重放原文）。"""
    lease_id, run_id, token, session_id, _ = await _seed(db_session)
    db_session.add(
        AgentRunLog(
            run_id=run_id,
            channel="tool_call",
            content_redacted='{"tool":"bash"}',
            timestamp=datetime.now(UTC),
        )
    )
    await db_session.commit()

    await _close_failed(
        db_session,
        lease_id,
        run_id,
        token,
        _transient_error("timeout", 'pi rpc "prompt" response timeout (30000ms)'),
    )

    entries = await _queued(db_session, session_id)
    assert len(entries) == 1
    assert entries[0].prompt == RESUME_NUDGE_PROMPT
    assert entries[0].origin == f"auto_resume:{run_id}"
    assert entries[0].prompt != "继续任务"


@pytest.mark.asyncio
async def test_silent_truncation_text_classified_transient(
    db_session: AsyncSession, mocked_redis
) -> None:
    """静默中断合成文本（task-02）归类 provider_error → 走分支 B。"""
    lease_id, run_id, token, session_id, _ = await _seed(db_session)
    await _close_failed(
        db_session,
        lease_id,
        run_id,
        token,
        _transient_error("provider_error", "[silent stream truncation] 上一轮输出流中断"),
    )
    entries = await _queued(db_session, session_id)
    assert len(entries) == 1


# ── 分支 A：quota 定时续跑 ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_quota_schedules_at_reset(db_session: AsyncSession, mocked_redis) -> None:
    """quota + reset_at → 定时消息 dispatch_at=reset_at+120s，nudge 文案。"""
    lease_id, run_id, token, session_id, _ = await _seed(db_session)
    await _close_failed(db_session, lease_id, run_id, token, _quota_error())

    assert await _queued(db_session, session_id) == []
    scheduled = await _scheduled(db_session, session_id)
    assert len(scheduled) == 1
    assert scheduled[0].prompt == QUOTA_NUDGE_PROMPT
    assert scheduled[0].origin == f"auto_resume:{run_id}"
    assert scheduled[0].status == "pending"
    # dispatch_at = reset_at + 120s（SQLite 可能丢 tz——统一 naive 比较，容差 2s）。
    reset_dt = datetime.fromisoformat(RESET_AT)
    expected_naive = (reset_dt + timedelta(seconds=QUOTA_DISPATCH_BUFFER_SECONDS)).replace(
        tzinfo=None
    )
    actual = scheduled[0].dispatch_at
    actual_naive = actual.replace(tzinfo=None) if actual.tzinfo else actual
    assert abs((actual_naive - expected_naive).total_seconds()) < 2


@pytest.mark.asyncio
async def test_quota_no_reset_at_no_action(db_session: AsyncSession, mocked_redis) -> None:
    """quota 无 reset_at（daemon 未解析到）→ 不排期不排队。"""
    lease_id, run_id, token, session_id, _ = await _seed(db_session)
    await _close_failed(db_session, lease_id, run_id, token, _quota_error(reset_at=None))
    assert await _queued(db_session, session_id) == []
    assert await _scheduled(db_session, session_id) == []


@pytest.mark.asyncio
async def test_quota_chain_limit(db_session: AsyncSession, mocked_redis) -> None:
    """quota 链 ≥3（当前+两代前驱均 quota）→ 不再排期。"""
    lease_id, run_id, token, session_id, uid = await _seed(db_session)
    # 两代前驱：run2(run_id) → prev2 → prev1，均 quota 失败 + 链标记。
    prev1 = await _add_prev_run(
        db_session,
        session_id,
        uid,
        minutes_before=30,
        error_detail={"type": "quota_exceeded"},
    )
    prev2 = await _add_prev_run(
        db_session,
        session_id,
        uid,
        minutes_before=20,
        metadata_={"auto_resume_of": str(prev1)},
        error_detail={"type": "quota_exceeded"},
    )
    # 当前 run 挂链（模拟其派发时打标）。
    run = await db_session.get(AgentRun, run_id)
    run.metadata_ = {"auto_resume_of": str(prev2)}
    await db_session.commit()

    await _close_failed(db_session, lease_id, run_id, token, _quota_error())
    assert await _scheduled(db_session, session_id) == []
    assert await _queued(db_session, session_id) == []


@pytest.mark.asyncio
async def test_quota_chain_breaks_on_non_quota(db_session: AsyncSession, mocked_redis) -> None:
    """quota 链遇非 quota 前驱断链 → 计数 1 → 正常排期（链上限按连续计）。"""
    lease_id, run_id, token, session_id, uid = await _seed(db_session)
    prev1 = await _add_prev_run(
        db_session,
        session_id,
        uid,
        minutes_before=30,
        metadata_={"auto_resume_of": str(uuid.uuid4())},
        error_detail={"type": "provider_error"},
    )
    run = await db_session.get(AgentRun, run_id)
    run.metadata_ = {"auto_resume_of": str(prev1)}
    await db_session.commit()

    await _close_failed(db_session, lease_id, run_id, token, _quota_error())
    scheduled = await _scheduled(db_session, session_id)
    assert len(scheduled) == 1


# ── 链上限（分支 B 工具活动）────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_transient_tight_chain_limit(db_session: AsyncSession, mocked_redis) -> None:
    """紧链 ≥2 → 不再 nudge。"""
    lease_id, run_id, token, session_id, uid = await _seed(db_session)
    db_session.add(
        AgentRunLog(
            run_id=run_id,
            channel="tool_call",
            content_redacted='{"tool":"bash"}',
            timestamp=datetime.now(UTC),
        )
    )
    prev1 = await _add_prev_run(
        db_session,
        session_id,
        uid,
        minutes_before=30,
        error_detail={"type": "provider_error"},
    )
    run = await db_session.get(AgentRun, run_id)
    run.metadata_ = {"auto_resume_of": str(prev1)}
    await db_session.commit()

    await _close_failed(db_session, lease_id, run_id, token, _transient_error())
    assert await _queued(db_session, session_id) == []


# ── 分支 C ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("err_type", ["auth_failed", "model_not_found", "unknown"])
async def test_non_recoverable_no_action(
    db_session: AsyncSession, mocked_redis, err_type: str
) -> None:
    lease_id, run_id, token, session_id, _ = await _seed(db_session)
    await _close_failed(
        db_session, lease_id, run_id, token, _transient_error(err_type, "some other error")
    )
    assert await _queued(db_session, session_id) == []
    assert await _scheduled(db_session, session_id) == []


# ── G0 守卫 ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_switch_off_no_action(db_session: AsyncSession, mocked_redis) -> None:
    """config.auto_resume_interrupted=False → 全分支回到手动（NFR-3）。"""
    lease_id, run_id, token, session_id, _ = await _seed(
        db_session, config={"auto_resume_interrupted": False}
    )
    await _close_failed(db_session, lease_id, run_id, token, _transient_error())
    assert await _queued(db_session, session_id) == []
    await _close_failed(db_session, lease_id, run_id, token, _transient_error())
    assert await _queued(db_session, session_id) == []


@pytest.mark.asyncio
async def test_not_latest_no_action(db_session: AsyncSession, mocked_redis) -> None:
    """run 之后有更新 run（用户已手动重发）→ 不自动。"""
    lease_id, run_id, token, session_id, uid = await _seed(db_session)
    await _add_prev_run(db_session, session_id, uid, minutes_before=-5, status="running")
    await _close_failed(db_session, lease_id, run_id, token, _transient_error())
    assert await _queued(db_session, session_id) == []


@pytest.mark.asyncio
async def test_empty_input_no_action(db_session: AsyncSession, mocked_redis) -> None:
    """无 user_input 日志（空轮）→ 不恢复（D-010）。"""
    from sqlalchemy import delete as sa_delete

    lease_id, run_id, token, session_id, _ = await _seed(db_session)
    await db_session.execute(
        sa_delete(AgentRunLog).where(
            AgentRunLog.run_id == run_id, AgentRunLog.channel == "user_input"
        )
    )
    await db_session.commit()
    await _close_failed(db_session, lease_id, run_id, token, _transient_error())
    assert await _queued(db_session, session_id) == []


# ── 静默容错 ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_recovery_failure_does_not_break_close(
    db_session: AsyncSession, mocked_redis
) -> None:
    """恢复路径异常（session.get 抛错）→ 静默吞掉，close 终态不受影响。"""
    lease_id, run_id, token, session_id, _ = await _seed(db_session)
    with (
        patch("app.modules.daemon.session.service.dispatch_next_queued_message", new=AsyncMock()),
        patch(
            "app.modules.daemon.session.service.auto_resume.maybe_auto_recover_failed_turn",
            side_effect=RuntimeError("recovery exploded"),
        ),
    ):
        svc = DaemonService(db_session)
        run = await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="error",
            is_error=True,
            error=_transient_error(),
        )
    assert run.status == "failed"
    db_session.expire_all()
    assert await _queued(db_session, session_id) == []


# ── 提示词文案锁定 ───────────────────────────────────────────────────────────


def test_nudge_prompt_text_lock() -> None:
    """nudge 文案锁定（design §5.3 单一源，防措辞漂移破坏语义）。"""
    assert RESUME_NUDGE_PROMPT.startswith("[系统续跑]")
    assert "上游输出流中断" in RESUME_NUDGE_PROMPT
    assert "已完成的步骤不要重复执行" in RESUME_NUDGE_PROMPT
    assert "若原任务已完成" in RESUME_NUDGE_PROMPT
    assert QUOTA_NUDGE_PROMPT.startswith("[系统续跑]")
    assert "额度已重置" in QUOTA_NUDGE_PROMPT
    assert "已完成的步骤不要重复执行" in QUOTA_NUDGE_PROMPT
    assert QUOTA_CHAIN_LIMIT == 3
    assert QUOTA_DISPATCH_BUFFER_SECONDS == 120
    assert {"rate_limited", "timeout", "network", "provider_error"} == TRANSIENT_ERROR_TYPES
