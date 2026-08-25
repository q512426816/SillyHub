"""task-03 / Phase1：cancel_lease → SESSION_END → daemon _terminateSession 硬杀链
集成测试（change 2026-08-05-daemon-kill-channel-unify / decisions D-001@v2 / D-003）。

AC-4：验证 backend ``cancel_lease`` 对 interactive lease 发出 SESSION_END 信号，
带动 DB 终态一致收敛（lease=cancelled / run=killed / session=ended），且消息
payload 携带 daemon end 路由所需字段（session_id / lease_id / runtime_id）。
daemon 侧 SESSION_END → ``sessionManager.end`` → ``_terminateSession`` →
``driverHandle.close?.()`` 的硬杀链由 ts 侧测试覆盖
（session-manager-terminate-close.test.ts AC-1 + daemon-kind-dispatch.test.ts AC-08）；
本文件守护 backend 这一端的完整链路（一条 cancel_lease 同时产出正确的 WS 信号
+ DB 终态），以及 best-effort 容错（daemon 离线不影响 DB 收敛）。

与既有测试分工（不重复）：
- test_cancel_lease_session.py::TestCancelLeaseSendsSessionEnd：分别断言
  「消息类型是 SESSION_END」「payload 含三字段」「不发 LEASE_CANCEL」等单一切面。
- 本文件：单一 cohesive 场景把「WS 信号 + lease/run/session 三态收敛 + best-effort
  容错 + reconnecting 收口分支」串成一个完整 kill-chain 集成断言，并补既有测试
  未覆盖的 ``session.status='reconnecting'`` 收口分支与「SESSION_END 是唯一
  session_control 消息（无 INTERRUPT 残留）」的端到端守护。

覆盖：
1. happy path：claimed interactive lease + active session → cancel_lease 同时
   触发 (a) 恰一条 SESSION_END (b) payload 三字段 (c) lease/run/session 三态收敛
   (d) 仅有 SESSION_END，无 SESSION_INTERRUPT / LEASE_CANCEL 残留。
2. reconnecting 收口分支：session.status='reconnecting' → cancel 后 ended
  （既有测试覆盖了 active/pending/ended/failed，本文件补 reconnecting）。
3. best-effort：daemon 离线（send_session_control 返回 False）→ SESSION_END
   仍尝试发送一次，DB 三态照常收敛，cancel_lease 不抛。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.lease_service import DaemonLeaseService
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"task03-{uid}@example.com",
            password_hash="irrelevant",
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
        name="task03-daemon",
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


def _make_recording_hub(captured: list, *, deliver: bool = True):
    """构造一个记录型 ws hub，把所有 send_session_control / send_to_runtime
    调用记入 ``captured``。``deliver=False`` 模拟 daemon 离线（返回 False）。"""

    from app.modules.daemon import ws_hub as ws_hub_mod

    class _RecordingHub:
        async def send_session_control(self, daemon_id, msg_type, payload):
            captured.append(("session_control", daemon_id, msg_type, payload))
            return deliver

        async def send_to_runtime(self, daemon_id, message):
            captured.append(("to_runtime", daemon_id, message))
            return deliver

    return ws_hub_mod, _RecordingHub


def _patch_hub(monkeypatch: pytest.MonkeyPatch, captured: list, *, deliver: bool = True) -> None:
    ws_hub_mod, hub_cls = _make_recording_hub(captured, deliver=deliver)
    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: hub_cls())


async def _create_interactive_run(
    session: AsyncSession,
    runtime_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    session_status: str = "active",
    lease_agent_run_id: uuid.UUID | None = None,
    lease_status: str = "claimed",
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """构造 interactive lease + AgentSession + AgentRun，返回 (lease_id, run_id, sess_id)。

    P0-2（2026-08-25 team-subsession 路线图）：``lease_agent_run_id`` 默认 None =
    生产形态（D-005@v1，placement.InteractiveDispatch：interactive lease 建时
    agent_run_id=NULL，首 turn run_id 只存 lease metadata）——本 helper 原先误写
    ``agent_run_id=run_id``，与生产相反，掩盖了 cancel_lease by-run 查询对
    interactive 恒 miss 的 SESSION_END 盲区。显式传 run_id 可构造旧形态对比。
    ``lease_status`` 供终态 lease 守卫用例。
    """
    now = datetime.now(UTC)
    run_id = uuid.uuid4()
    sess_id = uuid.uuid4()

    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=lease_agent_run_id,
        status=lease_status,
        kind="interactive",
        claimed_at=now,
        lease_expires_at=None,
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
        status="running",
        spec_strategy="platform-managed",
        agent_session_id=sess_id,
    )
    session.add_all([lease, agent_session, run])
    await session.commit()
    return lease.id, run_id, sess_id


# ── Tests ────────────────────────────────────────────────────────────────────


class TestCancelLeaseSessionEndIntegration:
    """task-03 AC-4：cancel_lease → SESSION_END + DB 终态一致收敛（完整 kill-chain
    backend 端集成）。"""

    @pytest.mark.asyncio
    async def test_cancel_interactive_full_kill_chain(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-001@v2 / D-03 完整链路：claimed interactive lease + active session
        → 单次 cancel_lease 同时产出：
        (a) 恰一条 SESSION_END WS 消息（send_session_control）；
        (b) payload 含 daemon end 路由所需 session_id / lease_id / runtime_id；
        (c) DB 三态收敛：lease=cancelled、run=killed、session=ended（ended_at 非空）；
        (d) 唯一性：无 SESSION_INTERRUPT、无 LEASE_CANCEL 残留（cancel 路径不再
            走软中断或 batch 通道）。
        单个场景串起 backend 这一端整条 kill-chain 契约。
        """
        from app.modules.daemon.protocol import (
            DAEMON_MSG_LEASE_CANCEL,
            DAEMON_MSG_SESSION_END,
            DAEMON_MSG_SESSION_INTERRUPT,
        )

        captured: list = []
        _patch_hub(monkeypatch, captured)

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id, sess_id = await _create_interactive_run(
            db_session, rt.id, user_id, session_status="active"
        )

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        # (a) 恰一条 session_control 消息
        session_control_calls = [c for c in captured if c[0] == "session_control"]
        to_runtime_calls = [c for c in captured if c[0] == "to_runtime"]
        assert len(session_control_calls) == 1
        # interactive 路径不走 send_to_runtime（那是 batch LEASE_CANCEL 通道）
        assert to_runtime_calls == []

        _kind, _daemon_id, msg_type, payload = session_control_calls[0]

        # (b) 消息类型 + payload 三字段
        assert msg_type == DAEMON_MSG_SESSION_END
        assert payload["session_id"] == str(sess_id)
        assert payload["lease_id"] == str(lease_id)
        assert payload["runtime_id"] == str(rt.id)

        # (d) 唯一性守护：cancel 路径既不发 INTERRUPT（D-001@v2 取消 v1 软中断），
        # 也不发 LEASE_CANCEL（那是 batch 路径）
        assert msg_type != DAEMON_MSG_SESSION_INTERRUPT
        assert msg_type != DAEMON_MSG_LEASE_CANCEL
        assert all(m.get("type") != DAEMON_MSG_LEASE_CANCEL for (_k, _d, m) in to_runtime_calls)

        # (c) DB 三态一致收敛
        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None and lease.status == "cancelled"
        ar = await db_session.get(AgentRun, run_id)
        assert ar is not None and ar.status == "killed"
        sess = await db_session.get(AgentSession, sess_id)
        assert sess is not None
        assert sess.status == "ended"
        assert sess.ended_at is not None

    @pytest.mark.asyncio
    async def test_cancel_interactive_reconnecting_session_closed(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """session.status='reconnecting'（daemon 重启恢复中）也必须被 cancel_lease
        收口为 ended。既有 test_cancel_lease_session.py 覆盖了 active/pending/ended/
        failed，本测试补 reconnecting 分支（cancel_lease 白名单含 reconnecting，
        lease_service.py:319-323）——daemon 离线重启窗口内用户取消仍能正确收口。
        """
        from app.modules.daemon.protocol import DAEMON_MSG_SESSION_END

        captured: list = []
        _patch_hub(monkeypatch, captured)

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id, sess_id = await _create_interactive_run(
            db_session, rt.id, user_id, session_status="reconnecting"
        )

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        # SESSION_END 仍发出（reconnecting session 在 cancel 白名单内）
        session_control_calls = [c for c in captured if c[0] == "session_control"]
        assert len(session_control_calls) == 1
        assert session_control_calls[0][2] == DAEMON_MSG_SESSION_END

        # session 收敛 ended（reconnecting → ended），ended_at 已写
        sess = await db_session.get(AgentSession, sess_id)
        assert sess is not None
        assert sess.status == "ended"
        assert sess.ended_at is not None
        # lease / run 终态照常
        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None and lease.status == "cancelled"
        ar = await db_session.get(AgentRun, run_id)
        assert ar is not None and ar.status == "killed"

    @pytest.mark.asyncio
    async def test_cancel_interactive_daemon_offline_db_still_converges(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """best-effort（design §9 / R-06）：daemon 离线（send_session_control 返回
        False，模拟 WS 无连接）→ SESSION_END 仍尝试发送一次，cancel_lease 不抛，
        DB 三态照常收敛（kill-chain 的 DB 端不受 WS 传输失败影响；daemon 侧靠
        idle expire / lease 心跳兜底，不在本测试范围）。
        """
        from app.modules.daemon.protocol import DAEMON_MSG_SESSION_END

        captured: list = []
        _patch_hub(monkeypatch, captured, deliver=False)

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id, sess_id = await _create_interactive_run(
            db_session, rt.id, user_id, session_status="active"
        )

        svc = DaemonLeaseService(db_session)
        # 不抛（best-effort）
        await svc.cancel_lease(run_id)

        # 仍尝试发送了 SESSION_END（best-effort：发不发由 hub 决定，cancel 主流程不依赖）
        session_control_calls = [c for c in captured if c[0] == "session_control"]
        assert len(session_control_calls) == 1
        assert session_control_calls[0][2] == DAEMON_MSG_SESSION_END

        # DB 三态照常收敛（kill-chain backend 端不受 WS 失败影响）
        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None and lease.status == "cancelled"
        ar = await db_session.get(AgentRun, run_id)
        assert ar is not None and ar.status == "killed"
        sess = await db_session.get(AgentSession, sess_id)
        assert sess is not None
        assert sess.status == "ended"
        assert sess.ended_at is not None

    @pytest.mark.asyncio
    async def test_cancel_interactive_no_double_session_control_message(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """守护：单次 cancel_lease 只发**一条** SESSION_END，不重复（避免 daemon
        侧多次 end → 多次 _terminateSession → 多次 close，虽然幂等但浪费 WS 流量
        且增加日志噪声）。本测试端到端断言 session_control 调用计数 == 1。
        """
        captured: list = []
        _patch_hub(monkeypatch, captured)

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        _lease_id, run_id, _sess_id = await _create_interactive_run(
            db_session, rt.id, user_id, session_status="active"
        )

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        session_control_calls = [c for c in captured if c[0] == "session_control"]
        assert len(session_control_calls) == 1

    # ── P0-2（2026-08-25 team-subsession 路线图）：生产 lease 形态回归 ──────────
    # 生产 interactive lease agent_run_id=NULL（D-005@v1，绑 session 不绑 run），
    # cancel_lease 的 by-run 查询对 interactive 恒 miss。下方用例锁定：
    # miss 后按 run.agent_session_id → AgentSession.lease_id 回捞 interactive
    # lease，SESSION_END 照发（否则 daemon 内存 SDK 会话成僵尸继续烧 token）。

    @pytest.mark.asyncio
    async def test_cancel_interactive_production_lease_shape_sends_session_end(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """P0-2 回归：lease agent_run_id=None（生产形态）→ 经 session.lease_id
        回捞后 SESSION_END 照发，lease=cancelled / run=killed / session=ended
        三态收敛与 by-run 命中路径完全一致。"""
        from app.modules.daemon.protocol import DAEMON_MSG_SESSION_END

        captured: list = []
        _patch_hub(monkeypatch, captured)

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id, sess_id = await _create_interactive_run(
            db_session, rt.id, user_id, session_status="active"
        )
        # fixture 默认已是生产形态（lease_agent_run_id=None），此处显式断言前提。
        lease_before = await db_session.get(DaemonTaskLease, lease_id)
        assert lease_before is not None and lease_before.agent_run_id is None

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        session_control_calls = [c for c in captured if c[0] == "session_control"]
        assert len(session_control_calls) == 1
        _kind, _daemon_id, msg_type, payload = session_control_calls[0]
        assert msg_type == DAEMON_MSG_SESSION_END
        assert payload["session_id"] == str(sess_id)
        assert payload["lease_id"] == str(lease_id)
        assert payload["runtime_id"] == str(rt.id)

        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None and lease.status == "cancelled"
        assert lease.terminating_at is not None
        ar = await db_session.get(AgentRun, run_id)
        assert ar is not None and ar.status == "killed"
        sess = await db_session.get(AgentSession, sess_id)
        assert sess is not None and sess.status == "ended"

    @pytest.mark.asyncio
    async def test_cancel_interactive_terminal_lease_not_resurrected(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """守卫：session 绑定的 lease 已终态（completed）→ 不回捞、不改 lease
        （终态 lease 不被复活重取消），走 lease-None 早退：run killed / session
        ended 照常，但不发 SESSION_END（daemon 侧会话已结束，无僵尸可杀）。"""
        captured: list = []
        _patch_hub(monkeypatch, captured)

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id, sess_id = await _create_interactive_run(
            db_session, rt.id, user_id, session_status="active", lease_status="completed"
        )

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        # 无 WS 消息（终态 lease 不发 SESSION_END / LEASE_CANCEL）
        assert captured == []

        # lease 保持 completed 不被改写
        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None and lease.status == "completed"
        # DB 收口照常（早退分支职责）
        ar = await db_session.get(AgentRun, run_id)
        assert ar is not None and ar.status == "killed"
        sess = await db_session.get(AgentSession, sess_id)
        assert sess is not None and sess.status == "ended"
