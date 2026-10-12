"""任务快照读侧去重单测（2026-10-12-session-defects task-06 / FR-07 / D-005 兜底）。

覆盖 task_snapshot_dedupe.dedupe_task_snapshots 纯函数语义 + GET
/sessions/{id}/tasks 端点接入（与导出 _fetch_export_tasks 同口径）：

1. 幽灵成对行收敛：同名 stopped(空摘要)+completed(真摘要) → 仅保留
   completed 真实终态行（生产会话 47e2ff1a 实证 21 组形态）；
2. 终态优先序：completed > failed > stopped，同优先序取 updated_at 最新；
3. running 透传：同名多在途实例（合法重试重生成）不误杀；completed+running
   并存两行都保留；
4. 无重复输入零变化（行集与相对顺序不变）；
5. 端点接入：含成对行数据源输出恰一行真实终态行；AgentSessionTaskRead
   形状与 updated_at desc 排序不变。

HTTP harness 镜像 test_agent_session_tasks.py（client + auth_headers +
db_session conftest 夹具）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.daemon.model import AgentSessionTask
from app.modules.daemon.task_snapshot_dedupe import dedupe_task_snapshots

# ── Helpers ──────────────────────────────────────────────────────────────────


def _row(
    session_id: uuid.UUID,
    task_id: str,
    name: str,
    *,
    status: str = "running",
    summary: str | None = None,
    minutes_ago: int = 0,
) -> AgentSessionTask:
    """构造内存行（不入库，纯函数直测用；updated_at 按 minutes_ago 回退）。"""
    now = datetime.now(UTC)
    return AgentSessionTask(
        session_id=session_id,
        run_id=uuid.uuid4(),
        task_id=task_id,
        task_name=name,
        status=status,
        summary=summary,
        started_at=now - timedelta(minutes=minutes_ago + 1),
        finished_at=now - timedelta(minutes=minutes_ago) if status != "running" else None,
        updated_at=now - timedelta(minutes=minutes_ago),
    )


async def _seed_pair(
    db_session: AsyncSession, session_id: uuid.UUID
) -> tuple[AgentSessionTask, AgentSessionTask]:
    """落库生产幽灵成对行（同名 stopped 空摘要 + completed 真摘要）。"""
    now = datetime.now(UTC)
    ghost = AgentSessionTask(
        session_id=session_id,
        run_id=uuid.uuid4(),
        task_id="callu_ghost",
        task_name="独立评审 VO 改名修复",
        status="stopped",
        message="轮次已结束，任务未上报终态",
        started_at=now - timedelta(minutes=30),
        finished_at=now - timedelta(minutes=10),
        updated_at=now - timedelta(minutes=10),
    )
    real = AgentSessionTask(
        session_id=session_id,
        run_id=uuid.uuid4(),
        task_id="ad1e466fdeadbeef",
        task_name="独立评审 VO 改名修复",
        status="completed",
        summary="评审完成，review.json 已写入",
        started_at=now - timedelta(minutes=30),
        finished_at=now - timedelta(minutes=5),
        updated_at=now - timedelta(minutes=5),
    )
    db_session.add_all([ghost, real])
    await db_session.commit()
    return ghost, real


# ── 1. 纯函数语义组 ──────────────────────────────────────────────────────────


class TestDedupeTaskSnapshots:
    def test_ghost_pair_keeps_completed_drops_stopped(self) -> None:
        sid = uuid.uuid4()
        ghost = _row(sid, "callu_ghost", "独立评审", status="stopped", minutes_ago=10)
        real = _row(
            sid,
            "ad1e466f",
            "独立评审",
            status="completed",
            summary="评审完成",
            minutes_ago=5,
        )
        out = dedupe_task_snapshots([ghost, real])
        assert [r.task_id for r in out] == ["ad1e466f"]
        assert out[0].summary == "评审完成"

    def test_terminal_priority_completed_beats_newer_stopped(self) -> None:
        sid = uuid.uuid4()
        newer_stopped = _row(sid, "t1", "任务甲", status="stopped", minutes_ago=1)
        older_completed = _row(sid, "t2", "任务甲", status="completed", minutes_ago=9)
        out = dedupe_task_snapshots([newer_stopped, older_completed])
        assert [r.task_id for r in out] == ["t2"]

    def test_same_status_latest_updated_at_wins(self) -> None:
        sid = uuid.uuid4()
        older = _row(sid, "t1", "任务乙", status="failed", minutes_ago=8)
        newer = _row(sid, "t2", "任务乙", status="failed", minutes_ago=2)
        out = dedupe_task_snapshots([older, newer])
        assert [r.task_id for r in out] == ["t2"]

    def test_running_rows_pass_through_with_terminal_sibling(self) -> None:
        """completed + 同名 running（合法重试在途实例）两行都保留。"""
        sid = uuid.uuid4()
        done = _row(sid, "t1", "评审后断点续跑收口", status="completed", minutes_ago=6)
        inflight = _row(sid, "t2", "评审后断点续跑收口", status="running", minutes_ago=1)
        out = dedupe_task_snapshots([done, inflight])
        assert {r.task_id for r in out} == {"t1", "t2"}

    def test_all_running_group_unchanged(self) -> None:
        sid = uuid.uuid4()
        a = _row(sid, "t1", "任务丙", status="running", minutes_ago=3)
        b = _row(sid, "t2", "任务丙", status="running", minutes_ago=1)
        out = dedupe_task_snapshots([a, b])
        assert len(out) == 2

    def test_no_duplicates_zero_change_preserves_order(self) -> None:
        sid = uuid.uuid4()
        rows = [
            _row(sid, "t1", "任务一", status="completed", minutes_ago=5),
            _row(sid, "t2", "任务二", status="running", minutes_ago=2),
        ]
        out = dedupe_task_snapshots(rows)
        assert out == rows

    def test_input_order_preserved_after_dedupe(self) -> None:
        sid = uuid.uuid4()
        ghost = _row(sid, "g", "同名任务", status="stopped", minutes_ago=9)
        real = _row(sid, "r", "同名任务", status="completed", minutes_ago=1)
        other = _row(sid, "o", "其他任务", status="completed", minutes_ago=5)
        # 输入序（updated_at desc 假设）：real(1m) → other(5m) → ghost(9m)
        out = dedupe_task_snapshots([real, other, ghost])
        assert [r.task_id for r in out] == ["r", "o"]


# ── 2. 端点接入组 ────────────────────────────────────────────────────────────


class TestListSessionTasksDedupe:
    @pytest.mark.asyncio
    async def test_endpoint_collapses_ghost_pair(
        self, client, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """含生产成对行的数据源：GET /sessions/{id}/tasks 每任务名恰一行真实终态行。"""
        from app.modules.agent.model import AgentSession

        # 归属对齐 conftest 的 admin 用户（test_agent_session_tasks._admin_id 同口径）。
        from .test_agent_session_tasks import _admin_id

        admin = await _admin_id(db_session)
        sess = AgentSession(
            id=uuid.uuid4(),
            user_id=admin,
            title="dedupe 冒烟",
            provider="claude",
            status="ended",
        )
        db_session.add(sess)
        await db_session.commit()
        await _seed_pair(db_session, sess.id)

        resp = await client.get(f"/api/daemon/sessions/{sess.id}/tasks", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        items = resp.json()
        names = [i["task_name"] for i in items]
        assert names.count("独立评审 VO 改名修复") == 1
        kept = next(i for i in items if i["task_name"] == "独立评审 VO 改名修复")
        assert kept["status"] == "completed"
        assert kept["summary"] == "评审完成，review.json 已写入"
