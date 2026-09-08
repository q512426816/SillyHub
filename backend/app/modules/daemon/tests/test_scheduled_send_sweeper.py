"""task-06（2026-09-07-session-pin-rename-scheduled-send）：定时消息派发 sweeper 单测.

覆盖 FR-05 / D-001@v1 / D-003@v1（design §接口定义·测试清单）：

直调 :func:`scheduled_send_sweep_once` / :func:`_dispatch_scheduled_entry`
（注入 AsyncSession，范式照 test_session_reconnect_sweep.py——无状态单次
函数，不依赖 30s 循环时序）。四分支各独立用例：

- 空闲 → inject 直发（新活跃 run）→ dispatched + dispatched_at；
- 忙轮（会话有活跃 run）→ ``queue_when_busy=True`` 落既有
  ``agent_session_queued_messages``（sender 记创建者）→ 条目同样 dispatched；
- 终态 / 软删 → failed + error_code=session_inactive（不盲发）；
- 忙轮且队列满 5（SESSION_QUEUE_MAX_PENDING）→ failed + error_code=queue_full
  （D-003@v1，不自动延后重试）。

另：单条 inject 抛 AppError 置 failed(inject_failed) 不连坐同轮其它条目；
非 AppError 崩溃单条不崩循环（条目留 pending 下轮重试）；dispatched 条目
二跑不重发（幂等）；未到期条目不捞取。

忙/闲会话经 ``DaemonService.create_session`` / ``inject_session`` 真链路造数
（mocked_hub / mocked_redis 隔离 WS 与 Redis，镜像 test_session_queue.py）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import (
    AgentRun,
    AgentSession,
    AgentSessionQueuedMessage,
    AgentSessionScheduledMessage,
)
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.scheduled_send import (
    _dispatch_scheduled_entry,
    scheduled_send_sweep_once,
)
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import SessionService

# 活跃轮状态（service.ACTIVE_TURN_STATUSES 同值快照——单测断言用，避免私有常量漂移）。
_ACTIVE_TURN_STATUSES = ("pending", "running", "pending_approval")

# ── Fixtures / helpers（范式逐字对齐 test_session_queue.py）─────────────────


async def _create_user(session) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"sw-{uid}@example.com",
            password_hash="x",
            display_name="SW",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(session, user_id: uuid.UUID):
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
    return rt


def _mock_hub(*, connected: bool = True) -> MagicMock:
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


async def _finish_run(db_session, run: AgentRun) -> None:
    run.status = "completed"
    run.finished_at = datetime.now(UTC)
    await db_session.commit()


async def _make_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID | None,
    *,
    status: str,
    deleted_at: datetime | None = None,
) -> AgentSession:
    """直接落一行会话（终态/软删/挂起等不 inject 成功的形态，无需 lease 绑定）。"""
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=None,
        provider="claude",
        status=status,
        agent_session_id=f"sdk-{uuid.uuid4().hex[:8]}",
        turn_count=1,
        created_at=now,
        last_active_at=now,
        ended_at=now if status in ("ended", "failed") else None,
        deleted_at=deleted_at,
    )
    db.add(sess)
    await db.commit()
    return sess


async def _make_scheduled(
    db: AsyncSession,
    session_id: uuid.UUID,
    sender_user_id: uuid.UUID,
    *,
    prompt: str = "定时消息",
    dispatch_at: datetime | None = None,
    status: str = "pending",
) -> AgentSessionScheduledMessage:
    """落一行定时条目（默认已到期 pending，dispatch_at UTC tz-aware）。"""
    row = AgentSessionScheduledMessage(
        agent_session_id=session_id,
        sender_user_id=sender_user_id,
        prompt=prompt,
        dispatch_at=dispatch_at or (datetime.now(UTC) - timedelta(seconds=10)),
        status=status,
    )
    db.add(row)
    await db.commit()
    return row


async def _seed_pending_queue(
    db: AsyncSession, session_id: uuid.UUID, sender_user_id: uuid.UUID, count: int
) -> None:
    """直接落 count 条 pending 排队消息（满员造数，绕过 inject 入队链）。"""
    for i in range(count):
        db.add(
            AgentSessionQueuedMessage(
                agent_session_id=session_id,
                sender_user_id=sender_user_id,
                prompt=f"占位排队{i}",
                status="pending",
                position=i,
            )
        )
    await db.commit()


async def _entry_row(db: AsyncSession, entry_id: uuid.UUID) -> Row:
    """(status, error_code, error_message, dispatched_at) 列级直查。"""
    return (
        await db.execute(
            select(
                AgentSessionScheduledMessage.status,
                AgentSessionScheduledMessage.error_code,
                AgentSessionScheduledMessage.error_message,
                AgentSessionScheduledMessage.dispatched_at,
            ).where(AgentSessionScheduledMessage.id == entry_id)
        )
    ).one()


async def _active_runs(db: AsyncSession, session_id: uuid.UUID) -> list[AgentRun]:
    from sqlmodel import col

    return list(
        (
            await db.execute(
                select(AgentRun).where(
                    AgentRun.agent_session_id == session_id,
                    col(AgentRun.status).in_(_ACTIVE_TURN_STATUSES),
                )
            )
        )
        .scalars()
        .all()
    )


async def _queue_rows(db: AsyncSession, session_id: uuid.UUID) -> list[AgentSessionQueuedMessage]:
    return list(
        (
            await db.execute(
                select(AgentSessionQueuedMessage).where(
                    AgentSessionQueuedMessage.agent_session_id == session_id
                )
            )
        )
        .scalars()
        .all()
    )


async def _make_idle_session(db: AsyncSession) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """create_session → 完结首轮 → 空闲 active 会话（sweep 直发前置形态）。

    返回 (uid, session_id, first_run_id)。
    """
    uid = await _create_user(db)
    await _create_runtime(db, uid)
    svc = DaemonService(db)
    created = await svc.create_session(uid, provider="claude", prompt="首轮")
    await _finish_run(db, created.agent_run)
    return uid, created.agent_session.id, created.agent_run.id


async def _make_busy_session(db: AsyncSession) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """create_session → 完结首轮 → 再注入占用本轮（有活跃 run 的忙态）。

    返回 (uid, session_id, busy_run_id)。
    """
    uid = await _create_user(db)
    await _create_runtime(db, uid)
    svc = DaemonService(db)
    created = await svc.create_session(uid, provider="claude", prompt="首轮")
    await _finish_run(db, created.agent_run)
    busy = await svc.inject_session(created.agent_session.id, uid, prompt="占用本轮")
    return uid, created.agent_session.id, busy.agent_run.id


# ── 分支一：空闲 → 直发 dispatched ─────────────────────────────────────────


class TestSweepIdleDispatch:
    async def test_idle_session_dispatched_with_new_run(
        self, db_session: AsyncSession, mocked_hub, mocked_redis
    ) -> None:
        """空闲会话到点 → inject 真链路建新活跃 run → 条目 dispatched + dispatched_at。"""
        uid, session_id, first_run_id = await _make_idle_session(db_session)
        assert await _active_runs(db_session, session_id) == []  # 前置：确为空闲
        entry = await _make_scheduled(db_session, session_id, uid, prompt="定时到点直发")

        processed = await scheduled_send_sweep_once(db_session)

        assert processed == 1
        status, error_code, _msg, dispatched_at = await _entry_row(db_session, entry.id)
        assert status == "dispatched"
        assert error_code is None
        assert dispatched_at is not None
        runs = await _active_runs(db_session, session_id)
        assert len(runs) == 1  # 新活跃 run（非排队路径）
        assert runs[0].id != first_run_id
        assert await _queue_rows(db_session, session_id) == []  # 空闲不走排队


# ── 分支二：忙轮 → 落既有排队表 → 条目 dispatched ──────────────────────────


class TestSweepBusyQueues:
    async def test_busy_session_lands_in_queue_then_dispatched(
        self, db_session: AsyncSession, mocked_hub, mocked_redis
    ) -> None:
        """忙轮（活跃 run 占用）→ queue_when_busy 落 queued_messages pending
        （sender 记条目创建者）→ 定时条目同样 dispatched（义务已履行）。"""
        uid, session_id, busy_run_id = await _make_busy_session(db_session)
        assert len(await _active_runs(db_session, session_id)) == 1  # 前置：忙态
        entry = await _make_scheduled(db_session, session_id, uid, prompt="忙轮定时追问")

        processed = await scheduled_send_sweep_once(db_session)

        assert processed == 1
        status, _error_code, _msg, dispatched_at = await _entry_row(db_session, entry.id)
        assert status == "dispatched"  # 入队即视为定时义务履行完毕
        assert dispatched_at is not None
        rows = await _queue_rows(db_session, session_id)
        assert len(rows) == 1
        assert rows[0].prompt == "忙轮定时追问"
        assert rows[0].sender_user_id == uid  # queue_sender_user_id=创建者记账
        assert rows[0].status == "pending"  # 用户可重排/取消（既有队列域管）
        # 忙轮不建第二个活跃 run（单会话单活跃轮不变式）
        active = await _active_runs(db_session, session_id)
        assert [r.id for r in active] == [busy_run_id]


# ── 分支三：终态/软删 → failed(session_inactive) ───────────────────────────


class TestSweepSessionInactive:
    async def test_ended_session_entry_failed_session_inactive(
        self, db_session: AsyncSession
    ) -> None:
        """终态（ended）会话的到期条目 → failed + session_inactive，不盲发。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess = await _make_session(db_session, uid, rt.id, status="ended")
        entry = await _make_scheduled(db_session, sess.id, uid)

        processed = await scheduled_send_sweep_once(db_session)

        assert processed == 1
        status, error_code, error_message, dispatched_at = await _entry_row(db_session, entry.id)
        assert status == "failed"
        assert error_code == "session_inactive"
        assert error_message is not None
        assert dispatched_at is None  # 未派发
        assert await _queue_rows(db_session, sess.id) == []
        assert await _active_runs(db_session, sess.id) == []

    async def test_soft_deleted_session_entry_failed_session_inactive(
        self, db_session: AsyncSession
    ) -> None:
        """软删（active + deleted_at 非空）同口径收敛 failed(session_inactive)。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess = await _make_session(
            db_session, uid, rt.id, status="active", deleted_at=datetime.now(UTC)
        )
        entry = await _make_scheduled(db_session, sess.id, uid)

        processed = await scheduled_send_sweep_once(db_session)

        assert processed == 1
        status, error_code, _msg, _disp = await _entry_row(db_session, entry.id)
        assert status == "failed"
        assert error_code == "session_inactive"
        assert await _queue_rows(db_session, sess.id) == []
        assert await _active_runs(db_session, sess.id) == []


# ── 分支四：忙轮且队列满 5 → failed(queue_full)（D-003@v1）─────────────────


class TestSweepQueueFull:
    async def test_busy_with_full_queue_fails_queue_full(
        self, db_session: AsyncSession, mocked_hub, mocked_redis
    ) -> None:
        """忙轮 + 既有 pending 队列已满 5 → inject 抛 DaemonSessionQueueFull →
        条目 failed + error_code=queue_full（不自动延后重试，用户可见原因）。"""
        from app.modules.agent.model import SESSION_QUEUE_MAX_PENDING

        uid, session_id, _busy_run_id = await _make_busy_session(db_session)
        await _seed_pending_queue(db_session, session_id, uid, SESSION_QUEUE_MAX_PENDING)
        entry = await _make_scheduled(db_session, session_id, uid, prompt="撞满员的定时")

        processed = await scheduled_send_sweep_once(db_session)

        assert processed == 1
        status, error_code, error_message, dispatched_at = await _entry_row(db_session, entry.id)
        assert status == "failed"
        assert error_code == "queue_full"
        assert error_message is not None and "上限" in error_message
        assert dispatched_at is None
        # 既有 5 条占位排队原样保留，定时消息未混入队列
        assert len(await _queue_rows(db_session, session_id)) == SESSION_QUEUE_MAX_PENDING


# ── 失败隔离：单条失败不连坐同轮其它条目 ───────────────────────────────────


class TestSweepFailureIsolation:
    async def test_single_app_error_failed_without_blocking_others(
        self, db_session: AsyncSession, mocked_hub, mocked_redis
    ) -> None:
        """同轮两条 due：其一 inject 抛 AppError（suspended 会话 →
        DaemonSessionNotActive）→ 该条 failed(inject_failed)；另一条照常 dispatched。"""
        # 坏条目：suspended 会话（非 ended/failed 终态，过 sweeper 前置复核，
        # inject 域抛 AppError → inject_failed 兜底归类）
        uid_bad = await _create_user(db_session)
        rt_bad = await _create_runtime(db_session, uid_bad)
        suspended = await _make_session(db_session, uid_bad, rt_bad.id, status="suspended")
        entry_bad = await _make_scheduled(db_session, suspended.id, uid_bad, prompt="挂起会话定时")
        # 好条目：空闲健康会话
        uid_good, session_good, _first = await _make_idle_session(db_session)
        entry_good = await _make_scheduled(
            db_session, session_good, uid_good, prompt="健康会话定时"
        )

        processed = await scheduled_send_sweep_once(db_session)

        assert processed == 2  # 两条均收敛（一 failed 一 dispatched）
        bad_status, bad_code, bad_msg, _ = await _entry_row(db_session, entry_bad.id)
        assert bad_status == "failed"
        assert bad_code == "inject_failed"
        assert bad_msg is not None
        good_status, good_code, _m, good_at = await _entry_row(db_session, entry_good.id)
        assert good_status == "dispatched"
        assert good_code is None and good_at is not None

    async def test_crash_isolation_keeps_entry_pending_for_next_round(
        self,
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """非 AppError 崩溃（RuntimeError）→ 单条不崩循环：该条留 pending
        下轮重试，同轮其它条目照常处理（sweep_once 逐条 try/except）。"""
        uid_a, session_a, _ = await _make_idle_session(db_session)
        uid_b, session_b, _ = await _make_idle_session(db_session)
        entry_crash = await _make_scheduled(db_session, session_a, uid_a, prompt="崩溃条目")
        entry_ok = await _make_scheduled(db_session, session_b, uid_b, prompt="正常条目")

        real_inject = SessionService.inject_session_as_service

        async def _explode_on_crash_prompt(self, session_id, *, prompt, **kwargs):
            if prompt == "崩溃条目":
                raise RuntimeError("boom")
            return await real_inject(self, session_id, prompt=prompt, **kwargs)

        monkeypatch.setattr(SessionService, "inject_session_as_service", _explode_on_crash_prompt)

        processed = await scheduled_send_sweep_once(db_session)

        assert processed == 1  # 仅正常条目收敛；崩溃条目不计
        crash_status, crash_code, _m, _d = await _entry_row(db_session, entry_crash.id)
        assert crash_status == "pending"  # 留 pending 下轮重试
        assert crash_code is None
        ok_status, _c, _mm, ok_at = await _entry_row(db_session, entry_ok.id)
        assert ok_status == "dispatched"
        assert ok_at is not None


# ── 幂等：dispatched 二跑不重发 ───────────────────────────────────────────


class TestSweepIdempotent:
    async def test_dispatched_entry_not_resent_on_second_run(
        self, db_session: AsyncSession, mocked_hub, mocked_redis
    ) -> None:
        """dispatched 条目：直调 _dispatch_scheduled_entry 返回 False、二跑
        sweep_once 捞 0 条；活跃 run 数与 dispatched_at 均不被二跑改动。"""
        uid, session_id, _first = await _make_idle_session(db_session)
        entry = await _make_scheduled(db_session, session_id, uid)
        entry_id = entry.id  # expire_all 后 ORM 属性走懒加载（greenlet 外），先快照
        assert await scheduled_send_sweep_once(db_session) == 1
        _, _, _, dispatched_at = await _entry_row(db_session, entry_id)
        assert dispatched_at is not None
        runs_after_first = [r.id for r in await _active_runs(db_session, session_id)]
        assert len(runs_after_first) == 1

        # 行锁内复核 status != pending → 幂等跳过（R-01 后到者语义）。
        # expire_all：生产路径每条目独立短 session（无陈旧 identity map），
        # 直调复用 db_session 须先丢弃缓存对象，让 SELECT 重读已提交终态。
        db_session.expire_all()
        flipped = await _dispatch_scheduled_entry(db_session, entry_id)
        assert flipped is False
        assert await scheduled_send_sweep_once(db_session) == 0
        _, _, _, dispatched_at_2 = await _entry_row(db_session, entry_id)
        assert dispatched_at_2 == dispatched_at  # 时间戳不被覆盖
        assert [r.id for r in await _active_runs(db_session, session_id)] == runs_after_first


# ── 未到期不捞取（due 过滤）───────────────────────────────────────────────


class TestSweepNotDue:
    async def test_future_entry_not_picked(
        self, db_session: AsyncSession, mocked_hub, mocked_redis
    ) -> None:
        """dispatch_at 未到 → 本轮 0 条，条目保持 pending（30s 轮询到期自然捞走）。"""
        uid, session_id, _first = await _make_idle_session(db_session)
        entry = await _make_scheduled(
            db_session, session_id, uid, dispatch_at=datetime.now(UTC) + timedelta(minutes=10)
        )

        assert await scheduled_send_sweep_once(db_session) == 0
        status, _code, _msg, dispatched_at = await _entry_row(db_session, entry.id)
        assert status == "pending"
        assert dispatched_at is None
        assert await _active_runs(db_session, session_id) == []
