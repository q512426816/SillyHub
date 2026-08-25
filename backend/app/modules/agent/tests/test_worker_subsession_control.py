"""task-11（2026-08-25-team-subsession-governance）：MissionControlService 治理三口径
换子会话新形态单测。

design §5.C.6 / §5.D / FR-07 / D-002@v1 / D-004@v1：

- 混跑并发计数：``running_worker_count`` / ``active_worker_count`` = 存量
  running/pending 分身 run + ``is_worker_complete=False`` 的分身子会话合计
  （子会话首 run 剔除防同分身双计，对齐 mission_derive_status 虚拟映射口径）；
  ``can_dispatch_worker`` 的 MAX_WORKERS 判定吃新计数；
- union 成本：``cost_so_far`` 输入 = 存量分身 run ∪ 分身子会话轮次 run
  （``agent_session_id ∈ mission_worker_sessions``），治理门预算拦截覆盖追问轮
  成本；``cost_from_runs`` 静态公式不动；
- cancel：kill 名单 = 活跃存量分身 run ∪ 活跃分身子会话（按其活跃轮 run，无
  活跃轮取首 run 调 ``cancel_lease``，命中 P0-2 ``_lookup_interactive_lease_by_run``
  回捞链发 SESSION_END，子会话 ended + lease cancelled）；主控轮仍不占额度/
  不计成本/不进 kill 名单；无子会话 mission 三口径回落现行为（FR-09）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.control import MissionControlService
from app.modules.agent.delegation import MAX_WORKERS
from app.modules.agent.model import AgentMission, AgentRun, AgentSession

# ── 播种 helpers ─────────────────────────────────────────────────────────────


async def _make_root_and_mission(
    db: AsyncSession, *, budget_usd: float | None = None
) -> tuple[AgentSession, AgentMission]:
    """建主控根会话 + 会话 mission（session_id 落根，分身子会话的挂载点）。"""
    root = AgentSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="claude",
        status="active",
    )
    db.add(root)
    await db.commit()

    mission = AgentMission(
        workspace_id=uuid.uuid4(),
        objective="团队目标",
        session_id=root.id,
        budget_usd=budget_usd,
    )
    db.add(mission)
    await db.commit()
    await db.refresh(mission)
    return root, mission


async def _make_worker_session(
    db: AsyncSession,
    root: AgentSession,
    *,
    status: str = "active",
    worker_done_at: datetime | None = None,
    lease_id: uuid.UUID | None = None,
    runtime_id: uuid.UUID | None = None,
) -> AgentSession:
    """建分身子会话（parent 挂根）。"""
    w = AgentSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="claude",
        status=status,
        parent_session_id=root.id,
        worker_done_at=worker_done_at,
        lease_id=lease_id,
        runtime_id=runtime_id,
    )
    db.add(w)
    await db.commit()
    await db.refresh(w)
    return w


async def _make_run(
    db: AsyncSession,
    *,
    status: str,
    mission_id: uuid.UUID | None = None,
    role: str | None = None,
    agent_session_id: uuid.UUID | None = None,
    cost: float = 0.0,
) -> AgentRun:
    r = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        provider="claude",
        status=status,
        role=role,
        objective="o",
        agent_session_id=agent_session_id,
        total_cost_usd=cost,
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return r


# ── 1. 混跑并发计数 ─────────────────────────────────────────────────────────


class TestMixedConcurrencyCount:
    @pytest.mark.asyncio
    async def test_mixed_count_sums_legacy_runs_and_incomplete_subsessions(
        self, db_session: AsyncSession
    ) -> None:
        """混跑 mission：2 个存量 running 分身 run + 2 个未完成子会话 → 计数 4。"""
        root, mission = await _make_root_and_mission(db_session)
        await _make_run(db_session, status="running", mission_id=mission.id, role="arch")
        await _make_run(db_session, status="running", mission_id=mission.id, role=None)
        # w1：首轮 run 已 completed 但未调 worker_done（未完成）
        w1 = await _make_worker_session(db_session, root)
        await _make_run(
            db_session,
            status="completed",
            mission_id=mission.id,
            role="impl",
            agent_session_id=w1.id,
        )
        # w2：首轮 run 仍在 running（活跃 turn）
        w2 = await _make_worker_session(db_session, root)
        await _make_run(
            db_session,
            status="running",
            mission_id=mission.id,
            role="impl",
            agent_session_id=w2.id,
        )

        ctrl = MissionControlService(db_session)
        assert await ctrl.running_worker_count(mission.id) == 4
        assert await ctrl.active_worker_count(mission.id) == 4

    @pytest.mark.asyncio
    async def test_first_run_of_subsession_not_double_counted(
        self, db_session: AsyncSession
    ) -> None:
        """子会话首 run（mission_id+role 双标记）只按子会话计一次，不与 run 维度
        双计（对齐 mission_derive_status 剔除首 run 的同款口径）。"""
        root, mission = await _make_root_and_mission(db_session)
        w = await _make_worker_session(db_session, root)
        await _make_run(
            db_session,
            status="running",
            mission_id=mission.id,
            role="impl",
            agent_session_id=w.id,
        )

        assert await MissionControlService(db_session).running_worker_count(mission.id) == 1

    @pytest.mark.asyncio
    async def test_done_and_terminal_subsessions_free_slots(self, db_session: AsyncSession) -> None:
        """已完成子会话（done 且无活跃 turn）/ 终态子会话不占并发额度。"""
        root, mission = await _make_root_and_mission(db_session)
        w_done = await _make_worker_session(db_session, root, worker_done_at=datetime.now(UTC))
        await _make_run(
            db_session,
            status="completed",
            mission_id=mission.id,
            role="impl",
            agent_session_id=w_done.id,
        )
        await _make_worker_session(db_session, root, status="ended")

        assert await MissionControlService(db_session).running_worker_count(mission.id) == 0

    @pytest.mark.asyncio
    async def test_gate_blocks_at_max_workers_mixed(self, db_session: AsyncSession) -> None:
        """验收：MAX_WORKERS 额度由 run+子会话混跑合计判定——未完成子会话占额度。"""
        root, mission = await _make_root_and_mission(db_session)
        for _ in range(MAX_WORKERS):
            w = await _make_worker_session(db_session, root)
            await _make_run(
                db_session,
                status="completed",
                mission_id=mission.id,
                role="impl",
                agent_session_id=w.id,
            )

        allowed, reason = await MissionControlService(db_session).can_dispatch_worker(mission)
        assert not allowed
        assert reason == "max_workers_reached"

    @pytest.mark.asyncio
    async def test_pending_first_turn_subsession_counts(self, db_session: AsyncSession) -> None:
        """pending 子会话（首 run pending 未 claim）计入 active 口径（防 cancel
        漏杀）且占并发额度。"""
        root, mission = await _make_root_and_mission(db_session)
        w = await _make_worker_session(db_session, root)
        await _make_run(
            db_session,
            status="pending",
            mission_id=mission.id,
            role="impl",
            agent_session_id=w.id,
        )

        ctrl = MissionControlService(db_session)
        assert await ctrl.active_worker_count(mission.id) == 1
        assert await ctrl.running_worker_count(mission.id) == 1


# ── 2. union 成本（预算治理门覆盖追问轮）────────────────────────────────────


class TestUnionCost:
    @pytest.mark.asyncio
    async def test_followup_run_cost_trips_budget_gate(self, db_session: AsyncSession) -> None:
        """追问轮 run（无 mission_id，仅挂子会话）成本计入预算拦截（§5.C.6）。"""
        root, mission = await _make_root_and_mission(db_session, budget_usd=10.0)
        await _make_run(
            db_session, status="completed", mission_id=mission.id, role="arch", cost=3.0
        )
        w = await _make_worker_session(db_session, root)
        await _make_run(
            db_session,
            status="completed",
            mission_id=mission.id,
            role="impl",
            agent_session_id=w.id,
            cost=2.0,
        )
        await _make_run(db_session, status="completed", agent_session_id=w.id, cost=6.0)  # 追问轮

        ctrl = MissionControlService(db_session)
        assert await ctrl.cost_so_far(mission.id) == pytest.approx(11.0)
        allowed, reason = await ctrl.can_dispatch_worker(mission)
        assert not allowed
        assert reason == "budget_exceeded"

    @pytest.mark.asyncio
    async def test_first_run_not_double_counted_in_union(self, db_session: AsyncSession) -> None:
        """子会话首 run 同时命中 mission runs 与子会话轮次查询——union 去重后
        只计一次。"""
        root, mission = await _make_root_and_mission(db_session)
        w = await _make_worker_session(db_session, root)
        await _make_run(
            db_session,
            status="completed",
            mission_id=mission.id,
            role="impl",
            agent_session_id=w.id,
            cost=2.0,
        )

        assert await MissionControlService(db_session).cost_so_far(mission.id) == pytest.approx(2.0)

    @pytest.mark.asyncio
    async def test_orchestrator_run_cost_excluded(self, db_session: AsyncSession) -> None:
        """主控轮成本不计分身预算（子会话形态下口径不变）。"""
        root, mission = await _make_root_and_mission(db_session, budget_usd=1.0)
        await _make_run(
            db_session,
            status="running",
            mission_id=mission.id,
            role="orchestrator",
            agent_session_id=root.id,
            cost=9.9,
        )

        ctrl = MissionControlService(db_session)
        assert await ctrl.cost_so_far(mission.id) == pytest.approx(0.0)
        allowed, reason = await ctrl.can_dispatch_worker(mission)
        assert allowed, f"主控轮成本不应触发 budget_exceeded，got reason={reason}"

    @pytest.mark.asyncio
    async def test_done_subsession_cost_still_counted(self, db_session: AsyncSession) -> None:
        """已完成分身的成本仍是 mission 累计成本（预算口径不因完成回退）。"""
        root, mission = await _make_root_and_mission(db_session, budget_usd=5.0)
        w = await _make_worker_session(db_session, root, worker_done_at=datetime.now(UTC))
        await _make_run(
            db_session,
            status="completed",
            mission_id=mission.id,
            role="impl",
            agent_session_id=w.id,
            cost=4.0,
        )

        allowed, _reason = await MissionControlService(db_session).can_dispatch_worker(mission)
        assert allowed
        assert await MissionControlService(db_session).cost_so_far(mission.id) == pytest.approx(4.0)


# ── 3. cancel：kill 名单扩活跃子会话（走 cancel_lease SESSION_END 链）──────


class TestCancelKillListComposition:
    """mock cancel_lease 记录入参 run id，断言名单构成（活跃轮优先/首 run 兜底/
    主控轮与终态对象排除）。"""

    @pytest.mark.asyncio
    async def test_kill_list_covers_runs_and_sessions(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.modules.daemon import lease_service

        cancelled_run_ids: list[uuid.UUID] = []

        class _FakeLeaseService:
            def __init__(self, session) -> None:
                self._session = session

            async def cancel_lease(self, agent_run_id: uuid.UUID) -> None:
                cancelled_run_ids.append(agent_run_id)

        monkeypatch.setattr(lease_service, "DaemonLeaseService", _FakeLeaseService)

        root, mission = await _make_root_and_mission(db_session)
        await _make_run(
            db_session,
            status="running",
            mission_id=mission.id,
            role="orchestrator",
            agent_session_id=root.id,
        )  # 主控轮：不进 kill 名单
        legacy_active = await _make_run(
            db_session, status="running", mission_id=mission.id, role="arch"
        )
        await _make_run(
            db_session, status="completed", mission_id=mission.id, role=None
        )  # 终态存量 run：不 kill

        # w1：有活跃追问轮 run → 按活跃轮 kill
        w1 = await _make_worker_session(db_session, root)
        await _make_run(
            db_session,
            status="completed",
            mission_id=mission.id,
            role="impl",
            agent_session_id=w1.id,
        )
        active_turn_w1 = await _make_run(db_session, status="running", agent_session_id=w1.id)
        # w2：无活跃轮（已 done 待收敛）→ 按首 run kill（收口子会话）
        w2 = await _make_worker_session(db_session, root, worker_done_at=datetime.now(UTC))
        first_run_w2 = await _make_run(
            db_session,
            status="completed",
            mission_id=mission.id,
            role="impl",
            agent_session_id=w2.id,
        )
        # w3：会话已 ended（终态）→ 不复活重杀
        w3 = await _make_worker_session(db_session, root, status="ended")
        await _make_run(
            db_session,
            status="running",
            mission_id=mission.id,
            role="impl",
            agent_session_id=w3.id,
        )

        killed = await MissionControlService(db_session).cancel(mission)

        assert killed == 3
        assert set(cancelled_run_ids) == {legacy_active.id, active_turn_w1.id, first_run_w2.id}
        assert mission.cancelled_at is not None

    @pytest.mark.asyncio
    async def test_cancel_subsession_without_any_run_skipped(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """活跃子会话无任何 run 行（脏数据）→ 跳过不抛，kill 计数不含它。"""
        from app.modules.daemon import lease_service

        cancelled_run_ids: list[uuid.UUID] = []

        class _FakeLeaseService:
            def __init__(self, session) -> None:
                self._session = session

            async def cancel_lease(self, agent_run_id: uuid.UUID) -> None:
                cancelled_run_ids.append(agent_run_id)

        monkeypatch.setattr(lease_service, "DaemonLeaseService", _FakeLeaseService)

        root, mission = await _make_root_and_mission(db_session)
        await _make_worker_session(db_session, root)  # 无 run 的分身

        killed = await MissionControlService(db_session).cancel(mission)

        assert killed == 0
        assert cancelled_run_ids == []
        assert mission.cancelled_at is not None


class TestCancelSessionEndIntegration:
    """真 cancel_lease 集成：子会话 kill 走 P0-2 回捞链（lease cancelled +
    SESSION_END 下发 + 子会话 ended + 活跃轮 run killed），存量 batch run 路径
    不变（LEASE_CANCEL 通道）。"""

    @pytest.mark.asyncio
    async def test_cancel_ends_subsession_via_session_end(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from app.modules.daemon import ws_hub as ws_hub_mod
        from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
        from app.modules.daemon.protocol import (
            DAEMON_MSG_LEASE_CANCEL,
            DAEMON_MSG_SESSION_END,
        )

        captured: list = []

        class _RecordingHub:
            async def send_session_control(self, daemon_id, msg_type, payload):
                captured.append(("session_control", daemon_id, msg_type, payload))
                return True

            async def send_to_runtime(self, daemon_id, message):
                captured.append(("to_runtime", daemon_id, message))
                return True

        monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _RecordingHub())

        from app.modules.auth.model import User

        user_id = uuid.uuid4()
        db_session.add(
            User(
                id=user_id,
                email=f"wsc-{user_id}@example.com",
                password_hash="x",
                display_name="T",
                status="active",
            )
        )
        rt = DaemonRuntime(
            id=uuid.uuid4(),
            user_id=user_id,
            name="wsc-daemon",
            provider="claude_code",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
        db_session.add(rt)
        await db_session.commit()

        now = datetime.now(UTC)
        root, mission = await _make_root_and_mission(db_session)

        # w1：interactive lease（绑会话不绑 run，D-005@v1 生产形态）+ 活跃追问轮
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            status="claimed",
            kind="interactive",
            claimed_at=now,
            lease_expires_at=None,
            metadata_={"claim_token": "tok", "session_id": "pending"},
            created_at=now,
            updated_at=now,
        )
        db_session.add(lease)
        await db_session.commit()
        w1 = await _make_worker_session(db_session, root, lease_id=lease.id, runtime_id=rt.id)
        first_run = await _make_run(
            db_session,
            status="completed",
            mission_id=mission.id,
            role="impl",
            agent_session_id=w1.id,
        )
        active_turn = await _make_run(db_session, status="running", agent_session_id=w1.id)

        killed = await MissionControlService(db_session).cancel(mission)

        assert killed == 1
        assert mission.cancelled_at is not None
        # lease cancelled + 子会话 ended + 活跃轮 run killed（P0-2 链）
        await db_session.refresh(lease)
        assert lease.status == "cancelled"
        await db_session.refresh(w1)
        assert w1.status == "ended"
        await db_session.refresh(active_turn)
        assert active_turn.status == "killed"
        # SESSION_END 恰一次下发（interactive 硬杀链），无 LEASE_CANCEL 混发
        session_ends = [c for c in captured if c[2] == DAEMON_MSG_SESSION_END]
        assert len(session_ends) == 1
        assert session_ends[0][3]["session_id"] == str(w1.id)
        assert session_ends[0][3]["lease_id"] == str(lease.id)
        assert all(c[2] != DAEMON_MSG_LEASE_CANCEL for c in captured)
        # 首 run 已终态不被误杀
        await db_session.refresh(first_run)
        assert first_run.status == "completed"

    @pytest.mark.asyncio
    async def test_cancel_legacy_batch_run_path_unchanged(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """无子会话 mission（存量 batch 形态）cancel 走 LEASE_CANCEL 通道不变
        （FR-09 回落）。"""
        from app.modules.daemon import ws_hub as ws_hub_mod
        from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
        from app.modules.daemon.protocol import DAEMON_MSG_LEASE_CANCEL

        captured: list = []

        class _RecordingHub:
            async def send_session_control(self, daemon_id, msg_type, payload):
                captured.append(("session_control", daemon_id, msg_type, payload))
                return True

            async def send_to_runtime(self, daemon_id, message):
                captured.append(("to_runtime", daemon_id, message))
                return True

        monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _RecordingHub())

        from app.modules.auth.model import User

        user_id = uuid.uuid4()
        db_session.add(
            User(
                id=user_id,
                email=f"lgc-{user_id}@example.com",
                password_hash="x",
                display_name="T",
                status="active",
            )
        )
        rt = DaemonRuntime(
            id=uuid.uuid4(),
            user_id=user_id,
            name="lgc-daemon",
            provider="claude_code",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
        db_session.add(rt)
        await db_session.commit()

        mission = AgentMission(workspace_id=uuid.uuid4(), objective="存量", session_id=None)
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)

        legacy = await _make_run(db_session, status="running", mission_id=mission.id, role="arch")
        now = datetime.now(UTC)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=legacy.id,
            status="claimed",
            kind="batch",
            claimed_at=now,
            lease_expires_at=None,
            metadata_={"claim_token": "tok"},
            created_at=now,
            updated_at=now,
        )
        db_session.add(lease)
        await db_session.commit()

        killed = await MissionControlService(db_session).cancel(mission)

        assert killed == 1
        await db_session.refresh(legacy)
        assert legacy.status == "killed"
        to_runtime_msgs = [c for c in captured if c[0] == "to_runtime"]
        assert len(to_runtime_msgs) == 1
        assert to_runtime_msgs[0][2]["type"] == DAEMON_MSG_LEASE_CANCEL


# ── 4. 无子会话回落现行为（FR-09）───────────────────────────────────────────


class TestLegacyFallback:
    @pytest.mark.asyncio
    async def test_sessionless_mission_counts_runs_only(self, db_session: AsyncSession) -> None:
        """无 session_id mission（存量 external）：计数/成本仅 run 维度。"""
        mission = AgentMission(workspace_id=uuid.uuid4(), objective="external", session_id=None)
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)
        await _make_run(db_session, status="running", mission_id=mission.id, role="arch", cost=1.5)

        ctrl = MissionControlService(db_session)
        assert await ctrl.running_worker_count(mission.id) == 1
        assert await ctrl.cost_so_far(mission.id) == pytest.approx(1.5)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
