"""task-04（2026-07-13-fix-interactive-session-zombie）：cancel_lease interactive
分支收口 AgentSession.status='ended'。

审计 P0-3：interactive lease（对话/stage/scan/quick-chat 的 lease kind 均为
interactive，D-008 / placement.py:264）被 cancel 时，AgentRun/lease 在 DB 已
killed/cancelled，但 1:1 绑定的 AgentSession 卡在 pending/active/reconnecting
成僵尸行——后续 GC/列表/UI 仍把它当作"活的"。本测试守护 cancel_lease 在
WS SESSION_END 之后补 set session.status='ended' + ended_at（D-003：
kill=正常终止非 failed，直接 set 不调辅助函数——辅助函数对 killed run 返
failed 不适用）。

change 2026-08-05-daemon-kill-channel-unify / task-02 / D-001@v2 / XC-01：
cancel_lease 对 interactive lease 改发 SESSION_END（不再 SESSION_INTERRUPT），
让取消 run 也走 daemon 的 _terminateSession 硬杀链（interrupt 按钮不动，仍发
INTERRUPT）。TestCancelLeaseSendsSessionEnd 守护此消息契约。

覆盖：
1. interactive 收口：active session → cancel_lease 后 ended（非 failed，D-003）
2. 幂等：已 ended 的 session 不被覆盖（D-005）
3. stage cancel 回归（D-008）：dispatch_to_daemon 路径 lease kind=interactive
4. scan cancel 回归（D-008）：platform-managed run 的 interactive lease
5. mission cancel 集成：MissionControlService.cancel 遍历调 cancel_lease 自动收口
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.daemon.lease_service import DaemonLeaseService
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.workspace.model import Workspace

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    """Insert a User row so FK constraints on daemon_runtimes are satisfied."""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"task04-{uid}@example.com",
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
        name="task04-daemon",
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


def _patch_ws_hub(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch ws_hub.get_daemon_ws_hub 为空 hub，避免 _send_interactive_cancel
    真连 daemon（WS 是 best-effort，测试只关心 DB 收口）。"""
    from app.modules.daemon import ws_hub as ws_hub_mod

    class _FakeHub:
        async def send_session_control(self, daemon_id, msg_type, payload):
            return True

    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _FakeHub())


async def _create_interactive_run(
    session: AsyncSession,
    runtime_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    session_status: str = "active",
    agent_session_id: uuid.UUID | None = None,
    change_id: uuid.UUID | None = None,
    spec_strategy: str | None = "platform-managed",
    run_status: str = "running",
    ended_at: datetime | None = None,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """构造 interactive lease + AgentSession + AgentRun。

    返回 (lease_id, run_id, session_id)。lease kind='interactive'（D-008 覆盖
    对话/stage/scan/quick-chat 的 lease kind 均为 interactive）。
    """
    now = datetime.now(UTC)
    run_id = uuid.uuid4()
    sess_id = agent_session_id or uuid.uuid4()

    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=run_id,
        status="claimed",
        kind="interactive",
        claimed_at=now,
        lease_expires_at=None,  # interactive lease 不过期
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
        ended_at=ended_at,
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status=run_status,
        spec_strategy=spec_strategy,
        change_id=change_id,
        agent_session_id=sess_id,
    )
    session.add_all([lease, agent_session, run])
    await session.commit()
    return lease.id, run_id, sess_id


# ── Tests ────────────────────────────────────────────────────────────────────


class TestCancelLeaseInteractiveSessionClose:
    """task-04 / D-003 / D-008：interactive lease cancel 收口 session=ended。"""

    @pytest.mark.asyncio
    async def test_cancel_interactive_closes_session_ended_not_failed(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-003：active session + claimed interactive lease → cancel 后
        run=killed、lease=cancelled、session=ended（非 failed）。

        kill=正常终止，不能标 failed（辅助函数对 killed run 返 failed 不适用，
        故收口段直接 set session.status='ended'）。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id, sess_id = await _create_interactive_run(
            db_session,
            rt.id,
            user_id,
            session_status="active",
        )

        _patch_ws_hub(monkeypatch)

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        # lease / run 终态
        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None
        assert lease.status == "cancelled"
        ar = await db_session.get(AgentRun, run_id)
        assert ar is not None
        assert ar.status == "killed"

        # 关键断言：session 收口 ended（非 failed），ended_at 已写
        sess = await db_session.get(AgentSession, sess_id)
        assert sess is not None
        assert sess.status == "ended"
        assert sess.ended_at is not None

    @pytest.mark.asyncio
    async def test_cancel_idempotent_when_session_already_ended(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-005：session 已 ended → cancel 不覆盖 status、不重写 ended_at。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        original_ended_at = datetime.now(UTC) - timedelta(hours=1)
        _lease_id, run_id, sess_id = await _create_interactive_run(
            db_session,
            rt.id,
            user_id,
            session_status="ended",
            ended_at=original_ended_at,
        )

        _patch_ws_hub(monkeypatch)

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        # 幂等：session 仍 ended、ended_at 未被重写
        sess = await db_session.get(AgentSession, sess_id)
        assert sess is not None
        assert sess.status == "ended"
        # SQLite 存 naive datetime，比较时去 tzinfo
        expected = original_ended_at.replace(tzinfo=None)
        actual = sess.ended_at.replace(tzinfo=None) if sess.ended_at else None
        assert actual == expected

    @pytest.mark.asyncio
    async def test_cancel_idempotent_when_session_failed(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-005 变体：session=failed → cancel 不动它（failed 不在收口白名单）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        _lease_id, run_id, sess_id = await _create_interactive_run(
            db_session,
            rt.id,
            user_id,
            session_status="failed",
        )

        _patch_ws_hub(monkeypatch)

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        sess = await db_session.get(AgentSession, sess_id)
        assert sess is not None
        assert sess.status == "failed"  # 未被覆盖
        assert sess.ended_at is None  # failed 不写 ended_at

    @pytest.mark.asyncio
    async def test_stage_cancel_closes_session(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-008：dispatch_to_daemon 路径 lease kind=interactive + session=pending
        （stage run：change_id 非空）→ cancel_lease 收口 session=ended，不破坏
        stage 生命周期（不触碰 stage 状态机 / 不双写 complete_lease）。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id, sess_id = await _create_interactive_run(
            db_session,
            rt.id,
            user_id,
            session_status="pending",
            change_id=uuid.uuid4(),  # 非空 = stage run
            spec_strategy="platform-managed",
        )

        _patch_ws_hub(monkeypatch)

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        # stage lease kind 仍是 interactive → session 收口 ended（D-008）
        sess = await db_session.get(AgentSession, sess_id)
        assert sess is not None
        assert sess.status == "ended"
        assert sess.ended_at is not None
        # lease / run 终态正常（不破坏 stage 生命周期）
        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None
        assert lease.status == "cancelled"
        ar = await db_session.get(AgentRun, run_id)
        assert ar is not None
        assert ar.status == "killed"

    @pytest.mark.asyncio
    async def test_scan_cancel_closes_session(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-008：platform-managed scan run 的 interactive lease（change_id=None）
        → cancel_lease 收口 session=ended，守护 test_interactive_lifecycle_patch
        行为不回归。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        _lease_id, run_id, sess_id = await _create_interactive_run(
            db_session,
            rt.id,
            user_id,
            session_status="active",
            change_id=None,
            spec_strategy="platform-managed",
        )

        _patch_ws_hub(monkeypatch)

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        sess = await db_session.get(AgentSession, sess_id)
        assert sess is not None
        assert sess.status == "ended"
        assert sess.ended_at is not None


class TestMissionCancelClosesWorkerSessions:
    """task-04 集成：MissionControlService.cancel 遍历 worker_runs 调 cancel_lease
    → 每个 worker session 收口 ended（control.py:108 透传，不改 control.py）。"""

    @pytest.mark.asyncio
    async def test_mission_cancel_closes_all_worker_sessions(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """2 个 worker run（mission_id 关联）各带 interactive lease + active
        session → mission cancel 后两 session 均 ended。
        """
        from app.modules.agent.control import MissionControlService

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        # Workspace（AgentMission.workspace_id NOT NULL FK）
        ws = Workspace(
            id=uuid.uuid4(),
            name="task04-ws",
            slug="task04-ws",
            root_path="/tmp/task04",
            status="active",
        )
        db_session.add(ws)
        await db_session.commit()

        mission = AgentMission(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            objective="task04 objective",
        )
        db_session.add(mission)

        # 2 个 worker run：各挂 interactive lease + active session，通过 mission_id 关联
        _, run_a, sess_a = await _create_interactive_run(
            db_session, rt.id, user_id, session_status="active"
        )
        _, run_b, sess_b = await _create_interactive_run(
            db_session, rt.id, user_id, session_status="active"
        )
        # 关联到 mission
        ar_a = await db_session.get(AgentRun, run_a)
        ar_b = await db_session.get(AgentRun, run_b)
        assert ar_a is not None and ar_b is not None
        ar_a.mission_id = mission.id
        ar_b.mission_id = mission.id
        db_session.add_all([ar_a, ar_b])
        await db_session.commit()

        _patch_ws_hub(monkeypatch)

        mc = MissionControlService(db_session)
        killed = await mc.cancel(mission)

        assert killed == 2
        # 两 worker session 均收口 ended
        sess1 = await db_session.get(AgentSession, sess_a)
        assert sess1 is not None
        assert sess1.status == "ended"
        assert sess1.ended_at is not None
        sess2 = await db_session.get(AgentSession, sess_b)
        assert sess2 is not None
        assert sess2.status == "ended"
        assert sess2.ended_at is not None


class TestCancelLeaseSendsSessionEnd:
    """task-02 / D-001@v2 / XC-01：cancel_lease 对 interactive lease 必须发
    SESSION_END（不再 SESSION_INTERRUPT）。daemon 收 SESSION_END 才会走
    ``sessionManager.end → _terminateSession → driverHandle.close?.()`` 硬杀链；
    SESSION_INTERRUPT 只软中止当前 turn（``interrupt()`` 不杀进程），cancel 路径
    用它会留僵尸。本类直接断言 WS 消息类型，守护真实契约。
    """

    @pytest.mark.asyncio
    async def test_cancel_interactive_sends_session_end_not_interrupt(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-001@v2：claimed interactive lease + active session → cancel_lease
        经 WS 发的必须是 SESSION_END，且不能是 SESSION_INTERRUPT。
        """
        from app.modules.daemon import ws_hub as ws_hub_mod
        from app.modules.daemon.protocol import (
            DAEMON_MSG_SESSION_END,
            DAEMON_MSG_SESSION_INTERRUPT,
        )

        captured: list[tuple] = []

        class _RecordingHub:
            async def send_session_control(self, daemon_id, msg_type, payload):
                captured.append((daemon_id, msg_type, payload))
                return True

        monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _RecordingHub())

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        _lease_id, run_id, _sess_id = await _create_interactive_run(
            db_session,
            rt.id,
            user_id,
            session_status="active",
        )

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        # 必发且只发一条 SESSION_END（不是 INTERRUPT）
        assert len(captured) == 1
        _daemon_id, msg_type, _payload = captured[0]
        assert msg_type == DAEMON_MSG_SESSION_END
        assert msg_type != DAEMON_MSG_SESSION_INTERRUPT

    @pytest.mark.asyncio
    async def test_cancel_interactive_session_end_payload_carries_ids(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """SESSION_END payload 必须带 session_id / lease_id / runtime_id（daemon
        end 路由按 session_id 收口，缺字段 daemon 端早返回不杀）。守护 payload 契约。
        """
        from app.modules.daemon import ws_hub as ws_hub_mod

        captured: list[dict] = []

        class _RecordingHub:
            async def send_session_control(self, daemon_id, msg_type, payload):
                captured.append(payload)
                return True

        monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _RecordingHub())

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id, sess_id = await _create_interactive_run(
            db_session,
            rt.id,
            user_id,
            session_status="active",
        )

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        assert len(captured) == 1
        payload = captured[0]
        assert payload["session_id"] == str(sess_id)
        assert payload["lease_id"] == str(lease_id)
        assert payload["runtime_id"] == str(rt.id)


class TestCancelLeaseRunIdNull:
    """verify e2e 发现的 bug 回归守护（2026-07-14）：interactive lease 的
    agent_run_id=NULL（D-005@v1 session↔lease 1:1，lease 绑 session 不绑 run），
    cancel_lease by agent_run_id 查 lease 查不到（lease None 早返回）。session
    收口必须独立于 lease，基于 run.agent_session_id。修复前 kill 后 session 卡
    active（e2e 实测 session=active/run=killed），修复后 ended。
    """

    @pytest.mark.asyncio
    async def test_cancel_lease_run_id_null_closes_session(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch_ws_hub(monkeypatch)
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        now = datetime.now(UTC)
        sess_id = uuid.uuid4()
        run_id = uuid.uuid4()
        # interactive lease agent_run_id=None（真实 D-005@v1，区别于 _create_interactive_run 的 =run_id）
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            status="claimed",
            kind="interactive",
            claimed_at=now,
            lease_expires_at=None,
            metadata_={"claim_token": "t", "session_id": str(sess_id)},
            created_at=now,
            updated_at=now,
        )
        agent_session = AgentSession(
            id=sess_id,
            user_id=uid,
            provider="claude",
            status="active",
            config={},
            turn_count=1,
            runtime_id=rt.id,
            lease_id=lease.id,
            last_active_at=now,
            created_at=now,
        )
        run = AgentRun(
            id=run_id,
            agent_type="claude_code",
            provider="claude",
            status="running",
            spec_strategy="interactive",
            agent_session_id=sess_id,
        )
        db_session.add_all([lease, agent_session, run])
        await db_session.commit()

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        await db_session.refresh(agent_session)
        await db_session.refresh(run)
        assert run.status == "killed"
        assert agent_session.status == "ended"  # 修复后收口（修复前卡 active）
        assert agent_session.ended_at is not None


class TestCancelLeaseSendsLeaseCancelForBatch:
    """task-05 / FR-03 / R-06（design §5 Phase2 / §7.5 / §9）：cancel_lease 对
    batch lease（``kind != interactive``）标记 cancelled 后必须经 ws_hub 即时
    best-effort 发 ``LEASE_CANCEL`` WS 消息，不再只靠心跳轮询。daemon 收到后调
    ``taskRunner.cancel(leaseId)`` 复用 ``AbortController → _killChild`` 即时杀
    子进程；发送失败靠心跳兜底。interactive lease **不**走此分支（task-02 改发
    SESSION_END）。本类直接断言 WS 消息类型 + payload + best-effort 容错。
    """

    @pytest.mark.asyncio
    async def test_cancel_batch_sends_lease_cancel(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """FR-03：claimed batch lease → cancel_lease 经 WS 发的必须是
        LEASE_CANCEL（type=daemon:lease_cancel），payload 带 lease_id + runtime_id。
        """
        from app.modules.daemon import ws_hub as ws_hub_mod
        from app.modules.daemon.protocol import (
            DAEMON_MSG_LEASE_CANCEL,
            DAEMON_MSG_SESSION_END,
            DAEMON_MSG_SESSION_INTERRUPT,
        )

        captured: list[tuple] = []

        class _RecordingHub:
            async def send_to_runtime(self, daemon_id, message):
                captured.append((daemon_id, message))
                return True

            async def send_session_control(self, daemon_id, msg_type, payload):
                # interactive 路径若误触发会走这里——测试断言它不该被调用
                captured.append(("_session_control", (msg_type, payload)))
                return True

        monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _RecordingHub())

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id = await _create_batch_lease_run(db_session, rt.id, user_id)

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        # 必发且只发一条 LEASE_CANCEL（走 send_to_runtime，不是 send_session_control）
        assert len(captured) == 1
        _daemon_id, message = captured[0]
        assert message["type"] == DAEMON_MSG_LEASE_CANCEL
        # 守护：不能误发 SESSION_END / SESSION_INTERRUPT（那是 interactive 路径）
        assert message["type"] != DAEMON_MSG_SESSION_END
        assert message["type"] != DAEMON_MSG_SESSION_INTERRUPT

        # payload 契约（task-04 provides：lease_id + runtime_id）
        payload = message["payload"]
        assert payload["lease_id"] == str(lease_id)
        assert payload["runtime_id"] == str(rt.id)

        # lease / run 终态正常
        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None
        assert lease.status == "cancelled"
        ar = await db_session.get(AgentRun, run_id)
        assert ar is not None
        assert ar.status == "killed"

    @pytest.mark.asyncio
    async def test_cancel_batch_lease_cancel_payload_no_extra_fields(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """守护 LEASE_CANCEL payload 仅含 task-04 provides 承诺的 lease_id +
        runtime_id（不 fallback 编造 session_id 等额外字段——契约铁律）。
        """
        from app.modules.daemon import ws_hub as ws_hub_mod

        captured: list[dict] = []

        class _RecordingHub:
            async def send_to_runtime(self, daemon_id, message):
                captured.append(message)
                return True

            async def send_session_control(self, daemon_id, msg_type, payload):
                return True

        monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _RecordingHub())

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id = await _create_batch_lease_run(db_session, rt.id, user_id)

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        assert len(captured) == 1
        payload = captured[0]["payload"]
        # 仅 task-04 provides 的两字段（snake_case），不掺 session_id / 别的字段
        assert set(payload.keys()) == {"lease_id", "runtime_id"}
        assert payload["lease_id"] == str(lease_id)
        assert payload["runtime_id"] == str(rt.id)

    @pytest.mark.asyncio
    async def test_cancel_interactive_does_not_send_lease_cancel(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """分工守护：interactive lease cancel 走 SESSION_END（task-02），**不**发
        LEASE_CANCEL——两条消息经不同 helper、不同 ws_hub 方法（send_session_control
        vs send_to_runtime），不能交叉。
        """
        from app.modules.daemon import ws_hub as ws_hub_mod
        from app.modules.daemon.protocol import (
            DAEMON_MSG_LEASE_CANCEL,
            DAEMON_MSG_SESSION_END,
        )

        runtime_calls: list[dict] = []
        session_control_calls: list[tuple] = []

        class _RecordingHub:
            async def send_to_runtime(self, daemon_id, message):
                runtime_calls.append(message)
                return True

            async def send_session_control(self, daemon_id, msg_type, payload):
                session_control_calls.append((msg_type, payload))
                return True

        monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _RecordingHub())

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        _lease_id, run_id, _sess_id = await _create_interactive_run(
            db_session, rt.id, user_id, session_status="active"
        )

        svc = DaemonLeaseService(db_session)
        await svc.cancel_lease(run_id)

        # interactive 走 SESSION_END（send_session_control），不走 LEASE_CANCEL
        assert len(session_control_calls) == 1
        msg_type, _payload = session_control_calls[0]
        assert msg_type == DAEMON_MSG_SESSION_END
        # 关键断言：send_to_runtime（LEASE_CANCEL 通道）一次都没调
        assert runtime_calls == []
        # 双保险：没有任何消息 type 是 LEASE_CANCEL
        assert all(m["type"] != DAEMON_MSG_LEASE_CANCEL for m in runtime_calls)

    @pytest.mark.asyncio
    async def test_cancel_batch_daemon_offline_does_not_raise(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """best-effort 守护（design §9）：daemon 离线（send_to_runtime 返回
        False）时 cancel_lease 不能抛——DB 已 cancelled，心跳轮询兜底。
        """
        from app.modules.daemon import ws_hub as ws_hub_mod

        class _OfflineHub:
            async def send_to_runtime(self, daemon_id, message):
                return False  # daemon 离线 / 无连接

            async def send_session_control(self, daemon_id, msg_type, payload):
                return False

        monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _OfflineHub())

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id = await _create_batch_lease_run(db_session, rt.id, user_id)

        svc = DaemonLeaseService(db_session)
        # 不抛
        await svc.cancel_lease(run_id)

        # DB 终态照常落库（best-effort：WS 失败不影响 cancel 主流程）
        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None
        assert lease.status == "cancelled"
        ar = await db_session.get(AgentRun, run_id)
        assert ar is not None
        assert ar.status == "killed"

    @pytest.mark.asyncio
    async def test_cancel_batch_send_to_runtime_raises_does_not_raise(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """best-effort 守护（design §9）：send_to_runtime 抛异常时 cancel_lease
        也不能抛——外层 try/except 兜住，只告警，DB 已收尾。
        """
        from app.modules.daemon import ws_hub as ws_hub_mod

        class _ExplodingHub:
            async def send_to_runtime(self, daemon_id, message):
                raise RuntimeError("simulated WS transport failure")

            async def send_session_control(self, daemon_id, msg_type, payload):
                return True

        monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _ExplodingHub())

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id = await _create_batch_lease_run(db_session, rt.id, user_id)

        svc = DaemonLeaseService(db_session)
        # 不抛
        await svc.cancel_lease(run_id)

        # DB 终态照常落库
        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None
        assert lease.status == "cancelled"


async def _create_batch_lease_run(
    session: AsyncSession,
    runtime_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    run_status: str = "running",
) -> tuple[uuid.UUID, uuid.UUID]:
    """构造一条 batch lease（kind='batch'）+ 关联 AgentRun（无 AgentSession，
    batch 路径不绑 session）。返回 (lease_id, run_id)。

    区别于 _create_interactive_run：kind='batch'、不带 AgentSession、lease 有
    lease_expires_at（batch 走心跳续期，interactive 不过期）。
    """
    now = datetime.now(UTC)
    run_id = uuid.uuid4()

    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=run_id,
        status="claimed",
        kind="batch",
        claimed_at=now,
        lease_expires_at=now + timedelta(minutes=5),
        metadata_={"claim_token": "tok"},
        created_at=now,
        updated_at=now,
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status=run_status,
        spec_strategy="platform-managed",
    )
    session.add_all([lease, run])
    await session.commit()
    return lease.id, run_id
