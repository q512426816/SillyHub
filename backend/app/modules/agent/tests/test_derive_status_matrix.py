"""task-02（2026-08-22-team-session-unify）：derive_status 判据矩阵全格单测（R-03）。

design §5 Phase1 判据矩阵（CC-01 兼容扩展 / Grill NEW-4 NULL 守卫）逐格覆盖，
按序判：cancelled > planning > running > awaiting_input（仅 session mission）>
degraded/done/failed。

守卫要点：
- NULL 守卫：``has_session=False``（存量 external/bootstrap mission，session 维度
  入参未传 / 默认 False）永不进 awaiting_input——存量调用方（router.py /
  finalizer.py / orchestrator.py）不传新参时返回值逐格不变，complete_lease 自动
  收敛依赖的 derive∈{done,degraded} 语义零回归。
- converged 置位或 session_active_turn 置位时不进新档，按全终态组合回落
  done/degraded/failed。

derive_status 是纯函数（AgentRun 对象构造即用，不依赖 DB）；仅
get_active_mission_for_session 辅助查询用根 conftest 的内存 SQLite db_session
（非真实 DB）验证活跃过滤语义（converged/cancelled 终态不返回）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.mission import (
    derive_status,
    get_active_mission_for_session,
    mission_derive_status,
)
from app.modules.agent.model import AgentMission, AgentRun, AgentSession


def _run(status: str, *, role: str | None = None) -> AgentRun:
    """构造一条 mission 子 run（纯对象直用，不落库）。"""
    return AgentRun(agent_type="claude_code", status=status, role=role)


# ── 判据矩阵输入组合 ────────────────────────────────────────────────────────

# 全终态组合 → 改动前（存量）判定期望值。查表给出，不复制实现分支。
LEGACY_TERMINAL: dict[str, str] = {
    "all_completed": "done",
    "completed_failed": "degraded",
    "completed_killed": "degraded",
    "all_failed": "failed",
    "killed_only": "failed",
    "orchestrator_turn_only": "done",
}


def _run_mixes() -> dict[str, list[AgentRun]]:
    """矩阵行：全终态组合 × 有活跃态组合 × 仅主控轮（无分身）。"""
    return {
        "all_completed": [_run("completed", role="arch"), _run("completed", role="code_style")],
        "completed_failed": [_run("completed", role="arch"), _run("failed", role="code_style")],
        "completed_killed": [_run("completed", role="arch"), _run("killed", role="code_style")],
        "all_failed": [_run("failed", role="arch"), _run("failed", role="code_style")],
        "killed_only": [_run("killed", role="arch")],
        "orchestrator_turn_only": [_run("completed", role="orchestrator")],
    }


_ACTIVE_MIXES: dict[str, list[AgentRun]] = {
    "worker_pending": [_run("pending", role="arch")],
    "worker_running_plus_completed": [_run("running", role="arch"), _run("completed", role="impl")],
    "orchestrator_pending_plus_workers_done": [
        _run("pending", role="orchestrator"),
        _run("completed", role="arch"),
    ],
}


# ── 1. 矩阵全格（主控轮×分身×converge×cancel×session×会话活跃 turn） ────────


class TestMatrixFullGrid:
    @pytest.mark.parametrize(
        ("mix", "legacy_expected"),
        sorted([*LEGACY_TERMINAL.items(), *{"worker_pending": "running"}.items()]),
    )
    @pytest.mark.parametrize("cancelled", [False, True])
    @pytest.mark.parametrize("converged", [False, True])
    @pytest.mark.parametrize("has_session", [False, True])
    @pytest.mark.parametrize("session_active_turn", [False, True])
    def test_full_grid(
        self,
        mix: str,
        legacy_expected: str,
        cancelled: bool,
        converged: bool,
        has_session: bool,
        session_active_turn: bool,
    ) -> None:
        """全格：cancelled > running > awaiting_input（仅 session 未收敛无活跃 turn）> 存量判定。"""
        runs = _run_mixes().get(mix) or _ACTIVE_MIXES[mix]
        result = derive_status(
            runs,
            cancelled=cancelled,
            converged=converged,
            has_session=has_session,
            session_active_turn=session_active_turn,
        )
        if cancelled:
            expected: str = "cancelled"
        elif legacy_expected == "running":
            expected = "running"
        elif has_session and not converged and not session_active_turn:
            expected = "awaiting_input"
        else:
            expected = legacy_expected
        assert result == expected


# ── 2. 按序判：cancelled / planning / running 优先级 ────────────────────────


class TestPrecedence:
    def test_cancelled_beats_everything(self) -> None:
        """cancelled 置位最高优先——即使会话 mission 全终态待 awaiting_input / 有活跃 run。"""
        assert (
            derive_status(
                [_run("pending"), _run("running")],
                True,
                converged=False,
                has_session=True,
                session_active_turn=True,
            )
            == "cancelled"
        )

    def test_planning_no_runs(self) -> None:
        """无子 run 且无主控轮回填（输入为空）→ planning，session 维度不改变。"""
        assert derive_status([]) == "planning"
        assert derive_status([], has_session=True) == "planning"
        assert (
            derive_status([], converged=True, has_session=True, session_active_turn=True)
            == "planning"
        )

    @pytest.mark.parametrize(("mix", "runs"), sorted(_ACTIVE_MIXES.items()))
    @pytest.mark.parametrize("has_session", [False, True])
    def test_running_beats_awaiting_input(
        self, mix: str, runs: list[AgentRun], has_session: bool
    ) -> None:
        """任一 run（主控轮或分身）pending/running → running，先于 awaiting_input 判。"""
        assert (
            derive_status(runs, converged=False, has_session=has_session, session_active_turn=False)
            == "running"
        )


# ── 3. awaiting_input 新档（仅 session mission） ───────────────────────────


class TestAwaitingInput:
    @pytest.mark.parametrize("mix", sorted(LEGACY_TERMINAL))
    def test_session_all_terminal_not_converged_no_active_turn(self, mix: str) -> None:
        """会话 mission 全终态+未 converge+无活跃 turn → awaiting_input（优先于 done/degraded/failed）。"""
        assert (
            derive_status(
                _run_mixes()[mix], converged=False, has_session=True, session_active_turn=False
            )
            == "awaiting_input"
        )

    def test_converged_session_falls_back_to_terminal(self) -> None:
        """converge 置位 → 不进新档，按全终态组合落 done/degraded/failed。"""
        assert (
            derive_status(
                _run_mixes()["all_completed"],
                converged=True,
                has_session=True,
                session_active_turn=False,
            )
            == "done"
        )
        assert (
            derive_status(
                _run_mixes()["completed_failed"],
                converged=True,
                has_session=True,
                session_active_turn=False,
            )
            == "degraded"
        )
        assert (
            derive_status(
                _run_mixes()["all_failed"],
                converged=True,
                has_session=True,
                session_active_turn=False,
            )
            == "failed"
        )

    def test_session_active_turn_falls_back_to_terminal(self) -> None:
        """会话活跃 turn（主控正在跑新一轮）→ 不进新档。"""
        assert (
            derive_status(
                _run_mixes()["all_completed"],
                converged=False,
                has_session=True,
                session_active_turn=True,
            )
            == "done"
        )


# ── 4. NULL 守卫：存量（has_session=False）零回归 ──────────────────────────


class TestLegacyNullGuard:
    @pytest.mark.parametrize("mix", sorted(LEGACY_TERMINAL))
    def test_legacy_never_awaiting_input(self, mix: str) -> None:
        """存量 mission（session 维度未传）永不 awaiting_input，保持原判定。"""
        result = derive_status(_run_mixes()[mix])  # 存量调用方不传新参
        assert result == LEGACY_TERMINAL[mix]
        assert result != "awaiting_input"

    def test_legacy_converged_and_active_turn_irrelevant(self) -> None:
        """converged / session_active_turn 对存量 mission 判定无影响（维度本就不存在）。"""
        runs = _run_mixes()["completed_failed"]
        assert (
            derive_status(runs, converged=True, has_session=False, session_active_turn=True)
            == "degraded"
        )

    @pytest.mark.parametrize("mix", sorted({**_run_mixes(), **_ACTIVE_MIXES}))
    def test_legacy_kwargs_explicit_false_byte_identical(self, mix: str) -> None:
        """显式传默认 False 与不传新参逐格一致（存量调用方语义字节不变）。"""
        runs = (_run_mixes() | _ACTIVE_MIXES)[mix]
        assert derive_status(runs) == derive_status(
            runs, converged=False, has_session=False, session_active_turn=False
        )
        assert derive_status(runs, True) == derive_status(
            runs, True, converged=False, has_session=False, session_active_turn=False
        )

    def test_legacy_complete_lease_convergence_set_intact(self) -> None:
        """complete_lease 自动收敛依赖 derive∈{done,degraded}：全终态有 completed 即落收敛集。"""
        assert derive_status(_run_mixes()["all_completed"]) in ("done", "degraded")
        assert derive_status(_run_mixes()["completed_killed"]) in ("done", "degraded")


# ── 5. get_active_mission_for_session 辅助查询（内存 SQLite，非真实 DB） ────


async def _add_mission(
    db: AsyncSession,
    *,
    session_id: uuid.UUID,
    created_at: datetime | None = None,
    converged_at: datetime | None = None,
    cancelled_at: datetime | None = None,
) -> AgentMission:
    m = AgentMission(
        workspace_id=uuid.uuid4(),
        objective="团队目标",
        session_id=session_id,
        created_at=created_at or datetime.now(UTC),
        converged_at=converged_at,
        cancelled_at=cancelled_at,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


class TestGetActiveMissionForSession:
    @pytest.mark.asyncio
    async def test_returns_active_mission(self, db_session: AsyncSession) -> None:
        """活跃（未收敛未取消）mission 命中返回。"""
        sid = uuid.uuid4()
        m = await _add_mission(db_session, session_id=sid)
        got = await get_active_mission_for_session(db_session, sid)
        assert got is not None and got.id == m.id

    @pytest.mark.asyncio
    async def test_converged_mission_not_returned(self, db_session: AsyncSession) -> None:
        """已 converge 的终态 mission 不返回（会话可开新 mission）。"""
        sid = uuid.uuid4()
        await _add_mission(
            db_session, session_id=sid, converged_at=datetime(2026, 8, 22, 3, 0, tzinfo=UTC)
        )
        assert await get_active_mission_for_session(db_session, sid) is None

    @pytest.mark.asyncio
    async def test_cancelled_mission_not_returned(self, db_session: AsyncSession) -> None:
        """已取消的终态 mission 不返回。"""
        sid = uuid.uuid4()
        await _add_mission(
            db_session, session_id=sid, cancelled_at=datetime(2026, 8, 22, 3, 0, tzinfo=UTC)
        )
        assert await get_active_mission_for_session(db_session, sid) is None

    @pytest.mark.asyncio
    async def test_terminal_history_skipped_latest_active_returned(
        self, db_session: AsyncSession
    ) -> None:
        """会话历史 mission（收敛/取消）跳过，只回当前活跃那条。"""
        sid = uuid.uuid4()
        await _add_mission(
            db_session,
            session_id=sid,
            created_at=datetime(2026, 8, 21, tzinfo=UTC),
            converged_at=datetime(2026, 8, 21, 12, tzinfo=UTC),
        )
        await _add_mission(
            db_session,
            session_id=sid,
            created_at=datetime(2026, 8, 22, tzinfo=UTC),
            cancelled_at=datetime(2026, 8, 22, 1, tzinfo=UTC),
        )
        active = await _add_mission(
            db_session, session_id=sid, created_at=datetime(2026, 8, 22, 2, tzinfo=UTC)
        )
        got = await get_active_mission_for_session(db_session, sid)
        assert got is not None and got.id == active.id

    @pytest.mark.asyncio
    async def test_other_session_not_leaked(self, db_session: AsyncSession) -> None:
        """按 session_id 精确过滤，别的会话的活跃 mission 不串。"""
        await _add_mission(db_session, session_id=uuid.uuid4())
        assert await get_active_mission_for_session(db_session, uuid.uuid4()) is None


# ── 6. mission_derive_status 虚拟 run 映射（task-08 / design §5.C.4）─────────
#
# derive_status 纯函数本身零回归由上方 1–4 节矩阵全格守护（签名与判定未动，
# D-005@v1）；本节验证包装层的虚拟映射优先级矩阵：done 优先 failed、idle→
# running、workers_only 排除主控轮（NULL role 守卫）、空集 planning 语义。


async def _add_session_mission(
    db: AsyncSession,
    *,
    root_session_id: uuid.UUID | None = None,
    converged_at: datetime | None = None,
    cancelled_at: datetime | None = None,
) -> AgentMission:
    m = AgentMission(
        workspace_id=uuid.uuid4(),
        objective="团队目标",
        session_id=root_session_id,
        converged_at=converged_at,
        cancelled_at=cancelled_at,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


async def _add_session(
    db: AsyncSession,
    *,
    status: str = "active",
    parent_session_id: uuid.UUID | None = None,
    worker_done_at: datetime | None = None,
) -> AgentSession:
    s = AgentSession(
        user_id=uuid.uuid4(),
        provider="claude",
        status=status,
        parent_session_id=parent_session_id,
        worker_done_at=worker_done_at,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


async def _add_run_row(
    db: AsyncSession,
    *,
    status: str,
    role: str | None = None,
    mission_id: uuid.UUID | None = None,
    agent_session_id: uuid.UUID | None = None,
) -> AgentRun:
    r = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        status=status,
        role=role,
        objective="o",
        agent_session_id=agent_session_id,
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return r


def _ts() -> datetime:
    return datetime.now(UTC)


class TestMissionDeriveStatusVirtualMapping:
    @pytest.mark.asyncio
    async def test_worker_idle_not_done_maps_running_not_planning(
        self, db_session: AsyncSession
    ) -> None:
        """分身 idle 未 done（无 worker_done_at）→ 虚拟 running；有分身时虚拟
        集合非空，无任何 run 行也不误判 planning（FR-05 验收核心）。"""
        root = await _add_session(db_session)
        mission = await _add_session_mission(db_session, root_session_id=root.id)
        await _add_session(db_session, parent_session_id=root.id)  # idle 未 done

        assert await mission_derive_status(db_session, mission.id) == "running"

    @pytest.mark.asyncio
    async def test_no_workers_no_runs_maps_planning(self, db_session: AsyncSession) -> None:
        """无分身无 run（mission 刚建）→ planning 空集语义不变。"""
        root = await _add_session(db_session)
        mission = await _add_session_mission(db_session, root_session_id=root.id)

        assert await mission_derive_status(db_session, mission.id) == "planning"

    @pytest.mark.asyncio
    async def test_all_done_workers_map_completed_when_converged(
        self, db_session: AsyncSession
    ) -> None:
        """全分身 done 且无活跃 turn → 虚拟全 completed → done（mission 已收敛
        视角，converged 置位不回落 awaiting_input）。"""
        root = await _add_session(db_session)
        mission = await _add_session_mission(
            db_session, root_session_id=root.id, converged_at=_ts()
        )
        await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())
        await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())

        assert await mission_derive_status(db_session, mission.id) == "done"

    @pytest.mark.asyncio
    async def test_all_done_active_mission_maps_awaiting_input(
        self, db_session: AsyncSession
    ) -> None:
        """全分身 done 但 mission 未收敛、主控无活跃 turn → awaiting_input
        （等主控 converge 的中间档语义保留，不被虚拟 completed 越过）。"""
        root = await _add_session(db_session)
        mission = await _add_session_mission(db_session, root_session_id=root.id)
        await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())

        assert await mission_derive_status(db_session, mission.id) == "awaiting_input"

    @pytest.mark.asyncio
    async def test_done_worker_priority_over_ended_session(self, db_session: AsyncSession) -> None:
        """converge end_session 后（会话 ended）done 分身仍优先映射 completed
        而非 failed/running——优先级 1（done）> 终态映射（验收核心）。"""
        root = await _add_session(db_session)
        mission = await _add_session_mission(
            db_session, root_session_id=root.id, converged_at=_ts()
        )
        await _add_session(
            db_session,
            status="ended",
            parent_session_id=root.id,
            worker_done_at=_ts(),
        )

        assert await mission_derive_status(db_session, mission.id) == "done"

    @pytest.mark.asyncio
    async def test_done_worker_priority_over_failed_session(self, db_session: AsyncSession) -> None:
        """会话终态 failed 但 worker_done 已置且无活跃 turn → completed 优先于
        failed（done 优先级矩阵），不落 degraded/failed。"""
        root = await _add_session(db_session)
        mission = await _add_session_mission(
            db_session, root_session_id=root.id, converged_at=_ts()
        )
        await _add_session(
            db_session,
            status="failed",
            parent_session_id=root.id,
            worker_done_at=_ts(),
        )

        assert await mission_derive_status(db_session, mission.id) == "done"

    @pytest.mark.asyncio
    async def test_failed_worker_session_without_done_maps_failed(
        self, db_session: AsyncSession
    ) -> None:
        """会话终态 failed 且未 done → 虚拟 failed；单一分身全 failed → failed。"""
        root = await _add_session(db_session)
        mission = await _add_session_mission(
            db_session, root_session_id=root.id, converged_at=_ts()
        )
        await _add_session(db_session, status="failed", parent_session_id=root.id)

        assert await mission_derive_status(db_session, mission.id) == "failed"

    @pytest.mark.asyncio
    async def test_ended_worker_without_done_maps_running(self, db_session: AsyncSession) -> None:
        """ended 未 done（非 failed 终态）→ running（保守：不进终态集合，
        不给「全部终态请收敛」类判据喂错误信号）。"""
        root = await _add_session(db_session)
        mission = await _add_session_mission(
            db_session, root_session_id=root.id, converged_at=_ts()
        )
        await _add_session(db_session, status="ended", parent_session_id=root.id)

        assert await mission_derive_status(db_session, mission.id) == "running"

    @pytest.mark.asyncio
    async def test_mixed_done_and_failed_workers_map_degraded(
        self, db_session: AsyncSession
    ) -> None:
        """一 done + 一 failed（未 done）→ 虚拟 completed+failed → degraded。"""
        root = await _add_session(db_session)
        mission = await _add_session_mission(
            db_session, root_session_id=root.id, converged_at=_ts()
        )
        await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())
        await _add_session(db_session, status="failed", parent_session_id=root.id)

        assert await mission_derive_status(db_session, mission.id) == "degraded"

    @pytest.mark.asyncio
    async def test_followup_rework_rolls_back_to_running(self, db_session: AsyncSession) -> None:
        """追问重开工：worker_done_at 已置但新轮 run 活跃 → 虚拟映射回到
        running（追问轮 run 不写 mission_id，仅会话维度可见）。"""
        root = await _add_session(db_session)
        mission = await _add_session_mission(db_session, root_session_id=root.id)
        worker = await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())
        await _add_run_row(
            db_session,
            status="running",
            agent_session_id=worker.id,  # 追问轮活跃
        )

        assert await mission_derive_status(db_session, mission.id) == "running"

    @pytest.mark.asyncio
    async def test_workers_only_excludes_orchestrator_active_round(
        self, db_session: AsyncSession
    ) -> None:
        """主控在自己活跃轮内（orchestrator run running）derive 不恒 running：

        - workers_only=True：主控轮被排除，全 done 分身虚拟 completed；主控
          会话有活跃 turn → 不进 awaiting_input → done（D-010 置位可成功）；
        - workers_only=False（对照）：主控轮 running 原样计入 → running。
        """
        root = await _add_session(db_session)
        mission = await _add_session_mission(db_session, root_session_id=root.id)
        await _add_run_row(
            db_session,
            status="running",
            role="orchestrator",
            mission_id=mission.id,
            agent_session_id=root.id,
        )
        await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())

        assert await mission_derive_status(db_session, mission.id, workers_only=True) == "done"
        assert await mission_derive_status(db_session, mission.id) == "running"

    @pytest.mark.asyncio
    async def test_workers_only_keeps_null_role_legacy_runs(self, db_session: AsyncSession) -> None:
        """NULL role 守卫：存量 batch run（role=NULL running）在 workers_only
        下保留（SQL 三值逻辑 != 会漏 NULL 行）→ running。"""
        root = await _add_session(db_session)
        mission = await _add_session_mission(db_session, root_session_id=root.id)
        await _add_run_row(db_session, status="running", role=None, mission_id=mission.id)

        assert await mission_derive_status(db_session, mission.id, workers_only=True) == "running"

    @pytest.mark.asyncio
    async def test_subsession_first_run_not_double_counted(self, db_session: AsyncSession) -> None:
        """分身首 run（mission_id + agent_session_id=子会话）被剔除不与虚拟映射
        双计：首 run failed + worker_done 已置 → 只算虚拟 completed → done
        （若双计则会误落 degraded）。"""
        root = await _add_session(db_session)
        mission = await _add_session_mission(
            db_session, root_session_id=root.id, converged_at=_ts()
        )
        worker = await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())
        await _add_run_row(
            db_session,
            status="failed",  # 首 run 终态 failed（不构成活跃 turn）
            role="arch",
            mission_id=mission.id,
            agent_session_id=worker.id,
        )

        assert await mission_derive_status(db_session, mission.id) == "done"

    @pytest.mark.asyncio
    async def test_cancelled_flag_short_circuits_virtual_mapping(
        self, db_session: AsyncSession
    ) -> None:
        """cancelled_at 置位最高优先——虚拟映射（running）不改变 cancelled 判定。"""
        root = await _add_session(db_session)
        mission = await _add_session_mission(
            db_session, root_session_id=root.id, cancelled_at=_ts()
        )
        await _add_session(db_session, parent_session_id=root.id)  # idle 未 done

        assert await mission_derive_status(db_session, mission.id) == "cancelled"

    @pytest.mark.asyncio
    async def test_legacy_batch_mission_zero_regression(self, db_session: AsyncSession) -> None:
        """存量 batch mission（session_id 随机 uuid 查无会话行，无子会话）：
        runs 原样喂纯函数，与既有调用方 derive_status(runs, cancelled=...) 结论
        逐字节一致，has_session=False 永不 awaiting_input（FR-09 零回归）。"""
        mission = await _add_session_mission(db_session, root_session_id=uuid.uuid4())
        r1 = await _add_run_row(db_session, status="completed", role="arch", mission_id=mission.id)
        r2 = await _add_run_row(db_session, status="failed", role="impl", mission_id=mission.id)

        assert await mission_derive_status(db_session, mission.id) == derive_status([r1, r2])
        assert await mission_derive_status(db_session, mission.id) == "degraded"
        assert await mission_derive_status(db_session, mission.id) != "awaiting_input"

    @pytest.mark.asyncio
    async def test_legacy_batch_pending_run_still_running(self, db_session: AsyncSession) -> None:
        """存量 batch run 判据：任一 pending/running → running（非子会话形态
        判据路径零回归）。"""
        mission = await _add_session_mission(db_session, root_session_id=uuid.uuid4())
        await _add_run_row(db_session, status="completed", role="arch", mission_id=mission.id)
        await _add_run_row(db_session, status="pending", role="impl", mission_id=mission.id)

        assert await mission_derive_status(db_session, mission.id) == "running"

    @pytest.mark.asyncio
    async def test_missing_mission_graceful_planning(self, db_session: AsyncSession) -> None:
        """mission 不存在 → 输入空集宽限（对齐 mission_worker_sessions 缺行
        返 [] 口径），返回 planning 不抛。"""
        assert await mission_derive_status(db_session, uuid.uuid4()) == "planning"

    @pytest.mark.asyncio
    async def test_first_run_terminal_maps_failed_convergence(
        self, db_session: AsyncSession
    ) -> None:
        """ql-20260828-013-a55b 守护：分身 run 终态（failed/killed）但会话侧
        未收敛（active）或 ended 无强收标记 → 虚拟 failed，mission 不再卡
        running（真实案例 mission 1eae4f70：run killed+会话 ended、run
        failed+会话 active 两种形态都卡「进行中」）。"""
        root = await _add_session(db_session)
        mission = await _add_session_mission(db_session, root_session_id=root.id)

        # 形态①：run killed + 会话 ended（无强收标记，原映射落 running）。
        w1 = await _add_session(db_session, status="ended", parent_session_id=root.id)
        await _add_run_row(
            db_session,
            status="killed",
            role="worker",
            mission_id=mission.id,
            agent_session_id=w1.id,
        )
        # 形态②：run failed + 会话仍 active（失败后未收敛）。
        w2 = await _add_session(db_session, status="active", parent_session_id=root.id)
        await _add_run_row(
            db_session,
            status="failed",
            role="worker",
            mission_id=mission.id,
            agent_session_id=w2.id,
        )

        # 两个虚拟 run 都映射 failed（修复前卡 running）→ 全终态有失败无完成
        # + 会话 mission 未收敛 → awaiting_input（等主控输入中间档，语义同
        # test_all_done_active_mission_maps_awaiting_input；关键在不再 running）。
        # converge 置位后收敛 failed。
        assert await mission_derive_status(db_session, mission.id) == "awaiting_input"
        mission.converged_at = _ts()
        db_session.add(mission)
        await db_session.commit()
        assert await mission_derive_status(db_session, mission.id) == "failed"

    @pytest.mark.asyncio
    async def test_first_run_terminal_priority_below_session_failed(
        self, db_session: AsyncSession
    ) -> None:
        """ql-20260828-013-a55b：首 run 终态兜底不改变既有优先级——done 未
        收敛语义（追问重开中）与 run completed 仍在 running 档（兜底只认
        failed/killed，completed 不越权标 done）。"""
        root = await _add_session(db_session)
        mission = await _add_session_mission(db_session, root_session_id=root.id)
        w = await _add_session(db_session, status="active", parent_session_id=root.id)
        await _add_run_row(
            db_session,
            status="completed",
            role="worker",
            mission_id=mission.id,
            agent_session_id=w.id,
        )
        # completed run + 会话 active（无 worker_done_at）→ 仍 running。
        assert await mission_derive_status(db_session, mission.id) == "running"
