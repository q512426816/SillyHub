"""2026-08-31-session-queue-ux 排队新语义行为锁（design §8 / FR-01~02 + 04~06）。

Wave 2-4 全部新排队语义的服务层直测（fixture 范式照抄 test_session_queue.py：
db_session + DaemonService 直调 + mocked_hub / mocked_redis）：

- TestEnqueuePosition（FR-01 / D-002）：连入 3 条 position 严格递增（MAX+1，
  空队列首条=0）；MAX(position) 不按 status 过滤——满员含 failed 占位时续入
  position 接续最大值不回卷；TASK_WAKEUP 通知 merge 原地改 prompt 不新建行、
  原条目 position 不变（task-02 契约回归）。
- TestReorder（FR-04 / D-003）：全量 ids 乱序上传 → position 重写 0..n-1 且
  list 序随之变化（failed 条目同参与全量校验与重排）；少传 / 多传 / 错传 /
  重复 id → DaemonSessionQueueOrderMismatch（router 422 语义）且现有
  position 原样回滚。
- TestEditEntry（FR-06 / NG-01 / D-009）：改 prompt 生效 + updated_at 变、
  附件/配置快照不动、pending 编辑不触发派发；空文本/超 8000 在 DTO 层 422
  （QueueEntryUpdateRequest min/max_length，服务层无二次校验）；TASK_WAKEUP
  前缀条目 409 不可编辑；failed 条目编辑 → 翻 pending + error_msg 清空（隔离
  断言），在线时直接派发成功（行删 + 新 run user_input=新文本）。
- TestDispatchNow（FR-05 / D-001 / R-03 / R-04）：空闲会话当场派发（行删 +
  新 run 落 prompt）；忙时本条 position 置队首（其余顺移）+ SESSION_INTERRUPT
  控制指令落库并经 hub 下发 + interrupted=True；interrupt 推送失败置顶不回滚
  （commit 先于发送，R-03）；非 active 409；条目不存在 404；failed 条目先翻
  pending 再走派发分支。
- TestDispatchLoop（FR-01/02 / R-05 / D-004 / D-005 / D-010）：对
  dispatch_queued_messages 直测（mock _inject_into_session 侧信道）——队头
  瞬态失败一次后续派下一条；连续 2 次失败即停（第 3 条不再尝试）；派发成功
  一条连续计数清零；reconnecting（非终态非 active）pending 全部原样保留；
  ended 终态 pending 批量转 failed；cancelled 不触发批量 fail（终态词表仅
  {ended, failed}）。
- TestReconnectHook（FR-01 / D-008）：confirm_session_reconnected 翻 active
  后，有 pending 条目才 fire 后台派发（_fire_background_task 真起 task + 强
  引用持有，对齐 test_run_sync_fire_background_task.py 手法）；无 pending
  零开销不起任务。

Author: SillySpec change 2026-08-31-session-queue-ux (task-05)
Created: 2026-08-31
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.core.errors import AppError
from app.modules.agent.model import (
    SESSION_QUEUE_MAX_PENDING,
    AgentRun,
    AgentRunLog,
    AgentSession,
    AgentSessionQueuedMessage,
)
from app.modules.daemon.control_commands import KIND_SESSION_INTERRUPT
from app.modules.daemon.model import DaemonControlCommand
from app.modules.daemon.protocol import DAEMON_MSG_SESSION_INTERRUPT
from app.modules.daemon.schema import QueueEntryUpdateRequest
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import (
    DaemonRuntimeOffline,
    DaemonSessionNotActive,
    DaemonSessionQueueEntryNotEditable,
    DaemonSessionQueueEntryNotFound,
    DaemonSessionQueueOrderMismatch,
    SessionService,
)

# ── Fixtures / helpers（范式逐字对齐 test_session_queue.py）──────────────────


async def _create_user(session) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"qx-{uid}@example.com",
            password_hash="x",
            display_name="QX",
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
    """按 (position, created_at) 取排队行——与 list/dispatch 排序键一致（D-002）。"""
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
    rt = await _create_runtime(db_session, uid)
    svc = DaemonService(db_session)
    created = await svc.create_session(uid, provider="claude", prompt="first")
    await _finish_run(db_session, created.agent_run)
    busy = await svc.inject_session(created.agent_session.id, uid, prompt="占用本轮")
    return svc, uid, rt, created.agent_session.id, busy.agent_run


async def _set_session_status(db_session, session_id: uuid.UUID, status: str) -> None:
    row = await db_session.get(AgentSession, session_id)
    assert row is not None
    row.status = status
    await db_session.commit()


async def _make_dispatch_fail_once(
    db_session, svc: DaemonService, session_id: uuid.UUID, hub
) -> None:
    """daemon 掉线让派发失败一次 → 队首条目转 failed 留队（既有失败配方复用）。"""
    hub.send_session_control = AsyncMock(return_value=False)
    hub.is_connected = MagicMock(return_value=False)
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
    # 恢复在线，后续派发走成功路径。
    hub.send_session_control = AsyncMock(return_value=True)
    hub.is_connected = MagicMock(return_value=True)


async def _active_runs(db_session, session_id: uuid.UUID) -> list[AgentRun]:
    return list(
        (
            await db_session.execute(
                select(AgentRun).where(
                    AgentRun.agent_session_id == session_id,
                    AgentRun.status == "pending",
                )
            )
        )
        .scalars()
        .all()
    )


async def _run_user_input(db_session, run_id: uuid.UUID) -> str | None:
    row = (
        (
            await db_session.execute(
                select(AgentRunLog).where(
                    AgentRunLog.run_id == run_id,
                    AgentRunLog.channel == "user_input",
                )
            )
        )
        .scalars()
        .first()
    )
    return row.content_redacted if row is not None else None


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


# ── 1. 入队 position MAX+1（FR-01 / D-002 / task-02 契约回归）────────────────


class TestEnqueuePosition:
    @pytest.mark.asyncio
    async def test_positions_increment_max_plus_one(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """连入 3 条普通消息 → position 严格递增 0,1,2（MAX+1，空队列首条=0）。"""
        svc, uid, _rt, session_id, _run = await _setup_busy_session(db_session)

        for text in ("第一条", "第二条", "第三条"):
            result = await svc.inject_session(session_id, uid, prompt=text, queue_when_busy=True)
            assert result.queued is True

        rows = await _queue_rows(db_session, session_id)
        assert [r.prompt for r in rows] == ["第一条", "第二条", "第三条"]
        assert [r.position for r in rows] == [0, 1, 2]

        listed = await svc.list_queued_messages(session_id, uid)
        assert [r.prompt for r in listed] == ["第一条", "第二条", "第三条"]

    @pytest.mark.asyncio
    async def test_max_position_unfiltered_by_failed_rows(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """MAX(position) 不按 status 过滤——failed 高位条目占位，续入接续最大值。

        满员 5 条（position 0..4）后把高位 2 条（3、4）翻 failed：满员检查只数
        pending（3 条）放行第 6 条；若实现误按 pending 过滤取 MAX（=2），新条目
        position 会回卷成 3 与 failed 行撞位——断言 5 钉死全集口径。
        """
        svc, uid, _rt, session_id, _run = await _setup_busy_session(db_session)

        for i in range(SESSION_QUEUE_MAX_PENDING):
            await svc.inject_session(session_id, uid, prompt=f"msg-{i}", queue_when_busy=True)

        rows = await _queue_rows(db_session, session_id)
        for row in rows:
            if (row.position or 0) >= 3:
                row.status = "failed"
        await db_session.commit()

        result = await svc.inject_session(session_id, uid, prompt="第6条", queue_when_busy=True)
        assert result.queued is True

        rows = await _queue_rows(db_session, session_id)
        new_row = next(r for r in rows if r.prompt == "第6条")
        assert new_row.position == 5
        # pending 满员检查只数 pending：failed 不占满员名额，但占 position 序。
        assert sorted(r.position for r in rows if r.status == "failed") == [3, 4]

    @pytest.mark.asyncio
    async def test_wakeup_merge_keeps_position(self, db_session, mocked_hub, mocked_redis) -> None:
        """TASK_WAKEUP 通知 merge 原地改 prompt——不新建行、原条目 position 不变。"""
        svc, uid, _rt, session_id, _run = await _setup_busy_session(db_session)

        await svc.inject_session(session_id, uid, prompt="普通消息", queue_when_busy=True)
        first = await svc.inject_session(
            session_id,
            uid,
            prompt=_wakeup_prompt("查依赖", "t-1"),
            queue_when_busy=True,
        )
        merged = await svc.inject_session(
            session_id,
            uid,
            prompt=_wakeup_prompt("生成类文件", "t-2"),
            queue_when_busy=True,
        )

        assert merged.queued is True
        assert merged.queue_entry_id == first.queue_entry_id
        rows = await _queue_rows(db_session, session_id)
        assert len(rows) == 2
        notification = next(r for r in rows if (r.prompt or "").startswith("[后台任务通知]"))
        assert notification.id == first.queue_entry_id
        # merge 前该条已位于 position 1，合并入队不动 position、不新建行。
        assert notification.position == 1
        assert "任务「查依赖」" in (notification.prompt or "")
        assert "任务「生成类文件」" in (notification.prompt or "")


# ── 2. reorder 全量校验与重写（FR-04 / D-003）─────────────────────────────────


class TestReorder:
    @pytest.mark.asyncio
    async def test_full_reorder_rewrites_positions(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """全量 ids 乱序上传 → position 按传入序重写 0..n-1，list 序随之变化。

        failed 条目同参与全量校验与重排（表内只剩 pending+failed）。
        """
        svc, uid, _rt, session_id, _run = await _setup_busy_session(db_session)
        a = await svc.inject_session(session_id, uid, prompt="A", queue_when_busy=True)
        b = await svc.inject_session(session_id, uid, prompt="B", queue_when_busy=True)
        c = await svc.inject_session(session_id, uid, prompt="C", queue_when_busy=True)
        # B 模拟派发失败（直接翻 failed——状态构造手段，语义同失败路径产物）。
        rows = await _queue_rows(db_session, session_id)
        next(r for r in rows if r.id == b.queue_entry_id).status = "failed"
        await db_session.commit()

        await svc.reorder_queued_messages(
            session_id, [c.queue_entry_id, b.queue_entry_id, a.queue_entry_id], uid
        )

        rows = await _queue_rows(db_session, session_id)
        assert [r.prompt for r in rows] == ["C", "B", "A"]
        assert [r.position for r in rows] == [0, 1, 2]
        listed = await svc.list_queued_messages(session_id, uid)
        assert [r.id for r in listed] == [
            c.queue_entry_id,
            b.queue_entry_id,
            a.queue_entry_id,
        ]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "case",
        ["missing", "extra", "foreign", "duplicate"],
    )
    async def test_reorder_mismatch_rejected_and_unchanged(
        self, db_session, mocked_hub, mocked_redis, case: str
    ) -> None:
        """少传 / 多传 / 错传（他会话条目）/ 重复 id → 422 语义异常 + 现序回滚。"""
        svc, uid, _rt, session_id, _run = await _setup_busy_session(db_session)
        a = await svc.inject_session(session_id, uid, prompt="A", queue_when_busy=True)
        b = await svc.inject_session(session_id, uid, prompt="B", queue_when_busy=True)
        c = await svc.inject_session(session_id, uid, prompt="C", queue_when_busy=True)
        ids = [a.queue_entry_id, b.queue_entry_id, c.queue_entry_id]

        if case == "missing":
            upload = ids[:2]
        elif case == "extra":
            upload = [*ids, uuid.uuid4()]
        elif case == "foreign":
            upload = [ids[0], ids[1], uuid.uuid4()]
        else:  # duplicate —— 长度恰好 3，集合 {A,B} ≠ 全集 {A,B,C}
            upload = [ids[0], ids[0], ids[1]]

        with pytest.raises(DaemonSessionQueueOrderMismatch):
            await svc.reorder_queued_messages(session_id, upload, uid)

        # 拒绝后现有 position 原样（rollback 生效，不落半重排）。
        rows = await _queue_rows(db_session, session_id)
        assert [r.prompt for r in rows] == ["A", "B", "C"]
        assert [r.position for r in rows] == [0, 1, 2]


# ── 3. edit 三态与 409（FR-06 / NG-01 / D-009）────────────────────────────────


class TestEditEntry:
    @pytest.mark.asyncio
    async def test_edit_prompt_updates_and_keeps_snapshot(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """改 prompt：文本/updated_at 变，附件/配置快照不动，pending 不触发派发。"""
        svc, uid, _rt, session_id, _run = await _setup_busy_session(db_session)
        result = await svc.inject_session(
            session_id,
            uid,
            prompt="原文",
            agent_profile_id="profile-snap",
            queue_when_busy=True,
        )
        entry_id = result.queue_entry_id
        assert entry_id is not None
        rows = await _queue_rows(db_session, session_id)
        row = next(r for r in rows if r.id == entry_id)
        # SQLite DateTime 回读为 naive——基准值同步用 naive，比较两边同型。
        stale_updated_at = datetime(2020, 1, 1)
        row.updated_at = stale_updated_at
        await db_session.commit()

        with patch.object(
            SessionService, "dispatch_queued_messages", new=AsyncMock()
        ) as dispatch_spy:
            updated = await svc.update_queued_message(session_id, entry_id, "改后的文本", uid)
            dispatch_spy.assert_not_awaited()

        assert updated.prompt == "改后的文本"
        assert updated.status == "pending"
        assert updated.updated_at is not None and updated.updated_at > stale_updated_at
        # NG-01：仅改 prompt——快照字段不动。
        assert updated.agent_profile_id == "profile-snap"
        assert updated.attachment_ids is None
        rows = await _queue_rows(db_session, session_id)
        assert len(rows) == 1

    @pytest.mark.asyncio
    async def test_edit_validation_enforced_at_dto_layer(self) -> None:
        """空文本 / 8001 字在 QueueEntryUpdateRequest 层 422（服务层无二次校验）。"""
        with pytest.raises(ValidationError):
            QueueEntryUpdateRequest(prompt="")
        with pytest.raises(ValidationError):
            QueueEntryUpdateRequest(prompt="x" * 8001)
        # 边界合法：8000 恰好在上限内。
        assert QueueEntryUpdateRequest(prompt="x" * 8000).prompt == "x" * 8000

    @pytest.mark.asyncio
    async def test_edit_wakeup_entry_rejected_409(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """TASK_WAKEUP 前缀条目 409 不可编辑（D-009——改文破坏 like 去重匹配）。"""
        svc, uid, _rt, session_id, _run = await _setup_busy_session(db_session)
        result = await svc.inject_session(
            session_id, uid, prompt=_wakeup_prompt("查依赖", "t-1"), queue_when_busy=True
        )
        entry_id = result.queue_entry_id
        assert entry_id is not None

        with pytest.raises(DaemonSessionQueueEntryNotEditable):
            await svc.update_queued_message(session_id, entry_id, "改通知", uid)

        rows = await _queue_rows(db_session, session_id)
        assert len(rows) == 1
        assert rows[0].prompt is not None and rows[0].prompt.startswith("[后台任务通知]")

    @pytest.mark.asyncio
    async def test_edit_failed_entry_resets_pending_state(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """failed 条目编辑保存 → 翻 pending + error_msg 清空（派发隔离断言）。"""
        svc, uid, _rt, session_id, busy_run = await _setup_busy_session(db_session)
        result = await svc.inject_session(session_id, uid, prompt="会失败的", queue_when_busy=True)
        entry_id = result.queue_entry_id
        assert entry_id is not None
        await _finish_run(db_session, busy_run)
        await _make_dispatch_fail_once(db_session, svc, session_id, mocked_hub)
        rows = await _queue_rows(db_session, session_id)
        assert rows[0].status == "failed"
        assert rows[0].error_msg

        with patch.object(
            SessionService, "dispatch_queued_messages", new=AsyncMock()
        ) as dispatch_spy:
            updated = await svc.update_queued_message(session_id, entry_id, "编辑后重发", uid)
            dispatch_spy.assert_awaited_once()

        assert updated.status == "pending"
        assert updated.error_msg is None
        assert updated.prompt == "编辑后重发"

    @pytest.mark.asyncio
    async def test_edit_failed_entry_dispatches_when_online(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """failed 条目编辑 → 翻 pending 后立即派发：行删 + 新 run 落新文本。"""
        svc, uid, _rt, session_id, busy_run = await _setup_busy_session(db_session)
        result = await svc.inject_session(session_id, uid, prompt="旧文本", queue_when_busy=True)
        entry_id = result.queue_entry_id
        assert entry_id is not None
        await _finish_run(db_session, busy_run)
        await _make_dispatch_fail_once(db_session, svc, session_id, mocked_hub)

        updated = await svc.update_queued_message(session_id, entry_id, "新文本", uid)

        # 派发成功：行已删，返回删除前快照标 dispatched（retry 同款）。
        assert await _queue_rows(db_session, session_id) == []
        assert updated.status == "dispatched"
        assert updated.prompt == "新文本"
        runs = await _active_runs(db_session, session_id)
        assert len(runs) == 1
        assert await _run_user_input(db_session, runs[0].id) == "新文本"


# ── 4. dispatch-now 空闲直发与忙时置顶+interrupt（FR-05 / D-001 / R-03）──────


class TestDispatchNow:
    @pytest.mark.asyncio
    async def test_dispatch_now_idle_dispatches_inline(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """空闲会话（无活跃 run）→ 当场派发：行删 + 新 run prompt=条目 prompt。"""
        svc, uid, _rt, session_id, busy_run = await _setup_busy_session(db_session)
        result = await svc.inject_session(
            session_id, uid, prompt="立即发这条", queue_when_busy=True
        )
        entry_id = result.queue_entry_id
        assert entry_id is not None
        await _finish_run(db_session, busy_run)

        interrupted = await svc.dispatch_queued_message_now(session_id, entry_id, uid)

        assert interrupted is False
        assert await _queue_rows(db_session, session_id) == []
        runs = await _active_runs(db_session, session_id)
        assert len(runs) == 1
        assert await _run_user_input(db_session, runs[0].id) == "立即发这条"

    @pytest.mark.asyncio
    async def test_dispatch_now_busy_prepends_and_interrupts(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """忙时：本条 position 置队首（其余顺移）+ SESSION_INTERRUPT 经 hub 下发。"""
        svc, uid, rt, session_id, _run = await _setup_busy_session(db_session)
        await svc.inject_session(session_id, uid, prompt="A", queue_when_busy=True)
        b = await svc.inject_session(session_id, uid, prompt="B", queue_when_busy=True)
        mocked_hub.send_session_control.reset_mock()

        interrupted = await svc.dispatch_queued_message_now(session_id, b.queue_entry_id, uid)

        assert interrupted is True
        rows = await _queue_rows(db_session, session_id)
        assert [r.prompt for r in rows] == ["B", "A"]
        assert [r.position for r in rows] == [0, 1]
        assert all(r.status == "pending" for r in rows)
        # interrupt 控制指令：经 ws hub 下发 SESSION_INTERRUPT 消息 + 控制行落库。
        mocked_hub.send_session_control.assert_awaited_once()
        _daemon_id, msg_type, payload = mocked_hub.send_session_control.await_args.args
        assert msg_type == DAEMON_MSG_SESSION_INTERRUPT
        assert payload["session_id"] == str(session_id)
        command = (
            (
                await db_session.execute(
                    select(DaemonControlCommand).where(
                        DaemonControlCommand.runtime_id == rt.id,
                        DaemonControlCommand.kind == KIND_SESSION_INTERRUPT,
                    )
                )
            )
            .scalars()
            .one_or_none()
        )
        assert command is not None

    @pytest.mark.asyncio
    async def test_dispatch_now_interrupt_failure_keeps_prepend(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """interrupt 推送失败（daemon 不在线）→ 抛 DaemonRuntimeOffline 但置顶不回滚
        （commit 先于 interrupt 发送，R-03）。"""
        svc, uid, _rt, session_id, _run = await _setup_busy_session(db_session)
        await svc.inject_session(session_id, uid, prompt="A", queue_when_busy=True)
        b = await svc.inject_session(session_id, uid, prompt="B", queue_when_busy=True)
        mocked_hub.send_session_control = AsyncMock(return_value=False)

        with pytest.raises(DaemonRuntimeOffline):
            await svc.dispatch_queued_message_now(session_id, b.queue_entry_id, uid)

        rows = await _queue_rows(db_session, session_id)
        assert [r.prompt for r in rows] == ["B", "A"]
        assert [r.position for r in rows] == [0, 1]

    @pytest.mark.asyncio
    async def test_dispatch_now_non_active_rejected(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """会话非 active（reconnecting/suspended/ended）→ DaemonSessionNotActive。"""
        svc, uid, _rt, session_id, _run = await _setup_busy_session(db_session)
        result = await svc.inject_session(session_id, uid, prompt="A", queue_when_busy=True)
        entry_id = result.queue_entry_id
        assert entry_id is not None

        for status in ("reconnecting", "suspended", "ended"):
            await _set_session_status(db_session, session_id, status)
            with pytest.raises(DaemonSessionNotActive):
                await svc.dispatch_queued_message_now(session_id, entry_id, uid)

    @pytest.mark.asyncio
    async def test_dispatch_now_entry_not_found_404(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """条目不存在（或不属于会话）→ DaemonSessionQueueEntryNotFound。"""
        svc, uid, _rt, session_id, _run = await _setup_busy_session(db_session)

        with pytest.raises(DaemonSessionQueueEntryNotFound):
            await svc.dispatch_queued_message_now(session_id, uuid.uuid4(), uid)

    @pytest.mark.asyncio
    async def test_dispatch_now_failed_entry_resets_then_dispatches(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """failed 条目 → 先翻 pending 再走派发分支（空闲路径当场派发）。"""
        svc, uid, _rt, session_id, busy_run = await _setup_busy_session(db_session)
        result = await svc.inject_session(
            session_id, uid, prompt="失败的条目", queue_when_busy=True
        )
        entry_id = result.queue_entry_id
        assert entry_id is not None
        await _finish_run(db_session, busy_run)
        await _make_dispatch_fail_once(db_session, svc, session_id, mocked_hub)
        rows = await _queue_rows(db_session, session_id)
        assert rows[0].status == "failed"

        interrupted = await svc.dispatch_queued_message_now(session_id, entry_id, uid)

        assert interrupted is False
        assert await _queue_rows(db_session, session_id) == []
        runs = await _active_runs(db_session, session_id)
        assert len(runs) == 1
        assert await _run_user_input(db_session, runs[0].id) == "失败的条目"


# ── 5. dispatch 循环化（FR-01/02 / R-05 / D-004 / D-005 / D-010）──────────────


class TestDispatchLoop:
    @pytest.mark.asyncio
    async def test_transient_failure_continues_to_next(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """队头失败 1 次（AppError）→ 继续派发下一条（瞬态单点失败不拖队）。"""
        svc, uid, _rt, session_id, busy_run = await _setup_busy_session(db_session)
        for text in ("A", "B", "C"):
            await svc.inject_session(session_id, uid, prompt=text, queue_when_busy=True)
        await _finish_run(db_session, busy_run)

        inject_mock = AsyncMock(side_effect=[AppError("模拟瞬态失败"), None, None])
        with patch.object(SessionService, "_inject_into_session", inject_mock):
            await svc.dispatch_queued_messages(session_id)

        rows = await _queue_rows(db_session, session_id)
        assert [r.prompt for r in rows] == ["A"]
        assert rows[0].status == "failed"
        assert rows[0].error_msg
        assert inject_mock.await_count == 3

    @pytest.mark.asyncio
    async def test_consecutive_failures_stop_loop(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """连续 2 次失败即停（R-05/D-004）：第 3 条保持 pending 不再尝试。"""
        svc, uid, _rt, session_id, busy_run = await _setup_busy_session(db_session)
        for text in ("A", "B", "C"):
            await svc.inject_session(session_id, uid, prompt=text, queue_when_busy=True)
        await _finish_run(db_session, busy_run)

        inject_mock = AsyncMock(side_effect=[AppError("失败1"), AppError("失败2")])
        with patch.object(SessionService, "_inject_into_session", inject_mock):
            await svc.dispatch_queued_messages(session_id)

        rows = await _queue_rows(db_session, session_id)
        assert [r.prompt for r in rows] == ["A", "B", "C"]
        assert [r.status for r in rows] == ["failed", "failed", "pending"]
        assert inject_mock.await_count == 2  # 第 3 条未被尝试

    @pytest.mark.asyncio
    async def test_success_resets_consecutive_counter(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """派发成功一条计数清零——交错「失败,成功,失败,成功」不会触发 ≥2 停止。"""
        svc, uid, _rt, session_id, busy_run = await _setup_busy_session(db_session)
        for text in ("A", "B", "C", "D"):
            await svc.inject_session(session_id, uid, prompt=text, queue_when_busy=True)
        await _finish_run(db_session, busy_run)

        transient = AppError("模拟瞬态失败")
        inject_mock = AsyncMock(side_effect=[transient, None, transient, None])
        with patch.object(SessionService, "_inject_into_session", inject_mock):
            await svc.dispatch_queued_messages(session_id)

        rows = await _queue_rows(db_session, session_id)
        assert [r.prompt for r in rows] == ["A", "C"]
        assert [r.status for r in rows] == ["failed", "failed"]
        assert inject_mock.await_count == 4

    @pytest.mark.asyncio
    async def test_reconnecting_session_keeps_pending(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """reconnecting（非终态非 active）→ pending 全部原样保留（D-05，P3 根因）。"""
        svc, uid, _rt, session_id, busy_run = await _setup_busy_session(db_session)
        for text in ("A", "B"):
            await svc.inject_session(session_id, uid, prompt=text, queue_when_busy=True)
        await _finish_run(db_session, busy_run)
        await _set_session_status(db_session, session_id, "reconnecting")

        inject_mock = AsyncMock()
        with patch.object(SessionService, "_inject_into_session", inject_mock):
            await svc.dispatch_queued_messages(session_id)

        rows = await _queue_rows(db_session, session_id)
        assert [r.prompt for r in rows] == ["A", "B"]
        assert [r.status for r in rows] == ["pending", "pending"]
        assert [r.position for r in rows] == [0, 1]
        inject_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_ended_session_fails_all_pending(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """ended 终态 → pending 批量转 failed 留队（终态收口，不留死条目）。"""
        svc, uid, _rt, session_id, busy_run = await _setup_busy_session(db_session)
        for text in ("A", "B"):
            await svc.inject_session(session_id, uid, prompt=text, queue_when_busy=True)
        await _finish_run(db_session, busy_run)
        await _set_session_status(db_session, session_id, "ended")

        await svc.dispatch_queued_messages(session_id)

        rows = await _queue_rows(db_session, session_id)
        assert [r.status for r in rows] == ["failed", "failed"]
        assert all(r.error_msg for r in rows)

    @pytest.mark.asyncio
    async def test_cancelled_status_not_batch_failed(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """cancelled 不在终态词表 {ended, failed} → 走非 active 保留分支不批量 fail。"""
        svc, uid, _rt, session_id, busy_run = await _setup_busy_session(db_session)
        for text in ("A", "B"):
            await svc.inject_session(session_id, uid, prompt=text, queue_when_busy=True)
        await _finish_run(db_session, busy_run)
        await _set_session_status(db_session, session_id, "cancelled")

        await svc.dispatch_queued_messages(session_id)

        rows = await _queue_rows(db_session, session_id)
        assert [r.status for r in rows] == ["pending", "pending"]


# ── 6. confirm_session_reconnected 恢复钩子（FR-01 / D-008）───────────────────


class TestReconnectHook:
    @pytest.mark.asyncio
    async def test_confirm_fires_redispatch_when_pending_exists(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """reconnecting→active 翻转 commit 后，有 pending 条目 → fire 一次后台派发。

        对齐 test_run_sync_fire_background_task.py 手法：_fire_background_task
        真起 task + _background_tasks 强引用持有；await 后台 task 再断言派发
        协程以 session_id 被调度。
        """
        SessionService._background_tasks.clear()
        svc, uid, rt, session_id, busy_run = await _setup_busy_session(db_session)
        for text in ("A", "B"):
            await svc.inject_session(session_id, uid, prompt=text, queue_when_busy=True)
        await _finish_run(db_session, busy_run)
        await _set_session_status(db_session, session_id, "reconnecting")

        dispatch_spy = AsyncMock()
        try:
            with patch(
                "app.modules.daemon.session.service.dispatch_next_queued_message",
                dispatch_spy,
            ):
                result_status = await svc.confirm_session_reconnected(session_id, runtime_id=rt.id)

            assert result_status == "active"
            tasks = list(SessionService._background_tasks)
            assert len(tasks) == 1  # 强引用持有（防 GC）
            await asyncio.gather(*tasks)
            dispatch_spy.assert_awaited_once_with(session_id)
        finally:
            SessionService._background_tasks.clear()

    @pytest.mark.asyncio
    async def test_confirm_without_pending_fires_nothing(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """队列无 pending 条目 → 不 fire 后台派发（零开销路径，防空转）。"""
        SessionService._background_tasks.clear()
        svc, _uid, rt, session_id, busy_run = await _setup_busy_session(db_session)
        await _finish_run(db_session, busy_run)
        await _set_session_status(db_session, session_id, "reconnecting")

        dispatch_spy = AsyncMock()
        try:
            with patch(
                "app.modules.daemon.session.service.dispatch_next_queued_message",
                dispatch_spy,
            ):
                result_status = await svc.confirm_session_reconnected(session_id, runtime_id=rt.id)

            assert result_status == "active"
            assert not SessionService._background_tasks  # 未创建任何后台任务
            dispatch_spy.assert_not_awaited()
        finally:
            SessionService._background_tasks.clear()
