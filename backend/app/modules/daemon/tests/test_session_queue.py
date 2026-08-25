"""ql-20260825-011：会话排队消息（后端真实排队）。

核心行为：
- 忙轮 inject（queue_when_busy=True）→ 落 agent_session_queued_messages 排队
  （queued=True + queue_entry_id），不再 409；
- 默认 queue_when_busy=False 保持 DaemonSessionTurnConflict 既有拒绝语义
  （service 身份路径零回归）；
- pending 上限 SESSION_QUEUE_MAX_PENDING（5），满员 DaemonSessionQueueFull；
- run 终态后 dispatch_queued_messages 自动派发队头：成功即删行、新 AgentRun
  带 queued prompt；派发失败（daemon 离线）条目转 failed 留队；
- end_session → pending 条目全部转 failed；
- list / delete / retry 管理端点语义。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select

from app.modules.agent.model import (
    SESSION_QUEUE_MAX_PENDING,
    AgentRun,
    AgentSessionQueuedMessage,
)
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import (
    DaemonSessionQueueEntryNotFound,
    DaemonSessionQueueFull,
    DaemonSessionTurnConflict,
)


async def _create_user(session) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"q11-{uid}@example.com",
            password_hash="x",
            display_name="Q11",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(session, user_id: uuid.UUID):
    from app.modules.daemon.model import DaemonRuntime

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
    return rt


def _mock_hub(*, connected: bool = True) -> MagicMock:
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


async def _finish_run(db_session, run: AgentRun) -> None:
    run.status = "completed"
    run.finished_at = datetime.now(UTC)
    await db_session.commit()


async def _queue_rows(db_session, session_id: uuid.UUID) -> list[AgentSessionQueuedMessage]:
    return list(
        (
            await db_session.execute(
                select(AgentSessionQueuedMessage).where(
                    AgentSessionQueuedMessage.agent_session_id == session_id
                )
            )
        )
        .scalars()
        .all()
    )


async def _setup_busy_session(db_session):
    """建会话 → 完结首 turn → 开一个未完结的第二轮（忙态）。"""
    uid = await _create_user(db_session)
    await _create_runtime(db_session, uid)
    svc = DaemonService(db_session)
    created = await svc.create_session(uid, provider="claude", prompt="first")
    await _finish_run(db_session, created.agent_run)
    busy = await svc.inject_session(created.agent_session.id, uid, prompt="占用本轮")
    return svc, uid, created.agent_session.id, busy.agent_run


class TestEnqueueWhenBusy:
    @pytest.mark.asyncio
    async def test_busy_inject_queues_instead_of_409(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        svc, uid, session_id, _run = await _setup_busy_session(db_session)

        result = await svc.inject_session(session_id, uid, prompt="排队消息", queue_when_busy=True)

        assert result.queued is True
        assert result.queue_entry_id is not None
        assert result.agent_run is None
        rows = await _queue_rows(db_session, session_id)
        assert len(rows) == 1
        assert rows[0].prompt == "排队消息"
        assert rows[0].status == "pending"
        assert rows[0].sender_user_id == uid

    @pytest.mark.asyncio
    async def test_default_flag_keeps_conflict_semantics(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """queue_when_busy 缺省 False → 既有 DaemonSessionTurnConflict（零回归）。"""
        svc, uid, session_id, _run = await _setup_busy_session(db_session)

        with pytest.raises(DaemonSessionTurnConflict):
            await svc.inject_session(session_id, uid, prompt="旧语义应拒绝")

    @pytest.mark.asyncio
    async def test_queue_full_rejected(self, db_session, mocked_hub, mocked_redis) -> None:
        svc, uid, session_id, _run = await _setup_busy_session(db_session)

        for i in range(SESSION_QUEUE_MAX_PENDING):
            await svc.inject_session(session_id, uid, prompt=f"msg-{i}", queue_when_busy=True)

        with pytest.raises(DaemonSessionQueueFull):
            await svc.inject_session(session_id, uid, prompt="超出上限", queue_when_busy=True)


class TestDispatchOnTurnComplete:
    @pytest.mark.asyncio
    async def test_dispatch_head_after_run_completes(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        svc, uid, session_id, busy_run = await _setup_busy_session(db_session)
        await svc.inject_session(session_id, uid, prompt="排队消息A", queue_when_busy=True)
        await svc.inject_session(session_id, uid, prompt="排队消息B", queue_when_busy=True)

        await _finish_run(db_session, busy_run)
        await svc.dispatch_queued_messages(session_id)

        # 队头已派发成新 run（至多一个活跃轮，第二条仍在队列）。
        runs = list(
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == session_id)
                )
            )
            .scalars()
            .all()
        )
        queued_turn = [r for r in runs if r.id != busy_run.id and r.status == "pending"]
        assert len(queued_turn) == 1
        rows = await _queue_rows(db_session, session_id)
        assert [r.prompt for r in rows] == ["排队消息B"]

        # 再完结 → 第二条也派发，队列清空。
        await _finish_run(db_session, queued_turn[0])
        await svc.dispatch_queued_messages(session_id)
        assert await _queue_rows(db_session, session_id) == []

    @pytest.mark.asyncio
    async def test_dispatch_skips_when_still_busy(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        svc, uid, session_id, _busy = await _setup_busy_session(db_session)
        await svc.inject_session(session_id, uid, prompt="排队消息", queue_when_busy=True)

        # 忙态下触发派发（如并发终态事件）→ no-op，条目仍 pending。
        await svc.dispatch_queued_messages(session_id)
        rows = await _queue_rows(db_session, session_id)
        assert len(rows) == 1
        assert rows[0].status == "pending"

    @pytest.mark.asyncio
    async def test_dispatch_failure_marks_entry_failed(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        svc, uid, session_id, busy_run = await _setup_busy_session(db_session)
        await svc.inject_session(session_id, uid, prompt="排队消息", queue_when_busy=True)
        await _finish_run(db_session, busy_run)

        # daemon 掉线 → 派发失败 → 条目转 failed 留队。
        mocked_hub.send_session_control = AsyncMock(return_value=False)
        mocked_hub.is_connected = MagicMock(return_value=False)
        # notify_interactive_dispatch 走 placement，直接让它返回未投递。
        with patch(
            "app.modules.daemon.session.service.SessionService._converge_failed_dispatch",
            new=AsyncMock(),
        ):
            with patch(
                "app.modules.agent.placement.RunPlacementService.notify_interactive_dispatch",
                new=AsyncMock(return_value=False),
            ):
                await svc.dispatch_queued_messages(session_id)

        rows = await _queue_rows(db_session, session_id)
        assert len(rows) == 1
        assert rows[0].status == "failed"
        assert rows[0].error_msg


class TestEndSessionCleanup:
    @pytest.mark.asyncio
    async def test_end_session_fails_pending_entries(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        svc, uid, session_id, _busy = await _setup_busy_session(db_session)
        await svc.inject_session(session_id, uid, prompt="排队消息", queue_when_busy=True)

        await svc.end_session(session_id, uid)

        rows = await _queue_rows(db_session, session_id)
        assert len(rows) == 1
        assert rows[0].status == "failed"


class TestQueueManagement:
    @pytest.mark.asyncio
    async def test_list_delete_retry(self, db_session, mocked_hub, mocked_redis) -> None:
        svc, uid, session_id, _busy = await _setup_busy_session(db_session)
        entry = await svc.inject_session(session_id, uid, prompt="待删消息", queue_when_busy=True)
        assert entry.queued is True

        listed = await svc.list_queued_messages(session_id, uid)
        assert [r.prompt for r in listed] == ["待删消息"]

        await svc.delete_queued_message(session_id, entry.queue_entry_id, uid)
        assert await _queue_rows(db_session, session_id) == []

        with pytest.raises(DaemonSessionQueueEntryNotFound):
            await svc.delete_queued_message(session_id, entry.queue_entry_id, uid)

        # failed 条目 retry：先造 failed（end 会话收口），再翻 pending。
        await svc.inject_session(session_id, uid, prompt="会失败的", queue_when_busy=True)
        await svc.end_session(session_id, uid)
        rows = await _queue_rows(db_session, session_id)
        assert rows[0].status == "failed"

        _svc2 = DaemonService(db_session)
        # retry 在已结束会话上：翻回 pending 后派发自查会话非 active → 再转
        # failed（会话已结束的排队消息不可复生）。
        await _svc2.retry_queued_message(session_id, rows[0].id, uid)
        rows = await _queue_rows(db_session, session_id)
        assert rows[0].status == "failed"

    @pytest.mark.asyncio
    async def test_delete_wrong_session_404(self, db_session, mocked_hub, mocked_redis) -> None:
        svc, uid, session_id, _busy = await _setup_busy_session(db_session)
        entry = await svc.inject_session(session_id, uid, prompt="排队消息", queue_when_busy=True)

        # 不存在的会话 → 会话级 404（DaemonSessionNotFound 先于条目判定）。
        other = uuid.uuid4()
        from app.modules.daemon.session.service import DaemonSessionNotFound

        with pytest.raises(DaemonSessionNotFound):
            await svc.delete_queued_message(other, entry.queue_entry_id, uid)
