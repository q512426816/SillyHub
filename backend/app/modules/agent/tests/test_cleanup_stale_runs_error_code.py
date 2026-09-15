"""2026-09-15-background-task-permission-lockout task-09/task-11（FR-04）：
_cleanup_stale_runs_impl 重启终态化补结构化错误码。

- failed 分支（无可恢复元数据）→ status=failed + error_code=
  SERVICE_RESTART_INTERRUPTED + error_detail（reason/finished_by）。
- completed 恢复分支（num_turns>0 + exit_code>=0）→ 不写 error_code（run 实际
  已正常完成，重启只是丢 commit，非错误）。

线上实证（会话 6e213eb3 / run d9426bc3）：重启终态化的 run 无错误码，排障无从
分辨「无声失败」与模型故障。
"""

import uuid
from datetime import UTC, datetime

import pytest

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.agent.service import _cleanup_stale_runs_impl
from app.modules.auth.model import User


async def _make_stale_session_and_run(db_session, *, num_turns: int, exit_code):
    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"stale-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await db_session.commit()
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=uid,
        provider="claude",
        status="active",
        turn_count=1,
        created_at=datetime.now(UTC),
    )
    db_session.add(sess)
    await db_session.flush()
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="running",
        spec_strategy="interactive",
        agent_session_id=sess.id,
        num_turns=num_turns,
        exit_code=exit_code,
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)
    return run


@pytest.mark.asyncio
async def test_stale_run_failed_branch_writes_error_code(db_session) -> None:
    """无可恢复元数据（num_turns=0 / exit_code=None）→ failed + 结构化错误码。"""
    run = await _make_stale_session_and_run(db_session, num_turns=0, exit_code=None)

    cleaned = await _cleanup_stale_runs_impl(db_session)

    assert cleaned >= 1
    await db_session.refresh(run)
    assert run.status == "failed"
    assert run.error_code == "SERVICE_RESTART_INTERRUPTED"
    assert run.error_detail == {
        "reason": "backend service restarted while run was active",
        "finished_by": "startup_cleanup",
    }
    assert run.exit_code == -1


@pytest.mark.asyncio
async def test_stale_run_restored_completed_branch_no_error_code(db_session) -> None:
    """completed 恢复分支（num_turns>0 + exit_code=0）→ 不写 error_code。"""
    run = await _make_stale_session_and_run(db_session, num_turns=5, exit_code=0)

    await _cleanup_stale_runs_impl(db_session)

    await db_session.refresh(run)
    assert run.status == "completed"
    assert run.error_code is None
    assert run.error_detail is None
