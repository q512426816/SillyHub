"""审计修复 F01（docs/qa/subsession-backend-audit-2026-08-26.md §A.6-1 / §3-F01）：
patrol 职责⑦「活跃 mission 死分身扫描」单测。

背景（审计 F01，P1）：「会话 ended/failed 且未 done 且 mission 无
budget_force_ended_at 标记」的分身被 ``_virtual_status`` 映射 running——但该形态
除预算强收外还有三个生成源（属主门户手动 end_session / reconnecting 空闲清扫 /
终态清扫残留），导致 derive 恒 running → converge 永久 busy、awaiting_input
超时收敛永不触发，非预算 mission 唯一出口是人工 cancel（死锁态）。

修复语义（审计方向）：patrol 新增职责⑦——活跃 mission 下「会话终态
（ended/failed）且未 done 且终态后超宽限（``ended_at`` 起算，默认 30 分钟，env
``MISSION_PATROL_WORKER_FORCE_END_GRACE_MINUTES`` 可调）」的死分身 → 原子置位
``mission.constraints.worker_force_ended_at``（DB 侧 JSON 合并，F05 同款）→
``mission_derive_status`` 的终态映射规则从「仅 budget 标记」扩为「budget 或
worker_force_ended 标记存在时 ended 未 done → failed 终态」——mission 可正常
converge（不强收卡死）。

宽限防误杀：刚终态（宽限内）不标；已 done 分身不标；会话仍活跃的分身不标
（本职责只扫会话终态形态）；已带 budget/worker 任一标记的 mission 不重标
（failed 映射已武装，幂等零重复计数）。
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
from app.modules.agent.mission import (
    BUDGET_FORCE_ENDED_AT_KEY,
    WORKER_FORCE_ENDED_AT_KEY,
    mission_derive_status,
)
from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.agent.patrol import MissionPatrolService
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.workspace.model import Workspace

# ── 播种 helpers（对齐 test_worker_subsession_patrol_budget 模式）───────────


async def _seed_tree(
    db: AsyncSession,
    *,
    constraints: dict | None = None,
) -> tuple[AgentSession, AgentMission, uuid.UUID, DaemonRuntime]:
    """建 user + workspace + 主控根会话 + **活跃**会话 mission（无预算——F01 的
    非预算死锁形态）；``constraints`` 预置标记用于「已标记跳过」用例。"""
    user_id = uuid.uuid4()
    db.add(
        User(
            id=user_id,
            email=f"tpd-{user_id.hex[:10]}@example.com",
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
        budget_usd=None,
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
    root: AgentSession,
    *,
    owner_id: uuid.UUID,
    runtime: DaemonRuntime,
    session_status: str = "ended",
    ended_at: datetime | None = None,
    worker_done_at: datetime | None = None,
) -> AgentSession:
    """建分身子会话（终态形态可控）+ claimed interactive lease（形态与 end_session
    收口后一致——lease 终态与本职责无关，仅保真现场）。"""
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime.id,
        agent_run_id=None,
        status="completed",
        kind="interactive",
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
        parent_session_id=root.id,
        lease_id=lease.id,
        runtime_id=runtime.id,
        ended_at=ended_at,
        worker_done_at=worker_done_at,
    )
    db.add(worker)
    await db.commit()
    await db.refresh(worker)
    return worker


async def _seed_orchestrator_anchor(
    db: AsyncSession,
    mission_id: uuid.UUID,
    root_session_id: uuid.UUID,
    *,
    finished_at: datetime,
) -> AgentRun:
    """建主控轮 turn run（role=orchestrator，挂根会话，已终态）——awaiting_input
    超时自动收敛的时钟锚点（对齐 test_patrol task-08 用例形态）。"""
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
    """把 ws_hub 换成录音 hub——死分身扫描置标记不发 WS（会话已终态无收口需求），
    断言零下发防误动 end_session。"""
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


def _patch_converge_recorder(
    monkeypatch: pytest.MonkeyPatch,
) -> list[tuple[uuid.UUID, bool]]:
    """mock finalizer.converge_mission_for_completed_run（真实入口走 GLM/git RPC，
    照 test_worker_subsession_patrol_budget._patch_converge_recorder 惯例）。保留
    真实入口的 derive 门（explicit 允许 done/degraded/failed/awaiting_input）。"""
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
            else ("done", "degraded")
        )
        if status not in allowed:
            return status
        mission.converged_at = datetime.now(UTC)
        session.add(mission)
        await session.commit()
        return await mission_derive_status(session, run.mission_id, workers_only=True)

    monkeypatch.setattr(finalizer_mod, "converge_mission_for_completed_run", _fake_converge)
    return calls


# ── 1. 命中：死分身置标记 → derive 脱离 running 死锁 ─────────────────────────


class TestDeadWorkerForceEndHit:
    async def test_dead_worker_past_grace_marks_and_unblocks_derive(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """会话 ended 未 done 超宽限（45min > 30min 默认）→ 置位
        worker_force_ended_at + 计数 worker_force_ended=1；derive 从 running 死锁
        落 awaiting_input（未 converge 中间档）；converge 置位后落 failed 终态。"""
        captured = _recording_ws_hub(monkeypatch)
        root, mission, user_id, rt = await _seed_tree(db_session)
        await _seed_worker(
            db_session,
            root,
            owner_id=user_id,
            runtime=rt,
            session_status="ended",
            ended_at=datetime.now(UTC) - timedelta(minutes=45),
        )

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["worker_force_ended"] == 1
        await db_session.refresh(mission)
        marker = (mission.constraints or {}).get(WORKER_FORCE_ENDED_AT_KEY)
        assert isinstance(marker, str) and marker != "", "标记必须落库（ISO 时间戳）"
        # F01 核心：ended 未 done 不再映射 running（死锁解除）。
        assert await mission_derive_status(db_session, mission.id, workers_only=True) != "running"
        assert (
            await mission_derive_status(db_session, mission.id, workers_only=True)
            == "awaiting_input"
        )
        mission.converged_at = datetime.now(UTC)
        db_session.add(mission)
        await db_session.commit()
        assert await mission_derive_status(db_session, mission.id, workers_only=True) == "failed", (
            "死分身虚拟 failed → converge 后落 failed 终态（非 running 卡死）"
        )
        # 会话已终态：本职责只置标记，不发 SESSION_END / 不重收口。
        assert captured == []

    async def test_dead_worker_marks_then_awaiting_input_converges(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """F01 全链路（审计「非预算 mission 唯一出口是人工 cancel」的解除）：
        第一轮职责⑦置标记（derive 门仍拦 awaiting_input 超时收敛）；第二轮
        职责①超时自动收敛经 explicit 入口置位 converged_at——不再需要人工 cancel。"""
        _calls = _patch_converge_recorder(monkeypatch)
        root, mission, user_id, rt = await _seed_tree(db_session)
        await _seed_worker(
            db_session,
            root,
            owner_id=user_id,
            runtime=rt,
            ended_at=datetime.now(UTC) - timedelta(minutes=45),
        )
        await _seed_orchestrator_anchor(
            db_session,
            mission.id,
            root.id,
            finished_at=datetime.now(UTC) - timedelta(minutes=40),
        )

        first = await MissionPatrolService(db_session).run_once()
        # 职责①先于职责⑦：第一轮标记未置位，derive 仍 running → 不提前收敛。
        assert first["worker_force_ended"] == 1
        assert first["converged"] == 0
        await db_session.refresh(mission)
        assert mission.converged_at is None, "分身映射 running 时不得提前收敛（derive 门）"

        second = await MissionPatrolService(db_session).run_once()
        assert second["worker_force_ended"] == 0, "已标记不重标（幂等）"
        assert second["converged"] == 1, "标记后 awaiting_input 超时收敛可触发（死锁解除）"
        await db_session.refresh(mission)
        assert mission.converged_at is not None

    async def test_failed_session_past_grace_marks(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """会话 failed 未 done 超宽限同属死分身形态 → 同样置标记（failed 会话虽
        已映射 failed，混合 mission 下标记一并武装 ended 未 done 分身的映射）。"""
        root, mission, user_id, rt = await _seed_tree(db_session)
        await _seed_worker(
            db_session,
            root,
            owner_id=user_id,
            runtime=rt,
            session_status="failed",
            ended_at=datetime.now(UTC) - timedelta(minutes=45),
        )

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["worker_force_ended"] == 1
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(WORKER_FORCE_ENDED_AT_KEY) is not None

    async def test_grandchild_dead_worker_marks(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """孙层死分身同样计入（全树枚举，design §5.E 口径延续）。"""
        root, mission, user_id, rt = await _seed_tree(db_session)
        child = await _seed_worker(
            db_session,
            root,
            owner_id=user_id,
            runtime=rt,
            session_status="active",
        )
        await _seed_worker(
            db_session,
            child,
            owner_id=user_id,
            runtime=rt,
            session_status="ended",
            ended_at=datetime.now(UTC) - timedelta(minutes=45),
        )

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["worker_force_ended"] == 1
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(WORKER_FORCE_ENDED_AT_KEY) is not None


# ── 2. 防误杀：宽限内 / 已 done / 会话活跃 / 终态时间缺失——零动作 ────────────


class TestDeadWorkerScanScope:
    async def test_within_grace_not_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """刚终态（5min < 30min 宽限）不标——刚 end 的会话可能正处收口语义中，
        保守宽限防误杀；derive 保持 running（P1 语义不变）。"""
        root, mission, user_id, rt = await _seed_tree(db_session)
        await _seed_worker(
            db_session,
            root,
            owner_id=user_id,
            runtime=rt,
            ended_at=datetime.now(UTC) - timedelta(minutes=5),
        )

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["worker_force_ended"] == 0
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(WORKER_FORCE_ENDED_AT_KEY) is None
        assert await mission_derive_status(db_session, mission.id, workers_only=True) == "running"

    async def test_done_worker_ended_not_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """ended 但已 done（worker_done_at 已置——converge end_session 后形态）
        → 非死分身：映射 completed，零标记。"""
        root, mission, user_id, rt = await _seed_tree(db_session)
        await _seed_worker(
            db_session,
            root,
            owner_id=user_id,
            runtime=rt,
            ended_at=datetime.now(UTC) - timedelta(minutes=45),
            worker_done_at=datetime.now(UTC),
        )

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["worker_force_ended"] == 0
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(WORKER_FORCE_ENDED_AT_KEY) is None

    async def test_active_session_not_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """会话仍活跃（audit F01 生成源③的对照）→ 不在本职责扫描口径（会话终态
        形态）内：零标记，derive 保持 running。"""
        root, mission, user_id, rt = await _seed_tree(db_session)
        await _seed_worker(db_session, root, owner_id=user_id, runtime=rt, session_status="active")

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["worker_force_ended"] == 0
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(WORKER_FORCE_ENDED_AT_KEY) is None

    async def test_terminal_without_ended_at_not_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """终态时间缺失（ended_at NULL 脏数据）→ 无法定宽限起点，跳过不猜
        （对齐判死链路断链语义）。"""
        root, mission, user_id, rt = await _seed_tree(db_session)
        await _seed_worker(
            db_session,
            root,
            owner_id=user_id,
            runtime=rt,
            session_status="ended",
            ended_at=None,
        )

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["worker_force_ended"] == 0
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(WORKER_FORCE_ENDED_AT_KEY) is None


# ── 3. 幂等与抢占：已标记跳过 / budget 标记跳过 / 并发 converge 抢占 ─────────


class TestDeadWorkerScanIdempotence:
    async def test_marker_exists_not_remarked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """已带 worker_force_ended_at 的 mission 不重标：时间戳原样保留、零计数
        （标记只查存在性，重置位无意义）。"""
        old_marker = "2026-08-26T03:00:00+00:00"
        root, mission, user_id, rt = await _seed_tree(
            db_session, constraints={WORKER_FORCE_ENDED_AT_KEY: old_marker}
        )
        await _seed_worker(
            db_session,
            root,
            owner_id=user_id,
            runtime=rt,
            ended_at=datetime.now(UTC) - timedelta(minutes=45),
        )

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["worker_force_ended"] == 0
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(WORKER_FORCE_ENDED_AT_KEY) == old_marker

    async def test_budget_marker_skips(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """已带 budget_force_ended_at（预算强收已武装 ended→failed 映射）→ 本职责
        零动作：不叠加 worker 标记、零计数。"""
        root, mission, user_id, rt = await _seed_tree(
            db_session, constraints={BUDGET_FORCE_ENDED_AT_KEY: "2026-08-26T03:00:00+00:00"}
        )
        await _seed_worker(
            db_session,
            root,
            owner_id=user_id,
            runtime=rt,
            ended_at=datetime.now(UTC) - timedelta(minutes=45),
        )

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["worker_force_ended"] == 0
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(WORKER_FORCE_ENDED_AT_KEY) is None

    async def test_concurrent_converge_preempt_skips(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """并发抢占——死分身判定后、置位前 mission 被 converge（UPDATE WHERE
        converged_at IS NULL 不再命中 → rowcount=0）→ 本轮零标记零计数。"""
        root, mission, user_id, rt = await _seed_tree(db_session)
        await _seed_worker(
            db_session,
            root,
            owner_id=user_id,
            runtime=rt,
            ended_at=datetime.now(UTC) - timedelta(minutes=45),
        )
        real_tree = patrol.mission_worker_sessions_tree

        async def _racing_tree(session, mission_id):
            workers = await real_tree(session, mission_id)
            if any(w.status == "ended" and w.worker_done_at is None for w in workers):
                await db_session.execute(
                    update(AgentMission)
                    .where(AgentMission.id == mission_id)
                    .values(converged_at=datetime.now(UTC))
                )
                await db_session.commit()
            return workers

        monkeypatch.setattr(patrol, "mission_worker_sessions_tree", _racing_tree)

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["worker_force_ended"] == 0
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(WORKER_FORCE_ENDED_AT_KEY) is None


# ── 4. F05 合并语义 + 宽限配置 + 异常隔离 ────────────────────────────────────


class TestDeadWorkerScanMechanics:
    async def test_marker_merges_existing_constraint_keys(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """置标记走 DB 侧 JSON 合并（F05 同款）：既有 conflict_attempts 等并发键
        保留，只并入新键——不整体覆盖。"""
        root, mission, user_id, rt = await _seed_tree(
            db_session, constraints={"conflict_attempts": 2, "mode": "team"}
        )
        await _seed_worker(
            db_session,
            root,
            owner_id=user_id,
            runtime=rt,
            ended_at=datetime.now(UTC) - timedelta(minutes=45),
        )

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["worker_force_ended"] == 1
        await db_session.refresh(mission)
        merged = mission.constraints or {}
        assert merged.get("conflict_attempts") == 2, "既有键不得被标记置位覆盖丢失"
        assert merged.get("mode") == "team"
        assert WORKER_FORCE_ENDED_AT_KEY in merged

    async def test_grace_configurable_via_env(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """宽限分钟数 env 可调（MISSION_PATROL_WORKER_FORCE_END_GRACE_MINUTES）：
        收紧到 1 分钟后，终态后 5 分钟的死分身即命中（默认 30 分钟下不命中）。"""
        root, mission, user_id, rt = await _seed_tree(db_session)
        await _seed_worker(
            db_session,
            root,
            owner_id=user_id,
            runtime=rt,
            ended_at=datetime.now(UTC) - timedelta(minutes=5),
        )
        monkeypatch.setenv("MISSION_PATROL_WORKER_FORCE_END_GRACE_MINUTES", "1")

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["worker_force_ended"] == 1
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(WORKER_FORCE_ENDED_AT_KEY) is not None

    async def test_duty_failure_isolated_in_run_once(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """职责⑦整体抛错只记 duty_failed(worker_force_end)，同轮其余职责照常
        （异常隔离对齐既有六职责）。"""
        log_spy = MagicMock()
        monkeypatch.setattr(patrol, "log", log_spy)

        async def _fake_convergence(
            self: MissionPatrolService, mission_ids: list[uuid.UUID]
        ) -> int:
            return 2

        async def _boom_dead_worker(self: MissionPatrolService) -> int:
            raise RuntimeError("boom on dead worker duty")

        monkeypatch.setattr(MissionPatrolService, "_patrol_convergence", _fake_convergence)
        monkeypatch.setattr(MissionPatrolService, "_patrol_worker_force_end", _boom_dead_worker)

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["converged"] == 2, "死分身扫描崩溃不得阻断收敛兜底"
        assert counts["worker_force_ended"] == 0
        log_spy.exception.assert_called_once_with(
            "mission_patrol_duty_failed", duty="worker_force_end"
        )


class TestZombieWaitForceEndHit:
    """职责⑦②僵尸等待形态（生产 ee24ba15 死锁补口）：会话 active + 未 done +
    无活跃 turn + 首 run 已终态且 finished_at 超宽限 → 置标解除虚拟 running 卡死。"""

    async def _seed_zombie(
        self,
        db: AsyncSession,
        *,
        first_run_status: str = "completed",
        first_run_finished_at: datetime | None = None,
    ) -> tuple[AgentSession, AgentSession, AgentMission]:
        """根 + 僵尸分身（active 空闲未 done）+ 首 run（终态可控、时间可控）。"""
        root, mission, user_id, rt = await _seed_tree(db)
        worker = await _seed_worker(
            db,
            root,
            owner_id=user_id,
            runtime=rt,
            session_status="active",
        )
        run = AgentRun(
            mission_id=mission.id,
            agent_session_id=worker.id,
            agent_type="claude_code",
            status=first_run_status,
            role="worker",
            objective="分身首 run",
            finished_at=first_run_finished_at,
        )
        db.add(run)
        await db.commit()
        return root, worker, mission

    async def test_zombie_wait_past_grace_marks(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """active 空闲 + 首 run completed + finished_at 超宽限（45min）→ 置标；
        derive 不再 running（虚拟映射强收放行）。"""
        _recording_ws_hub(monkeypatch)
        _root, _worker, mission = await self._seed_zombie(
            db_session, first_run_finished_at=datetime.now(UTC) - timedelta(minutes=45)
        )

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["worker_force_ended"] == 1
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(WORKER_FORCE_ENDED_AT_KEY) is not None
        assert (
            await mission_derive_status(db_session, mission.id, workers_only=True) != "running"
        ), "僵尸等待置标后不得再虚拟 running（死锁解除）"

    async def test_zombie_wait_within_grace_not_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """首 run 刚终态（10min < 30min 宽限，嵌套回叫可能仍在途）→ 不标。"""
        _recording_ws_hub(monkeypatch)
        _root, _worker, mission = await self._seed_zombie(
            db_session, first_run_finished_at=datetime.now(UTC) - timedelta(minutes=10)
        )

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["worker_force_ended"] == 0
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(WORKER_FORCE_ENDED_AT_KEY) is None

    async def test_zombie_wait_first_run_active_not_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """首 run 仍在跑（分身活跃 turn）→ 非僵尸，不标。"""
        _recording_ws_hub(monkeypatch)
        _root, _worker, _mission = await self._seed_zombie(
            db_session, first_run_status="running", first_run_finished_at=None
        )

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["worker_force_ended"] == 0

    async def test_zombie_wait_no_first_run_not_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """无首 run（派发链路异常形态）→ 宽限无时钟起点，不猜不标。"""
        _recording_ws_hub(monkeypatch)
        root, mission, user_id, rt = await _seed_tree(db_session)
        await _seed_worker(db_session, root, owner_id=user_id, runtime=rt, session_status="active")

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["worker_force_ended"] == 0
        await db_session.refresh(mission)
        assert (mission.constraints or {}).get(WORKER_FORCE_ENDED_AT_KEY) is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
