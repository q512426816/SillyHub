"""2026-08-25 会话服务层审查修复（F2）回归测试。

覆盖 6 项修复：
1. P1 归档/取消归档 commit 后发布 agent_sessions:changed 列表信号（幂等零发布）
   ——修复前两方法不发信号，已打开 SSE 的其它客户端看不到归档变更；
2. P1 end_session 本地收口先 commit 释放行锁、SESSION_END WS 后发
   ——用发送时刻的独立连接快照钉死「WS 发送时 killed 已对其它连接可见」；
3. P1 close_interactive_run 终态竞态——end_session 先收口 killed 后，迟到的
   close（success）不得把 killed 覆写成 completed（FOR UPDATE 读 + 终态守卫）；
4. P1 sync_agent_run_status 终态守卫（迟到 running 不复活终态 run；同值重发
   幂等）+ LeaseSyncRequest Literal 枚举（非法 status 直接 ValidationError）；
5. P2 end_session 幂等早退扩到 failed（终态不被翻 ended、无 WS）+ 已 cancelled
   的 lease 不被改写 completed / terminating_at 不被清；
6. P2 reopen_session 对 runtime_id=None 显式抛 DaemonSessionInvariantViolation
   （原 ``if runtime_id is not None`` 短路在线检查 + ``python -O`` 下会被剥除
   的 assert 兜底）。

fixture 范式参照 test_session_delete_active.py / test_close_interactive_run_
session_status.py / test_session_events_cross.py。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.schema import LeaseSyncRequest
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import DaemonSessionInvariantViolation

# ── Fixtures / helpers ───────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"f2-{uid}@example.com",
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


def _mock_hub() -> MagicMock:
    hub = MagicMock()
    hub.is_connected.return_value = True
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=True)
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
    with (
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
    ):
        yield redis


_UNBOUND = object()  # sentinel：_make_session(bind_runtime=_UNBOUND) 显式写 NULL


async def _make_session(
    db_session: AsyncSession,
    *,
    uid: uuid.UUID,
    runtime_id: uuid.UUID,
    status: str = "active",
    lease_status: str = "pending",
    run_status: str | None = "running",
    bind_runtime: object = None,
    lease_extra: dict | None = None,
) -> tuple[AgentSession, DaemonTaskLease, AgentRun | None]:
    """direct 行种子：session + interactive lease（带 claim_token）+ 可选 run。

    ``bind_runtime``：None（默认）= session.runtime_id 绑 runtime_id；
    ``_UNBOUND`` = 显式写 NULL（数据损坏场景）。
    """
    now = datetime.now(UTC)
    session_id = uuid.uuid4()
    session_runtime_id = runtime_id if bind_runtime is None else None
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,
        kind="interactive",
        status=lease_status,
        created_at=now,
        updated_at=now,
        # close_interactive_run 的绑定校验读 metadata.session_id（interactive
        # lease.agent_run_id 恒 NULL，D-005@v1），必须与 run.agent_session_id 一致。
        metadata_={"claim_token": "tok", "session_id": str(session_id)},
    )
    if lease_extra:
        for key, value in lease_extra.items():
            setattr(lease, key, value)
    session = AgentSession(
        id=session_id,
        user_id=uid,
        runtime_id=session_runtime_id,
        lease_id=lease.id,
        provider="claude",
        status=status,
        turn_count=1,
        created_at=now,
        last_active_at=now,
        ended_at=now if status in ("ended", "failed") else None,
    )
    run = None
    if run_status is not None:
        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status=run_status,
            spec_strategy="interactive",
            agent_session_id=session.id,
            started_at=now,
        )
    db_session.add_all([x for x in (lease, session, run) if x is not None])
    await db_session.commit()
    await db_session.refresh(lease)
    await db_session.refresh(session)
    if run is not None:
        await db_session.refresh(run)
    return session, lease, run


def _capture_publish(monkeypatch: pytest.MonkeyPatch, module_path: str) -> list[tuple]:
    """把 ``module_path.publish_sessions_changed`` 换成捕获桩（镜像 events_cross）。"""
    calls: list[tuple] = []

    async def _fake_publish(event, session_id, user_id):
        calls.append((event, session_id, user_id))

    monkeypatch.setattr(f"{module_path}.publish_sessions_changed", _fake_publish)
    return calls


def _as_utc(dt: datetime) -> datetime:
    """SQLite 读回 naive datetime，统一补 UTC 后再比较（先例 reopen 窗口判断）。"""
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


# ── 1. P1 归档/取消归档发布列表信号 ─────────────────────────────────────────


class TestArchivePublishesListSignal:
    async def test_archive_publishes_status_changed(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls = _capture_publish(monkeypatch, "app.modules.daemon.session.service")
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _lease, _run = await _make_session(db_session, uid=uid, runtime_id=rt.id)

        await DaemonService(db_session).archive_session(session.id, uid)

        assert calls == [("status_changed", session.id, uid)]
        fresh = await db_session.get(AgentSession, session.id)
        assert fresh is not None and fresh.archived_at is not None

    async def test_archive_idempotent_no_publish(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls = _capture_publish(monkeypatch, "app.modules.daemon.session.service")
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _lease, _run = await _make_session(db_session, uid=uid, runtime_id=rt.id)
        await DaemonService(db_session).archive_session(session.id, uid)
        assert len(calls) == 1
        calls.clear()

        await DaemonService(db_session).archive_session(session.id, uid)

        assert calls == []  # 幂等：已归档重复调用零发布

    async def test_unarchive_publishes_status_changed(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls = _capture_publish(monkeypatch, "app.modules.daemon.session.service")
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _lease, _run = await _make_session(db_session, uid=uid, runtime_id=rt.id)
        await DaemonService(db_session).archive_session(session.id, uid)
        calls.clear()

        await DaemonService(db_session).unarchive_session(session.id, uid)

        assert calls == [("status_changed", session.id, uid)]
        fresh = await db_session.get(AgentSession, session.id)
        assert fresh is not None and fresh.archived_at is None

    async def test_unarchive_idempotent_no_publish(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls = _capture_publish(monkeypatch, "app.modules.daemon.session.service")
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _lease, _run = await _make_session(db_session, uid=uid, runtime_id=rt.id)

        await DaemonService(db_session).unarchive_session(session.id, uid)

        assert calls == []  # 幂等：未归档重复调用零发布


# ── 2. P1 end_session：commit 先于 SESSION_END WS 发送 ─────────────────────


class TestEndSessionCommitBeforeWs:
    async def test_ws_send_sees_committed_killed_run(
        self, db_session: AsyncSession, db_engine, mocked_hub, mocked_redis
    ) -> None:
        """发送时刻用独立连接读 run：必须已是 killed（commit 已落库可见）。

        修复前 WS 在 commit 之前发送（且持会话行锁等待最长 10s）——本测试钉死
        「本地收口 commit → 才发 WS」的顺序。
        """
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _lease, run = await _make_session(db_session, uid=uid, runtime_id=rt.id)
        assert run is not None
        run_id = run.id
        observed: dict[str, str] = {}

        async def _probe_send(daemon_id, msg_type, payload):
            factory = async_sessionmaker(
                bind=db_engine, class_=AsyncSession, expire_on_commit=False
            )
            async with factory() as other:
                row = await other.get(AgentRun, run_id)
                observed["status_at_send"] = row.status if row else "missing"
            return True

        mocked_hub.send_session_control = AsyncMock(side_effect=_probe_send)

        result = await DaemonService(db_session).end_session(session.id, uid)

        assert result.agent_session.status == "ended"
        # WS 发送时 run 已 commit 为 killed（对独立连接可见）。
        assert observed.get("status_at_send") == "killed"
        assert mocked_hub.send_session_control.await_count == 1

    async def test_ws_send_sees_committed_ended_session(
        self, db_session: AsyncSession, db_engine, mocked_hub, mocked_redis
    ) -> None:
        """同款顺序断言：发送时刻 session 已 commit 为 ended。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _lease, _run = await _make_session(db_session, uid=uid, runtime_id=rt.id)
        session_id = session.id
        observed: dict[str, str] = {}

        async def _probe_send(daemon_id, msg_type, payload):
            factory = async_sessionmaker(
                bind=db_engine, class_=AsyncSession, expire_on_commit=False
            )
            async with factory() as other:
                row = await other.get(AgentSession, session_id)
                observed["status_at_send"] = row.status if row else "missing"
            return True

        mocked_hub.send_session_control = AsyncMock(side_effect=_probe_send)

        await DaemonService(db_session).end_session(session.id, uid)

        assert observed.get("status_at_send") == "ended"


# ── 3. P1 close_interactive_run 终态竞态 ───────────────────────────────────


class TestCloseInteractiveRunRace:
    async def test_late_close_does_not_overwrite_end_session_killed(
        self, db_session: AsyncSession, mocked_hub, mocked_redis
    ) -> None:
        """end_session 先收口 killed 后，迟到的 close(success) 不覆写成 completed。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _lease, run = await _make_session(db_session, uid=uid, runtime_id=rt.id)
        assert run is not None
        # 标量先行捕获（end/close 的 rollback/expire 路径后再摸 ORM 属性会触发
        # 异步下不允许的 lazy load）。
        session_id, run_id, lease_id = session.id, run.id, session.lease_id

        # 用户先结束会话：run → killed、session → ended、lease → completed。
        await DaemonService(db_session).end_session(session_id, uid)

        # daemon 尚未感知 end，随后回灌本轮 SDK 成功结果（迟到 close）。
        closed = await DaemonService(db_session).close_interactive_run(
            lease_id, run_id, "tok", status="success", is_error=False
        )

        db_session.expire_all()
        fresh = await db_session.get(AgentRun, run_id)
        assert fresh is not None
        assert fresh.status == "killed", (
            f"迟到的 close 覆写了 end_session 的 killed 终态 → {fresh.status}"
        )
        assert closed.status == "killed"
        ended_session = await db_session.get(AgentSession, session_id)
        assert ended_session is not None and ended_session.status == "ended"


# ── 4. P1 sync_agent_run_status 终态守卫 + Literal 枚举 ─────────────────────


async def _make_batch_lease_with_run(
    db_session: AsyncSession,
    *,
    uid: uuid.UUID,
    runtime_id: uuid.UUID,
    run_status: str,
    finished_at: datetime | None = None,
) -> tuple[DaemonTaskLease, AgentRun]:
    """batch 型 lease（agent_run_id 直挂 run）+ claim_token，供 sync 上报。"""
    now = datetime.now(UTC)
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status=run_status,
        started_at=now,
        finished_at=finished_at,
    )
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=run.id,
        kind="batch",
        status="claimed",
        claimed_at=now,
        created_at=now,
        updated_at=now,
        metadata_={"claim_token": "sync-tok"},
    )
    db_session.add_all([run, lease])
    await db_session.commit()
    await db_session.refresh(run)
    await db_session.refresh(lease)
    return lease, run


class TestSyncAgentRunStatusTerminalGuard:
    async def test_terminal_run_ignores_late_running(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """已 completed 的 run 收到迟到 running 上报 → 保持 completed（不复活）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        lease, run = await _make_batch_lease_with_run(
            db_session,
            uid=uid,
            runtime_id=rt.id,
            run_status="completed",
            finished_at=datetime.now(UTC),
        )
        run_id = run.id

        result = await DaemonService(db_session).sync_agent_run_status(
            lease.id, "sync-tok", "running"
        )

        assert result is not None
        db_session.expire_all()
        fresh = await db_session.get(AgentRun, run_id)
        assert fresh is not None
        assert fresh.status == "completed"

    async def test_terminal_run_same_value_resync_idempotent(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """同值重发放行：killed → 再报 killed 仍是 killed，finished_at 不被改写。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        original_finished_at = datetime.now(UTC) - timedelta(minutes=5)
        lease, run = await _make_batch_lease_with_run(
            db_session,
            uid=uid,
            runtime_id=rt.id,
            run_status="killed",
            finished_at=original_finished_at,
        )
        run_id = run.id

        result = await DaemonService(db_session).sync_agent_run_status(
            lease.id, "sync-tok", "killed"
        )

        assert result is not None and result.status == "killed"
        db_session.expire_all()
        fresh = await db_session.get(AgentRun, run_id)
        assert fresh is not None
        assert fresh.status == "killed"
        # finished_at 已有值 → 同值重发不覆盖（幂等副作用为零）。
        assert fresh.finished_at is not None
        assert _as_utc(fresh.finished_at) == _as_utc(original_finished_at)

    async def test_running_run_still_accepts_terminal_sync(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """回归：running run 收 completed 正常推进（守卫不拦截合法路径）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        lease, run = await _make_batch_lease_with_run(
            db_session, uid=uid, runtime_id=rt.id, run_status="running"
        )
        run_id = run.id

        result = await DaemonService(db_session).sync_agent_run_status(
            lease.id, "sync-tok", "completed"
        )

        assert result is not None and result.status == "completed"
        db_session.expire_all()
        fresh = await db_session.get(AgentRun, run_id)
        assert fresh is not None
        assert fresh.status == "completed"
        assert fresh.finished_at is not None


class TestLeaseSyncRequestLiteral:
    """DTO status 收紧为 Literal 枚举（非法值 Pydantic 直接拒，路由层 422）。"""

    def test_valid_statuses_accepted(self) -> None:
        for status in ("running", "completed", "failed", "killed"):
            req = LeaseSyncRequest(claim_token="t", status=status)
            assert req.status == status

    @pytest.mark.parametrize("bad", ["interrupting", "pending", "CANCELLED", "", "ok", "Running"])
    def test_invalid_status_rejected(self, bad: str) -> None:
        with pytest.raises(ValidationError):
            LeaseSyncRequest(claim_token="t", status=bad)


# ── 5. P2 end_session 幂等/覆写守卫 ────────────────────────────────────────


class TestEndSessionTerminalGuards:
    async def test_failed_session_end_is_idempotent_noop(
        self, db_session: AsyncSession, mocked_hub, mocked_redis
    ) -> None:
        """failed 也是终态：end 不翻 ended、不发 WS、run/lease 不动。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, lease, run = await _make_session(
            db_session,
            uid=uid,
            runtime_id=rt.id,
            status="failed",
            lease_status="cancelled",
            run_status="failed",
        )
        assert run is not None
        session_id, run_id, lease_id = session.id, run.id, lease.id
        mocked_hub.send_session_control.reset_mock()

        result = await DaemonService(db_session).end_session(session_id, uid)

        assert result.current_run_id is None
        db_session.expire_all()
        fresh_session = await db_session.get(AgentSession, session_id)
        assert fresh_session is not None
        assert fresh_session.status == "failed"  # 不被翻成 ended
        fresh_run = await db_session.get(AgentRun, run_id)
        assert fresh_run is not None and fresh_run.status == "failed"
        fresh_lease = await db_session.get(DaemonTaskLease, lease_id)
        assert fresh_lease is not None and fresh_lease.status == "cancelled"
        assert mocked_hub.send_session_control.await_count == 0

    async def test_cancelled_lease_not_overwritten_by_end(
        self, db_session: AsyncSession, mocked_hub, mocked_redis
    ) -> None:
        """active 会话 end：run killed / session ended，但已 cancelled 的 lease
        不被改写 completed、terminating_at 不被清。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        terminating_at = datetime.now(UTC) - timedelta(minutes=3)
        session, lease, run = await _make_session(
            db_session,
            uid=uid,
            runtime_id=rt.id,
            status="active",
            lease_status="cancelled",
            run_status="running",
            lease_extra={"terminating_at": terminating_at},
        )
        assert run is not None
        session_id, run_id, lease_id = session.id, run.id, lease.id

        result = await DaemonService(db_session).end_session(session_id, uid)

        assert result.agent_session.status == "ended"
        db_session.expire_all()
        fresh_run = await db_session.get(AgentRun, run_id)
        assert fresh_run is not None and fresh_run.status == "killed"
        fresh_lease = await db_session.get(DaemonTaskLease, lease_id)
        assert fresh_lease is not None
        assert fresh_lease.status == "cancelled"  # 不被改成 completed
        assert fresh_lease.terminating_at is not None
        assert _as_utc(fresh_lease.terminating_at) == _as_utc(terminating_at)  # 不被清


# ── 6. P2 reopen_session runtime 不变量显式 raise ──────────────────────────


class TestReopenRuntimeInvariant:
    async def test_reopen_without_runtime_raises_invariant_violation(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """runtime_id=None：显式 DaemonSessionInvariantViolation（非 assert 兜底、
        不再静默跳过在线检查）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _lease, _run = await _make_session(
            db_session,
            uid=uid,
            runtime_id=rt.id,
            status="ended",
            run_status=None,
            bind_runtime=_UNBOUND,  # 数据损坏：终态会话无 runtime 绑定
        )
        session.agent_session_id = "sdk-x"
        session.cwd = "C:\\work"
        db_session.add(session)
        await db_session.commit()

        with pytest.raises(DaemonSessionInvariantViolation):
            await DaemonService(db_session).reopen_session(session.id, uid)


# ── 附：dispatch 种子完整性 sanity（防止 fixture 漂移误报） ─────────────────


class TestSeedSanity:
    async def test_make_session_seed_shapes(self, db_session: AsyncSession, mocked_redis) -> None:
        """_make_session 种子与 service 期望一致（interactive lease + run 归属）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, lease, run = await _make_session(db_session, uid=uid, runtime_id=rt.id)
        assert lease.kind == "interactive"
        assert lease.id == session.lease_id
        assert run is not None and run.agent_session_id == session.id
        assert (lease.metadata_ or {}).get("claim_token") == "tok"
