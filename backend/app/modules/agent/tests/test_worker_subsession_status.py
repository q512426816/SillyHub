"""task-08（2026-08-25-team-subsession-governance）：is_worker_complete 双形态单测。

design §5.C.3 / FR-05 / D-005@v1——worker 完成判据单一真相源：

- 子会话形态（``AgentSession``）：完成 = ``worker_done_at`` 非空**且**该会话
  无活跃 turn（ACTIVE_RUN_STATUSES 单源词表）；失败/终结 = 会话终态
  failed/ended。追问重开工期间（新轮 run 活跃）自动回未完成，干完（run 终态 /
  再调 worker_done）回到完成——可重复完成周期语义自洽；
- 存量 batch 形态（``AgentRun``）：run 终态集合 completed/failed/killed；
- 各状态源一致性（FR-05 验收核心）：同一分身在 is_worker_complete 与
  mission_derive_status 虚拟映射下结论一致（idle 未 done→running / 全 done
  且无活跃 turn→completed）。

2026-08-26-team-subsession-recursion task-03（design §5.E / FR-05 / FR-07）：
mission_derive_status 分身集合换 ``mission_worker_sessions_tree`` 全树枚举
（孙层计入，无孙树与一层等价）+ ``budget_force_ended_at`` 预算强收标记的
虚拟映射增补（会话 ended 且未 done → failed 终态，可收敛 degraded）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.mission import is_worker_complete, mission_derive_status
from app.modules.agent.model import AgentMission, AgentRun, AgentSession


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
    agent_session_id: uuid.UUID | None = None,
    mission_id: uuid.UUID | None = None,
    role: str | None = None,
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


# ── 1. 子会话形态（AgentSession）────────────────────────────────────────────


class TestSubsessionForm:
    @pytest.mark.asyncio
    async def test_idle_not_done_incomplete(self, db_session: AsyncSession) -> None:
        """分身 idle 未 done（无 worker_done_at）→ 未完成。"""
        s = await _add_session(db_session)
        assert await is_worker_complete(db_session, s) is False

    @pytest.mark.asyncio
    async def test_done_without_active_turn_complete(self, db_session: AsyncSession) -> None:
        """worker_done_at 已置且会话无活跃 turn → 完成。"""
        s = await _add_session(db_session, worker_done_at=_ts())
        assert await is_worker_complete(db_session, s) is True

    @pytest.mark.asyncio
    async def test_done_with_pending_run_incomplete(self, db_session: AsyncSession) -> None:
        """首 turn 尚在 pending（活跃 turn）→ 未完成。"""
        s = await _add_session(db_session, worker_done_at=_ts())
        await _add_run_row(db_session, status="pending", agent_session_id=s.id)
        assert await is_worker_complete(db_session, s) is False

    @pytest.mark.asyncio
    @pytest.mark.parametrize("active_status", ["pending", "running", "pending_approval"])
    async def test_followup_rework_rolls_back_to_incomplete(
        self, db_session: AsyncSession, active_status: str
    ) -> None:
        """追问重开工（新轮 run 活跃，ACTIVE_RUN_STATUSES 全词表含
        pending_approval）→ 自动回未完成。"""
        s = await _add_session(db_session, worker_done_at=_ts())
        await _add_run_row(db_session, status="completed", agent_session_id=s.id)  # 首 turn
        await _add_run_row(db_session, status=active_status, agent_session_id=s.id)  # 追问轮
        assert await is_worker_complete(db_session, s) is False

    @pytest.mark.asyncio
    async def test_rework_finished_back_to_complete_without_remark(
        self, db_session: AsyncSession
    ) -> None:
        """追问轮干完（该 run 终态、无活跃 turn）→ 回到完成（worker_done_at 仍是
        旧值也成立——判定只看「已置位且无活跃 turn」）。"""
        s = await _add_session(db_session, worker_done_at=_ts())
        await _add_run_row(db_session, status="completed", agent_session_id=s.id)  # 首 turn
        followup = await _add_run_row(db_session, status="running", agent_session_id=s.id)  # 追问轮
        assert await is_worker_complete(db_session, s) is False

        followup.status = "completed"  # 追问轮干完（终态化，非新增 run）
        db_session.add(followup)
        await db_session.commit()
        assert await is_worker_complete(db_session, s) is True

    @pytest.mark.asyncio
    async def test_repeated_completion_cycles(self, db_session: AsyncSession) -> None:
        """重复完成周期：done → 重开工未完成 → 干完再置位完成 → 再重开工未完成 →
        再干完回完成（worker_done_at 可重复置位取最新，判据语义自洽）。"""
        s = await _add_session(db_session, worker_done_at=_ts())
        assert await is_worker_complete(db_session, s) is True

        rework1 = await _add_run_row(db_session, status="running", agent_session_id=s.id)
        assert await is_worker_complete(db_session, s) is False

        # 干完再调 worker_done（重复置位取最新时间）
        rework1.status = "completed"
        s.worker_done_at = _ts()
        db_session.add(rework1)
        db_session.add(s)
        await db_session.commit()
        assert await is_worker_complete(db_session, s) is True

        rework2 = await _add_run_row(db_session, status="pending", agent_session_id=s.id)
        assert await is_worker_complete(db_session, s) is False

        rework2.status = "completed"
        db_session.add(rework2)
        await db_session.commit()
        assert await is_worker_complete(db_session, s) is True

    @pytest.mark.asyncio
    async def test_session_failed_terminal_even_without_done(
        self, db_session: AsyncSession
    ) -> None:
        """会话终态 failed（未 done）→ 终结即完成。"""
        s = await _add_session(db_session, status="failed")
        assert await is_worker_complete(db_session, s) is True

    @pytest.mark.asyncio
    async def test_session_ended_terminal_even_without_done(self, db_session: AsyncSession) -> None:
        """会话终态 ended（未 done）→ 终结即完成。"""
        s = await _add_session(db_session, status="ended")
        assert await is_worker_complete(db_session, s) is True

    @pytest.mark.asyncio
    async def test_failed_session_with_active_run_still_terminal(
        self, db_session: AsyncSession
    ) -> None:
        """终态优先于活跃 turn：会话 failed 即使残留活跃 run 行（脏数据）也判定
        终结——会话终态是更硬的信号。"""
        s = await _add_session(db_session, status="failed")
        await _add_run_row(db_session, status="running", agent_session_id=s.id)
        assert await is_worker_complete(db_session, s) is True


# ── 2. 存量 batch 形态（AgentRun）────────────────────────────────────────────


class TestBatchRunForm:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("terminal", ["completed", "failed", "killed"])
    async def test_terminal_run_complete(self, db_session: AsyncSession, terminal: str) -> None:
        """存量 batch 形态：run 终态集合 completed/failed/killed → 完成。"""
        run = await _add_run_row(db_session, status=terminal, role="arch")
        assert await is_worker_complete(db_session, run) is True

    @pytest.mark.asyncio
    @pytest.mark.parametrize("active", ["pending", "running", "pending_approval"])
    async def test_active_run_incomplete(self, db_session: AsyncSession, active: str) -> None:
        """run 非终态（pending/running/pending_approval）→ 未完成。"""
        run = await _add_run_row(db_session, status=active, role="arch")
        assert await is_worker_complete(db_session, run) is False


# ── 3. 各状态源一致（FR-05 验收核心：is_worker_complete × mission_derive_status）──


class TestStatusSourceConsistency:
    @pytest.mark.asyncio
    async def test_idle_worker_consistent_running(self, db_session: AsyncSession) -> None:
        """分身 idle 未 done → is_worker_complete=False 且 mission_derive_status
        映射 running——两状态源结论一致。"""
        root = await _add_session(db_session)
        mission = AgentMission(workspace_id=uuid.uuid4(), objective="o", session_id=root.id)
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)
        worker = await _add_session(db_session, parent_session_id=root.id)

        assert await is_worker_complete(db_session, worker) is False
        assert await mission_derive_status(db_session, mission.id) == "running"

    @pytest.mark.asyncio
    async def test_all_done_consistent_completed(self, db_session: AsyncSession) -> None:
        """全分身 done 且无活跃 turn → is_worker_complete=True 且虚拟映射
        completed（mission 已收敛视角 derive=done）。"""
        root = await _add_session(db_session)
        mission = AgentMission(
            workspace_id=uuid.uuid4(),
            objective="o",
            session_id=root.id,
            converged_at=_ts(),
        )
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)
        w1 = await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())
        w2 = await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())
        await _add_run_row(db_session, status="completed", agent_session_id=w1.id)

        assert await is_worker_complete(db_session, w1) is True
        assert await is_worker_complete(db_session, w2) is True
        assert await mission_derive_status(db_session, mission.id) == "done"

    @pytest.mark.asyncio
    async def test_rework_worker_consistent_running(self, db_session: AsyncSession) -> None:
        """追问重开工中的分身：is_worker_complete=False 且虚拟映射 running
        （两源同步回落，不出现「判据已完成但状态 running」的漂移）。"""
        root = await _add_session(db_session)
        mission = AgentMission(
            workspace_id=uuid.uuid4(),
            objective="o",
            session_id=root.id,
            converged_at=_ts(),
        )
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)
        worker = await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())
        await _add_run_row(db_session, status="running", agent_session_id=worker.id)

        assert await is_worker_complete(db_session, worker) is False
        assert await mission_derive_status(db_session, mission.id) == "running"


# ── 4. 全树分身集合（2026-08-26-team-subsession-recursion task-03，design §5.E）──
#
# mission_derive_status 分身集合从 mission_worker_sessions（一层）换
# mission_worker_sessions_tree（全树，孙层计入）：孙未完成不漏判、孙首 run
# 按全树 id 集合剔除不双计、无孙树与 P1 一层枚举等价（FR-08 零回归）。


async def _add_mission(
    db: AsyncSession,
    *,
    root_session_id: uuid.UUID,
    converged_at: datetime | None = None,
    constraints: dict | None = None,
) -> AgentMission:
    m = AgentMission(
        workspace_id=uuid.uuid4(),
        objective="o",
        session_id=root_session_id,
        converged_at=converged_at,
        constraints=constraints,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


class TestWholeTreeWorkerSet:
    @pytest.mark.asyncio
    async def test_grandson_incomplete_keeps_running(self, db_session: AsyncSession) -> None:
        """三层树：分身全 done 但孙 idle 未完成 → 孙层计入判据，derive 保持
        running（一层枚举会漏孙、误判全部终态——FR-07 孙层不漏）。"""
        root = await _add_session(db_session)
        mission = await _add_mission(db_session, root_session_id=root.id, converged_at=_ts())
        worker = await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())
        grandson = await _add_session(db_session, parent_session_id=worker.id)  # 孙 idle 未 done

        assert await is_worker_complete(db_session, grandson) is False
        assert await mission_derive_status(db_session, mission.id) == "running"

    @pytest.mark.asyncio
    async def test_grandson_rework_active_turn_keeps_running(
        self, db_session: AsyncSession
    ) -> None:
        """孙追问重开工中（worker_done 已置但新轮 run 活跃）→ 孙层虚拟映射
        running（全树活跃 turn 批量查明含孙，不漏）。"""
        root = await _add_session(db_session)
        mission = await _add_mission(db_session, root_session_id=root.id, converged_at=_ts())
        worker = await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())
        grandson = await _add_session(db_session, parent_session_id=worker.id, worker_done_at=_ts())
        await _add_run_row(db_session, status="running", agent_session_id=grandson.id)

        assert await is_worker_complete(db_session, grandson) is False
        assert await mission_derive_status(db_session, mission.id) == "running"

    @pytest.mark.asyncio
    async def test_grandson_all_terminal_derives_done(self, db_session: AsyncSession) -> None:
        """分身 + 孙全树到达终态（全 done 无活跃 turn）→ done（孙层计入，
        不双计不漏计）。"""
        root = await _add_session(db_session)
        mission = await _add_mission(db_session, root_session_id=root.id, converged_at=_ts())
        worker = await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())
        await _add_session(db_session, parent_session_id=worker.id, worker_done_at=_ts())

        assert await mission_derive_status(db_session, mission.id) == "done"

    @pytest.mark.asyncio
    async def test_grandson_failed_mixed_derives_degraded(self, db_session: AsyncSession) -> None:
        """分身 done + 孙会话终态 failed（未 done）→ 虚拟 completed+failed →
        degraded（孙失败计入混合判定）。"""
        root = await _add_session(db_session)
        mission = await _add_mission(db_session, root_session_id=root.id, converged_at=_ts())
        worker = await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())
        await _add_session(db_session, status="failed", parent_session_id=worker.id)

        assert await mission_derive_status(db_session, mission.id) == "degraded"

    @pytest.mark.asyncio
    async def test_grandson_first_run_not_double_counted(self, db_session: AsyncSession) -> None:
        """孙首 run（mission_id + agent_session_id=孙会话）被剔除不与虚拟映射
        双计——首 run 剔除按全树 id 集合执行：孙 done + 孙首 run failed → 只算
        虚拟 completed → done（若漏剔除/漏孙则会误落 degraded）。"""
        root = await _add_session(db_session)
        mission = await _add_mission(db_session, root_session_id=root.id, converged_at=_ts())
        worker = await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())
        grandson = await _add_session(db_session, parent_session_id=worker.id, worker_done_at=_ts())
        await _add_run_row(
            db_session,
            status="failed",  # 孙首 run 终态 failed（不构成活跃 turn）
            role="impl",
            mission_id=mission.id,
            agent_session_id=grandson.id,
        )

        assert await mission_derive_status(db_session, mission.id) == "done"

    @pytest.mark.asyncio
    async def test_no_grandson_tree_equivalent_to_one_layer(self, db_session: AsyncSession) -> None:
        """无孙一层树换全树前后等价（FR-08 零回归）：一 done + 一 failed 未
        done → degraded；一 done + 一 ended 未 done → running（P1 一层语义
        逐分支不变）。"""
        root = await _add_session(db_session)
        degraded_mission = await _add_mission(
            db_session, root_session_id=root.id, converged_at=_ts()
        )
        await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())
        await _add_session(db_session, status="failed", parent_session_id=root.id)
        assert await mission_derive_status(db_session, degraded_mission.id) == "degraded"

        root2 = await _add_session(db_session)
        running_mission = await _add_mission(
            db_session, root_session_id=root2.id, converged_at=_ts()
        )
        await _add_session(db_session, parent_session_id=root2.id, worker_done_at=_ts())
        await _add_session(db_session, status="ended", parent_session_id=root2.id)
        assert await mission_derive_status(db_session, running_mission.id) == "running"


# ── 5. budget_force_ended_at 虚拟映射（task-03 / design §5.E，D-005@v1）─────
#
# 预算强收可收敛语义：mission.constraints 带 budget_force_ended_at 键（task-07
# patrol 置位，本卡只读）时「会话 ended 且未 done」映射 failed（终态）而非
# running → derive 出 degraded/failed，强收后 mission 可正常 converge。优先级：
# done(完成) > budget 标记下 ended 未 done → failed > 会话 failed → failed >
# 其余 running。无标记时 ended 未 done 仍 running（P1 语义不变）。

# 标记值只查键存在性（patrol 落 ISO 时间戳字符串），值内容不影响映射。
_BUDGET_MARKER: dict = {"budget_force_ended_at": "2026-08-26T03:00:00+00:00"}


class TestBudgetForceEndedMapping:
    @pytest.mark.asyncio
    async def test_marker_ended_not_done_maps_failed(self, db_session: AsyncSession) -> None:
        """标记 + 单分身 ended 未 done（强收典型输入）→ 虚拟 failed → failed
        （终态，非 running 卡死）。"""
        root = await _add_session(db_session)
        mission = await _add_mission(
            db_session,
            root_session_id=root.id,
            converged_at=_ts(),
            constraints=_BUDGET_MARKER,
        )
        await _add_session(db_session, status="ended", parent_session_id=root.id)

        assert await mission_derive_status(db_session, mission.id) == "failed"

    @pytest.mark.asyncio
    async def test_marker_mixed_done_and_force_ended_derives_degraded(
        self, db_session: AsyncSession
    ) -> None:
        """标记 + 一 done 分身 + 一强收 ended 未 done 分身 → completed+failed
        → degraded（收尾但不圆满，可收敛核心验收）。"""
        root = await _add_session(db_session)
        mission = await _add_mission(
            db_session,
            root_session_id=root.id,
            converged_at=_ts(),
            constraints=_BUDGET_MARKER,
        )
        await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())
        await _add_session(db_session, status="ended", parent_session_id=root.id)

        assert await mission_derive_status(db_session, mission.id) == "degraded"

    @pytest.mark.asyncio
    async def test_marker_force_ended_all_terminal_not_running(
        self, db_session: AsyncSession
    ) -> None:
        """标记 + 全 ended 未 done（全员强收，未 converge）→ 虚拟全 failed →
        不再 running：会话 mission 未收敛回落 awaiting_input（等主控 converge
        收尾），强收后 mission 不卡死在 running。"""
        root = await _add_session(db_session)
        mission = await _add_mission(
            db_session, root_session_id=root.id, constraints=_BUDGET_MARKER
        )
        await _add_session(db_session, status="ended", parent_session_id=root.id)
        await _add_session(db_session, status="ended", parent_session_id=root.id)

        assert await mission_derive_status(db_session, mission.id) != "running"
        assert await mission_derive_status(db_session, mission.id) == "awaiting_input"

    @pytest.mark.asyncio
    async def test_no_marker_same_input_still_running(self, db_session: AsyncSession) -> None:
        """无标记对照：同输入（一 done + 一 ended 未 done）仍 running——P1
        ended-running 语义不变，标记不存在时零行为漂移。"""
        root = await _add_session(db_session)
        mission = await _add_mission(db_session, root_session_id=root.id, converged_at=_ts())
        await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())
        await _add_session(db_session, status="ended", parent_session_id=root.id)

        assert await mission_derive_status(db_session, mission.id) == "running"

    @pytest.mark.asyncio
    async def test_marker_done_worker_priority_over_budget_branch(
        self, db_session: AsyncSession
    ) -> None:
        """标记下 done 分身（会话 ended + worker_done 已置 + 无活跃 turn——
        converge end_session 后形态）仍优先映射 completed → done——budget
        分支不误杀已完成分身（done 优先级在 budget 标记之前）。"""
        root = await _add_session(db_session)
        mission = await _add_mission(
            db_session,
            root_session_id=root.id,
            converged_at=_ts(),
            constraints=_BUDGET_MARKER,
        )
        await _add_session(
            db_session,
            status="ended",
            parent_session_id=root.id,
            worker_done_at=_ts(),
        )
        await _add_session(
            db_session,
            status="ended",
            parent_session_id=root.id,
            worker_done_at=_ts(),
        )

        assert await mission_derive_status(db_session, mission.id) == "done"

    @pytest.mark.asyncio
    async def test_marker_session_failed_still_failed(self, db_session: AsyncSession) -> None:
        """标记 + 会话终态 failed（未 done）→ failed（budget 分支与其后的
        会话 failed 分支同象，映射结果一致）。"""
        root = await _add_session(db_session)
        mission = await _add_mission(
            db_session,
            root_session_id=root.id,
            converged_at=_ts(),
            constraints=_BUDGET_MARKER,
        )
        await _add_session(db_session, status="failed", parent_session_id=root.id)

        assert await mission_derive_status(db_session, mission.id) == "failed"

    @pytest.mark.asyncio
    async def test_marker_active_session_still_running(self, db_session: AsyncSession) -> None:
        """标记只改 ended 未 done 的映射：标记存在但会话仍 active（未被强收
        / 强收后重开新分身）→ running 不受标记影响。"""
        root = await _add_session(db_session)
        mission = await _add_mission(
            db_session,
            root_session_id=root.id,
            converged_at=_ts(),
            constraints=_BUDGET_MARKER,
        )
        await _add_session(db_session, status="active", parent_session_id=root.id)

        assert await mission_derive_status(db_session, mission.id) == "running"

    @pytest.mark.asyncio
    async def test_marker_constraints_none_graceful(self, db_session: AsyncSession) -> None:
        """constraints=None（未传约束的 mission）安全：ended 未 done 仍 running
        （P1 行为，键查询对 None 短路）。"""
        root = await _add_session(db_session)
        mission = await _add_mission(
            db_session, root_session_id=root.id, converged_at=_ts(), constraints=None
        )
        await _add_session(db_session, status="ended", parent_session_id=root.id)

        assert await mission_derive_status(db_session, mission.id) == "running"

    @pytest.mark.asyncio
    async def test_marker_applies_to_grandson_too(self, db_session: AsyncSession) -> None:
        """标记对全树生效（mission 级标记，孙层同样映射）：分身 done + 孙
        ended 未 done + 标记 → degraded（孙强收计入收敛判定）。"""
        root = await _add_session(db_session)
        mission = await _add_mission(
            db_session,
            root_session_id=root.id,
            converged_at=_ts(),
            constraints=_BUDGET_MARKER,
        )
        worker = await _add_session(db_session, parent_session_id=root.id, worker_done_at=_ts())
        await _add_session(db_session, status="ended", parent_session_id=worker.id)  # 孙被强收

        assert await mission_derive_status(db_session, mission.id) == "degraded"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
