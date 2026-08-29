"""2026-08-29-daemon-platform-resilience task-05：backend 会话挂起语义单测.

design A5 / FR-04 / D-001（恢复口径）/ D-007（pending 归宿、recover 非白名单）。
四组断言（sweep 侧直接调 ``*_once`` 单拍，时间阈值在造数侧落死——fake 时钟
语义由数据时间戳承载，不依赖 60s 循环时序）：

- **suspend-batch 三步收敛 + 幂等**（service 直调 + router 端点鉴权）：该
  daemon 全部 active 会话 → suspended（非终态不写 ended_at、写 last_active_at
  作 24h GC 基准）、中断轮 run → failed（error_code=daemon_stopped）、挂起
  lease → cancelled；重复调用 no-op（0/0）；pending / 终态 / 他 daemon 会话
  不动；越权/不存在 daemon 404；
- **offline sweep 改语义**：active → suspended（只发列表 status_changed，
  不发 session_ended）；pending 维持 failed（发 session_ended）；
- **suspended 超龄 GC**：超 ``SUSPENDED_MAX_AGE_SEC``（24h）→ failed +
  ended_at + session_ended（reason=suspended_expired）+ status_changed；
  未超龄不动；二跑幂等；
- **recover 非白名单三态锁定**（D-007）：suspended / pending / reconnecting
  均 recover → reconnecting 且 claim_token 轮换（既有 recover 状态守卫零
  改动，本组仅用例化锁定语义）。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import (
    DAEMON_STOPPED_ERROR_CODE,
    SessionService,
)

# ── helpers（镜像 test_session_reconnect_sweep / test_session_recovery 造数范式）──


async def _make_user(db: AsyncSession, *, prefix: str = "susp") -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"{prefix}-{uuid.uuid4()}@example.com",
        password_hash="x",
        display_name="susp",
        status="active",
    )
    db.add(user)
    await db.commit()
    return user


async def _make_instance(db: AsyncSession, user_id: uuid.UUID) -> DaemonInstance:
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=f"host-{uuid.uuid4().hex[:6]}",
        server_url="http://localhost:8000",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db.add(inst)
    await db.commit()
    return inst


async def _make_runtime(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    daemon_instance_id: uuid.UUID | None = None,
    status: str = "online",
    heartbeat: datetime | None = None,
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        daemon_instance_id=daemon_instance_id,
        name="daemon",
        provider="claude",
        status=status,
        last_heartbeat_at=heartbeat if heartbeat is not None else datetime.now(UTC),
    )
    db.add(rt)
    await db.commit()
    return rt


async def _make_lease(
    db: AsyncSession,
    runtime_id: uuid.UUID,
    *,
    status: str = "claimed",
    claim_token: str = "tok-old",
) -> DaemonTaskLease:
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,
        kind="interactive",
        status=status,
        claimed_at=now if status == "claimed" else None,
        lease_expires_at=None,  # interactive lease 恒 NULL
        attempt_number=1,
        metadata_={"session_id": "sdk-sess", "claim_token": claim_token},
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
    last_active_at: datetime | None = None,
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
        last_active_at=last_active_at if last_active_at is not None else now,
        ended_at=now if status in ("ended", "failed") else None,
    )
    db.add(sess)
    await db.commit()
    return sess


async def _make_run(
    db: AsyncSession,
    session_id: uuid.UUID,
    *,
    status: str = "running",
) -> AgentRun:
    run = AgentRun(agent_type="claude_code", status=status, agent_session_id=session_id)
    db.add(run)
    await db.commit()
    return run


async def _lease_status(db: AsyncSession, lease_id: uuid.UUID) -> str:
    return (
        await db.execute(select(DaemonTaskLease.status).where(DaemonTaskLease.id == lease_id))
    ).scalar_one()


def _capture_publish(monkeypatch: pytest.MonkeyPatch, module_path: str) -> list[tuple]:
    """把 ``module_path.publish_sessions_changed`` 换成捕获桩，返回调用记录。"""
    calls: list[tuple] = []

    async def _fake_publish(event, session_id, user_id):
        calls.append((event, session_id, user_id))

    monkeypatch.setattr(f"{module_path}.publish_sessions_changed", _fake_publish)
    return calls


def _capture_sweep_redis(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str]]:
    """捕获 sweep 模块 per-session 频道（``agent_session:{id}``）的 publish。"""
    from app.modules.daemon import sweep as sweep_mod

    captured: list[tuple[str, str]] = []

    class _FakeRedis:
        async def publish(self, channel: str, payload: str) -> int:
            captured.append((channel, payload))
            return 1

    monkeypatch.setattr(sweep_mod, "get_redis", lambda: _FakeRedis())
    return captured


async def _session_row(db: AsyncSession, session_id: uuid.UUID):
    return (
        await db.execute(
            select(
                AgentSession.status,
                AgentSession.ended_at,
                AgentSession.last_active_at,
            ).where(AgentSession.id == session_id)
        )
    ).one()


# ── 1. suspend-batch：三步收敛 + 幂等 + 圈定 ─────────────────────────────────


class TestSuspendBatch:
    async def test_active_converged_three_steps(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """active 会话三步收敛：suspended（无 ended_at、刷新 last_active_at）+
        run failed（daemon_stopped）+ lease cancelled；只发列表 status_changed。"""
        calls = _capture_publish(monkeypatch, "app.modules.daemon.session.service")
        user = await _make_user(db_session)
        inst = await _make_instance(db_session, user.id)
        rt = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        lease = await _make_lease(db_session, rt.id, status="claimed")
        sess = await _make_session(db_session, user.id, rt.id, status="active", lease_id=lease.id)
        run = await _make_run(db_session, sess.id, status="running")
        old_last_active = sess.last_active_at

        result = await SessionService(db_session).suspend_sessions_for_daemon(inst.id)

        assert result.suspended == 1
        assert result.runs_failed == 1
        row = await _session_row(db_session, sess.id)
        assert row.status == "suspended"
        assert row.ended_at is None  # 非终态不写 ended_at
        assert row.last_active_at is not None
        # SQLite 读回 naive datetime，按 UTC 补 tz 再比（先例 reopen 窗口判断）。
        new_last_active = row.last_active_at
        if new_last_active.tzinfo is None:
            new_last_active = new_last_active.replace(tzinfo=UTC)
        assert new_last_active > old_last_active  # 挂起时刻刷新（GC 基准）
        run_row = (
            await db_session.execute(
                select(AgentRun.status, AgentRun.error_code, AgentRun.finished_at).where(
                    AgentRun.id == run.id
                )
            )
        ).one()
        assert run_row.status == "failed"
        assert run_row.error_code == DAEMON_STOPPED_ERROR_CODE
        assert run_row.finished_at is not None
        assert await _lease_status(db_session, lease.id) == "cancelled"
        # suspended 非终态：只发列表变更信号
        assert calls == [("status_changed", sess.id, user.id)]

    async def test_second_call_idempotent_noop(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """幂等重入：重复调用 0/0，suspended/failed/cancelled 原样、不二次覆盖。"""
        user = await _make_user(db_session, prefix="susp-idem")
        inst = await _make_instance(db_session, user.id)
        rt = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        lease = await _make_lease(db_session, rt.id, status="pending")
        sess = await _make_session(db_session, user.id, rt.id, status="active", lease_id=lease.id)
        run = await _make_run(db_session, sess.id, status="running")
        svc = SessionService(db_session)

        first = await svc.suspend_sessions_for_daemon(inst.id)
        assert (first.suspended, first.runs_failed) == (1, 1)
        first_ended_at, first_finished_at = (
            (await _session_row(db_session, sess.id)).ended_at,
            (
                await db_session.execute(select(AgentRun.finished_at).where(AgentRun.id == run.id))
            ).scalar_one(),
        )

        calls = _capture_publish(monkeypatch, "app.modules.daemon.session.service")
        second = await svc.suspend_sessions_for_daemon(inst.id)

        assert (second.suspended, second.runs_failed) == (0, 0)
        row = await _session_row(db_session, sess.id)
        assert row.status == "suspended"
        assert row.ended_at == first_ended_at
        assert (
            await db_session.execute(
                select(AgentRun.status, AgentRun.finished_at).where(AgentRun.id == run.id)
            )
        ).one() == ("failed", first_finished_at)
        assert await _lease_status(db_session, lease.id) == "cancelled"
        assert calls == []  # 无变更零发布

    async def test_pending_terminal_other_daemon_untouched(self, db_session: AsyncSession) -> None:
        """圈定语义：同 daemon 的 pending/ended 会话与他 daemon 的 active 会话均不动。"""
        user = await _make_user(db_session, prefix="susp-scope")
        inst = await _make_instance(db_session, user.id)
        rt = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        other_inst = await _make_instance(db_session, user.id)
        other_rt = await _make_runtime(db_session, user.id, daemon_instance_id=other_inst.id)

        pending = await _make_session(db_session, user.id, rt.id, status="pending", lease_id=None)
        ended = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        foreign = await _make_session(
            db_session, user.id, other_rt.id, status="active", lease_id=None
        )

        result = await SessionService(db_session).suspend_sessions_for_daemon(inst.id)

        assert result.suspended == 0
        assert result.runs_failed == 0
        assert (
            await db_session.execute(
                select(AgentSession.status).where(AgentSession.id == pending.id)
            )
        ).scalar_one() == "pending"
        assert (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == ended.id))
        ).scalar_one() == "ended"
        assert (
            await db_session.execute(
                select(AgentSession.status).where(AgentSession.id == foreign.id)
            )
        ).scalar_one() == "active"

    async def test_no_runtimes_returns_zero(self, db_session: AsyncSession) -> None:
        """无 runtime 的 daemon（或未知 id）→ 0/0，不报错。"""
        user = await _make_user(db_session, prefix="susp-empty")
        inst = await _make_instance(db_session, user.id)

        result = await SessionService(db_session).suspend_sessions_for_daemon(inst.id)

        assert (result.suspended, result.runs_failed) == (0, 0)


# ── 2. suspend-batch router 端点（鉴权归属 + 响应契约）───────────────────────


def _token_for(user: User) -> str:
    from app.core.config import get_settings
    from app.core.security import create_access_token

    settings = get_settings()
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=bool(user.is_platform_admin),
        settings=settings,
    )
    return token


class TestSuspendBatchEndpoint:
    async def test_endpoint_owner_converges(self, client, db_session: AsyncSession) -> None:
        """owner 经端点挂起：200 + {suspended, runs_failed} 计数，三步落库。"""
        user = await _make_user(db_session, prefix="susp-ep")
        inst = await _make_instance(db_session, user.id)
        rt = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        lease = await _make_lease(db_session, rt.id, status="claimed")
        sess = await _make_session(db_session, user.id, rt.id, status="active", lease_id=lease.id)
        run = await _make_run(db_session, sess.id, status="running")

        resp = await client.post(
            "/api/daemon/sessions/suspend-batch",
            json={"daemon_local_id": str(inst.id)},
            headers={"Authorization": f"Bearer {_token_for(user)}"},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"suspended": 1, "runs_failed": 1}
        assert (await _session_row(db_session, sess.id)).status == "suspended"
        assert (
            await db_session.execute(
                select(AgentRun.status, AgentRun.error_code).where(AgentRun.id == run.id)
            )
        ).one() == ("failed", DAEMON_STOPPED_ERROR_CODE)
        assert await _lease_status(db_session, lease.id) == "cancelled"

    async def test_endpoint_cross_user_404(self, client, db_session: AsyncSession) -> None:
        """越权（他人 daemon）与不存在 daemon 同语义 404，不泄露存在性。"""
        owner = await _make_user(db_session, prefix="susp-own")
        inst = await _make_instance(db_session, owner.id)
        stranger = await _make_user(db_session, prefix="susp-str")

        resp = await client.post(
            "/api/daemon/sessions/suspend-batch",
            json={"daemon_local_id": str(inst.id)},
            headers={"Authorization": f"Bearer {_token_for(stranger)}"},
        )
        assert resp.status_code == 404

        resp_missing = await client.post(
            "/api/daemon/sessions/suspend-batch",
            json={"daemon_local_id": str(uuid.uuid4())},
            headers={"Authorization": f"Bearer {_token_for(owner)}"},
        )
        assert resp_missing.status_code == 404


# ── 3. offline sweep 改语义（active→suspended / pending→failed）──────────────


class TestOfflineSweepSuspendSemantics:
    async def test_offline_active_to_suspended_no_session_ended(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """active + runtime 离线 → suspended（ended_at 不写）；run failed /
        lease cancelled 维持现状；广播只发 status_changed 不发 session_ended。"""
        from app.modules.daemon import sweep as sweep_mod

        captured = _capture_sweep_redis(monkeypatch)
        calls = _capture_publish(monkeypatch, "app.modules.daemon.sweep")
        user = await _make_user(db_session, prefix="susp-off")
        rt = await _make_runtime(
            db_session,
            user.id,
            status="offline",
            heartbeat=datetime.now(UTC)
            - timedelta(seconds=sweep_mod.RUNTIME_OFFLINE_GRACE_SEC + 60),
        )
        lease = await _make_lease(db_session, rt.id, status="claimed")
        sess = await _make_session(db_session, user.id, rt.id, status="active", lease_id=lease.id)
        run = await _make_run(db_session, sess.id, status="running")

        converged = await sweep_mod.session_offline_sweep_once(db_session)

        assert converged == 1
        row = await _session_row(db_session, sess.id)
        assert row.status == "suspended"
        assert row.ended_at is None
        assert (
            await db_session.execute(select(AgentRun.status).where(AgentRun.id == run.id))
        ).scalar_one() == "failed"
        assert await _lease_status(db_session, lease.id) == "cancelled"
        # 非终态：per-session 频道零 publish（无 session_ended 收尾）
        events = [json.loads(p) for ch, p in captured if ch == f"agent_session:{sess.id}"]
        assert not any(e.get("event") == "session_ended" for e in events)
        assert calls == [("status_changed", sess.id, user.id)]

    async def test_offline_pending_stays_failed_with_session_ended(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """pending + runtime 离线 → 维持 failed + ended_at + session_ended（D-007）。"""
        from app.modules.daemon import sweep as sweep_mod

        captured = _capture_sweep_redis(monkeypatch)
        calls = _capture_publish(monkeypatch, "app.modules.daemon.sweep")
        user = await _make_user(db_session, prefix="susp-off-p")
        rt = await _make_runtime(
            db_session,
            user.id,
            heartbeat=datetime.now(UTC)
            - timedelta(seconds=sweep_mod.RUNTIME_OFFLINE_GRACE_SEC + 300),
        )
        sess = await _make_session(db_session, user.id, rt.id, status="pending", lease_id=None)

        converged = await sweep_mod.session_offline_sweep_once(db_session)

        assert converged == 1
        row = await _session_row(db_session, sess.id)
        assert row.status == "failed"
        assert row.ended_at is not None
        events = [json.loads(p) for ch, p in captured if ch == f"agent_session:{sess.id}"]
        assert any(
            e.get("event") == "session_ended" and e.get("reason") == "runtime_offline"
            for e in events
        )
        assert calls == [("status_changed", sess.id, user.id)]

    async def test_suspended_overage_gc_to_failed(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """超龄 24h 的 suspended → failed + ended_at + session_ended
        （reason=suspended_expired，此时才发终态事件）+ status_changed。"""
        from app.modules.daemon import sweep as sweep_mod

        captured = _capture_sweep_redis(monkeypatch)
        calls = _capture_publish(monkeypatch, "app.modules.daemon.sweep")
        user = await _make_user(db_session, prefix="susp-gc")
        rt = await _make_runtime(db_session, user.id)  # online：GC 纯年龄驱动
        sess = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="suspended",
            lease_id=None,
            last_active_at=datetime.now(UTC)
            - timedelta(seconds=sweep_mod.SUSPENDED_MAX_AGE_SEC + 3600),
        )

        converged = await sweep_mod.session_offline_sweep_once(db_session)

        assert converged == 1
        row = await _session_row(db_session, sess.id)
        assert row.status == "failed"
        assert row.ended_at is not None
        events = [json.loads(p) for ch, p in captured if ch == f"agent_session:{sess.id}"]
        assert any(
            e.get("event") == "session_ended" and e.get("reason") == "suspended_expired"
            for e in events
        )
        assert calls == [("status_changed", sess.id, user.id)]

    async def test_suspended_within_age_untouched(self, db_session: AsyncSession) -> None:
        """未超龄（1h）suspended 不被 GC，runtime 在线也无离线收敛 → 0。"""
        from app.modules.daemon import sweep as sweep_mod

        user = await _make_user(db_session, prefix="susp-fresh")
        rt = await _make_runtime(db_session, user.id)
        sess = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="suspended",
            lease_id=None,
            last_active_at=datetime.now(UTC) - timedelta(hours=1),
        )

        converged = await sweep_mod.session_offline_sweep_once(db_session)

        assert converged == 0
        assert (await _session_row(db_session, sess.id)).status == "suspended"

    async def test_gc_and_offline_idempotent_second_run(self, db_session: AsyncSession) -> None:
        """双路径二跑幂等：离线挂起 + 超龄 GC 后再跑一轮收敛 0 行。"""
        from app.modules.daemon import sweep as sweep_mod

        user = await _make_user(db_session, prefix="susp-idem2")
        off_rt = await _make_runtime(
            db_session, user.id, status="offline", heartbeat=datetime.now(UTC) - timedelta(hours=2)
        )
        await _make_session(db_session, user.id, off_rt.id, status="active", lease_id=None)
        gc_rt = await _make_runtime(db_session, user.id)
        await _make_session(
            db_session,
            user.id,
            gc_rt.id,
            status="suspended",
            lease_id=None,
            last_active_at=datetime.now(UTC)
            - timedelta(seconds=sweep_mod.SUSPENDED_MAX_AGE_SEC + 60),
        )

        first = await sweep_mod.session_offline_sweep_once(db_session)
        second = await sweep_mod.session_offline_sweep_once(db_session)

        assert first == 2  # 一 suspended（active 档）+ 一 failed（GC 档）
        assert second == 0

    async def test_mixed_round_suspended_and_failed_split(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """同一轮分流：同 daemon 离线的 active→suspended、pending→failed 各归其位。"""
        from app.modules.daemon import sweep as sweep_mod

        _capture_sweep_redis(monkeypatch)
        calls = _capture_publish(monkeypatch, "app.modules.daemon.sweep")
        user = await _make_user(db_session, prefix="susp-mix")
        rt = await _make_runtime(
            db_session,
            user.id,
            status="offline",
            heartbeat=datetime.now(UTC) - timedelta(hours=1),
        )
        active_sess = await _make_session(
            db_session, user.id, rt.id, status="active", lease_id=None
        )
        pending_sess = await _make_session(
            db_session, user.id, rt.id, status="pending", lease_id=None
        )

        converged = await sweep_mod.session_offline_sweep_once(db_session)

        assert converged == 2
        assert (await _session_row(db_session, active_sess.id)).status == "suspended"
        pending_row = await _session_row(db_session, pending_sess.id)
        assert pending_row.status == "failed"
        assert pending_row.ended_at is not None
        assert sorted(calls, key=lambda c: str(c[1])) == sorted(
            [
                ("status_changed", active_sess.id, user.id),
                ("status_changed", pending_sess.id, user.id),
            ],
            key=lambda c: str(c[1]),
        )


# ── 4. recover 非白名单三态锁定（D-007：不加白名单分支，用例化锁定）──────────


class TestRecoverThreeStates:
    @pytest.fixture()
    def mocked_redis(self):
        redis = AsyncMock()
        redis.publish = AsyncMock()
        with patch("app.modules.daemon.session.service.get_redis", return_value=redis) as yielded:
            yield yielded

    async def _seed(
        self,
        db: AsyncSession,
        *,
        session_status: str,
        run_status: str | None = None,
    ) -> tuple[DaemonRuntime, DaemonTaskLease, AgentSession, AgentRun | None]:
        """pending/reconnecting 用例缺省不造 run——recover 的不变式守卫要求
        活跃 run 必须以 interrupted_run_id 显式交代（本组只锁定状态守卫语义）。"""
        user = await _make_user(db, prefix="susp-rec")
        rt = await _make_runtime(db, user.id)
        lease = await _make_lease(db, rt.id, status="claimed", claim_token="tok-old")
        sess = await _make_session(db, user.id, rt.id, status=session_status, lease_id=lease.id)
        run = await _make_run(db, sess.id, status=run_status) if run_status else None
        return rt, lease, sess, run

    async def test_recover_suspended_flips_reconnecting_with_token_rotation(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """suspend-batch 挂起后的会话（lease 已 cancelled）仍可 recover →
        reconnecting + claim_token 轮换（闭环成立：recover 只查 kind 不查 status）。"""
        user = await _make_user(db_session, prefix="susp-rec-s")
        inst = await _make_instance(db_session, user.id)
        rt = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        lease = await _make_lease(db_session, rt.id, status="claimed", claim_token="tok-old")
        sess = await _make_session(db_session, user.id, rt.id, status="active", lease_id=lease.id)
        run = await _make_run(db_session, sess.id, status="running")
        await SessionService(db_session).suspend_sessions_for_daemon(inst.id)
        assert (await _session_row(db_session, sess.id)).status == "suspended"
        assert await _lease_status(db_session, lease.id) == "cancelled"

        result = await DaemonService(db_session).recover_session_after_daemon_restart(
            sess.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-1",
            interrupted_run_id=run.id,
        )

        assert result.status == "reconnecting"
        await db_session.refresh(lease)
        new_token = (lease.metadata_ or {}).get("claim_token")
        assert new_token is not None and new_token != "tok-old"
        assert (await _session_row(db_session, sess.id)).status == "reconnecting"

    async def test_recover_pending_flips_reconnecting(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """pending 态 recover → reconnecting（非白名单：非终态一律可 recover）。"""
        rt, lease, sess, _run = await self._seed(db_session, session_status="pending")

        result = await DaemonService(db_session).recover_session_after_daemon_restart(
            sess.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-1",
            interrupted_run_id=None,
        )

        assert result.status == "reconnecting"
        assert (await _session_row(db_session, sess.id)).status == "reconnecting"

    async def test_recover_reconnecting_stays_reconnecting(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """reconnecting 态重复 recover → 仍 reconnecting（幂等，token 再轮换）。"""
        rt, lease, sess, _run = await self._seed(db_session, session_status="reconnecting")

        result = await DaemonService(db_session).recover_session_after_daemon_restart(
            sess.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-1",
            interrupted_run_id=None,
        )

        assert result.status == "reconnecting"
        await db_session.refresh(lease)
        assert (lease.metadata_ or {}).get("claim_token") != "tok-old"
