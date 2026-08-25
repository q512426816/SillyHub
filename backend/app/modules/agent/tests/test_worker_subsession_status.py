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


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
