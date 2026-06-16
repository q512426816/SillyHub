"""ql-20260616-006：kill_run 双路径测试。

直接调用 AgentService.kill_run（不经 HTTP，避免 SQLite :memory: 跨 session 不可见问题），
覆盖 quick-chat 等所有 spec_strategy 场景：

- pending lease（daemon 从未 claim）→ agent_run.status='killed' 立即
- claimed lease（daemon 在跑）→ agent_run.status 不动（等 daemon 心跳上报后收尾）
- 无 lease 但 agent_run 仍 pending/running → 立即 killed
- agent_run 已终态 → 幂等不动
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.agent.service import AgentService
from app.modules.daemon.lease_service import DaemonLeaseService
from app.modules.daemon.tests.test_lease_service import (
    _create_lease_row,
    _create_runtime,
    _create_user,
)


async def _seed_runtime(session: AsyncSession):
    user_id = await _create_user(session)
    rt = await _create_runtime(session, user_id)
    return rt


@pytest.mark.asyncio
async def test_kill_run_with_pending_lease_marks_killed(db_session: AsyncSession) -> None:
    """pending lease + pending agent_run → kill_run → status='killed' 立即。"""
    rt = await _seed_runtime(db_session)
    run_id = uuid.uuid4()
    db_session.add(
        AgentRun(id=run_id, agent_type="claude_code", status="pending", spec_strategy="quick-chat")
    )
    await db_session.commit()
    await _create_lease_row(db_session, rt.id, run_id, status="pending")

    svc = AgentService(db_session)
    await svc.kill_run(run_id)

    ar = await db_session.get(AgentRun, run_id)
    assert ar is not None
    assert ar.status == "killed"
    assert ar.finished_at is not None


@pytest.mark.asyncio
async def test_kill_run_with_claimed_lease_defers(db_session: AsyncSession) -> None:
    """claimed lease + running agent_run → kill_run → status 不动（等 daemon 上报）。"""
    rt = await _seed_runtime(db_session)
    run_id = uuid.uuid4()
    db_session.add(
        AgentRun(id=run_id, agent_type="claude_code", status="running", spec_strategy="quick-chat")
    )
    await db_session.commit()

    lease_svc = DaemonLeaseService(db_session)
    await lease_svc.claim_task(rt.id, run_id)

    svc = AgentService(db_session)
    await svc.kill_run(run_id)

    ar = await db_session.get(AgentRun, run_id)
    assert ar is not None
    assert ar.status == "running"  # daemon-side 心跳上报后才会变 killed
    assert ar.finished_at is None


@pytest.mark.asyncio
async def test_kill_run_without_lease_marks_killed(db_session: AsyncSession) -> None:
    """无 lease + pending agent_run → kill_run → 立即 killed（兜底路径）。"""
    run_id = uuid.uuid4()
    db_session.add(
        AgentRun(id=run_id, agent_type="claude_code", status="pending", spec_strategy="quick-chat")
    )
    await db_session.commit()

    svc = AgentService(db_session)
    await svc.kill_run(run_id)

    ar = await db_session.get(AgentRun, run_id)
    assert ar is not None
    assert ar.status == "killed"
    assert ar.finished_at is not None


@pytest.mark.asyncio
async def test_kill_run_idempotent_on_terminal(db_session: AsyncSession) -> None:
    """agent_run 已 completed → kill_run 不动它。"""
    run_id = uuid.uuid4()
    db_session.add(
        AgentRun(
            id=run_id,
            agent_type="claude_code",
            status="completed",
            spec_strategy="quick-chat",
        )
    )
    await db_session.commit()

    svc = AgentService(db_session)
    await svc.kill_run(run_id)  # should not raise

    ar = await db_session.get(AgentRun, run_id)
    assert ar is not None
    assert ar.status == "completed"


@pytest.mark.asyncio
async def test_kill_run_pending_leases_with_quick_chat_strategy(db_session: AsyncSession) -> None:
    """spec_strategy='quick-chat' 的 pending lease 也走相同路径（验证不挑类型）。"""
    rt = await _seed_runtime(db_session)
    run_id = uuid.uuid4()
    db_session.add(
        AgentRun(
            id=run_id,
            agent_type="claude_code",
            status="pending",
            spec_strategy="quick-chat",
        )
    )
    await db_session.commit()
    await _create_lease_row(db_session, rt.id, run_id, status="pending")

    svc = AgentService(db_session)
    await svc.kill_run(run_id)

    ar = await db_session.get(AgentRun, run_id)
    assert ar is not None
    assert ar.status == "killed"


@pytest.mark.asyncio
async def test_kill_run_not_found_raises(db_session: AsyncSession) -> None:
    """kill_run 不存在的 run_id → AgentRunNotFound。"""
    from app.core.errors import AgentRunNotFound

    svc = AgentService(db_session)
    with pytest.raises(AgentRunNotFound):
        await svc.kill_run(uuid.uuid4())
