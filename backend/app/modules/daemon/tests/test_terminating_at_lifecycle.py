"""task-12 / Phase4 测试：``terminating_at`` 写清时序 + sweeper 超时告警。

change 2026-08-05-daemon-kill-channel-unify / FR-04 / D-007 / XC-03 / XC-04 /
XC-08。被测实现位于 task-11（已落地，本文件**只补测试**）：

- **写（仅 cancel_lease，XC-03）**：``lease_service.DaemonLeaseService.cancel_lease``
  标 lease=cancelled 时同步写 ``terminating_at = now``（lease_service.py:419）。
- **清（batch ACK = complete_lease）**：``lease.service.LeaseService.complete_lease``
  标 lease=completed 时清 ``terminating_at = None``（lease/service.py:307）。
- **清（interactive ACK = notifySessionEnd = end_session）**：
  ``session.service.SessionService.end_session`` 单事务收口时清
  ``terminating_at = None``（session/service.py:934）。
- **Sweeper**：``DaemonLeaseService.alert_stuck_terminating_leases`` 独立查询
  ``terminating_at IS NOT NULL AND terminating_at < now-30s``，对命中 lease 记
  ``log.warning("lease_terminating_stuck", ...)`` + 返回 lease_id 列表；**不改
  ``lease.status``、不重试**（D-007 方案 C）。``TERMINATING_TIMEOUT_SECONDS = 30``。

验收三组（task-12.md acceptance）：
1. 写仅 cancel：``cancel_lease`` 写 ``terminating_at``；``end_session`` **不写**
   （XC-03：在从未被 cancel 的 lease 上调 end_session，``terminating_at`` 保持 None）。
2. 回传清：``complete_lease``（batch）/ ``end_session``（interactive）→ ``terminating_at`` 清空。
3. Sweeper：``terminating_at`` 早于 now-30s → 告警（``log.warning``）+ 返回列表；
   近期（10s）/ None → 不告警；**不改 ``lease.status``**（mock 时钟改为直接写字段，免 freezegun）。

与既有测试分工（不重复）：
- ``test_cancel_lease_session_end_integration.py``（task-03）：cancel_lease → SESSION_END
  + lease/run/session 三态收敛 + best-effort 容错，但**不**断言 ``terminating_at``。
- ``test_lease_service.py`` / ``test_cancel_lease_session.py``（Wave 2）：claim/
  heartbeat/expire/cancel/complete 的既有切面，**无** ``terminating_at`` 覆盖。
- ``test_session_router.py``（task-13）：router 读路径 ``AgentSessionRead.terminating_at``
  暴露（populate），**非**写清/sweeper 生命周期。
- 本文件专注 ``terminating_at`` 的 写→清→告警 生命周期 + sweeper 行为，补上述未覆盖段。

日志捕获说明：``app.core.logging.configure_logging`` 把 structlog 接到
``PrintLoggerFactory(file=sys.stderr)``，**绕过 stdlib logging handler**，pytest
``caplog`` 抓不到。故 sweeper 用例用 ``MagicMock`` 替换 ``lease_service`` 模块级
``log`` 符号，直接断言 ``log.warning`` 调用（sweeper 仅调 ``warning``，替换模块符号
不影响其它用例）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.lease_service import DaemonLeaseService
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    """Insert a User row so FK constraints on daemon_runtimes are satisfied."""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"task12-{uid}@example.com",
            password_hash="irrelevant",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    """Create a DaemonRuntime row for testing (provider runtime, online)."""
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="task12-daemon",
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


def _mock_hub(*, connected: bool = True) -> MagicMock:
    """Recording ws hub mock — ``send_session_control`` returns ``connected``."""
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


@pytest.fixture()
def mocked_hub():
    """Patch ``get_daemon_ws_hub`` at source so cancel_lease / end_session need no live WS."""
    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    """Patch ``get_redis`` in session.service so end_session's session event publish is hermetic."""
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


async def _make_interactive_triple(
    session: AsyncSession,
    runtime_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    session_status: str = "active",
    run_status: str = "running",
    terminating_at: datetime | None = None,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """构造 interactive lease + AgentSession + AgentRun 三元组。

    返回 ``(lease_id, run_id, session_id)``。``terminating_at`` 可注入以模拟
    「cancel_lease 已写 terminating_at，等 daemon 回传」的中间态。

    注：生产 interactive lease 的 ``agent_run_id`` 列恒 NULL（D-005@v1 lease↔session
    1:1）；此处为方便 ``cancel_lease(by agent_run_id)`` 查到 lease 而显式置 run_id，
    与 task-03 ``_create_interactive_run`` 同款测试便利（不影响 terminating_at 断言）。
    """
    now = datetime.now(UTC)
    run_id = uuid.uuid4()
    sess_id = uuid.uuid4()

    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=run_id,
        status="claimed",
        kind="interactive",
        claimed_at=now,
        lease_expires_at=None,  # interactive lease 永不过期
        terminating_at=terminating_at,
        metadata_={"claim_token": "tok", "session_id": str(sess_id)},
        created_at=now,
        updated_at=now,
    )
    agent_session = AgentSession(
        id=sess_id,
        user_id=user_id,
        provider="claude",
        status=session_status,
        config={},
        turn_count=1,
        runtime_id=runtime_id,
        lease_id=lease.id,
        last_active_at=now,
        created_at=now,
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status=run_status,
        spec_strategy="platform-managed",
        agent_session_id=sess_id,
    )
    session.add_all([lease, agent_session, run])
    await session.commit()
    return lease.id, run_id, sess_id


async def _make_terminated_lease_row(
    session: AsyncSession,
    runtime_id: uuid.UUID,
    *,
    terminating_at: datetime | None,
    status: str = "cancelled",
    kind: str = "batch",
) -> DaemonTaskLease:
    """Low-level lease row with ``terminating_at`` set directly (sweeper setup).

    直接写 ``terminating_at`` 字段模拟「cancel_lease 已写、等 daemon 回传」的观测
    窗口——免 freezegun mock 时钟：old/new/None 三种值驱动 sweeper 命中/跳过。
    """
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=uuid.uuid4(),  # sweeper 查询不依赖 run；随机 uuid 占位
        status=status,
        kind=kind,
        claimed_at=now,
        lease_expires_at=now + timedelta(seconds=60),
        terminating_at=terminating_at,
        metadata_={"claim_token": "tok"},
        created_at=now,
        updated_at=now,
    )
    session.add(lease)
    await session.commit()
    await session.refresh(lease)
    return lease


def _patch_logger_spy(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """Replace ``lease_service.log`` with a MagicMock so ``log.warning`` calls are capturable.

    structlog 经 ``PrintLoggerFactory`` 直写 stderr，pytest ``caplog`` 抓不到；sweeper
    仅调 ``log.warning``，替换模块级 ``log`` 符号是最稳健的捕获方式（在方法调用时
    按模块 globals 解析，monkeypatch 生效）。
    """
    import app.modules.daemon.lease_service as lease_service_mod

    spy = MagicMock()
    monkeypatch.setattr(lease_service_mod, "log", spy)
    return spy


# ── Acceptance 1：写仅 cancel_lease；end_session 不写（XC-03）──────────────────


class TestTerminatingAtWrite:
    """XC-03：``terminating_at`` 的唯一写入点是 ``cancel_lease``。``end_session``
    是回传收敛点（清空），**不是**写入点——在从未被 cancel 的 lease 上调
    ``end_session``，``terminating_at`` 必须保持 None。"""

    @pytest.mark.asyncio
    async def test_cancel_lease_writes_terminating_at_batch(self, db_session: AsyncSession) -> None:
        """batch lease：``cancel_lease`` 写 ``terminating_at``（≈ now，非 None）。

        FR-04 / D-007 / XC-03：cancel_lease 标 lease=cancelled 时同步写
        ``terminating_at = now``（lease_service.py:419），开启「等 daemon 回传」
        观测窗口。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()

        svc = DaemonLeaseService(db_session)
        lease = await svc.claim_task(rt.id, agent_run_id)  # 默认 kind="batch"
        assert lease.terminating_at is None  # claim 不写 terminating_at（基线）

        before = datetime.now(UTC)
        await svc.cancel_lease(agent_run_id)
        after = datetime.now(UTC)

        await db_session.refresh(lease)
        assert lease.status == "cancelled"
        # 核心断言：cancel_lease 写了 terminating_at（非 None，且落在调用时间窗内）
        assert lease.terminating_at is not None
        ta = lease.terminating_at
        if ta.tzinfo is None:  # SQLite 存 naive datetime，归一 UTC 再比
            ta = ta.replace(tzinfo=UTC)
        assert before <= ta <= after

    @pytest.mark.asyncio
    async def test_cancel_lease_writes_terminating_at_interactive(
        self, db_session: AsyncSession, mocked_hub
    ) -> None:
        """interactive lease：``cancel_lease`` 同样写 ``terminating_at``（与 batch 一致）。

        D-001@v2 / XC-01：cancel_lease 对 interactive 改发 SESSION_END；XC-03 写入
        点与 batch 同源（均 cancel_lease）。WS 信号 best-effort 不影响 DB 写。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id, _sess_id = await _make_interactive_triple(db_session, rt.id, user_id)

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None
        assert lease.status == "cancelled"
        # 核心断言：interactive cancel 同样写 terminating_at
        assert lease.terminating_at is not None

    @pytest.mark.asyncio
    async def test_end_session_does_not_write_terminating_at(
        self, db_session: AsyncSession, mocked_hub, mocked_redis
    ) -> None:
        """XC-03 守护：``end_session`` 不是写入点。

        在**从未被 cancel**（``terminating_at=None``）的 interactive lease 上调
        ``end_session``（= daemon notifySessionEnd 回传收敛点），``terminating_at``
        必须保持 None。若 end_session 误写 ``terminating_at = now``（XC-03 所防），
        本断言即失败。证明 end_session 是 clear-only 路径，不是 writer。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, _run_id, sess_id = await _make_interactive_triple(
            db_session, rt.id, user_id, terminating_at=None
        )

        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None and lease.terminating_at is None  # 基线：从未被 cancel

        svc = DaemonService(db_session)
        await svc.end_session(sess_id, user_id)

        await db_session.refresh(lease)
        # end_session 把 lease 置 completed（回传收敛），但 terminating_at 保持 None
        assert lease.status == "completed"
        assert lease.terminating_at is None  # XC-03：end_session 不写 terminating_at


# ── Acceptance 2：daemon 回传清 terminating_at（complete_lease / end_session）──


class TestTerminatingAtClear:
    """回传收敛点清空 ``terminating_at``：batch 走 ``complete_lease``，interactive
    走 ``end_session``（= notifySessionEnd）。清空后 sweeper 不再误告警。"""

    @pytest.mark.asyncio
    async def test_complete_lease_clears_terminating_at(self, db_session: AsyncSession) -> None:
        """batch ACK：``complete_lease`` 清空 ``terminating_at``（lease/service.py:307）。

        模拟「cancel_lease 已写 terminating_at」→ daemon 完成 kill 后回传
        ``complete_lease(status="completed")`` → ``terminating_at`` 被清成 None。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        agent_run_id = uuid.uuid4()

        lease_svc = DaemonLeaseService(db_session)
        lease = await lease_svc.claim_task(rt.id, agent_run_id)
        assert isinstance(lease.metadata_, dict)
        claim_token = lease.metadata_["claim_token"]

        # 模拟先前的 cancel_lease 写入（直接写字段，免走 WS 路径）
        lease.terminating_at = datetime.now(UTC)
        db_session.add(lease)
        await db_session.commit()
        await db_session.refresh(lease)
        assert lease.terminating_at is not None  # 基线：cancel 已写

        # daemon 回传 complete → 清空 terminating_at
        svc = DaemonService(db_session)
        await svc.complete_lease(lease.id, claim_token, {"status": "completed"})

        await db_session.refresh(lease)
        assert lease.status == "completed"
        # 核心断言：complete_lease 清空了 terminating_at
        assert lease.terminating_at is None

    @pytest.mark.asyncio
    async def test_end_session_clears_terminating_at(
        self, db_session: AsyncSession, mocked_hub, mocked_redis
    ) -> None:
        """interactive ACK（= notifySessionEnd = end_session）：清空 ``terminating_at``
        （session/service.py:934）。

        模拟「cancel_lease 已写 terminating_at」→ daemon 完成 kill 后回传
        ``POST /sessions/{id}/end`` → backend ``end_session`` 清空 ``terminating_at``。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, _run_id, sess_id = await _make_interactive_triple(
            db_session,
            rt.id,
            user_id,
            terminating_at=datetime.now(UTC),  # 模拟先前 cancel_lease 已写
        )

        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None and lease.terminating_at is not None  # 基线

        svc = DaemonService(db_session)
        await svc.end_session(sess_id, user_id)

        await db_session.refresh(lease)
        assert lease.status == "completed"
        # 核心断言：end_session 清空了 terminating_at
        assert lease.terminating_at is None


# ── Acceptance 3：sweeper 超时告警（不改 status / 不重试，D-007 方案 C）────────


class TestTerminatingAtSweeper:
    """``DaemonLeaseService.alert_stuck_terminating_leases``：``terminating_at`` 超
    ``TERMINATING_TIMEOUT_SECONDS``（30s）仍非空 → ``log.warning`` + 返回 lease_id 列表；
    近期 / None → 跳过。**不改 ``lease.status``、不重试**（D-007）。

    免 freezegun：直接写字段构造 old(31s)/recent(10s)/None 三态。
    """

    @pytest.mark.asyncio
    async def test_sweeper_alerts_old_terminating_lease(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """``terminating_at = now-31s`` → 命中（> 30s 阈值）：返回列表 + ``log.warning``
        + ``lease.status`` 不变。"""
        spy = _patch_logger_spy(monkeypatch)

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        old = datetime.now(UTC) - timedelta(seconds=31)
        lease = await _make_terminated_lease_row(
            db_session, rt.id, terminating_at=old, status="cancelled"
        )

        svc = DaemonLeaseService(db_session)
        stuck = await svc.alert_stuck_terminating_leases()

        # 返回列表含该 lease_id
        assert stuck == [lease.id]
        # log.warning 被调一次，事件名 + lease_id 正确
        assert spy.warning.call_count == 1
        _args, kwargs = spy.warning.call_args
        assert _args[0] == "lease_terminating_stuck"
        assert kwargs["lease_id"] == str(lease.id)
        assert kwargs["threshold_seconds"] == 30
        # D-007：不改 lease.status（仍是 cancelled，未加中间态）
        await db_session.refresh(lease)
        assert lease.status == "cancelled"

    @pytest.mark.asyncio
    async def test_sweeper_skips_recent_terminating_lease(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """``terminating_at = now-10s`` → 未超 30s 阈值：不告警、不返回。"""
        spy = _patch_logger_spy(monkeypatch)

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        recent = datetime.now(UTC) - timedelta(seconds=10)
        await _make_terminated_lease_row(
            db_session, rt.id, terminating_at=recent, status="cancelled"
        )

        svc = DaemonLeaseService(db_session)
        stuck = await svc.alert_stuck_terminating_leases()

        assert stuck == []
        assert spy.warning.call_count == 0  # 近期不告警

    @pytest.mark.asyncio
    async def test_sweeper_skips_null_terminating_lease(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """``terminating_at = None``（未 cancel / 已回传清空）：不告警、不返回。

        守护「正常 lease 不被 sweeper 误报」——只有 cancel_lease 写了 terminating_at
        且 30s 内无回传的 lease 才进列表。
        """
        spy = _patch_logger_spy(monkeypatch)

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        await _make_terminated_lease_row(db_session, rt.id, terminating_at=None, status="claimed")

        svc = DaemonLeaseService(db_session)
        stuck = await svc.alert_stuck_terminating_leases()

        assert stuck == []
        assert spy.warning.call_count == 0

    @pytest.mark.asyncio
    async def test_sweeper_query_does_not_filter_by_status(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """XC-08：sweeper 独立查询仅按 ``terminating_at`` 过滤，不绑 ``status``。

        即便出现脏数据（非 cancelled 却带 terminating_at，例如 claimed lease 被
        直接写终止时间戳）也该告警——不应被 status 屏蔽。同时证明本查询**不并入**
        ``expire_overdue_leases``（后者只扫 ``status='claimed'`` 的过期 lease）。
        """
        spy = _patch_logger_spy(monkeypatch)

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        old = datetime.now(UTC) - timedelta(seconds=31)
        # 脏数据：status='claimed'（非 cancelled）却带 terminating_at
        lease = await _make_terminated_lease_row(
            db_session, rt.id, terminating_at=old, status="claimed"
        )

        svc = DaemonLeaseService(db_session)
        stuck = await svc.alert_stuck_terminating_leases()

        # 仍命中（XC-08：不按 status 过滤）
        assert stuck == [lease.id]
        assert spy.warning.call_count == 1
        # D-007：sweeper 不改 status（仍是 claimed）
        await db_session.refresh(lease)
        assert lease.status == "claimed"

    @pytest.mark.asyncio
    async def test_sweeper_returns_only_old_among_mixed(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """混合场景：同时存在 old(31s)/recent(10s)/None 三条 lease → 仅 old 进列表。

        端到端验证阈值边界 + 幂等（sweeper 不误报、不漏报）。
        """
        spy = _patch_logger_spy(monkeypatch)

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        old_lease = await _make_terminated_lease_row(
            db_session,
            rt.id,
            terminating_at=datetime.now(UTC) - timedelta(seconds=31),
        )
        await _make_terminated_lease_row(
            db_session,
            rt.id,
            terminating_at=datetime.now(UTC) - timedelta(seconds=10),
        )
        await _make_terminated_lease_row(db_session, rt.id, terminating_at=None)

        svc = DaemonLeaseService(db_session)
        stuck = await svc.alert_stuck_terminating_leases()

        assert stuck == [old_lease.id]  # 仅 old 命中
        assert spy.warning.call_count == 1  # 仅一条告警
