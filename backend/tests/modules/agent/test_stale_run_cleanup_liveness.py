"""2026-10-08-backend-restart-fake-failed / FR-01：启动清理的日志活性检测。

线上实证（会话 968e58be，2026-10-08 11:28）：部署重启后端容器时
``_cleanup_stale_runs_impl`` 只看 DB status='running'，把仍在 daemon 上实际
执行的轮判成 failed + SERVICE_RESTART_INTERRUPTED；daemon 6 分钟后跑完的迟到
成功结果又被终态守卫拒收，UI 永远假失败。

本文件验证清理前的 recency 门（design §做法概述防线一）：
- 近期（≤ STALE_RUN_ACTIVE_GRACE）有 daemon 上报的 running 轮 → 跳过判死保持
  running，等真终态；
- 上报停滞超宽限 / 无日志行的 running 轮 → 沿用既有判死（防永卡 running）。

fixture 模式参考 ``backend/tests/modules/daemon/lease/test_complete_lease_stage_writeback.py``
（real-DB + 直接构造模型行）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.agent.service import STALE_RUN_ACTIVE_GRACE, _cleanup_stale_runs_impl


def _make_running_run() -> AgentRun:
    return AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        model="claude-sonnet-4",
        status="running",
        spec_strategy="interactive",
    )


async def _add_log(db_session: AsyncSession, run_id: uuid.UUID, age: timedelta) -> None:
    db_session.add(
        AgentRunLog(
            run_id=run_id,
            channel="stdout",
            timestamp=datetime.now(UTC) - age,
            content_redacted="[TOOL_USE] bash: echo hi",
        )
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_cleanup_skips_run_with_recent_daemon_activity(
    db_session: AsyncSession,
) -> None:
    """最新日志距今 3 分钟（daemon 仍在上报）→ 跳过判死，保持 running。"""
    run = _make_running_run()
    db_session.add(run)
    await db_session.commit()
    await _add_log(db_session, run.id, timedelta(minutes=3))

    cleaned = await _cleanup_stale_runs_impl(db_session)

    assert cleaned == 0
    refreshed = await db_session.get(AgentRun, run.id)
    assert refreshed is not None
    assert refreshed.status == "running"
    assert refreshed.error_code is None
    assert refreshed.exit_code is None
    assert refreshed.finished_at is None


@pytest.mark.asyncio
async def test_cleanup_fails_run_with_stale_activity(db_session: AsyncSession) -> None:
    """最新日志距今超宽限窗（daemon 实际已死）→ 沿用既有判死。"""
    run = _make_running_run()
    db_session.add(run)
    await db_session.commit()
    await _add_log(db_session, run.id, STALE_RUN_ACTIVE_GRACE + timedelta(minutes=20))

    cleaned = await _cleanup_stale_runs_impl(db_session)

    assert cleaned == 1
    refreshed = await db_session.get(AgentRun, run.id)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert refreshed.error_code == "SERVICE_RESTART_INTERRUPTED"
    assert refreshed.exit_code == -1
    assert refreshed.finished_at is not None


@pytest.mark.asyncio
async def test_cleanup_fails_run_without_logs(db_session: AsyncSession) -> None:
    """无任何日志行（活性检测无信号）→ 不得阻塞清理，沿用既有判死。"""
    run = _make_running_run()
    db_session.add(run)
    await db_session.commit()

    cleaned = await _cleanup_stale_runs_impl(db_session)

    assert cleaned == 1
    refreshed = await db_session.get(AgentRun, run.id)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert refreshed.error_code == "SERVICE_RESTART_INTERRUPTED"
