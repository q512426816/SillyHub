"""DS-6（2026-08-21-session-reopen-resume task-05）：reconnecting 巡检收敛单测.

直调 :func:`session_reconnect_sweep_once`（无状态单次函数、注入 AsyncSession），
不依赖 60s 循环时序（acceptance：测试直接调用即全覆盖）。覆盖四组断言：

- 超时收敛：reconnecting 且 ``last_active_at`` 距今 > RECONNECTING_RETRY_WINDOW_SEC
  （180s，常量 import 自 session/service.py）→ failed + ended_at，挂起 lease
  （pending/claimed）→ cancelled；
- 不误伤：窗口内 reconnecting / active / ended / failed 会话及其 lease 原样；
- 幂等：同数据二跑收敛 0 行（条件更新，多轮/多 worker 重复无害）；
- 边界：命中行 lease 已终态（completed）不回写；软删行同样收敛（条件不挂
  deleted_at，无可见影响）。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.session.service import RECONNECTING_RETRY_WINDOW_SEC
from app.modules.daemon.sweep import session_reconnect_sweep_once

# ── Helpers（镜像 test_session_reopen.py 造数范式）──────────────────────────


async def _make_user(db: AsyncSession) -> User:
    from app.core.config import get_settings
    from app.core.security import password_hasher

    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        id=uuid.uuid4(),
        email=f"sweep-{uuid.uuid4()}@example.com",
        password_hash=password_hasher.hash("Admin123!@#"),
        display_name="sweep",
        status="active",
        is_platform_admin=True,
    )
    db.add(user)
    await db.commit()
    return user


async def _make_runtime(db: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db.add(rt)
    await db.commit()
    return rt


async def _make_lease(
    db: AsyncSession,
    runtime_id: uuid.UUID,
    *,
    status: str = "pending",
) -> DaemonTaskLease:
    """挂起 interactive lease（pending/claimed）或终态 lease（completed）。"""
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,
        kind="interactive",
        status=status,
        claimed_at=now if status == "claimed" else None,
        lease_expires_at=None,  # interactive lease 恒 NULL（DS-6 取值依据）
        attempt_number=1,
        metadata_={
            "session_id": "sdk-sess",
            "provider": "claude",
            "claim_token": f"tok-{uuid.uuid4().hex[:12]}",
        },
        created_at=now,
        updated_at=now,
    )
    db.add(lease)
    await db.commit()
    return lease


async def _make_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    *,
    status: str,
    lease_id: uuid.UUID | None,
    last_active_at: datetime | None,
    deleted_at: datetime | None = None,
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=lease_id,
        provider="claude",
        status=status,
        agent_session_id=f"sdk-{uuid.uuid4().hex[:8]}",
        config={"model": "sonnet"},
        turn_count=1,
        cwd="/workspace/proj",
        created_at=now,
        last_active_at=last_active_at,
        ended_at=now if status in ("ended", "failed") else None,
        deleted_at=deleted_at,
    )
    db.add(sess)
    await db.commit()
    return sess


async def _lease_status(db: AsyncSession, lease_id: uuid.UUID) -> str:
    return (
        await db.execute(select(DaemonTaskLease.status).where(DaemonTaskLease.id == lease_id))
    ).scalar_one()


# ── 超时收敛 ────────────────────────────────────────────────────────────────


class TestSweepConvergesStaleReconnecting:
    async def test_stale_reconnecting_converged_with_leases_cancelled(
        self, db_session: AsyncSession
    ) -> None:
        """窗口外（300s > 180s）：reconnecting → failed + ended_at 写入；挂起 lease
        两种形态（pending / claimed）均置 cancelled（DS-6 取值，非 expired）。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        stale_ts = datetime.now(UTC) - timedelta(seconds=RECONNECTING_RETRY_WINDOW_SEC + 120)
        pending_lease = await _make_lease(db_session, rt.id, status="pending")
        claimed_lease = await _make_lease(db_session, rt.id, status="claimed")
        stale_pending = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="reconnecting",
            lease_id=pending_lease.id,
            last_active_at=stale_ts,
        )
        stale_claimed = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="reconnecting",
            lease_id=claimed_lease.id,
            last_active_at=stale_ts,
        )

        converged = await session_reconnect_sweep_once(db_session)

        assert converged == 2
        for sess_id in (stale_pending.id, stale_claimed.id):
            status, ended_at = (
                await db_session.execute(
                    select(AgentSession.status, AgentSession.ended_at).where(
                        AgentSession.id == sess_id
                    )
                )
            ).one()
            assert status == "failed"
            assert ended_at is not None
        assert await _lease_status(db_session, pending_lease.id) == "cancelled"
        assert await _lease_status(db_session, claimed_lease.id) == "cancelled"

    async def test_no_candidates_returns_zero(self, db_session: AsyncSession) -> None:
        """空表/无命中：返回 0、不报错（常驻循环每 60s 空转路径）。"""
        user = await _make_user(db_session)
        await _make_runtime(db_session, user.id)

        assert await session_reconnect_sweep_once(db_session) == 0


# ── 不误伤（窗口内 / active / ended / failed）──────────────────────────────


class TestSweepDoesNotTouchHealthyOrTerminal:
    async def test_within_window_active_ended_failed_untouched(
        self, db_session: AsyncSession
    ) -> None:
        """四类不收敛：窗口内 reconnecting（60s 前）、active、ended、failed
        （含 failed 但 lease 仍 pending 的边界行）——session 与 lease 原样。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        fresh_ts = datetime.now(UTC) - timedelta(seconds=60)
        old_ts = datetime.now(UTC) - timedelta(seconds=600)

        fresh_lease = await _make_lease(db_session, rt.id, status="pending")
        fresh = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="reconnecting",
            lease_id=fresh_lease.id,
            last_active_at=fresh_ts,
        )
        active_lease = await _make_lease(db_session, rt.id, status="claimed")
        active = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="active",
            lease_id=active_lease.id,
            last_active_at=old_ts,  # active 超时也无碍：条件锁 status=reconnecting
        )
        ended_lease = await _make_lease(db_session, rt.id, status="completed")
        ended = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="ended",
            lease_id=ended_lease.id,
            last_active_at=old_ts,
        )
        failed_lease = await _make_lease(db_session, rt.id, status="pending")
        failed = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="failed",
            lease_id=failed_lease.id,
            last_active_at=old_ts,
        )

        converged = await session_reconnect_sweep_once(db_session)

        assert converged == 0
        fresh_row = (
            await db_session.execute(
                select(AgentSession.status, AgentSession.ended_at).where(
                    AgentSession.id == fresh.id
                )
            )
        ).one()
        assert fresh_row.status == "reconnecting"
        assert fresh_row.ended_at is None
        assert await _lease_status(db_session, fresh_lease.id) == "pending"

        active_row = (
            await db_session.execute(
                select(AgentSession.status).where(AgentSession.id == active.id)
            )
        ).scalar_one()
        assert active_row == "active"
        assert await _lease_status(db_session, active_lease.id) == "claimed"

        ended_row = (
            await db_session.execute(
                select(AgentSession.status, AgentSession.ended_at).where(
                    AgentSession.id == ended.id
                )
            )
        ).one()
        assert ended_row.status == "ended"
        assert ended_row.ended_at is not None
        assert await _lease_status(db_session, ended_lease.id) == "completed"

        failed_row = (
            await db_session.execute(
                select(AgentSession.status).where(AgentSession.id == failed.id)
            )
        ).scalar_one()
        assert failed_row == "failed"
        assert await _lease_status(db_session, failed_lease.id) == "pending"

    async def test_terminal_lease_of_hit_row_not_touched(self, db_session: AsyncSession) -> None:
        """命中行的 lease 已是终态（completed）→ session 照常收敛 failed，但
        lease 不回写（仅 pending/claimed 置 cancelled，幂等不翻终态）。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        done_lease = await _make_lease(db_session, rt.id, status="completed")
        stale = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="reconnecting",
            lease_id=done_lease.id,
            last_active_at=datetime.now(UTC)
            - timedelta(seconds=RECONNECTING_RETRY_WINDOW_SEC + 60),
        )

        converged = await session_reconnect_sweep_once(db_session)

        assert converged == 1
        status_row = (
            await db_session.execute(
                select(AgentSession.status, AgentSession.ended_at).where(
                    AgentSession.id == stale.id
                )
            )
        ).one()
        assert status_row.status == "failed"
        assert status_row.ended_at is not None
        assert await _lease_status(db_session, done_lease.id) == "completed"


# ── 幂等（同数据二跑收敛 0 行）─────────────────────────────────────────────


class TestSweepIdempotent:
    async def test_second_run_converges_zero_and_nothing_rewritten(
        self, db_session: AsyncSession
    ) -> None:
        """同一批数据重复执行：第二次收敛 0 行；session 终态与 ended_at、lease
        cancelled 均不被二次覆盖（多轮/多 worker 重复无害）。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        lease = await _make_lease(db_session, rt.id, status="pending")
        stale = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="reconnecting",
            lease_id=lease.id,
            last_active_at=datetime.now(UTC)
            - timedelta(seconds=RECONNECTING_RETRY_WINDOW_SEC + 90),
        )

        first = await session_reconnect_sweep_once(db_session)
        assert first == 1
        row = (
            await db_session.execute(
                select(AgentSession.status, AgentSession.ended_at).where(
                    AgentSession.id == stale.id
                )
            )
        ).one()
        assert row.status == "failed"
        first_ended_at = row.ended_at
        assert first_ended_at is not None
        assert await _lease_status(db_session, lease.id) == "cancelled"

        second = await session_reconnect_sweep_once(db_session)

        assert second == 0
        row2 = (
            await db_session.execute(
                select(AgentSession.status, AgentSession.ended_at).where(
                    AgentSession.id == stale.id
                )
            )
        ).one()
        assert row2.status == "failed"
        assert row2.ended_at == first_ended_at  # ended_at 不被二跑覆盖
        assert await _lease_status(db_session, lease.id) == "cancelled"


# ── 软删行（implementation 定案：条件不挂 deleted_at，同样收敛）────────────


class TestSweepSoftDeleted:
    async def test_soft_deleted_stale_session_also_converged(
        self, db_session: AsyncSession
    ) -> None:
        """软删（deleted_at 非空）的卡死 reconnecting 行同样收敛（无可见影响，
        条件仅 status + last_active_at 两条）。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        lease = await _make_lease(db_session, rt.id, status="pending")
        stale = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="reconnecting",
            lease_id=lease.id,
            last_active_at=datetime.now(UTC)
            - timedelta(seconds=RECONNECTING_RETRY_WINDOW_SEC + 30),
            deleted_at=datetime.now(UTC),
        )

        converged = await session_reconnect_sweep_once(db_session)

        assert converged == 1
        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == stale.id))
        ).scalar_one()
        assert status_row == "failed"
        assert await _lease_status(db_session, lease.id) == "cancelled"


# ── P2b（2026-08-24 会话审查）：runtime 离线 sweep + 终态广播 ───────────────
# task-05（2026-08-29-daemon-platform-resilience / design A5 / D-007）改挂起语义：
# active → suspended（非终态、可 recover，D-001 恢复口径）；pending 维持 failed。


class TestOfflineSweep:
    async def test_offline_runtime_active_session_converged(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """runtime 离线 + active 会话 → **suspended**（非终态，ended_at 不写）+
        挂起 run failed + 挂起 lease cancelled；suspended 非终态**不发
        session_ended**（只发列表 status_changed，SSE 会话流继续 keepalive）。"""
        from app.modules.daemon import sweep as sweep_mod

        captured: list[tuple[str, str]] = []

        class _FakeRedis:
            async def publish(self, channel: str, payload: str) -> int:
                captured.append((channel, payload))
                return 1

        monkeypatch.setattr(sweep_mod, "get_redis", lambda: _FakeRedis())

        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        rt.status = "offline"
        rt.last_heartbeat_at = datetime.now(UTC) - timedelta(
            seconds=sweep_mod.RUNTIME_OFFLINE_GRACE_SEC + 60
        )
        db_session.add(rt)
        lease = await _make_lease(db_session, rt.id, status="claimed")
        sess = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="active",
            lease_id=lease.id,
            last_active_at=datetime.now(UTC),
        )
        # 挂起 run（running，挂在会话上）
        from app.modules.agent.model import AgentRun

        run = AgentRun(agent_type="claude_code", status="running", agent_session_id=sess.id)
        db_session.add(run)
        await db_session.commit()

        converged = await sweep_mod.session_offline_sweep_once(db_session)

        assert converged == 1
        row = (
            await db_session.execute(
                select(AgentSession.status, AgentSession.ended_at).where(AgentSession.id == sess.id)
            )
        ).one()
        assert row.status == "suspended"  # task-05：active 档收敛改挂起（原 failed）
        assert row.ended_at is None  # 非终态不写 ended_at
        assert await _lease_status(db_session, lease.id) == "cancelled"
        run_status = (
            await db_session.execute(select(AgentRun.status).where(AgentRun.id == run.id))
        ).scalar_one()
        assert run_status == "failed"
        # suspended 非终态：不广播 session_ended（SSE 流不收尾，列表经 status_changed 刷新）
        events = [json.loads(p) for ch, p in captured if ch == f"agent_session:{sess.id}"]
        assert not any(e.get("event") == "session_ended" for e in events)

    async def test_online_runtime_session_untouched(self, db_session: AsyncSession) -> None:
        """runtime 在线且心跳新鲜 → active 会话不收敛（不误伤）。"""
        from app.modules.daemon import sweep as sweep_mod

        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)  # online + 新鲜心跳
        lease = await _make_lease(db_session, rt.id, status="pending")
        sess = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="active",
            lease_id=lease.id,
            last_active_at=datetime.now(UTC),
        )

        converged = await sweep_mod.session_offline_sweep_once(db_session)

        assert converged == 0
        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "active"
        assert await _lease_status(db_session, lease.id) == "pending"

    async def test_pending_session_offline_converged(self, db_session: AsyncSession) -> None:
        """pending 会话（派发后 daemon 从未就绪即死）**维持 failed**（task-05 /
        D-007：daemon 本地无快照记录，suspended 无人 recover）。"""
        from app.modules.daemon import sweep as sweep_mod

        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        rt.last_heartbeat_at = datetime.now(UTC) - timedelta(
            seconds=sweep_mod.RUNTIME_OFFLINE_GRACE_SEC + 300
        )
        db_session.add(rt)
        lease = await _make_lease(db_session, rt.id, status="pending")
        sess = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="pending",
            lease_id=lease.id,
            last_active_at=datetime.now(UTC),
        )
        await db_session.commit()

        converged = await sweep_mod.session_offline_sweep_once(db_session)

        assert converged == 1
        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "failed"

    async def test_idempotent_second_run(self, db_session: AsyncSession) -> None:
        """同数据二跑收敛 0 行（状态条件挡住，多轮/多 worker 幂等）。"""
        from app.modules.daemon import sweep as sweep_mod

        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        rt.status = "offline"
        db_session.add(rt)
        lease = await _make_lease(db_session, rt.id, status="pending")
        await _make_session(
            db_session,
            user.id,
            rt.id,
            status="active",
            lease_id=lease.id,
            last_active_at=datetime.now(UTC),
        )
        await db_session.commit()

        assert await sweep_mod.session_offline_sweep_once(db_session) == 1
        assert await sweep_mod.session_offline_sweep_once(db_session) == 0


# ── ql-20260903-017：failed 收敛同步清理排队消息（队列不留永久「等待中」）────


async def _make_queued(
    db: AsyncSession,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    status: str = "pending",
) -> uuid.UUID:
    from app.modules.agent.model import AgentSessionQueuedMessage

    row = AgentSessionQueuedMessage(
        id=uuid.uuid4(),
        agent_session_id=session_id,
        sender_user_id=user_id,
        prompt="排队中的追问",
        status=status,
    )
    db.add(row)
    await db.commit()
    return row.id


async def _queued_status(db: AsyncSession, queued_id: uuid.UUID) -> tuple[str, str | None]:
    from sqlalchemy import select as sa_select

    from app.modules.agent.model import AgentSessionQueuedMessage

    row = (
        await db.execute(
            sa_select(AgentSessionQueuedMessage.status, AgentSessionQueuedMessage.error_msg).where(
                AgentSessionQueuedMessage.id == queued_id
            )
        )
    ).one()
    return row.status, row.error_msg


class TestSweepFailsQueuedMessages:
    async def test_reconnecting_converge_fails_pending_queue(
        self, db_session: AsyncSession
    ) -> None:
        """超时收敛 failed 时，pending 排队条目同步翻 failed 带可读原因。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        lease = await _make_lease(db_session, rt.id)
        sess = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="reconnecting",
            lease_id=lease.id,
            last_active_at=datetime.now(UTC)
            - timedelta(seconds=RECONNECTING_RETRY_WINDOW_SEC + 60),
        )
        queued_id = await _make_queued(db_session, sess.id, user.id)

        assert await session_reconnect_sweep_once(db_session) == 1

        status, error_msg = await _queued_status(db_session, queued_id)
        assert status == "failed"
        assert error_msg is not None and "排队消息未发送" in error_msg

    async def test_offline_pending_session_fails_queue(self, db_session: AsyncSession) -> None:
        """runtime 离线 pending 档收敛 failed 时，排队条目同步翻 failed。"""
        import app.modules.daemon.sweep as sweep_mod

        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        # runtime 离线：心跳早于宽限窗。
        rt.status = "offline"
        rt.last_heartbeat_at = datetime.now(UTC) - timedelta(seconds=900)
        db_session.add(rt)
        await db_session.commit()
        sess = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="pending",
            lease_id=None,
            last_active_at=datetime.now(UTC),
        )
        queued_id = await _make_queued(db_session, sess.id, user.id)

        assert await sweep_mod.session_offline_sweep_once(db_session) >= 1

        status, error_msg = await _queued_status(db_session, queued_id)
        assert status == "failed"
        assert error_msg is not None and "排队消息未发送" in error_msg

    async def test_within_window_reconnecting_queue_untouched(
        self, db_session: AsyncSession
    ) -> None:
        """窗口内会话不被收敛，排队条目保持 pending（不误伤活会话）。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        sess = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="reconnecting",
            lease_id=None,
            last_active_at=datetime.now(UTC) - timedelta(seconds=10),
        )
        queued_id = await _make_queued(db_session, sess.id, user.id)

        assert await session_reconnect_sweep_once(db_session) == 0

        status, _ = await _queued_status(db_session, queued_id)
        assert status == "pending"
