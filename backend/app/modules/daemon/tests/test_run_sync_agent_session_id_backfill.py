"""task-01 / DS-1（变更 2026-08-21-session-reopen-resume）：submit_messages 增量回填
AgentSession.agent_session_id（SDK resume key，最新值覆盖）。

背景：reopen（POST /sessions/{id}/reopen）硬依赖 ``agent_sessions.agent_session_id``
（空则 409），但全仓库无生产代码写入该列。daemon 每轮上报的 SDK 会话 id 经消息顶层
``session_id`` 流入（claude SDK 每条消息顶层 / codex toFlatMessage 注入 thread id），
本 task 在 submit_messages 消息落库时把它最新值覆盖写入会话行，与消息走同一 commit。

语义对照（design §4 DS-1 / D-001@v1）：
  - AgentRun.session_id：仅空时写（既有，本 task 不得回归）；
  - AgentSession.agent_session_id：**最新值覆盖**（fork/reload 换新 id 后旧 key
    resume 会回到分叉前历史，语义错误，故不做仅空时写）。

用例四组（卡 task-01）：交互 run 首条消息回填（含同事务断言）、fork 换新 id 覆盖、
batch run（会话 FK None）不触碰 agent_sessions 表、AgentRun.session_id 仅空时写不
回归 + 会话行缺失（理论不应发生）静默跳过。

参照 test_submit_messages_no_overwrite_terminal._seed_pending_interactive_session 范式。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService

# ── Fixtures（对齐 test_submit_messages_no_overwrite_terminal） ────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"bf-{uid}@example.com",
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


async def _seed_interactive_run(
    db_session: AsyncSession,
    *,
    session_agent_session_id: str | None = None,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, str]:
    """建 interactive session + lease + pending run（会话 FK 非空）。

    ``session_agent_session_id``：会话行 agent_session_id 的初始值（None = 全新
    会话；非 None = 模拟 fork 前已有旧 key / 已回填过）。
    返回 (agent_session_id, lease_id, run_id, claim_token)。
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
        status="active",
        config={},
        turn_count=1,
        runtime_id=rt.id,
        lease_id=dispatch.lease_id,
        agent_session_id=session_agent_session_id,
        last_active_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status="pending",
        spec_strategy="interactive",
        agent_session_id=session_id,
    )
    db_session.add_all([session, run])
    await db_session.commit()
    return session_id, dispatch.lease_id, run_id, dispatch.claim_token


async def _seed_batch_run(
    db_session: AsyncSession,
) -> tuple[uuid.UUID, uuid.UUID, str, uuid.UUID]:
    """建 batch lease + pending run（agent_session_id 会话 FK 为 None）+ 诱饵会话行。

    返回 (lease_id, run_id, claim_token, decoy_agent_session_id)。诱饵行是库里
    唯一的 agent_sessions 行 —— batch run 上报的 SDK session_id 绝不能写进去。
    """
    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)
    run_id = uuid.uuid4()
    lease_id = uuid.uuid4()
    token = "batch-claim-token"
    lease = DaemonTaskLease(
        id=lease_id,
        runtime_id=rt.id,
        agent_run_id=run_id,
        kind="batch",
        status="claimed",
        claimed_at=datetime.now(UTC),
        metadata_={"claim_token": token, "run_id": str(run_id)},
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status="pending",
        spec_strategy="scan",
        agent_session_id=None,  # batch run：会话 FK 为 None
    )
    decoy = AgentSession(
        id=uuid.uuid4(),
        user_id=uid,
        provider="claude",
        status="ended",
        config={},
        turn_count=0,
        runtime_id=rt.id,
        agent_session_id=None,
        created_at=datetime.now(UTC),
    )
    db_session.add_all([lease, run, decoy])
    await db_session.commit()
    return lease_id, run_id, token, decoy.id


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    # submit_messages 已迁 RunSyncService；session/lease 路径仍走 facade，一并 patch。
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


# ── Tests ────────────────────────────────────────────────────────────────────


class TestAgentSessionIdBackfill:
    @pytest.mark.asyncio
    async def test_first_message_backfills_same_commit(
        self, db_session: AsyncSession, db_engine, mocked_redis
    ) -> None:
        """交互 run 首条带顶层 session_id 的消息 → AgentSession.agent_session_id 回填。

        同事务断言：submit_messages 返回后（测试侧不再 commit），用独立连接即可
        同时看到已 commit 的 AgentRunLog 行与回填后的会话行 —— 回填与消息落库走
        同一 commit（design DS-1「事务」条款）。
        """
        session_id, lease_id, run_id, token = await _seed_interactive_run(db_session)

        svc = DaemonService(db_session)
        result = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [{"event_type": "assistant", "content": "hello", "session_id": "sdk-sess-alpha"}],
        )
        assert result == 1  # 1 条消息落库

        # 独立连接（不经 db_session 事务上下文）读已 commit 状态。
        other_factory = async_sessionmaker(
            bind=db_engine, class_=AsyncSession, expire_on_commit=False
        )
        async with other_factory() as other:
            row = await other.get(AgentSession, session_id)
            assert row is not None
            assert row.agent_session_id == "sdk-sess-alpha"
            logs = (
                (await other.execute(select(AgentRunLog).where(AgentRunLog.run_id == run_id)))
                .scalars()
                .all()
            )
            assert len(logs) == 1

    @pytest.mark.asyncio
    async def test_fork_new_session_id_overwrites(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """fork/reload 换新 id 再上报 → 覆盖为新值（最新值覆盖，非仅空时写）。

        旧 key 已存在（含既有非空值）也必须被覆盖：旧 key resume 会回到分叉前
        历史，语义错误（design DS-1 / task 卡 acceptance 2）。
        """
        # 初始给一个"fork 前"旧 key，模拟已有值也被覆盖。
        session_id, lease_id, run_id, token = await _seed_interactive_run(
            db_session, session_agent_session_id="sdk-sess-old-fork"
        )
        svc = DaemonService(db_session)

        # 第 1 轮上报：旧 id（应把旧值原样确认 / 覆盖语义下不变）。
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [{"event_type": "assistant", "content": "turn1", "session_id": "sdk-sess-old-fork"}],
        )
        db_session.expire_all()
        row = await db_session.get(AgentSession, session_id)
        assert row is not None
        assert row.agent_session_id == "sdk-sess-old-fork"

        # 第 2 轮上报：fork 后的新 id → 覆盖为新值。
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [{"event_type": "assistant", "content": "turn2", "session_id": "sdk-sess-new-fork"}],
        )
        db_session.expire_all()
        row = await db_session.get(AgentSession, session_id)
        assert row is not None
        assert row.agent_session_id == "sdk-sess-new-fork", (
            "fork 换新 id 后必须最新值覆盖（旧 key resume 会回到分叉前历史）"
        )

    @pytest.mark.asyncio
    async def test_batch_run_fk_none_no_touch_sessions_table(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """batch run（agent_session_id FK None）消息上报后 agent_sessions 表无任何变化。

        诱饵行保持 agent_session_id=None，且全表查不到上报的 SDK id；同时
        AgentRun.session_id 照常填充 —— 证明消息确被处理、跳过只发生在会话回填。
        """
        lease_id, run_id, token, decoy_session_id = await _seed_batch_run(db_session)

        svc = DaemonService(db_session)
        result = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [{"event_type": "assistant", "content": "scan output", "session_id": "batch-sdk-sess"}],
        )
        assert result == 1

        db_session.expire_all()
        # run.session_id 照常填充（batch 路径既有行为不回归）。
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.session_id == "batch-sdk-sess"
        # 诱饵会话行未被触碰。
        decoy = await db_session.get(AgentSession, decoy_session_id)
        assert decoy is not None
        assert decoy.agent_session_id is None
        # 全表无任何行持有上报的 SDK id。
        holders = (
            (
                await db_session.execute(
                    select(AgentSession).where(AgentSession.agent_session_id == "batch-sdk-sess")
                )
            )
            .scalars()
            .all()
        )
        assert holders == []

    @pytest.mark.asyncio
    async def test_agent_run_session_id_write_if_empty_not_regressed(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """D-001@v1 回归：AgentRun.session_id 仅空时写；同轮会话列却要覆盖。

        run.session_id 已有值时上报新 id：run 列不动、会话列覆盖 —— 两列语义
        差异正是本 task 的设计点。
        """
        session_id, lease_id, run_id, token = await _seed_interactive_run(db_session)
        # 预置 run.session_id（模拟首轮已写入，后续轮次不得覆盖）。
        db_session.expire_all()
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        run.session_id = "run-first-id"
        await db_session.commit()

        svc = DaemonService(db_session)
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [{"event_type": "assistant", "content": "later turn", "session_id": "sdk-newer-id"}],
        )

        db_session.expire_all()
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.session_id == "run-first-id", (
            "AgentRun.session_id 仅空时写语义不得回归（D-001@v1）"
        )
        session_row = await db_session.get(AgentSession, session_id)
        assert session_row is not None
        assert session_row.agent_session_id == "sdk-newer-id"

    @pytest.mark.asyncio
    async def test_missing_session_row_skipped_silently(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """会话 FK 指向不存在的行（理论不应发生）→ 静默跳过，消息照常落库不抛错。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        run_id = uuid.uuid4()
        lease_id = uuid.uuid4()
        token = "ghost-token"
        lease = DaemonTaskLease(
            id=lease_id,
            runtime_id=rt.id,
            agent_run_id=run_id,
            kind="interactive",
            status="claimed",
            claimed_at=datetime.now(UTC),
            metadata_={"claim_token": token, "run_id": str(run_id)},
        )
        # 悬空 FK：SQLite 测试库不强制外键，行可插入；get(AgentSession) 返回 None。
        ghost_session_fk = uuid.uuid4()
        run = AgentRun(
            id=run_id,
            agent_type="claude_code",
            provider="claude",
            status="pending",
            spec_strategy="interactive",
            agent_session_id=ghost_session_fk,
        )
        db_session.add_all([lease, run])
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [{"event_type": "assistant", "content": "ghost", "session_id": "sdk-ghost"}],
        )
        assert result == 1  # 消息照常落库

        db_session.expire_all()
        logs = (
            (await db_session.execute(select(AgentRunLog).where(AgentRunLog.run_id == run_id)))
            .scalars()
            .all()
        )
        assert len(logs) == 1
