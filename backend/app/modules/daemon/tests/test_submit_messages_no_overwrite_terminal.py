"""ql-20260805-002: submit_messages 不得覆盖已终态的 AgentRun (lost update 修复)。

竞态：interactive session 多轮 + daemon 消息乱序/重试时，submit_messages 与
close_interactive_run 并发。close 把 run 置 completed 并 commit 后，一个迟到
的 submit_messages 协程若仍持有旧快照（status=pending），旧代码直接 ORM 内存
写 status=running 会覆盖 completed 终态 → run 卡 running，前端一直显示
「等待本轮完成」。

修复（run_sync/service.py submit_messages 内 pending→running 分支）：改成原子
条件 UPDATE（WHERE status='pending'），rowcount=0 即 DB 已被别处推进到终态，
跳过激活，不覆盖。

参照 test_interactive_lifecycle_patch._seed_active_interactive_session 范式。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.service import DaemonService

# ── Fixtures（对齐 test_interactive_lifecycle_patch） ────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"lost-{uid}@example.com",
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


async def _seed_pending_interactive_run(
    db_session: AsyncSession,
) -> tuple[uuid.UUID, uuid.UUID, str]:
    """建 pending 的 interactive session + lease + run，返回 (lease_id, run_id, claim_token)。"""
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
    return dispatch.lease_id, run_id, dispatch.claim_token


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


class TestSubmitMessagesLostUpdate:
    @pytest.mark.asyncio
    async def test_late_submit_does_not_overwrite_completed_run(
        self, db_session: AsyncSession, db_engine, mocked_redis
    ) -> None:
        """close 已 commit completed 后，迟到 submit（旧快照 pending）不得改回 running。"""
        lease_id, run_id, token = await _seed_pending_interactive_run(db_session)

        # 预热 db_session identity map：拿到 status=pending 的旧快照（模拟迟到的
        # 协程在 close 之前已读取 run，尚未 expire）。
        stale = await db_session.get(AgentRun, run_id)
        assert stale is not None and stale.status == "pending"

        # 另一个 session 模拟 close_interactive_run 把 run 置 completed 并 commit。
        other_factory = async_sessionmaker(
            bind=db_engine, class_=AsyncSession, expire_on_commit=False
        )
        async with other_factory() as other:
            await other.execute(
                update(AgentRun)
                .where(AgentRun.id == run_id)
                .values(status="completed", finished_at=datetime.now(UTC))
            )
            await other.commit()

        # db_session 仍持有 pending 旧快照（identity map 缓存，未 expire），模拟
        # 迟到的 submit 协程。修复前：ORM 内存写 running 会覆盖 DB 的 completed。
        svc = DaemonService(db_session)
        await svc.submit_messages(
            lease_id, token, run_id, [{"event_type": "assistant", "content": "done"}]
        )

        # 验证：DB 里 run 仍是 completed，未被迟到 submit 覆盖成 running。
        db_session.expire_all()
        fresh = await db_session.get(AgentRun, run_id)
        assert fresh is not None
        assert fresh.status == "completed", (
            f"迟到的 submit 覆盖了 close 的 completed 终态 → {fresh.status}"
        )

    @pytest.mark.asyncio
    async def test_fresh_submit_promotes_pending_to_running(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """回归：正常路径（无并发）pending run 首条消息仍应推进到 running。"""
        lease_id, run_id, token = await _seed_pending_interactive_run(db_session)

        svc = DaemonService(db_session)
        await svc.submit_messages(
            lease_id, token, run_id, [{"event_type": "assistant", "content": "go"}]
        )

        db_session.expire_all()
        fresh = await db_session.get(AgentRun, run_id)
        assert fresh is not None
        assert fresh.status == "running"
        assert fresh.started_at is not None


class TestActivationListSignal:
    """2026-10-20-session-status-live-sync：run 激活经 PublishIntent.list_signal
    补发列表信号（左侧徽标秒级亮「正在执行」）。

    - 激活成功（rowcount>0）→ intent.list_signal=(session_id, 会话属主)；
    - 迟到 submit（rowcount=0，run 已终态）→ list_signal=None 零发布；
    - publish_submitted_messages 消费 list_signal → publish_sessions_changed
      ("status_changed")，None 时零调用。
    """

    @staticmethod
    async def _session_owner(
        db_session: AsyncSession, run_id: uuid.UUID
    ) -> tuple[uuid.UUID, uuid.UUID]:
        run = await db_session.get(AgentRun, run_id)
        assert run is not None and run.agent_session_id is not None
        sess = await db_session.get(AgentSession, run.agent_session_id)
        assert sess is not None
        return sess.id, sess.user_id

    @pytest.mark.asyncio
    async def test_activated_submit_carries_list_signal(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """正常激活：publish_intent.list_signal=(session_id, 会话属主)。"""
        lease_id, run_id, token = await _seed_pending_interactive_run(db_session)

        svc = DaemonService(db_session)
        result = await svc.submit_messages(
            lease_id, token, run_id, [{"event_type": "assistant", "content": "go"}]
        )

        sess_id, owner = await self._session_owner(db_session, run_id)
        assert result.publish_intent is not None
        assert result.publish_intent.list_signal == (sess_id, owner)

    @pytest.mark.asyncio
    async def test_late_submit_no_list_signal(
        self, db_session: AsyncSession, db_engine, mocked_redis
    ) -> None:
        """迟到 submit（rowcount=0，run 已被 close 收口终态）：list_signal=None。"""
        lease_id, run_id, token = await _seed_pending_interactive_run(db_session)
        stale = await db_session.get(AgentRun, run_id)
        assert stale is not None and stale.status == "pending"
        other_factory = async_sessionmaker(
            bind=db_engine, class_=AsyncSession, expire_on_commit=False
        )
        async with other_factory() as other:
            await other.execute(
                update(AgentRun)
                .where(AgentRun.id == run_id)
                .values(status="completed", finished_at=datetime.now(UTC))
            )
            await other.commit()

        svc = DaemonService(db_session)
        result = await svc.submit_messages(
            lease_id, token, run_id, [{"event_type": "assistant", "content": "late"}]
        )

        assert result.publish_intent is not None
        assert result.publish_intent.list_signal is None

    @pytest.mark.asyncio
    async def test_publish_consumes_signal_and_none_noop(self, mocked_redis, monkeypatch) -> None:
        """纯消费段：构造 PublishIntent 直接验证 publish 调用面（不依赖 DB）。"""
        from app.modules.daemon.run_sync.service.publish import (
            PublishIntent,
            publish_submitted_messages,
        )

        calls: list[tuple[str, uuid.UUID, object]] = []

        async def spy_publish(event, sid, uid, **kwargs):
            calls.append((event, sid, uid))

        monkeypatch.setattr(
            "app.modules.daemon.run_sync.service.publish.publish_sessions_changed",
            spy_publish,
        )

        def _intent(list_signal):
            return PublishIntent(
                agent_run_id=uuid.uuid4(),
                lease_id=uuid.uuid4(),
                count=0,
                published_logs=[],
                agent_run_status="running",
                input_tokens=None,
                output_tokens=None,
                cache_read_tokens=None,
                cache_creation_tokens=None,
                ctx_tokens=None,
                duration_api_ms=None,
                agent_session_id=uuid.uuid4(),
                timestamp_iso="2026-10-20T00:00:00Z",
                list_signal=list_signal,
            )

        sid, uid = uuid.uuid4(), uuid.uuid4()
        await publish_submitted_messages(_intent((sid, uid)))
        assert calls == [("status_changed", sid, uid)]

        calls.clear()
        await publish_submitted_messages(_intent(None))
        assert calls == []
