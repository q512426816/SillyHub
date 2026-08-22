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

from app.modules.agent.mission import derive_status, get_active_mission_for_session
from app.modules.agent.model import AgentMission, AgentRun


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
