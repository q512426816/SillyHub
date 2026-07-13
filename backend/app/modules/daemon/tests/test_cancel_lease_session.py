"""task-04（2026-07-13-fix-interactive-session-zombie）：cancel_lease interactive
分支收口 AgentSession.status='ended'。

审计 P0-3：interactive lease（对话/stage/scan/quick-chat 的 lease kind 均为
interactive，D-008 / placement.py:264）被 cancel 时，AgentRun/lease 在 DB 已
killed/cancelled，但 1:1 绑定的 AgentSession 卡在 pending/active/reconnecting
成僵尸行——后续 GC/列表/UI 仍把它当作"活的"。本测试守护 cancel_lease 在
WS SESSION_INTERRUPT 之后补 set session.status='ended' + ended_at（D-003：
kill=正常终止非 failed，直接 set 不调辅助函数——辅助函数对 killed run 返
failed 不适用）。

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
