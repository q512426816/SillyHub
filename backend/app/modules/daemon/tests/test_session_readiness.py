"""Tests for SessionReadiness + inject waits for ready + POST /ready + recover mark (task-12).

Covers FR-05 / design Phase 2-4：
  1. SessionReadiness 四方法（mark_ready / wait / clear + 单例 get_session_readiness）
     —— mark 写 set + Event set；wait 已 ready 立即返 True / 未 ready 超时返 False；
     clear 后须等下一次 mark；并发 mark+wait 协程交错返 True。
  2. inject 等 ready 直通：先 mark_ready 再 inject_session，立即等到零阻塞，
     SESSION_INJECT 正常发出。
  3. inject 超时 fallback：wait 返 False（patch 即时返），inject 仍发 SESSION_INJECT
     并落 ``session_ready_timeout`` warn（兼容旧 daemon / 上报丢失）。
  4. POST /api/daemon/sessions/{id}/ready 端点：200 + ``{"ok": True}`` + 调到
     mark_ready（readiness set 含 sid）；缺鉴权头 401。
  5. confirm_session_reconnected：reconnecting→active 翻转后 readiness set 含 sid
    （design Phase 4 / gap-1 双保险）。

全 mock，不连真实 Postgres/Redis/daemon。SessionReadiness 单例跨测试隔离：
``fresh_readiness`` fixture 把 ``get_session_readiness`` 在 service / router 两模块
替换为同一个新实例，避免模块级单例污染。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.protocol import DAEMON_MSG_SESSION_INJECT
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import SessionReadiness

# ── shared helpers（复用 test_session_recovery / test_interactive_lifecycle_patch 范式） ──


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"ready-{uid}@example.com",
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
    """与 test_interactive_lifecycle_patch._mock_hub 同构：WS hub 全 mock。

    send_session_control 返 ``connected`` —— inject 路径据此判断是否 fallback
    收敛 run（True = 发送成功，不收敛）。
    """
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    return redis


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = _mock_redis()
    # get_redis 从 session.service 与 run_sync.service 取，patch 跟随（同
    # test_interactive_lifecycle_patch 范式）。
    with (
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
    ):
        yield redis


@pytest.fixture()
def fresh_readiness(monkeypatch: pytest.MonkeyPatch) -> SessionReadiness:
    """隔离 SessionReadiness 模块级单例（gap-2 / D-002）。

    ``SessionService`` / ``DaemonService`` 在 router 是 per-request 实例化，
    readiness 必须模块级单例才能跨请求共享；但单例跨测试会污染（前一个测试
    mark 的 sid 残留 set，后一个测试 wait 立即返 True）。本 fixture 把
    ``get_session_readiness`` 在 ``session.service`` 与 ``router`` 两模块的符号
    替换为返回**同一个新 SessionReadiness 实例**，每个测试独立一份 set/event dict。
    """
    import app.modules.daemon.router as router_mod
    import app.modules.daemon.session.service as svc_mod

    instance = SessionReadiness()
    monkeypatch.setattr(svc_mod, "get_session_readiness", lambda: instance)
    monkeypatch.setattr(router_mod, "get_session_readiness", lambda: instance)
    return instance


# ── 1. SessionReadiness 单元 ──────────────────────────────────────────────────


class TestSessionReadinessUnit:
    """SessionReadiness 四方法单元（直接 new 实例，不经单例，零污染）。"""

    async def test_mark_ready_adds_to_set_and_sets_event(self) -> None:
        readiness = SessionReadiness()
        sid = uuid.uuid4()
        assert sid not in readiness._ready

        readiness.mark_ready(sid)

        assert sid in readiness._ready
        event = readiness._events.get(sid)
        assert event is not None
        assert event.is_set()

    async def test_mark_ready_is_idempotent(self) -> None:
        """重复 mark 同一 session 不报错（set.add / event.set 幂等）。"""
        readiness = SessionReadiness()
        sid = uuid.uuid4()
        readiness.mark_ready(sid)
        readiness.mark_ready(sid)  # second mark must not raise

        assert sid in readiness._ready
        assert readiness._events[sid].is_set()

    async def test_wait_already_ready_returns_true_immediately(self) -> None:
        """已 ready（sid ∈ _ready）立即返 True，零开销不进 wait_for。"""
        readiness = SessionReadiness()
        sid = uuid.uuid4()
        readiness.mark_ready(sid)

        result = await readiness.wait(sid, timeout=0.05)

        assert result is True

    async def test_wait_timeout_not_ready_returns_false(self) -> None:
        """未 ready 超时返 False（不抛 TimeoutError）。小 timeout 避免拖慢套件。"""
        readiness = SessionReadiness()
        sid = uuid.uuid4()

        result = await readiness.wait(sid, timeout=0.05)

        assert result is False

    async def test_clear_removes_from_set_and_resets_event(self) -> None:
        """clear 后 set 无该 id；用新 Event 替换（非 event.clear），下次 wait 须重新等。"""
        readiness = SessionReadiness()
        sid = uuid.uuid4()
        readiness.mark_ready(sid)
        assert sid in readiness._ready
        old_event = readiness._events[sid]

        readiness.clear(sid)

        assert sid not in readiness._ready
        new_event = readiness._events[sid]
        # 新 Event 对象（旧已 set，复用会立即返 True 与语义不符）—— design clear 注释。
        assert new_event is not old_event
        assert not new_event.is_set()

    async def test_wait_after_clear_requires_remark(self) -> None:
        """clear 后 wait 不再立即返 True（需下一次 mark_ready 才能 set 返 True）。"""
        readiness = SessionReadiness()
        sid = uuid.uuid4()
        readiness.mark_ready(sid)
        # 未 clear 前立即返 True
        assert await readiness.wait(sid, timeout=0.05) is True

        readiness.clear(sid)
        # clear 后超时返 False
        assert await readiness.wait(sid, timeout=0.05) is False

        # 重新 mark 后立即返 True（验证 clear 用新 event，不残留旧 set）
        readiness.mark_ready(sid)
        assert await readiness.wait(sid, timeout=0.05) is True

    async def test_clear_unknown_session_is_noop(self) -> None:
        """clear 一个从未 mark 的 session 不报错（discard 幂等 + 新建 event 槽位）。"""
        readiness = SessionReadiness()
        unknown = uuid.uuid4()
        readiness.clear(unknown)  # must not raise
        assert unknown not in readiness._ready

    async def test_concurrent_mark_wakes_waiting_wait(self) -> None:
        """并发：wait 协程先 park 在 event.wait()，另一协程 mark_ready 唤醒它返 True。"""
        readiness = SessionReadiness()
        sid = uuid.uuid4()
        result: dict[str, bool] = {}

        async def waiter() -> None:
            result["ready"] = await readiness.wait(sid, timeout=2.0)

        task = asyncio.create_task(waiter())
        # 让 waiter 进入 event.wait() 阻塞（未 ready 快速路径不触发，sid 不在 set）。
        await asyncio.sleep(0.05)
        assert "ready" not in result  # still parked

        readiness.mark_ready(sid)
        await asyncio.sleep(0.05)
        await task

        assert result.get("ready") is True

    async def test_get_session_readiness_singleton_within_process(self) -> None:
        """get_session_readiness 模块级单例：两次调用返同一实例（design D-002 gap-2 根因）。"""
        from app.modules.daemon.session.service import get_session_readiness

        # 注意：此处用真实模块单例（不被 fresh_readiness fixture patch），验证
        # 模块级 lazy 单例语义本身；跨测试的清理由 fresh_readiness 在集成测试里隔离。
        a = get_session_readiness()
        b = get_session_readiness()
        assert a is b


# ── 2. inject 等 ready 直通 ───────────────────────────────────────────────────


class TestInjectWaitsForReady:
    """inject_session 在 send SESSION_INJECT 前 await readiness.wait；已 ready 立即返 True。"""

    async def test_inject_passes_through_when_ready(
        self,
        db_session: AsyncSession,
        mocked_hub: MagicMock,
        mocked_redis: AsyncMock,
        fresh_readiness: SessionReadiness,
    ) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="hello")

        # 标 daemon session ready（fresh 实例）—— wait 应立即返 True，无 30s 阻塞。
        fresh_readiness.mark_ready(created.agent_session.id)

        # 首个 run 必须收敛为 terminal，inject 才不 409（DaemonSessionTurnConflict）。
        first_run = created.agent_run
        first_run.status = "completed"
        first_run.finished_at = datetime.now(UTC)
        db_session.add(first_run)
        await db_session.commit()

        mocked_hub.send_session_control.reset_mock()
        await svc.inject_session(created.agent_session.id, uid, prompt="turn 2")

        # SESSION_INJECT 发出（wait 直通，未阻塞 fallback）。
        assert mocked_hub.send_session_control.await_count == 1
        _rt, msg_type, _payload = mocked_hub.send_session_control.await_args.args
        assert msg_type == DAEMON_MSG_SESSION_INJECT


# ── 3. inject 超时 fallback ───────────────────────────────────────────────────


class TestInjectTimeoutFallback:
    """wait 超时返 False 时，inject fallback 仍发 SESSION_INJECT + warn（兼容旧 daemon）。"""

    async def test_inject_still_sends_on_timeout_with_warn(
        self,
        db_session: AsyncSession,
        mocked_hub: MagicMock,
        mocked_redis: AsyncMock,
        fresh_readiness: SessionReadiness,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="hello")

        first_run = created.agent_run
        first_run.status = "completed"
        first_run.finished_at = datetime.now(UTC)
        db_session.add(first_run)
        await db_session.commit()

        # 不 mark_ready + patch wait 即时返 False（避免源码硬编码 30s 真等）。
        monkeypatch.setattr(fresh_readiness, "wait", AsyncMock(return_value=False))

        # structlog 经 PrintLoggerFactory 直写 stderr，caplog 抓不到（见
        # test_terminating_at_lifecycle._patch_logger_spy 注释）；替换模块级 log
        # 符号是最稳健的捕获方式。
        import app.modules.daemon.session.service as svc_mod

        log_spy = MagicMock()
        monkeypatch.setattr(svc_mod, "log", log_spy)

        mocked_hub.send_session_control.reset_mock()
        await svc.inject_session(created.agent_session.id, uid, prompt="turn 2")

        # fallback：仍发 SESSION_INJECT（兼容旧 daemon 不上报 ready）。
        assert mocked_hub.send_session_control.await_count == 1
        _rt, msg_type, _payload = mocked_hub.send_session_control.await_args.args
        assert msg_type == DAEMON_MSG_SESSION_INJECT

        # 落 warn 日志（design §Phase 3 / R-02 兼容窗口标记）。
        log_spy.warning.assert_any_call(
            "session_ready_timeout", session_id=str(created.agent_session.id)
        )


# ── 4. POST /api/daemon/sessions/{id}/ready 端点 ──────────────────────────────


class TestNotifySessionReadyEndpoint:
    """POST /sessions/{id}/ready：daemon auth + mark_ready + 返 200 ``{"ok": True}``。"""

    async def test_post_ready_200_marks_ready(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        fresh_readiness: SessionReadiness,
    ) -> None:
        sid = uuid.uuid4()
        resp = await client.post(f"/api/daemon/sessions/{sid}/ready", headers=auth_headers)

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"ok": True}
        # mark_ready 被调用 → readiness set 含 sid（唤醒等 ready 的 inject 协程）。
        assert sid in fresh_readiness._ready
        assert fresh_readiness._events[sid].is_set()

    async def test_post_ready_no_auth_returns_401(
        self,
        client: AsyncClient,
        fresh_readiness: SessionReadiness,
    ) -> None:
        """缺鉴权头 → AuthTokenMissing → 401（get_current_principal 双路 JWT / X-API-Key）。"""
        sid = uuid.uuid4()
        resp = await client.post(f"/api/daemon/sessions/{sid}/ready")

        assert resp.status_code == 401
        # 未授权 → 不应 mark_ready（readiness set 不含 sid）。
        assert sid not in fresh_readiness._ready


# ── 5. confirm_session_reconnected mark_ready（design Phase 4 / gap-1 双保险） ──


async def _make_reconnecting_session(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    runtime: DaemonRuntime,
    claim_token: str = "old-token",
) -> tuple[AgentSession, DaemonTaskLease]:
    """建一个 reconnecting 状态 session + interactive lease（recover 后待 confirm）。"""
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime.id,
        status="claimed",
        kind="interactive",
        claimed_at=now,
        lease_expires_at=now,
        metadata_={"claim_token": claim_token},
    )
    db_session.add(lease)
    await db_session.flush()

    session = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime.id,
        lease_id=lease.id,
        provider="claude",
        status="reconnecting",
        agent_session_id="sdk-sess-1",
        config={"manual_approval": False},
        turn_count=1,
        created_at=now,
        last_active_at=now,
        cwd="C:\\work",
    )
    db_session.add(session)
    await db_session.commit()
    await db_session.refresh(lease)
    await db_session.refresh(session)
    return session, lease


class TestConfirmReconnectedMarkReady:
    """reconnecting→active 翻转后调 mark_ready（防 daemon 上报丢失致 inject 等超时）。"""

    async def test_confirm_reconnected_marks_session_ready(
        self,
        db_session: AsyncSession,
        mocked_redis: AsyncMock,
        fresh_readiness: SessionReadiness,
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _lease = await _make_reconnecting_session(db_session, user_id=uid, runtime=rt)

        svc = DaemonService(db_session)
        result_status = await svc.confirm_session_reconnected(session.id, runtime_id=rt.id)

        assert result_status == "active"
        await db_session.refresh(session)
        assert session.status == "active"
        # 双保险：翻转后 readiness set 含 sid（inject 后续 wait 立即返 True）。
        assert session.id in fresh_readiness._ready

    async def test_confirm_reconnected_idempotent_when_already_active(
        self,
        db_session: AsyncSession,
        mocked_redis: AsyncMock,
        fresh_readiness: SessionReadiness,
    ) -> None:
        """非 reconnecting（已 active）幂等返回当前 status，不重复 mark_ready 分支。

        守门：confirm_session_reconnected 仅在 ``status == reconnecting`` 时翻转 +
        mark_ready；其它状态直接 return（不进 mark_ready 分支）。
        """
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        # 直接建 active session（不经 recover）
        now = datetime.now(UTC)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            status="claimed",
            kind="interactive",
            claimed_at=now,
            lease_expires_at=now,
            metadata_={"claim_token": "tok"},
        )
        active_session = AgentSession(
            id=uuid.uuid4(),
            user_id=uid,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            status="active",
            agent_session_id="sdk-x",
            turn_count=1,
            created_at=now,
            last_active_at=now,
        )
        db_session.add_all([lease, active_session])
        await db_session.commit()

        svc = DaemonService(db_session)
        result_status = await svc.confirm_session_reconnected(active_session.id, runtime_id=rt.id)

        assert result_status == "active"
        # 已 active → 不进 reconnecting 翻转分支 → 不调 mark_ready。
        assert active_session.id not in fresh_readiness._ready

    async def test_confirm_reconnected_runtime_mismatch_rejected(
        self,
        db_session: AsyncSession,
        mocked_redis: AsyncMock,
        fresh_readiness: SessionReadiness,
    ) -> None:
        """runtime_id 不匹配 → rejected（ownership guard），不 mark_ready。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _lease = await _make_reconnecting_session(db_session, user_id=uid, runtime=rt)

        svc = DaemonService(db_session)
        result_status = await svc.confirm_session_reconnected(
            session.id,
            runtime_id=uuid.uuid4(),  # mismatched
        )

        assert result_status == "rejected"
        assert session.id not in fresh_readiness._ready
