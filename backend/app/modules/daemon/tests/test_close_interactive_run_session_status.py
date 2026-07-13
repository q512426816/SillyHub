"""task-03 单测：close_interactive_run 接入 session 终态回写（D-001 / D-009 / D-005）。

钉死 :929 commit 之前对 AgentSession 的终态回写：
- 单轮任务（change_id 非空 或 spec_strategy 非 interactive+None）run completed
  → session.status='ended' + ended_at 非空
- 单轮任务 run failed → session.status='failed' + ended_at 非空
- 多轮对话（spec_strategy=='interactive' AND change_id is None）run completed
  → session 保持 active + last_active_at 刷新（ended_at 仍为 None）
- 幂等：session 已 ended/failed → 不被覆盖（D-005，由 _apply_session_terminal_status 守卫）

参照 test_interactive_lifecycle_patch.py 的 _seed_active_interactive_session + DaemonService
facade + mocked_redis 范式。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.service import DaemonService

# ── Fixtures ─────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"task03-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    return redis


@pytest.fixture()
def mocked_redis():
    redis = _mock_redis()
    # close_interactive_run 的 get_redis 从 run_sync.service 取；_publish_session_event
    # 从 session.service 取。patch 两处指向同一 mock（对齐 lifecycle_patch 范式）。
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


async def _seed_session_and_run(
    db_session: AsyncSession,
    *,
    spec_strategy: str | None = "interactive",
    change_id: uuid.UUID | None = None,
    run_status: str = "running",
    session_status: str = "active",
) -> tuple[uuid.UUID, uuid.UUID, str, uuid.UUID]:
    """构造 session + lease + run，返回 (lease_id, run_id, claim_token, session_id)。

    用 RunPlacementService.prepare_interactive_dispatch 建带 claim_token 的真实 lease，
    再补 session + run 行（最小集，create_session 会写更多但本测试不需要）。
    """
    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)
    placement = RunPlacementService(db_session)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=session_id,
        agent_run_id=run_id,
        user_id=uid,
        provider="claude",
        prompt="hi",
        model=None,
    )
    session = AgentSession(
        id=session_id,
        user_id=uid,
        provider="claude",
        status=session_status,
        config={},
        turn_count=1,
        runtime_id=rt.id,
        lease_id=dispatch.lease_id,
        last_active_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status=run_status,
        spec_strategy=spec_strategy,
        agent_session_id=session_id,
        change_id=change_id,
    )
    db_session.add_all([session, run])
    await db_session.commit()
    return dispatch.lease_id, run_id, dispatch.claim_token, session_id


# ── 单轮任务：completed → ended --------------------------------------------


@pytest.mark.asyncio
async def test_single_turn_completed_marks_session_ended(
    db_session: AsyncSession, mocked_redis
) -> None:
    """单轮任务（change_id 非空）run completed → session ended + ended_at。"""
    change_id = uuid.uuid4()
    lease_id, run_id, token, session_id = await _seed_session_and_run(
        db_session,
        spec_strategy="interactive",
        change_id=change_id,
    )
    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="success",
        is_error=False,
        subtype="success",
    )
    assert run.status == "completed"

    # 重读 session 规避 identity map 缓存
    refreshed = await db_session.get(AgentSession, session_id, populate_existing=True)
    assert refreshed is not None
    assert refreshed.status == "ended"
    assert refreshed.ended_at is not None


# ── 单轮任务：failed → failed ----------------------------------------------


@pytest.mark.asyncio
async def test_single_turn_failed_marks_session_failed(
    db_session: AsyncSession, mocked_redis
) -> None:
    """单轮任务（spec_strategy 非 interactive+None，如 quick-chat）run failed →
    session failed + ended_at。"""
    lease_id, run_id, token, session_id = await _seed_session_and_run(
        db_session,
        spec_strategy="quick-chat",
        change_id=None,
    )
    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="error_during_execution",
        is_error=True,
    )
    assert run.status == "failed"

    refreshed = await db_session.get(AgentSession, session_id, populate_existing=True)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert refreshed.ended_at is not None


# ── 多轮对话：completed → 保持 active + 刷 last_active_at -------------------


@pytest.mark.asyncio
async def test_multi_turn_completed_keeps_session_active(
    db_session: AsyncSession, mocked_redis
) -> None:
    """多轮对话（spec_strategy=='interactive' AND change_id is None）run completed
    → session 保持 active + last_active_at 刷新，ended_at 仍 None。"""
    lease_id, run_id, token, session_id = await _seed_session_and_run(
        db_session,
        spec_strategy="interactive",
        change_id=None,
    )
    old_last_active = datetime(2020, 1, 1, tzinfo=UTC)
    # 把 last_active_at 压到很早，便于断言刷新
    sess_row = await db_session.get(AgentSession, session_id)
    assert sess_row is not None
    sess_row.last_active_at = old_last_active
    await db_session.commit()

    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="success",
        is_error=False,
    )
    assert run.status == "completed"

    refreshed = await db_session.get(AgentSession, session_id, populate_existing=True)
    assert refreshed is not None
    assert refreshed.status == "active"
    assert refreshed.ended_at is None
    # last_active_at 已被刷新（晚于旧的 2020 值）。SQLite aiosqlite 存本地 naive，
    # 读回无 tzinfo，故取 naive 比较（记忆 backend-test-sqlite-vs-pg 坑）。
    assert refreshed.last_active_at is not None
    stored = (
        refreshed.last_active_at.replace(tzinfo=None)
        if refreshed.last_active_at.tzinfo
        else refreshed.last_active_at
    )
    assert stored > datetime(2020, 1, 1)


# ── 幂等：session 已 ended/failed 不覆盖 -----------------------------------


@pytest.mark.asyncio
async def test_session_already_ended_not_overwritten(
    db_session: AsyncSession, mocked_redis
) -> None:
    """session 已 ended → _apply_session_terminal_status 返 None，回写不覆盖
    既有 ended 终态（D-005）。"""
    ended_at = datetime(2020, 1, 1, tzinfo=UTC)
    lease_id, run_id, token, session_id = await _seed_session_and_run(
        db_session,
        spec_strategy="quick-chat",  # 单轮本应 ended
        change_id=None,
        session_status="ended",  # 但已被其它路径收口
    )
    # 写入 ended_at，验证不被覆盖
    sess_row = await db_session.get(AgentSession, session_id)
    assert sess_row is not None
    sess_row.ended_at = ended_at
    await db_session.commit()

    svc = DaemonService(db_session)
    await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="success",
        is_error=False,
    )

    refreshed = await db_session.get(AgentSession, session_id, populate_existing=True)
    assert refreshed is not None
    # 仍 ended，ended_at 不被新值覆盖（SQLite naive datetime 存储去 tzinfo，比对值相等即可）
    assert refreshed.status == "ended"
    assert refreshed.ended_at is not None
    # 取 naive 比较：SQLite aiosqlite 存本地 naive，tzinfo 会被丢，比较年月日时分秒
    stored = (
        refreshed.ended_at.replace(tzinfo=None) if refreshed.ended_at.tzinfo else refreshed.ended_at
    )
    expected = ended_at.replace(tzinfo=None)
    assert stored == expected
