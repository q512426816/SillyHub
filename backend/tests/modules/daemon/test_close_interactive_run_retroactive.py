"""2026-10-08-backend-restart-fake-failed / FR-02：误杀轮迟到成功结果回正。

线上实证（会话 968e58be）：启动清理把仍在 daemon 上执行的轮误标 failed +
SERVICE_RESTART_INTERRUPTED 后，daemon 跑完 POST 成功结果被
``close_interactive_run`` 终态守卫（interactive_run_close_already_terminal）
no-op 拒收，UI 永远假失败。

本文件验证终态守卫的唯一例外（design §做法概述防线二）：
- failed + SERVICE_RESTART_INTERRUPTED + 迟到成功 → 清误杀残留后走正常收口，
  回正 completed（终态事件重发，usage/summary 落库）；
- 其余终态（completed、failed+interactive_failed）重复上报 → 维持 no-op 拒收，
  不重复触发收口钩子（幂等回归保护）。

fixture 模式参考 ``backend/tests/modules/daemon/lease/test_complete_lease_stage_writeback.py``
（real-DB + facade mock 隔离跨子域回调）。
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.run_sync.service.close_run_steps import close_interactive_run

_CLAIM_TOKEN = "test-claim-token"


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        id=uuid.uuid4(),
        email=f"retro-{uuid.uuid4().hex[:6]}@example.com",
        password_hash="x",
        display_name="retro-test",
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    return user.id


async def _create_runtime(db_session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    runtime = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="retro-test-runtime",
        provider="claude",
        status="online",
    )
    db_session.add(runtime)
    await db_session.commit()
    return runtime


async def _create_session_and_lease(
    db_session: AsyncSession, runtime: DaemonRuntime
) -> tuple[uuid.UUID, DaemonTaskLease]:
    """多轮 interactive 会话 + 绑定该会话的 claimed lease（kind=interactive）。"""
    session = AgentSession(
        id=uuid.uuid4(),
        user_id=runtime.user_id,
        runtime_id=runtime.id,
        provider="claude",
        status="active",
        origin="chat",
    )
    db_session.add(session)
    await db_session.commit()

    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime.id,
        kind="interactive",
        status="claimed",
        metadata_={
            "claim_token": _CLAIM_TOKEN,
            "session_id": str(session.id),
        },
    )
    db_session.add(lease)
    await db_session.commit()
    return session.id, lease


def _make_svc(db_session: AsyncSession, session_id: uuid.UUID) -> MagicMock:
    """最小 svc 面：lease 鉴权放行 + 跨子域回调（gate/群钩子/事件发布）隔离。

    lease 鉴权 mock 返回轻量 stub（close 路径只读 metadata_）——no-op 分支的
    rollback 会过期 session 里全部 ORM 实例，mock 若持有 ORM lease 行，第二次
    调用读 metadata_ 会触发同步惰性加载（MissingGreenlet）。
    """
    lease_stub = SimpleNamespace(
        metadata_={"claim_token": _CLAIM_TOKEN, "session_id": str(session_id)}
    )
    svc = MagicMock()
    svc._session = db_session
    svc._facade._get_lease_and_verify_token = AsyncMock(return_value=lease_stub)
    svc._facade._publish_session_event = AsyncMock(return_value=None)
    svc._gate_applicable = AsyncMock(return_value=False)
    svc._is_gate_rejected_first_failure = AsyncMock(return_value=False)
    svc._fire_background_task = MagicMock()
    return svc


async def _make_run(
    db_session: AsyncSession,
    *,
    agent_session_id: uuid.UUID,
    status: str,
    error_code: str | None,
) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        model="claude-sonnet-4",
        status=status,
        spec_strategy="interactive",
        agent_session_id=agent_session_id,
        change_id=None,
        error_code=error_code,
        exit_code=-1 if status == "failed" else 0,
        output_redacted="Run interrupted: service restarted while agent was running."
        if status == "failed"
        else None,
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)
    return run


@pytest.mark.asyncio
async def test_late_success_result_rehabilates_service_restart_interrupted_run(
    db_session: AsyncSession,
) -> None:
    """误杀轮（failed+SERVICE_RESTART_INTERRUPTED）收到迟到成功结果 → 回正 completed。"""
    user_id = await _create_user(db_session)
    runtime = await _create_runtime(db_session, user_id)
    session_id, lease = await _create_session_and_lease(db_session, runtime)
    run = await _make_run(
        db_session,
        agent_session_id=session_id,
        status="failed",
        error_code="SERVICE_RESTART_INTERRUPTED",
    )
    svc = _make_svc(db_session, session_id)

    result = await close_interactive_run(
        svc,
        lease_id=lease.id,
        run_id=run.id,
        claim_token=_CLAIM_TOKEN,
        status="success",
        is_error=False,
        input_tokens=132772,
        output_tokens=38259,
        result_summary="修复完成：轮次导航指向标记已实现并通过测试",
    )

    assert result.status == "completed"
    assert result.exit_code == 0
    # 误杀残留全部清除
    assert result.error_code is None
    assert result.error_detail is None
    assert "Run interrupted" not in (result.output_redacted or "")
    # 迟到结果携带的 usage / 摘要正常落库
    assert result.input_tokens == 132772
    assert result.output_tokens == 38259
    assert result.finished_at is not None
    assert "轮次导航" in (result.output_redacted or "")
    # 终态事件重发（前端轮徽标从失败收敛为完成）
    svc._facade._publish_session_event.assert_awaited()

    refreshed = await db_session.get(AgentRun, run.id)
    assert refreshed is not None
    assert refreshed.status == "completed"
    assert refreshed.error_code is None


@pytest.mark.asyncio
async def test_other_terminal_results_stay_noop(db_session: AsyncSession) -> None:
    """非误杀终态（completed / failed+interactive_failed）重复上报 → 维持拒收。"""
    user_id = await _create_user(db_session)
    runtime = await _create_runtime(db_session, user_id)
    session_id, lease = await _create_session_and_lease(db_session, runtime)

    completed_run = await _make_run(
        db_session,
        agent_session_id=session_id,
        status="completed",
        error_code=None,
    )
    genuinely_failed_run = await _make_run(
        db_session,
        agent_session_id=session_id,
        status="failed",
        error_code="interactive_failed",
    )
    svc = _make_svc(db_session, session_id)

    # no-op 分支的 rollback 会过期 session 里全部 ORM 实例，循环内再取
    # lease.id / run.id 会触发同步惰性加载（MissingGreenlet）——标量先提。
    lease_id = lease.id
    cases = [
        (
            completed_run.id,
            completed_run.status,
            completed_run.error_code,
            completed_run.output_redacted,
        ),
        (
            genuinely_failed_run.id,
            genuinely_failed_run.status,
            genuinely_failed_run.error_code,
            genuinely_failed_run.output_redacted,
        ),
    ]
    for run_id, expected_status, expected_error_code, summary_before in cases:
        result = await close_interactive_run(
            svc,
            lease_id=lease_id,
            run_id=run_id,
            claim_token=_CLAIM_TOKEN,
            status="success",
            is_error=False,
            input_tokens=1,
            output_tokens=1,
            result_summary="duplicate retry payload",
        )
        # no-op：终态与既有字段原样保留，不被重复上报改写
        assert result.status == expected_status
        assert result.error_code == expected_error_code
        assert result.input_tokens != 1
        assert result.output_redacted == summary_before

    # no-op 路径不发任何会话事件（不重复触发前端收敛）
    svc._facade._publish_session_event.assert_not_awaited()
