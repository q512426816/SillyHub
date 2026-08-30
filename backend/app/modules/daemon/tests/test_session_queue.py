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
    # 2026-08-31-session-queue-ux task-05：读取序对齐新派发序键 (position,
    # created_at)（FR-04/D-002）——position 全 0 时退化为 created_at 序，
    # 既有断言不变。
    return list(
        (
            await db_session.execute(
                select(AgentSessionQueuedMessage)
                .where(AgentSessionQueuedMessage.agent_session_id == session_id)
                .order_by(
                    AgentSessionQueuedMessage.position,
                    AgentSessionQueuedMessage.created_at,
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
    async def test_busy_queue_inject_still_binds(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """task-07（2026-08-26-session-input-mention / FR-06）：忙轮排队路径仍完成绑定。

        binder 插入点在排队早退之前（design §4.2）——queue_when_busy 入队返回前
        link 行已落库（前端 running 态 sendToServerQueue 恰走本路径，绑定静默
        丢失即 R-10，此用例守护防回归）。
        """
        from app.modules.change.model import Change, ChangeSessionLink, QuicklogSessionLink
        from app.modules.workspace.model import Workspace

        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        ws = Workspace(
            id=uuid.uuid4(),
            name="queue-bind-ws",
            slug=f"queue-bind-{uuid.uuid4().hex[:6]}",
            root_path="/tmp/queue-bind",
            created_by=uid,
        )
        db_session.add(ws)
        await db_session.commit()
        await db_session.refresh(ws)

        with patch(
            "app.modules.daemon.session.service.allowed_workspace_ids",
            new_callable=AsyncMock,
            return_value={ws.id},
        ):
            svc = DaemonService(db_session)
            created = await svc.create_session(
                uid, provider="claude", prompt="first", workspace_id=ws.id
            )
        await _finish_run(db_session, created.agent_run)
        await svc.inject_session(created.agent_session.id, uid, prompt="占用本轮")
        session_id = created.agent_session.id

        result = await svc.inject_session(
            session_id,
            uid,
            prompt="排队的绑定消息",
            queue_when_busy=True,
            bind_change_key="2026-08-27-queue-bind",
            bind_quick_id="ql-20260827-020-queue",
        )

        # 入队语义不变
        assert result.queued is True
        assert result.queue_entry_id is not None
        rows = await _queue_rows(db_session, session_id)
        assert [r.prompt for r in rows] == ["排队的绑定消息"]

        # 绑定在入队早退前已完成：placeholder + 两类 link 行真实落库
        change = (
            (
                await db_session.execute(
                    select(Change).where(
                        Change.workspace_id == ws.id,
                        Change.change_key == "2026-08-27-queue-bind",
                    )
                )
            )
            .scalars()
            .one()
        )
        assert change is not None
        c_link = (
            (
                await db_session.execute(
                    select(ChangeSessionLink).where(
                        ChangeSessionLink.change_id == change.id,
                        ChangeSessionLink.session_id == session_id,
                    )
                )
            )
            .scalars()
            .one()
        )
        assert c_link is not None
        q_link = (
            (
                await db_session.execute(
                    select(QuicklogSessionLink).where(
                        QuicklogSessionLink.workspace_id == ws.id,
                        QuicklogSessionLink.ql_id == "ql-20260827-020-queue",
                        QuicklogSessionLink.session_id == session_id,
                    )
                )
            )
            .scalars()
            .one()
        )
        assert q_link is not None

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
        """daemon 掉线 → 派发失败 → 条目转 failed 留队。

        2026-08-31-session-queue-ux task-05 循环化语义确认：队列仅 1 条、连续
        失败计数 1 < 2 → 循环取不到下一条 pending 自然结束，failed 留队断言
        与循环化前逐字节一致（多条连续失败上限语义在新文件
        test_session_queue_actions.py::TestDispatchLoop 锁定）。
        """
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


def _wakeup_prompt(task_name: str, task_id: str) -> str:
    """构造 daemon _scheduleTaskWakeup 同款通知 prompt（单生产者模板对齐）。"""
    return (
        "[后台任务通知] 以下 1 个后台子代理任务已全部结束"
        "（列表中的每一个都已终止，没有仍在运行的任务）：\n"
        f"- 任务「{task_name}」已完成（用时 00:01）（task_id: {task_id}，"
        "如需完整输出可调用 TaskOutput 查询，block=false）\n"
        "请逐条核对上述每个任务（共 1 个）的名称与结果，一次性向用户完整汇报"
        "（综合归纳，不要逐字照抄，不要遗漏任何一个任务）；"
        "禁止声称仍在等待任何任务；汇报完即结束本轮；不要重复执行这些任务；"
        "此消息为系统通知，无需向用户复述本通知本身。"
    )


class TestTaskWakeupMerge:
    """ql-20260827-015：忙轮期间多条「[后台任务通知]」合并为一条排队。

    生产实证（会话 17f10040）：长轮未结期间每个后台任务终态注入一条通知排队，
    计数只增不减、派发后逐条烧一轮模型汇报。合并后通知类排队恒 ≤1 条。
    """

    @pytest.mark.asyncio
    async def test_notifications_merge_into_single_entry(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        svc, uid, session_id, _run = await _setup_busy_session(db_session)

        first = await svc.inject_session(
            session_id, uid, prompt=_wakeup_prompt("查依赖", "t-1"), queue_when_busy=True
        )
        second = await svc.inject_session(
            session_id, uid, prompt=_wakeup_prompt("生成类文件", "t-2"), queue_when_busy=True
        )

        # 仍只有 1 行；两次返回同一 entry id（daemon 调用方无感）。
        rows = await _queue_rows(db_session, session_id)
        assert len(rows) == 1
        assert second.queued is True
        assert second.queue_entry_id == first.queue_entry_id

        merged = rows[0].prompt or ""
        # 两个任务行都在，头/尾计数改写为 2。
        assert "任务「查依赖」" in merged
        assert "任务「生成类文件」" in merged
        assert "以下 2 个后台子代理任务已全部结束" in merged
        assert "（共 2 个）" in merged
        assert "以下 1 个" not in merged
        # 汇报指令尾行保留（只出现一次）。
        assert merged.count("请逐条核对上述每个任务") == 1

    @pytest.mark.asyncio
    async def test_normal_messages_not_merged(self, db_session, mocked_hub, mocked_redis) -> None:
        svc, uid, session_id, _run = await _setup_busy_session(db_session)

        await svc.inject_session(session_id, uid, prompt="普通消息A", queue_when_busy=True)
        await svc.inject_session(session_id, uid, prompt="普通消息B", queue_when_busy=True)

        rows = await _queue_rows(db_session, session_id)
        assert len(rows) == 2
        assert {r.prompt for r in rows} == {"普通消息A", "普通消息B"}

    @pytest.mark.asyncio
    async def test_notification_and_normal_coexist(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """通知与普通消息互不合并（合并只作用于通知前缀内部）。"""
        svc, uid, session_id, _run = await _setup_busy_session(db_session)

        await svc.inject_session(
            session_id, uid, prompt=_wakeup_prompt("查依赖", "t-1"), queue_when_busy=True
        )
        await svc.inject_session(session_id, uid, prompt="普通消息", queue_when_busy=True)

        rows = await _queue_rows(db_session, session_id)
        assert len(rows) == 2
        prompts = {r.prompt or "" for r in rows}
        assert any(p.startswith("[后台任务通知]") for p in prompts)
        assert "普通消息" in prompts


class TestRetrySuccessPath:
    @pytest.mark.asyncio
    async def test_retry_success_returns_snapshot_not_crash(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """重试成功派发：行被删后不得 assert 崩（旧代码此路径必 500）。"""
        svc, uid, session_id, busy_run = await _setup_busy_session(db_session)
        await svc.inject_session(session_id, uid, prompt="重试我", queue_when_busy=True)
        await _finish_run(db_session, busy_run)

        # 先造 failed（daemon 掉线派发失败），与既有失败分支测试同法。
        mocked_hub.send_session_control = AsyncMock(return_value=False)
        mocked_hub.is_connected = MagicMock(return_value=False)
        with (
            patch(
                "app.modules.daemon.session.service.SessionService._converge_failed_dispatch",
                new=AsyncMock(),
            ),
            patch(
                "app.modules.agent.placement.RunPlacementService.notify_interactive_dispatch",
                new=AsyncMock(return_value=False),
            ),
        ):
            await svc.dispatch_queued_messages(session_id)
        rows = await _queue_rows(db_session, session_id)
        assert rows[0].status == "failed"

        # 恢复 hub 在线 → retry 派发成功（走行删除路径，即旧代码 assert 崩溃点）。
        mocked_hub.send_session_control = AsyncMock(return_value=True)
        mocked_hub.is_connected = MagicMock(return_value=True)

        _svc2 = DaemonService(db_session)
        result = await _svc2.retry_queued_message(session_id, rows[0].id, uid)

        # 派发成功：排队行已删（新 run 已建），返回删除前快照而非抛错。
        assert await _queue_rows(db_session, session_id) == []
        assert result.id == rows[0].id
        assert result.status == "dispatched"
        assert result.prompt == "重试我"
