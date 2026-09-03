"""2026-08-29-daemon-platform-resilience task-01：控制指令表与服务（design A2）.

核心行为：
- enqueue：INSERT status=pending；expires_at 缺省按 kind（session_inject 10min /
  permission_response 6min / 其余 30min），显式传入则原样落库；
- fetch_pending：仅返回 status=pending、created_at 升序（FIFO），跨 runtime 隔离，
  delivered/acked/expired 一律不出现（D-006 补拉只回 pending）；
- mark_delivered / ack 状态机推进（pending→delivered；pending|delivered→acked），
  已终态（acked/expired）幂等跳过、不回退；
- gc 三路收敛：pending 过 expires_at → expired、delivered 未 ack 超 10min →
  expired、acked 超 1h → DELETE；未到阈值与阈值缺省（NULL）行不动。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.daemon.control_commands import (
    ACK_RETENTION_SECONDS,
    DEFAULT_EXPIRE_TTL_SECONDS,
    DELIVERED_ACK_GRACE_SECONDS,
    EXPIRE_TTL_SECONDS,
    ControlCommandService,
)
from app.modules.daemon.model import DaemonControlCommand, DaemonRuntime

# ── helpers ───────────────────────────────────────────────────────────────────


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"cc-{uid}@example.com",
            password_hash="x",
            display_name="CC",
            status="active",
        )
    )
    await db_session.commit()
    return uid


async def _create_runtime(db_session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    return rt


async def _setup_runtime(db_session: AsyncSession) -> DaemonRuntime:
    uid = await _create_user(db_session)
    return await _create_runtime(db_session, uid)


async def _insert_row(
    db_session: AsyncSession,
    runtime_id: uuid.UUID,
    *,
    kind: str = "session_inject",
    status: str = "pending",
    created_at: datetime | None = None,
    delivered_at: datetime | None = None,
    ack_at: datetime | None = None,
    expires_at: datetime | None = None,
    payload: dict | None = None,
) -> DaemonControlCommand:
    """直接落一行指定状态的指令（GC / fetch_pending 用例需要精确时钟）。

    payload 缺省 {"x": 1}（无 run_id，不参与 inject 过期联动）；联动用例显式传
    ``{"run_id": ...}`` 指向待收敛的 AgentRun。
    """
    row = DaemonControlCommand(
        runtime_id=runtime_id,
        kind=kind,
        payload=payload if payload is not None else {"x": 1},
        status=status,
        created_at=created_at or datetime.now(UTC),
        delivered_at=delivered_at,
        ack_at=ack_at,
        expires_at=expires_at,
    )
    db_session.add(row)
    await db_session.commit()
    return row


async def _fetch_row(
    db_session: AsyncSession, command_id: uuid.UUID
) -> DaemonControlCommand | None:
    # 服务内 bulk update/delete 不经 identity map；populate_existing 强制本轮
    # SELECT 刷新实例属性（expire_all + 属性访问在 async 下会触发同步惰性加载报错）。
    stmt = (
        select(DaemonControlCommand)
        .where(DaemonControlCommand.id == command_id)
        .execution_options(populate_existing=True)
    )
    return (await db_session.execute(stmt)).scalars().first()


async def _fetch_all(db_session: AsyncSession, runtime_id: uuid.UUID) -> list[DaemonControlCommand]:
    stmt = (
        select(DaemonControlCommand)
        .where(DaemonControlCommand.runtime_id == runtime_id)
        .execution_options(populate_existing=True)
    )
    return list((await db_session.execute(stmt)).scalars().all())


# ── enqueue ───────────────────────────────────────────────────────────────────


class TestEnqueue:
    @pytest.mark.asyncio
    async def test_enqueue_persists_pending_row(self, db_session) -> None:
        rt = await _setup_runtime(db_session)
        svc = ControlCommandService(db_session)

        row = await svc.enqueue(rt.id, "session_inject", {"prompt": "你好", "session_id": "s1"})

        assert row.status == "pending"
        persisted = await _fetch_row(db_session, row.id)
        assert persisted is not None
        assert persisted.runtime_id == rt.id
        assert persisted.kind == "session_inject"
        assert persisted.payload == {"prompt": "你好", "session_id": "s1"}
        assert persisted.status == "pending"
        assert persisted.created_at is not None
        assert persisted.expires_at is not None
        assert persisted.delivered_at is None
        assert persisted.ack_at is None

    @pytest.mark.asyncio
    async def test_enqueue_expires_at_by_kind(self, db_session) -> None:
        """缺省 expires_at 按 kind：inject 10min、permission_response 6min、其余 30min。"""
        rt = await _setup_runtime(db_session)
        svc = ControlCommandService(db_session)

        cases = [
            ("session_inject", EXPIRE_TTL_SECONDS["session_inject"]),
            ("permission_response", EXPIRE_TTL_SECONDS["permission_response"]),
            ("session_end", DEFAULT_EXPIRE_TTL_SECONDS),
            ("provider_config_changed", DEFAULT_EXPIRE_TTL_SECONDS),
        ]
        for kind, ttl in cases:
            row = await svc.enqueue(rt.id, kind, {"k": kind})
            delta = (row.expires_at - row.created_at).total_seconds()
            assert ttl - 1 <= delta <= ttl + 1, f"{kind} 期望 TTL {ttl}s，实际 {delta}s"

        # 常量与 design A2 对齐：10min / 6min / 30min。
        assert EXPIRE_TTL_SECONDS["session_inject"] == 10 * 60
        assert EXPIRE_TTL_SECONDS["permission_response"] == 6 * 60
        assert DEFAULT_EXPIRE_TTL_SECONDS == 30 * 60

    @pytest.mark.asyncio
    async def test_enqueue_explicit_expires_at_honored(self, db_session) -> None:
        rt = await _setup_runtime(db_session)
        svc = ControlCommandService(db_session)
        explicit = datetime.now(UTC) + timedelta(minutes=42)

        row = await svc.enqueue(rt.id, "session_inject", None, expires_at=explicit)

        assert row.expires_at == explicit
        persisted = await _fetch_row(db_session, row.id)
        assert persisted is not None
        assert persisted.expires_at is not None
        assert persisted.expires_at.replace(tzinfo=UTC) == explicit


# ── fetch_pending ─────────────────────────────────────────────────────────────


class TestFetchPending:
    @pytest.mark.asyncio
    async def test_only_pending_returned(self, db_session) -> None:
        """补拉只回 pending：delivered/acked/expired 一律不出现（D-006）。"""
        rt = await _setup_runtime(db_session)
        now = datetime.now(UTC)
        pending = await _insert_row(db_session, rt.id, status="pending")
        await _insert_row(db_session, rt.id, status="delivered", delivered_at=now)
        await _insert_row(db_session, rt.id, status="acked", ack_at=now)
        await _insert_row(db_session, rt.id, status="expired")

        svc = ControlCommandService(db_session)
        rows = await svc.fetch_pending(rt.id)

        assert [r.id for r in rows] == [pending.id]

    @pytest.mark.asyncio
    async def test_created_at_ascending(self, db_session) -> None:
        """created_at 升序（FIFO），与插入顺序无关。"""
        rt = await _setup_runtime(db_session)
        now = datetime.now(UTC)
        oldest = await _insert_row(db_session, rt.id, created_at=now - timedelta(seconds=30))
        newest = await _insert_row(db_session, rt.id, created_at=now - timedelta(seconds=10))
        middle = await _insert_row(db_session, rt.id, created_at=now - timedelta(seconds=20))

        svc = ControlCommandService(db_session)
        rows = await svc.fetch_pending(rt.id)

        assert [r.id for r in rows] == [oldest.id, middle.id, newest.id]

    @pytest.mark.asyncio
    async def test_runtime_isolation(self, db_session) -> None:
        uid = await _create_user(db_session)
        rt_a = await _create_runtime(db_session, uid)
        rt_b = await _create_runtime(db_session, uid)
        row_a = await _insert_row(db_session, rt_a.id)
        row_b = await _insert_row(db_session, rt_b.id)

        svc = ControlCommandService(db_session)

        assert [r.id for r in await svc.fetch_pending(rt_a.id)] == [row_a.id]
        assert [r.id for r in await svc.fetch_pending(rt_b.id)] == [row_b.id]


# ── mark_delivered / ack 状态推进 ─────────────────────────────────────────────


class TestStateTransitions:
    @pytest.mark.asyncio
    async def test_mark_delivered_pending_only(self, db_session) -> None:
        rt = await _setup_runtime(db_session)
        r1 = await _insert_row(db_session, rt.id)
        r2 = await _insert_row(db_session, rt.id)

        svc = ControlCommandService(db_session)
        flipped = await svc.mark_delivered([r1.id])

        assert flipped == 1
        got1 = await _fetch_row(db_session, r1.id)
        got2 = await _fetch_row(db_session, r2.id)
        assert got1 is not None and got1.status == "delivered"
        assert got1.delivered_at is not None
        assert got2 is not None and got2.status == "pending"
        assert got2.delivered_at is None

    @pytest.mark.asyncio
    async def test_mark_delivered_skips_terminal(self, db_session) -> None:
        """已 acked/expired 的行不回退 delivered（状态机单向、幂等）。"""
        rt = await _setup_runtime(db_session)
        now = datetime.now(UTC)
        pending = await _insert_row(db_session, rt.id)
        acked = await _insert_row(db_session, rt.id, status="acked", ack_at=now)
        expired = await _insert_row(db_session, rt.id, status="expired")

        svc = ControlCommandService(db_session)
        flipped = await svc.mark_delivered([pending.id, acked.id, expired.id])

        assert flipped == 1
        assert (await _fetch_row(db_session, acked.id)).status == "acked"
        assert (await _fetch_row(db_session, expired.id)).status == "expired"

    @pytest.mark.asyncio
    async def test_ack_from_pending_and_delivered(self, db_session) -> None:
        """pending 与 delivered 均可 ack（生命周期契约表）。"""
        rt = await _setup_runtime(db_session)
        now = datetime.now(UTC)
        from_pending = await _insert_row(db_session, rt.id)
        from_delivered = await _insert_row(db_session, rt.id, status="delivered", delivered_at=now)

        svc = ControlCommandService(db_session)
        flipped = await svc.ack([from_pending.id, from_delivered.id])

        assert flipped == 2
        got_a = await _fetch_row(db_session, from_pending.id)
        got_b = await _fetch_row(db_session, from_delivered.id)
        assert got_a is not None and got_a.status == "acked"
        assert got_a.ack_at is not None
        assert got_b is not None and got_b.status == "acked"
        assert got_b.ack_at is not None

    @pytest.mark.asyncio
    async def test_ack_idempotent_on_terminal(self, db_session) -> None:
        """已 acked/expired 的行 ack 不翻转（幂等，返回 0）。"""
        rt = await _setup_runtime(db_session)
        now = datetime.now(UTC)
        acked = await _insert_row(db_session, rt.id, status="acked", ack_at=now)
        expired = await _insert_row(db_session, rt.id, status="expired")

        svc = ControlCommandService(db_session)
        flipped = await svc.ack([acked.id, expired.id])

        assert flipped == 0
        assert (await _fetch_row(db_session, acked.id)).status == "acked"
        assert (await _fetch_row(db_session, expired.id)).status == "expired"

    @pytest.mark.asyncio
    async def test_empty_ids_short_circuit(self, db_session) -> None:
        rt = await _setup_runtime(db_session)
        svc = ControlCommandService(db_session)

        assert await svc.mark_delivered([]) == 0
        assert await svc.ack([]) == 0
        assert (await svc.fetch_pending(rt.id)) == []


# ── gc ────────────────────────────────────────────────────────────────────────


class TestGc:
    @pytest.mark.asyncio
    async def test_gc_expires_stale_pending(self, db_session) -> None:
        """pending 且 expires_at < now → expired；未过期与 expires_at NULL 不动。"""
        rt = await _setup_runtime(db_session)
        now = datetime.now(UTC)
        stale = await _insert_row(db_session, rt.id, expires_at=now - timedelta(minutes=1))
        fresh = await _insert_row(db_session, rt.id, expires_at=now + timedelta(minutes=10))
        no_expiry = await _insert_row(db_session, rt.id, expires_at=None)

        svc = ControlCommandService(db_session)
        result = await svc.gc(now)

        assert result.expired == 1
        assert result.deleted == 0
        assert (await _fetch_row(db_session, stale.id)).status == "expired"
        assert (await _fetch_row(db_session, fresh.id)).status == "pending"
        assert (await _fetch_row(db_session, no_expiry.id)).status == "pending"

    @pytest.mark.asyncio
    async def test_gc_expires_stale_delivered(self, db_session) -> None:
        """delivered 未 ack 超 10min → expired；10min 内不动。"""
        rt = await _setup_runtime(db_session)
        now = datetime.now(UTC)
        stale = await _insert_row(
            db_session,
            rt.id,
            status="delivered",
            delivered_at=now - timedelta(seconds=DELIVERED_ACK_GRACE_SECONDS + 60),
        )
        recent = await _insert_row(
            db_session,
            rt.id,
            status="delivered",
            delivered_at=now - timedelta(seconds=60),
        )

        svc = ControlCommandService(db_session)
        result = await svc.gc(now)

        assert result.expired == 1
        assert (await _fetch_row(db_session, stale.id)).status == "expired"
        assert (await _fetch_row(db_session, recent.id)).status == "delivered"

    @pytest.mark.asyncio
    async def test_gc_deletes_old_acked(self, db_session) -> None:
        """acked 超 1h → DELETE；1h 内保留（观测窗口）。"""
        rt = await _setup_runtime(db_session)
        now = datetime.now(UTC)
        old = await _insert_row(
            db_session,
            rt.id,
            status="acked",
            ack_at=now - timedelta(seconds=ACK_RETENTION_SECONDS + 60),
        )
        recent = await _insert_row(
            db_session,
            rt.id,
            status="acked",
            ack_at=now - timedelta(minutes=30),
        )

        svc = ControlCommandService(db_session)
        result = await svc.gc(now)

        assert result.expired == 0
        assert result.deleted == 1
        assert await _fetch_row(db_session, old.id) is None
        assert (await _fetch_row(db_session, recent.id)).status == "acked"

    @pytest.mark.asyncio
    async def test_gc_full_lifecycle_sweep(self, db_session) -> None:
        """三路同轮命中：pending 过期 + delivered 超时 → expired 计 2，acked 超龄 → 删 1。"""
        rt = await _setup_runtime(db_session)
        now = datetime.now(UTC)
        await _insert_row(db_session, rt.id, expires_at=now - timedelta(minutes=1))
        await _insert_row(
            db_session,
            rt.id,
            status="delivered",
            delivered_at=now - timedelta(seconds=DELIVERED_ACK_GRACE_SECONDS + 1),
        )
        await _insert_row(
            db_session,
            rt.id,
            status="acked",
            ack_at=now - timedelta(seconds=ACK_RETENTION_SECONDS + 1),
        )

        svc = ControlCommandService(db_session)
        result = await svc.gc(now)

        assert result.expired == 2
        assert result.deleted == 1
        rows = await _fetch_all(db_session, rt.id)
        # acked 已物理删除；剩两行均为 expired；fetch_pending 不再回任何行。
        assert sorted(r.status for r in rows) == ["expired", "expired"]
        assert await svc.fetch_pending(rt.id) == []

    @pytest.mark.asyncio
    async def test_gc_inject_linkage_writes_failure_reason(self, db_session) -> None:
        """ql-20260831-004：inject 过期联动判失败时写可读原因到 output_redacted。

        两桶语义不同（经 SessionRunRead.failure_summary 透出到前端错误卡）：
        - pending 过期（从未送达）→ 「未能送达执行端」；
        - delivered 未 ack 超时（送达但未执行）→ 「已送达但未被执行」。
        """
        from app.modules.agent.model import AgentRun, AgentSession

        rt = await _setup_runtime(db_session)
        now = datetime.now(UTC)
        sid = uuid.uuid4()
        db_session.add(AgentSession(id=sid, user_id=rt.user_id, provider="claude", status="active"))
        run_undelivered = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            status="pending",
            agent_session_id=sid,
        )
        run_delivered = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            status="running",
            agent_session_id=sid,
        )
        db_session.add_all([run_undelivered, run_delivered])
        # pending 过期（从未投递）→ 未送达桶。
        await _insert_row(
            db_session,
            rt.id,
            expires_at=now - timedelta(minutes=1),
            payload={"run_id": str(run_undelivered.id)},
        )
        # delivered 未 ack 超 10min → 已送达未执行桶。
        await _insert_row(
            db_session,
            rt.id,
            status="delivered",
            delivered_at=now - timedelta(seconds=DELIVERED_ACK_GRACE_SECONDS + 1),
            payload={"run_id": str(run_delivered.id)},
        )

        svc = ControlCommandService(db_session)
        result = await svc.gc(now)

        assert result.expired == 2
        assert result.runs_failed == 2
        for run_id, expect_frag in (
            (run_undelivered.id, "未能送达执行端"),
            (run_delivered.id, "未被执行"),
        ):
            stmt = (
                select(AgentRun)
                .where(AgentRun.id == run_id)
                .execution_options(populate_existing=True)
            )
            got = (await db_session.execute(stmt)).scalars().one()
            assert got.status == "failed"
            assert got.error_code == "interactive_inject_send_failed"
            assert got.output_redacted is not None
            assert expect_frag in got.output_redacted


# ── cancel_pending（ql-20260903-016：派发失败收链——run 判死后 pending 指令
#    同步取消，daemon 重连补拉不再「复活」执行） ────────────────────────────────


class TestCancelPending:
    @pytest.mark.asyncio
    async def test_cancel_pending_flips_and_fetch_excludes(self, db_session) -> None:
        """pending → cancelled；fetch_pending 不再取到（补拉不会复活执行）；幂等。"""
        rt = await _setup_runtime(db_session)
        svc = ControlCommandService(db_session)
        row = await svc.enqueue(rt.id, "session_inject", {"prompt": "hi"})

        assert await svc.cancel_pending(row.id) is True

        persisted = await _fetch_row(db_session, row.id)
        assert persisted is not None
        assert persisted.status == "cancelled"
        assert await svc.fetch_pending(rt.id) == []
        # 幂等：已终态再取消返回 False。
        assert await svc.cancel_pending(row.id) is False

    @pytest.mark.asyncio
    async def test_cancel_skips_delivered(self, db_session) -> None:
        """已 delivered（daemon 已收到）不取消——迟到取消不该吞掉在途回执链路。"""
        rt = await _setup_runtime(db_session)
        svc = ControlCommandService(db_session)
        row = await svc.enqueue(rt.id, "session_end", None)
        await svc.mark_delivered([row.id])

        assert await svc.cancel_pending(row.id) is False

        persisted = await _fetch_row(db_session, row.id)
        assert persisted is not None
        assert persisted.status == "delivered"

    @pytest.mark.asyncio
    async def test_gc_purges_old_cancelled(self, db_session) -> None:
        """cancelled 终态行按 acked 同款保留期物理清理（免永久堆积）。"""
        from sqlalchemy import update

        rt = await _setup_runtime(db_session)
        svc = ControlCommandService(db_session)
        row = await svc.enqueue(rt.id, "session_interrupt", None)
        assert await svc.cancel_pending(row.id) is True
        # created_at 拨回保留期之外（服务 update 不经 identity map，直接 SQL）。
        old = datetime.now(UTC) - timedelta(seconds=ACK_RETENTION_SECONDS + 60)
        await db_session.execute(
            update(DaemonControlCommand)
            .where(DaemonControlCommand.id == row.id)
            .values(created_at=old)
        )
        await db_session.commit()

        result = await svc.gc(datetime.now(UTC))

        assert result.deleted == 1
        assert result.expired == 0
        assert result.runs_failed == 0
        assert await _fetch_row(db_session, row.id) is None

    @pytest.mark.asyncio
    async def test_session_service_cancel_helper(self, db_session) -> None:
        """SessionService._cancel_pending_control_command（收链助手）正常路径取消。"""
        from app.modules.daemon.session.service import SessionService

        rt = await _setup_runtime(db_session)
        svc = ControlCommandService(db_session)
        row = await svc.enqueue(rt.id, "session_inject", {"prompt": "hi"})

        await SessionService(db_session)._cancel_pending_control_command(row.id)

        persisted = await _fetch_row(db_session, row.id)
        assert persisted is not None
        assert persisted.status == "cancelled"
