"""task-07（2026-08-26-team-subsession-recursion）：patrol 职责⑥预算强收单测。

design §5.D / §5.E（Grill M2 时序）/ FR-05 / FR-07 / D-005@v1 / 生命周期契约表
「patrol 预算触顶」行：

- 触顶强收——活跃 mission（budget_usd 非空、未收敛未取消）cost_so_far >=
  budget_usd 且存在未完成分身（全树枚举，含孙层）→ **先**原子置位
  ``mission.constraints.budget_force_ended_at``（R5 同款 UPDATE...WHERE 抢占，
  rowcount=0 本轮跳过）**再**复用 P1 收口链批量
  ``SessionService.end_session(reason=mission_budget_exceeded)``；标记 + 强收后
  ``mission_derive_status`` 虚拟映射（task-03）把「ended 且未 done」映 failed →
  derive 出 degraded，mission 可正常 converge（不强收卡死）；
- 未触顶不误收——cost < budget / budget_usd 为空 / 分身已全完成的 mission
  零动作零写入（全完成待收敛归职责①兜底）；已标记且分身已收口的不重复动作；
- 枚举换全树——孤儿扫描与强收名单均经 ``mission_worker_sessions_tree``
  （孙层孤儿 / 孙层未完成分身同样计入，design §5.E）。

测试隔离策略对齐 test_worker_subsession_patrol_orphan：monkeypatch
``ws_hub.get_daemon_ws_hub`` 为录音 hub 断言 SESSION_END；converge 置位经
mock ``finalizer.converge_mission_for_completed_run``（真实入口走 GLM/git RPC，
照 test_patrol._patch_explicit_converge_recorder 惯例）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.agent.patrol as patrol
from app.modules.agent.mission import BUDGET_FORCE_ENDED_AT_KEY, mission_derive_status
from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.agent.patrol import MissionPatrolService
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.protocol import DAEMON_MSG_SESSION_END
from app.modules.workspace.model import Workspace

# ── 播种 helpers（对齐 test_worker_subsession_patrol_orphan 模式）───────────


async def _seed_tree(
    db: AsyncSession,
    *,
    budget_usd: float | None,
    constraints: dict | None = None,
) -> tuple[AgentSession, AgentMission, uuid.UUID, DaemonRuntime]:
    """建 user + workspace + 主控根会话 + **活跃**会话 mission（budget_usd 可控）。

    预算强收的候选形态恒为活跃（未收敛未取消）；``constraints`` 显式控制用于
    「已标记不重复」用例的预置标记。
    """
    user_id = uuid.uuid4()
    db.add(
        User(
            id=user_id,
            email=f"tpb-{user_id.hex[:10]}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    ws_id = uuid.uuid4()
    db.add(
        Workspace(
            id=ws_id,
            name=f"ws-{ws_id.hex[:8]}",
            slug=f"ws-{ws_id.hex[:8]}",
            root_path=f"/tmp/{ws_id.hex}",
        )
    )
    root = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        provider="claude",
        status="active",
    )
    db.add(root)
    mission = AgentMission(
        workspace_id=ws_id,
        objective="团队目标",
        session_id=root.id,
        created_by=user_id,
        budget_usd=budget_usd,
        constraints=constraints,
    )
    db.add(mission)
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name=f"rt-{user_id.hex[:6]}",
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db.add(rt)
    await db.commit()
    await db.refresh(mission)
    return root, mission, user_id, rt


async def _seed_worker(
    db: AsyncSession,
    parent: AgentSession,
    *,
    owner_id: uuid.UUID,
    runtime: DaemonRuntime,
    session_status: str = "active",
    lease_kind: str = "interactive",
    worker_done_at: datetime | None = None,
) -> tuple[AgentSession, DaemonTaskLease]:
    """建分身/孙子会话（``parent`` 挂点可控——传分身会话即孙层）+ claimed lease。

    ``worker_done_at`` 非空即「已完成分身」（预算强收名单应排除）；
    ``lease_kind="batch"`` 制造 end_session 收口失败形态。
    """
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime.id,
        agent_run_id=None,
        status="claimed",
        kind=lease_kind,
        claimed_at=now,
        lease_expires_at=None,
        metadata_={"claim_token": "tok", "session_id": "pending"},
        created_at=now,
        updated_at=now,
    )
    db.add(lease)
    worker = AgentSession(
        id=uuid.uuid4(),
        user_id=owner_id,
        provider="claude",
        status=session_status,
        parent_session_id=parent.id,
        lease_id=lease.id,
        runtime_id=runtime.id,
        worker_done_at=worker_done_at,
    )
    db.add(worker)
    await db.commit()
    await db.refresh(worker)
    return worker, lease


async def _seed_cost_run(
    db: AsyncSession,
    mission_id: uuid.UUID,
    agent_session_id: uuid.UUID,
    *,
    total_cost_usd: float,
) -> AgentRun:
    """在分身子会话上挂一条已完成的成本 run（``cost_so_far`` union 计入）。"""
    run = AgentRun(
        mission_id=mission_id,
        agent_session_id=agent_session_id,
        agent_type="claude_code",
        status="completed",
        role="worker",
        objective="分身目标",
        finished_at=datetime.now(UTC),
        total_cost_usd=total_cost_usd,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run


async def _seed_orchestrator_anchor(
    db: AsyncSession,
    mission_id: uuid.UUID,
    root_session_id: uuid.UUID,
    *,
    finished_at: datetime,
) -> AgentRun:
    """建主控轮 turn run（role=orchestrator，挂根会话）——awaiting_input 超时
    自动收敛的时钟锚点（对齐 test_patrol task-08 用例形态）。"""
    run = AgentRun(
        mission_id=mission_id,
        agent_session_id=root_session_id,
        agent_type="claude_code",
        status="completed",
        role="orchestrator",
        objective="主控轮",
        finished_at=finished_at,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run


def _recording_ws_hub(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, Any, str, dict]]:
    """把 ws_hub 换成录音 hub，捕获全部 WS 下发（同 orphan 测试模式）。"""
    from app.modules.daemon import ws_hub as ws_hub_mod

    captured: list[tuple[str, Any, str, dict]] = []

    class _RecordingHub:
        async def send_session_control(self, daemon_id, msg_type, payload):
            captured.append(("session_control", daemon_id, msg_type, payload))
            return True

        async def send_to_runtime(self, daemon_id, message):
            captured.append(("to_runtime", daemon_id, message))
            return True

    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _RecordingHub())
    return captured


def _session_ends(captured: list[tuple[str, Any, str, dict]]) -> list[dict]:
    return [c[3] for c in captured if c[2] == DAEMON_MSG_SESSION_END]


def _patch_converge_recorder(
    monkeypatch: pytest.MonkeyPatch,
) -> list[tuple[uuid.UUID, bool]]:
    """mock finalizer.converge_mission_for_completed_run（真实入口走 GLM/git
    RPC，照 test_patrol._patch_explicit_converge_recorder 惯例）。记录
    ``(run_id, converge_explicit)``；保留真实入口的 derive 门（``converge_explicit``
    判 ``mission_derive_status(workers_only=True)`` ∈ done/degraded/failed/
    awaiting_input 才置位，强收前分身 running 不得提前收敛）与「置位后重派生落
    终态档」副作用。"""
    import app.modules.agent.finalizer as finalizer_mod

    calls: list[tuple[uuid.UUID, bool]] = []

    async def _fake_converge(session, run_id, glm_config=None, *, converge_explicit=False):
        calls.append((run_id, converge_explicit))
        run = await session.get(AgentRun, run_id)
        if run is None or run.mission_id is None:
            return None
        mission = await session.get(AgentMission, run.mission_id)
        if mission is None:
            return None
        status = await mission_derive_status(session, run.mission_id, workers_only=True)
        allowed = (
            ("done", "degraded", "failed", "awaiting_input")
            if converge_explicit
            else (
                "done",
                "degraded",
            )
        )
        if status not in allowed:
            return status
        mission.converged_at = datetime.now(UTC)
        session.add(mission)
        await session.commit()
        # 对齐真实入口：置位后 converged=True 重派生自然落到终态档。
        return await mission_derive_status(session, run.mission_id, workers_only=True)

    monkeypatch.setattr(finalizer_mod, "converge_mission_for_completed_run", _fake_converge)
    return calls


# ── 1. 触顶强收：先标记后收口 + derive degraded ─────────────────────────────


class TestBudgetForceEndHit:
    async def test_budget_hit_marks_then_ends_incomplete_workers(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """触顶命中——先原子置位 budget_force_ended_at 再批量收口：未完成分身
        ended + lease completed + SESSION_END（reason 语义在 P1 收口链内）；已完成
        分身不误杀；计数 budget_force_ended=1 进 round_done。"""
        captured = _recording_ws_hub(monkeypatch)
        root, mission, user_id, rt = await _seed_tree(db_session, budget_usd=5.0)
        w_incomplete, l_inc = await _seed_worker(db_session, root, owner_id=user_id, runtime=rt)
        w_done, l_done = await _seed_worker(
            db_session, root, owner_id=user_id, runtime=rt, worker_done_at=datetime.now(UTC)
        )
        await _seed_cost_run(db_session, mission.id, w_incomplete.id, total_cost_usd=6.0)

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["budget_force_ended"] == 1
        await db_session.refresh(mission)
        marker = (mission.constraints or {}).get(BUDGET_FORCE_ENDED_AT_KEY)
        assert isinstance(marker, str) and marker != "", "标记必须落库（ISO 时间戳）"
        # 未完成分身被强收：会话 ended + lease completed + SESSION_END 下发。
        await db_session.refresh(w_incomplete)
        assert w_incomplete.status == "ended"
        await db_session.refresh(l_inc)
        assert l_inc.status == "completed"
        # 已完成分身（worker_done_at 已置、无活跃 turn）不进强收名单。
        await db_session.refresh(w_done)
        assert w_done.status == "active", "已完成分身不得被预算强收误杀"
        await db_session.refresh(l_done)
        assert l_done.status == "claimed"
        ends = _session_ends(captured)
        assert {p["session_id"] for p in ends} == {str(w_incomplete.id)}
        # task-03 虚拟映射：ended 未 done → failed（终态）——未收敛的会话 mission
        # 回落 awaiting_input 档而非 running 卡死；置位 converge 后 derive degraded。
        derive = await mission_derive_status(db_session, mission.id, workers_only=True)
        assert derive != "running", "强收后 ended 未 done 不得再映射 running（卡死）"
        assert derive == "awaiting_input"
        mission.converged_at = datetime.now(UTC)
        db_session.add(mission)
        await db_session.commit()
        assert await mission_derive_status(db_session, mission.id, workers_only=True) == "degraded"

    async def test_force_ended_mission_converges_afterwards(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """强收后可收敛（Grill M2 核心验收）：第一轮职责⑥强收置标记；第二轮
        职责① awaiting_input 超时自动收敛（derive degraded 非 running 卡死）→
        explicit 入口置位 converged_at，mission 正常落地终态。"""
        captured = _recording_ws_hub(monkeypatch)
        calls = _patch_converge_recorder(monkeypatch)
        root, mission, user_id, rt = await _seed_tree(db_session, budget_usd=5.0)
        w1, _l1 = await _seed_worker(db_session, root, owner_id=user_id, runtime=rt)
        anchor = await _seed_orchestrator_anchor(
            db_session,
            mission.id,
            root.id,
            finished_at=datetime.now(UTC) - timedelta(minutes=40),
        )
        await _seed_cost_run(db_session, mission.id, w1.id, total_cost_usd=9.0)

        # 第一轮：职责⑥强收置标记（SESSION_END 已下发）。职责①先行，超时窗口
        # 虽已过但 derive 仍 running（标记未置位、分身未 ended）——explicit 入口
        # derive 门拦下，不提前收敛。
        first = await MissionPatrolService(db_session).run_once()
        assert first["budget_force_ended"] == 1
        assert first["converged"] == 0
        assert {p["session_id"] for p in _session_ends(captured)} == {str(w1.id)}
        await db_session.refresh(mission)
        assert mission.converged_at is None, "分身未收口前不得提前收敛（derive 门）"

        # 第二轮：标记 + 全分身 ended 未 done → 虚拟 failed（终态）→ awaiting_input
        # 档命中超时收敛 → explicit 入口置位 converged_at，mission 正常落地终态。
        second = await MissionPatrolService(db_session).run_once()
        assert second["budget_force_ended"] == 0, "已收口不重复强收"
        assert second["converged"] == 1
        assert calls[-1] == (anchor.id, True), "必须走 explicit 入口且锚点=最新主控轮"
        await db_session.refresh(mission)
        assert mission.converged_at is not None, "强收后 mission 可正常置位收敛"


# ── 2. 范围：未触顶 / 无预算 / 全完成 / 已标记——零动作零写入 ────────────────


class TestBudgetForceScope:
    async def test_cost_below_budget_zero_action(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """cost < budget（3 < 5）→ 零动作：不置标记、不动分身、零 WS。"""
        captured = _recording_ws_hub(monkeypatch)
        root, mission, user_id, rt = await _seed_tree(db_session, budget_usd=5.0)
        w, lease = await _seed_worker(db_session, root, owner_id=user_id, runtime=rt)
        await _seed_cost_run(db_session, mission.id, w.id, total_cost_usd=3.0)

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["budget_force_ended"] == 0
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(BUDGET_FORCE_ENDED_AT_KEY) is None
        await db_session.refresh(w)
        assert w.status == "active"
        await db_session.refresh(lease)
        assert lease.status == "claimed"
        assert _session_ends(captured) == []

    async def test_budget_null_mission_not_scanned(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """budget_usd 为空的活跃 mission 不进候选（零误收，FR-09 存量零回归）。"""
        captured = _recording_ws_hub(monkeypatch)
        root, mission, user_id, rt = await _seed_tree(db_session, budget_usd=None)
        w, lease = await _seed_worker(db_session, root, owner_id=user_id, runtime=rt)
        await _seed_cost_run(db_session, mission.id, w.id, total_cost_usd=99.0)

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["budget_force_ended"] == 0
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(BUDGET_FORCE_ENDED_AT_KEY) is None
        await db_session.refresh(w)
        assert w.status == "active"
        await db_session.refresh(lease)
        assert lease.status == "claimed"
        assert _session_ends(captured) == []

    async def test_all_workers_complete_no_force(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """触顶但分身已全完成（worker_done 已置）→ 无未完成分身不强收——
        全完成待收敛归职责①兜底，本职责零标记零收口。"""
        captured = _recording_ws_hub(monkeypatch)
        root, mission, user_id, rt = await _seed_tree(db_session, budget_usd=5.0)
        w1, l1 = await _seed_worker(
            db_session, root, owner_id=user_id, runtime=rt, worker_done_at=datetime.now(UTC)
        )
        w2, l2 = await _seed_worker(
            db_session, root, owner_id=user_id, runtime=rt, worker_done_at=datetime.now(UTC)
        )
        await _seed_cost_run(db_session, mission.id, w1.id, total_cost_usd=8.0)

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["budget_force_ended"] == 0
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(BUDGET_FORCE_ENDED_AT_KEY) is None
        for w, lease in ((w1, l1), (w2, l2)):
            await db_session.refresh(w)
            assert w.status == "active", "全完成分身不进强收名单"
            await db_session.refresh(lease)
            assert lease.status == "claimed"
        assert _session_ends(captured) == []

    async def test_already_marked_not_repeated(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """已标记且分身已收口（ended）→ 不重复动作：标记值原样保留、零计数
        零 WS（幂等）。"""
        captured = _recording_ws_hub(monkeypatch)
        marker_value = "2026-08-26T03:00:00+00:00"
        root, mission, user_id, rt = await _seed_tree(
            db_session, budget_usd=5.0, constraints={BUDGET_FORCE_ENDED_AT_KEY: marker_value}
        )
        w, lease = await _seed_worker(db_session, root, owner_id=user_id, runtime=rt)
        await _seed_cost_run(db_session, mission.id, w.id, total_cost_usd=7.0)
        # 标记已存在 + 分身已全部收口（模拟上一轮强收完成形态）。
        w.status = "ended"
        w.ended_at = datetime.now(UTC)
        db_session.add(w)
        await db_session.commit()

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["budget_force_ended"] == 0
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(BUDGET_FORCE_ENDED_AT_KEY) == marker_value
        await db_session.refresh(lease)
        assert lease.status == "claimed", "已收口子会话的 lease 不被改写"
        assert _session_ends(captured) == []


# ── 3. 原子与时序：并发抢占跳过 + 标记先于收口 ──────────────────────────────


class TestBudgetForceAtomicity:
    async def test_concurrent_converge_preempt_skips_round(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """并发抢占——cost 判定后、置位前 mission 被 converge（UPDATE WHERE
        converged_at IS NULL 不再命中 → rowcount=0）→ 本轮不写不收：零标记
        刷新、零收口、零计数。"""
        captured = _recording_ws_hub(monkeypatch)
        from app.modules.agent import control as control_mod

        root, mission, user_id, rt = await _seed_tree(db_session, budget_usd=5.0)
        w, lease = await _seed_worker(db_session, root, owner_id=user_id, runtime=rt)
        await _seed_cost_run(db_session, mission.id, w.id, total_cost_usd=6.0)

        async def _racing_cost(
            self: control_mod.MissionControlService, mission_id: uuid.UUID
        ) -> float:
            # 模拟并发 converge：扫描与置位之间抢先落 converged_at 终态。
            await db_session.execute(
                update(AgentMission)
                .where(AgentMission.id == mission_id)
                .values(converged_at=datetime.now(UTC))
            )
            await db_session.commit()
            return 6.0

        monkeypatch.setattr(control_mod.MissionControlService, "cost_so_far", _racing_cost)

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["budget_force_ended"] == 0
        await db_session.refresh(w)
        assert w.status == "active", "并发抢占本轮不得收口"
        await db_session.refresh(lease)
        assert lease.status == "claimed"
        assert _session_ends(captured) == []

    async def test_duty_failure_isolated_in_run_once(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """职责⑥整体抛错只记 duty_failed(budget_force_end)，同轮其余职责照常
        （异常隔离对齐既有五职责）。"""
        log_spy = MagicMock()
        monkeypatch.setattr(patrol, "log", log_spy)

        async def _fake_convergence(
            self: MissionPatrolService, mission_ids: list[uuid.UUID]
        ) -> int:
            return 2

        async def _boom_budget(self: MissionPatrolService) -> int:
            raise RuntimeError("boom on budget duty")

        monkeypatch.setattr(MissionPatrolService, "_patrol_convergence", _fake_convergence)
        monkeypatch.setattr(MissionPatrolService, "_patrol_budget_force_end", _boom_budget)

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["converged"] == 2, "预算强收崩溃不得阻断收敛兜底"
        assert counts["budget_force_ended"] == 0
        log_spy.exception.assert_called_once_with(
            "mission_patrol_duty_failed", duty="budget_force_end"
        )


# ── 3.5 F05：抢占 UPDATE 走 DB 侧 JSON 合并（不丢并发键）─────────────────────


class TestBudgetClaimMergesConstraints:
    async def test_claim_preserves_concurrent_constraint_keys(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """审计修复 F05：budget 抢占 UPDATE 不得用早前读的整体 dict 覆盖
        constraints——扫描读到 constraints 之后、置位之前并发提交的
        conflict_attempts（``_bump_conflict_attempts`` 同款整体写）必须保留：
        UPDATE 改 DB 侧 JSON 合并（只并入 budget 标记键，其余键以库内现值为准）。"""
        captured = _recording_ws_hub(monkeypatch)
        from app.modules.agent import control as control_mod

        root, mission, user_id, rt = await _seed_tree(
            db_session, budget_usd=5.0, constraints={"coordinator_summary": "拆解"}
        )
        w, lease = await _seed_worker(db_session, root, owner_id=user_id, runtime=rt)
        await _seed_cost_run(db_session, mission.id, w.id, total_cost_usd=6.0)

        async def _racing_conflict_bump(
            self: control_mod.MissionControlService, mission_id: uuid.UUID
        ) -> float:
            # 模拟并发写者（_bump_conflict_attempts 同款整体 dict 写）：在 patrol
            # 扫描与置位之间提交 conflict_attempts —— 旧实现（早前读的整体覆盖）
            # 会把该键抹掉。
            await db_session.execute(
                update(AgentMission)
                .where(AgentMission.id == mission_id)
                .values(constraints={"conflict_attempts": 1})
            )
            await db_session.commit()
            return 6.0

        monkeypatch.setattr(control_mod.MissionControlService, "cost_so_far", _racing_conflict_bump)

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["budget_force_ended"] == 1
        await db_session.refresh(mission)
        merged = mission.constraints or {}
        assert merged.get("conflict_attempts") == 1, (
            "并发提交的 conflict_attempts 不得被 budget 抢占覆盖丢失（F05）"
        )
        assert BUDGET_FORCE_ENDED_AT_KEY in merged, "budget 标记必须照常置位"
        # 强收链路照常（收口动作不受合并语义影响）。
        await db_session.refresh(w)
        assert w.status == "ended"
        await db_session.refresh(lease)
        assert lease.status == "completed"
        assert {p["session_id"] for p in _session_ends(captured)} == {str(w.id)}


# ── 4. 全树枚举：孙层计入（强收 + 孤儿扫描，design §5.E）───────────────────


class TestBudgetForceGrandchild:
    async def test_grandchild_included_in_force_end(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """孙层未完成分身同样进强收名单：分身→孙 两层全收口（全树枚举，
        一层枚举会漏孙层）。"""
        captured = _recording_ws_hub(monkeypatch)
        root, mission, user_id, rt = await _seed_tree(db_session, budget_usd=5.0)
        child, _lc = await _seed_worker(db_session, root, owner_id=user_id, runtime=rt)
        grand, _lg = await _seed_worker(db_session, child, owner_id=user_id, runtime=rt)
        await _seed_cost_run(db_session, mission.id, child.id, total_cost_usd=6.0)

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["budget_force_ended"] == 1
        for w in (child, grand):
            await db_session.refresh(w)
            assert w.status == "ended", "孙层分身必须同样被强收"
        assert {p["session_id"] for p in _session_ends(captured)} == {str(child.id), str(grand.id)}
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(BUDGET_FORCE_ENDED_AT_KEY) is not None


class TestOrphanScanGrandchild:
    async def test_grandchild_orphan_ended(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """孤儿扫描换全树——终态 mission 下「分身已 ended + 孙仍活跃」的孙层
        孤儿同样补收口（一层枚举会漏，design §5.E 迁移点）。"""
        captured = _recording_ws_hub(monkeypatch)
        root, mission, user_id, rt = await _seed_tree(db_session, budget_usd=None)
        child, _lc = await _seed_worker(db_session, root, owner_id=user_id, runtime=rt)
        grand, lg = await _seed_worker(db_session, child, owner_id=user_id, runtime=rt)
        mission.converged_at = datetime.now(UTC)
        db_session.add(mission)
        child.status = "ended"
        child.ended_at = datetime.now(UTC)
        db_session.add(child)
        await db_session.commit()

        ended = await MissionPatrolService(db_session)._patrol_orphan_subsessions()

        assert ended == 1, "孙层孤儿必须被补收口"
        await db_session.refresh(grand)
        assert grand.status == "ended"
        await db_session.refresh(lg)
        assert lg.status == "completed"
        assert {p["session_id"] for p in _session_ends(captured)} == {str(grand.id)}


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
