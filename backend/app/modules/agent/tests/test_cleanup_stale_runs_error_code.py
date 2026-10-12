"""2026-09-15-background-task-permission-lockout task-09/task-11（FR-04）：
_cleanup_stale_runs_impl 重启终态化补结构化错误码。

- failed 分支（无可恢复元数据）→ status=failed + error_code=
  SERVICE_RESTART_INTERRUPTED + error_detail（reason/finished_by）+ 中文可读
  原因（output_redacted，2026-10-12-stale-run-askwait-fix）。
- completed 恢复分支（num_turns>0 + exit_code>=0）→ 不写 error_code（run 实际
  已正常完成，重启只是丢 commit，非错误）。

2026-10-12-stale-run-askwait-fix：等待用户回答提问的 running 轮豁免判死——
生产实证（会话 47e2ff1a run e31ec8fc）：AskUserQuestion 等待回答近 20 分钟，
后端重启的启动清理按 10 分钟宽限窗误判 SERVICE_RESTART_INTERRUPTED。

线上实证（会话 6e213eb3 / run d9426bc3）：重启终态化的 run 无错误码，排障无从
分辨「无声失败」与模型故障。
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
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


async def _add_run_log(
    db_session,
    run_id: uuid.UUID,
    *,
    channel: str,
    tool_kind: str | None = None,
    minutes_ago: int,
) -> None:
    """插入一条 run 日志（timestamp 相对现在回拨，构造日志停滞场景）。"""
    db_session.add(
        AgentRunLog(
            run_id=run_id,
            channel=channel,
            tool_kind=tool_kind,
            timestamp=datetime.now(UTC) - timedelta(minutes=minutes_ago),
        )
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_stale_run_failed_branch_writes_error_code(db_session) -> None:
    """无可恢复元数据（num_turns=0 / exit_code=None）→ failed + 结构化错误码。"""
    run = await _make_stale_session_and_run(db_session, num_turns=0, exit_code=None)

    cleaned = await _cleanup_stale_runs_impl(db_session)

    assert cleaned >= 1
    await db_session.refresh(run)
    assert run.status == "failed"
    assert run.error_code == "SERVICE_RESTART_INTERRUPTED"
    # 2026-10-08-backend-restart-fake-failed（评审 P3）：reason 文案兼顾复扫
    # 场景——清理不只发生在后端重启，延迟复扫发现 daemon 停止上报同样走此
    # 分支；finished_by 随之改 stale_run_cleanup。
    assert run.error_detail == {
        "reason": "no daemon activity within grace window (startup cleanup / deferred recheck)",
        "finished_by": "stale_run_cleanup",
    }
    assert run.exit_code == -1
    # 2026-10-12-stale-run-askwait-fix：output_redacted 中文可读原因（经
    # SessionRunRead.failure_summary 透出前端错误卡 message）。
    assert run.output_redacted == (
        "平台服务重启，本轮执行被中断；会话上下文已保留，可重新发送继续。"
    )


@pytest.mark.asyncio
async def test_stale_run_restored_completed_branch_no_error_code(db_session) -> None:
    """completed 恢复分支（num_turns>0 + exit_code=0）→ 不写 error_code。"""
    run = await _make_stale_session_and_run(db_session, num_turns=5, exit_code=0)

    await _cleanup_stale_runs_impl(db_session)

    await db_session.refresh(run)
    assert run.status == "completed"
    assert run.error_code is None
    assert run.error_detail is None


# ── 2026-10-12-stale-run-askwait-fix：等待用户回答的轮豁免判死 ──────────────


@pytest.mark.asyncio
async def test_stale_run_awaiting_user_answer_skipped(db_session) -> None:
    """ask 提问（tool_kind=ask）晚于 user_input → 日志停滞仍豁免，保持 running。

    生产实证形态（会话 47e2ff1a）：AskUserQuestion 后等待用户回答近 20 分钟，
    后端重启的启动清理不得按宽限窗误判 SERVICE_RESTART_INTERRUPTED。
    """
    run = await _make_stale_session_and_run(db_session, num_turns=0, exit_code=None)
    await _add_run_log(db_session, run.id, channel="user_input", minutes_ago=30)
    await _add_run_log(db_session, run.id, channel="tool_call", tool_kind="ask", minutes_ago=25)

    cleaned = await _cleanup_stale_runs_impl(db_session)

    await db_session.refresh(run)
    assert run.status == "running"
    assert run.error_code is None
    assert run.finished_at is None
    assert cleaned == 0


@pytest.mark.asyncio
async def test_stale_run_awaiting_user_pending_input_channel_skipped(db_session) -> None:
    """pending_input 通道的 ask 信号同样豁免（提问落库的另一形态）。"""
    run = await _make_stale_session_and_run(db_session, num_turns=0, exit_code=None)
    await _add_run_log(db_session, run.id, channel="pending_input", minutes_ago=25)

    await _cleanup_stale_runs_impl(db_session)

    await db_session.refresh(run)
    assert run.status == "running"


@pytest.mark.asyncio
async def test_stale_run_user_answered_after_ask_still_killed(db_session) -> None:
    """user_input 晚于 ask（已回答）→ 不豁免，日志停滞照常判死（防永卡兜底不缩小）。"""
    run = await _make_stale_session_and_run(db_session, num_turns=0, exit_code=None)
    await _add_run_log(db_session, run.id, channel="tool_call", tool_kind="ask", minutes_ago=30)
    await _add_run_log(db_session, run.id, channel="user_input", minutes_ago=25)

    cleaned = await _cleanup_stale_runs_impl(db_session)

    await db_session.refresh(run)
    assert run.status == "failed"
    assert run.error_code == "SERVICE_RESTART_INTERRUPTED"
    assert cleaned >= 1


# ── 2026-10-13-review-risk-fixes FR-02：askwait 豁免 24h 时间上限 ────────────


@pytest.mark.asyncio
async def test_stale_run_awaiting_user_ask_over_24h_killed(db_session) -> None:
    """ask 超 24h 未答（askwait 上限）→ 不再豁免，照常判死。

    风险审查实证：豁免无时限 + run 级 daemon 真死兜底缺失（任务表清扫不碰
    AgentRun 且 daemon 离线时 fail-open）→ daemon 真死场景 run 永远 running、
    会话楔死。24h 上限给「人离开很久」留足裕量，超龄回落既有判死路径。
    """
    run = await _make_stale_session_and_run(db_session, num_turns=0, exit_code=None)
    # user_input 30h 前、ask 25h 前（ask 晚于 user_input 且超 24h 上限）。
    await _add_run_log(db_session, run.id, channel="user_input", minutes_ago=30 * 60)
    await _add_run_log(
        db_session, run.id, channel="tool_call", tool_kind="ask", minutes_ago=25 * 60
    )

    cleaned = await _cleanup_stale_runs_impl(db_session)

    await db_session.refresh(run)
    assert run.status == "failed"
    assert run.error_code == "SERVICE_RESTART_INTERRUPTED"
    assert cleaned >= 1


@pytest.mark.asyncio
async def test_stale_run_awaiting_user_ask_under_24h_cap_zero_regression(db_session) -> None:
    """ask 未超 24h 上限（23h）→ 豁免仍生效（时限内零回归）。"""
    run = await _make_stale_session_and_run(db_session, num_turns=0, exit_code=None)
    await _add_run_log(db_session, run.id, channel="user_input", minutes_ago=24 * 60)
    await _add_run_log(db_session, run.id, channel="pending_input", minutes_ago=23 * 60)

    cleaned = await _cleanup_stale_runs_impl(db_session)

    await db_session.refresh(run)
    assert run.status == "running"
    assert run.error_code is None
    assert cleaned == 0
