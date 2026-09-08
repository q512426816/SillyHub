"""定时消息到点派发巡检（2026-09-07-session-pin-rename-scheduled-send task-04 / design §总体方案 Wave2 / D-001@v1）.

- :func:`scheduled_send_sweep_once`：单趟扫描 ``status='pending'`` 且
  ``dispatch_at <= now`` 的定时消息（Python 侧 ``datetime.now(UTC)`` 算好
  绑定参数，aiosqlite / PG 双方言，对齐 sweep.py NFR 惯例），每轮至多
  :data:`SCHEDULED_SEND_SWEEP_BATCH_LIMIT` 条防长事务。逐条经独立短 session
  调 :func:`_dispatch_scheduled_entry` 四分支收敛（design FR-05）：
  空闲 → inject 成功置 dispatched；忙轮 → ``queue_when_busy=True`` 自动落
  既有 ``agent_session_queued_messages``（条目同样置 dispatched——定时义务
  已履行，后续排队归队列域管）；会话终态/软删 → failed(session_inactive)；
  队列满（SESSION_QUEUE_MAX_PENDING）→ failed(queue_full)（D-003@v1）。
  单条失败不连坐同轮其它条目（失败隔离）。
- :func:`scheduled_send_sweeper`：常驻循环（30s 周期），模式与关停契约
  同 :func:`app.modules.daemon.sweep.session_reconnect_sweeper`（每轮独立
  短 session、单轮异常 ``log.exception`` 吞掉不崩循环、``asyncio.sleep``
  处 ``CancelledError`` 透传保证 lifespan cancel+gather 干净落地）。

at-least-once 权衡（design R-02）：条目状态翻转与 inject 分两个事务——
先 inject 成功再单独事务写 dispatched。inject 提交后、dispatched 落库前
崩溃的极端窗口内条目仍 pending，下轮会重发一次（最多重复发送一次）；
换取的是「先落 dispatched 再 inject」崩溃路径的静默丢消息不发生。

取消竞态（R-01 + ql-20260908-006 R3 修正）：派发前在条目行 ``with_for_update``
复核 pending，与 ``cancel_scheduled_message`` 的行锁串行化——取消先落则本轮
回跳过。行锁只保到 inject 的内部 commit 为止：此后条目仍 pending 的窗口内
到达的取消会成功落库并向用户返回 204，终态写回因此用带谓词的条件 UPDATE
（仅 ``status='pending'`` 可翻转）——被取消即 0 行命中，尊重用户取消语义
不盲覆写（消息可能已实际发出，属 R-02 at-least-once 固有代价）。

daemon 离线（ql-20260908-006 R4）：``DaemonRuntimeOffline`` 是瞬时态（关机/
掉线/重启中），不落终态——每次失败把 ``dispatch_at`` 延后 5 分钟重试，至多
6 次（≈30 分钟窗口，进程内计数，backend 重启清零重计）；超限置
``failed(daemon_offline)``。毒丸上限（R5）：单条派发连续崩溃 5 轮（非
AppError，每轮 30s）后置 ``failed(sweep_crash_retry_exhausted)`` 收口，
配合 due 扫描按 ``dispatch_at`` 升序，防同一批毒丸常年占满批量槽饿死其余。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session_factory
from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.agent.model import AgentSession, AgentSessionScheduledMessage
from app.modules.daemon.runtime.service import DaemonRuntimeOffline
from app.modules.daemon.session.service import (
    DaemonSessionQueueFull,
    SessionService,
)

log = get_logger(__name__)

# 巡检周期（秒）。design §总体方案 Wave2 定 30s——tailer 10s 推送 + 30s 轮询
# 的可见性口径下，到点消息最迟 ~30s 后发出；backend 重启后首轮即补发 due 条目。
# 常开巡检不加 Settings 开关（对齐 sweep.py 常量唯一落点惯例）。
SCHEDULED_SEND_SWEEP_INTERVAL_SEC = 30
# 单轮批量上限（防长事务——每条独立 session 串行处理，50 条 × inject 秒级
# 已是单轮 1-2 分钟量级；超量条目下轮自然续捞）。
SCHEDULED_SEND_SWEEP_BATCH_LIMIT = 50
# R4（ql-20260908-006）：daemon 离线有界重试——每次失败延后 5 分钟，至多 6 次
# （≈30 分钟窗口覆盖常见关机/掉线/重启时段）。进程内计数：backend 重启清零
# 重计（重启即弃计数的语义损失可接受，换来不动表结构）。
DAEMON_OFFLINE_RETRY_DELAY = timedelta(minutes=5)
DAEMON_OFFLINE_RETRY_MAX = 6
# R5（ql-20260908-006）：单条毒丸（每轮派发即崩的非 AppError）连续崩溃轮数
# 上限——达限置 failed 收口，不再无限重试（防「inject 提交后崩溃」形态的
# 周期性重发无上界）。
SWEEP_CRASH_RETRY_MAX = 5

# R4/R5 进程内重试计数（key=条目 id；成功/终态即弹，见各分支）。
_OFFLINE_RETRY_ATTEMPTS: dict[uuid.UUID, int] = {}
_CRASH_RETRY_ATTEMPTS: dict[uuid.UUID, int] = {}

# 会话终态判定（与 ACTIVE_SESSION_STATUSES {pending, active, reconnecting}
# 互补的显式清单——suspended 非终态但不可 inject，走 inject_failed 兜底收敛，
# design §生命周期契约表 C-17 口径）。
_TERMINAL_SESSION_STATUSES = frozenset({"ended", "failed"})


async def _dispatch_scheduled_entry(db: AsyncSession, message_id: uuid.UUID) -> bool:
    """派发单条 due 定时消息（四分支收敛），返回是否发生状态翻转。

    独立短 session 调用（sweep_once 逐条开）；task-06 单测直调本函数注入
    AsyncSession。行锁复核 pending 在事务最前（与取消串行化，R-01）。
    """
    entry = (
        await db.execute(
            select(AgentSessionScheduledMessage)
            .where(AgentSessionScheduledMessage.id == message_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if entry is None or entry.status != "pending":
        # 行锁内复核失败：已被并发取消/派发（R-01 后到者幂等跳过），非本回事务。
        await db.rollback()  # 释放 FOR UPDATE 行锁（复核失败不悬挂事务）
        return False

    agent_session = await db.get(AgentSession, entry.agent_session_id)
    if (
        agent_session is None
        or agent_session.deleted_at is not None
        or (agent_session.status or "") in _TERMINAL_SESSION_STATUSES
    ):
        entry.status = "failed"
        entry.error_code = "session_inactive"
        entry.error_message = "会话已结束或已删除，定时消息不再派发。"
        await db.commit()
        _OFFLINE_RETRY_ATTEMPTS.pop(message_id, None)
        log.warning(
            "scheduled_send_skipped_session_inactive",
            message_id=str(message_id),
            session_id=str(entry.agent_session_id),
        )
        return True

    # inject 与状态翻转分两个事务（R-02 at-least-once）：先在行锁事务内取
    # 快照载荷 → 复用 inject_session_as_service 全链路（含内部 commit）→
    # 成功后同 session 新事务写 dispatched。
    prompt = entry.prompt
    entry_id = entry.id
    agent_session_id = entry.agent_session_id
    sender_user_id = entry.sender_user_id
    attachment_ids = (
        [uuid.UUID(str(x)) for x in entry.attachment_ids] if entry.attachment_ids else None
    )
    agent_profile_id = entry.agent_profile_id
    llm_provider_id = entry.llm_provider_id
    try:
        svc = SessionService(db)
        await svc.inject_session_as_service(
            agent_session_id,
            prompt=prompt,
            queue_when_busy=True,
            queue_sender_user_id=sender_user_id,
            attachment_ids=attachment_ids,
            agent_profile_id=agent_profile_id,
            llm_provider_id=llm_provider_id,
        )
    except DaemonSessionQueueFull as exc:
        # D-003@v1：队列满员 → failed(queue_full)，不自动延后重试（重试风暴
        # 与「以为已排队」的语义欺骗比显式失败更差）。
        await db.rollback()
        await _mark_entry_failed(db, entry_id, "queue_full", str(exc))
        _OFFLINE_RETRY_ATTEMPTS.pop(entry_id, None)
        return True
    except AppError as exc:
        # R4（ql-20260908-006）：daemon 离线是瞬时态（关机/掉线/重启中），不落
        # 终态——有界延后重试（dispatch_at +5min，至多 6 次；进程内计数，重启清零）。
        # 超限才置 failed(daemon_offline)。
        if isinstance(exc, DaemonRuntimeOffline):
            attempts = _OFFLINE_RETRY_ATTEMPTS.get(entry_id, 0) + 1
            if attempts <= DAEMON_OFFLINE_RETRY_MAX:
                _OFFLINE_RETRY_ATTEMPTS[entry_id] = attempts
                await db.rollback()
                await db.execute(
                    update(AgentSessionScheduledMessage)
                    .where(
                        AgentSessionScheduledMessage.id == entry_id,
                        AgentSessionScheduledMessage.status == "pending",
                    )
                    .values(dispatch_at=datetime.now(UTC) + DAEMON_OFFLINE_RETRY_DELAY)
                )
                await db.commit()
                log.warning(
                    "scheduled_send_offline_retry_scheduled",
                    message_id=str(entry_id),
                    attempt=attempts,
                    max_attempts=DAEMON_OFFLINE_RETRY_MAX,
                    retry_delay_sec=int(DAEMON_OFFLINE_RETRY_DELAY.total_seconds()),
                )
                return False
            _OFFLINE_RETRY_ATTEMPTS.pop(entry_id, None)
            await db.rollback()
            await _mark_entry_failed(
                db,
                entry_id,
                "daemon_offline",
                f"daemon 持续离线（重试 {DAEMON_OFFLINE_RETRY_MAX} 次未恢复），"
                "定时消息已停止派发，请 daemon 恢复后重新创建。",
            )
            return True
        # inject 域业务失败（含 suspended 会话、工作区归档守卫 409 等）——
        # 统一 failed(inject_failed)，失败原因用户可见（design FR-05 失败隔离）。
        await db.rollback()
        await _mark_entry_failed(db, entry_id, "inject_failed", str(exc))
        _OFFLINE_RETRY_ATTEMPTS.pop(entry_id, None)
        return True

    # inject 成功（或忙轮入队成功）——独立事务条件写终态（R3，ql-20260908-006）：
    # 开头的行锁已随 inject 的内部 commit 释放，条目仍 pending 的窗口内可能被
    # 并发 cancel 置 cancelled 并向用户返回 204——用带谓词的条件 UPDATE（仅
    # pending 可翻转），0 行命中即已被取消，尊重用户取消语义不盲覆写（消息
    # 可能已实际发出，属 R-02 at-least-once 固有代价）。
    result = await db.execute(
        update(AgentSessionScheduledMessage)
        .where(
            AgentSessionScheduledMessage.id == entry_id,
            AgentSessionScheduledMessage.status == "pending",
        )
        .values(status="dispatched", dispatched_at=datetime.now(UTC))
    )
    await db.commit()
    _OFFLINE_RETRY_ATTEMPTS.pop(entry_id, None)
    if result.rowcount == 0:
        log.info(
            "scheduled_send_dispatch_lost_race_to_cancel",
            message_id=str(entry_id),
            session_id=str(agent_session_id),
        )
        return True
    log.info(
        "scheduled_send_dispatched",
        message_id=str(entry_id),
        session_id=str(agent_session_id),
    )
    return True


async def _mark_entry_failed(
    db: AsyncSession,
    message_id: uuid.UUID,
    error_code: str,
    error_message: str,
) -> None:
    """rollback 后以新事务把条目置 failed（幂等：仅 pending 可翻转）。"""
    entry = await db.get(AgentSessionScheduledMessage, message_id)
    if entry is None or entry.status != "pending":
        return
    entry.status = "failed"
    entry.error_code = error_code
    entry.error_message = error_message[:500]
    await db.commit()
    log.warning(
        "scheduled_send_entry_failed",
        message_id=str(message_id),
        error_code=error_code,
    )


async def scheduled_send_sweep_once(db_session: AsyncSession) -> int:
    """单趟扫描 due 定时消息并逐条派发，返回本轮命中（翻转/跳过）条数。

    扫描用注入的 db_session（单测可直调）；逐条派发经
    ``get_session_factory()`` 开独立短 session（对齐
    ``dispatch_next_queued_message`` 的独立 session 模式——条目处理生命周期
    独立于扫描事务）。时间阈值 Python 侧算好绑定参数（双方言 NFR）。
    """
    now = datetime.now(UTC)
    due_ids = list(
        (
            await db_session.execute(
                select(AgentSessionScheduledMessage.id)
                .where(
                    AgentSessionScheduledMessage.status == "pending",
                    AgentSessionScheduledMessage.dispatch_at <= now,
                )
                # R5（ql-20260908-006）：到期升序（id 兜底并列）——无排序时截断
                # [:50] 每轮可能捞到同一批，其余到期条目被无限饿死。
                .order_by(
                    AgentSessionScheduledMessage.dispatch_at.asc(),
                    AgentSessionScheduledMessage.id.asc(),
                )
            )
        )
        .scalars()
        .all()[:SCHEDULED_SEND_SWEEP_BATCH_LIMIT]
    )
    if not due_ids:
        return 0

    session_factory = get_session_factory()
    processed = 0
    for message_id in due_ids:
        try:
            async with session_factory() as entry_db:
                if await _dispatch_scheduled_entry(entry_db, message_id):
                    processed += 1
            _CRASH_RETRY_ATTEMPTS.pop(message_id, None)
        except Exception:
            # 失败隔离：单条异常（含 _mark_entry_failed 自身失败）不连坐
            # 同轮其它条目、不崩循环；条目保持 pending 由下轮重试。
            # R5（ql-20260908-006）：重试有上限——连续 SWEEP_CRASH_RETRY_MAX 轮
            # 崩溃（每轮 30s）即置 failed 收口，防毒丸条目无限重发/占满扫描槽。
            attempts = _CRASH_RETRY_ATTEMPTS.get(message_id, 0) + 1
            _CRASH_RETRY_ATTEMPTS[message_id] = attempts
            log.exception(
                "scheduled_send_entry_crashed",
                message_id=str(message_id),
                attempt=attempts,
            )
            if attempts >= SWEEP_CRASH_RETRY_MAX:
                _CRASH_RETRY_ATTEMPTS.pop(message_id, None)
                try:
                    async with session_factory() as fail_db:
                        await _mark_entry_failed(
                            fail_db,
                            message_id,
                            "sweep_crash_retry_exhausted",
                            f"连续 {SWEEP_CRASH_RETRY_MAX} 轮派发异常，已停止自动重试",
                        )
                except Exception:
                    log.exception(
                        "scheduled_send_poison_cap_mark_failed",
                        message_id=str(message_id),
                    )
    return processed


async def scheduled_send_sweeper(
    interval: float = SCHEDULED_SEND_SWEEP_INTERVAL_SEC,
) -> None:
    """常驻巡检循环（main.py lifespan ``create_task`` 消费）.

    仿 ``session_reconnect_sweeper``（sweep.py）：每轮经 ``get_session_factory()``
    开短 session 调 :func:`scheduled_send_sweep_once`，轮间不长期占连接池；
    单轮异常 ``except Exception`` 只 ``log.exception`` 吞掉、不崩循环；
    ``asyncio.sleep(interval)`` 处 ``CancelledError`` 透传（shutdown cancel
    才能干净落地）。关停由调用方 ``task.cancel()`` + ``await gather`` 落地。
    """
    while True:
        try:
            async with get_session_factory()() as db_session:
                processed = await scheduled_send_sweep_once(db_session)
            if processed:
                log.info("scheduled_send_sweep_round", processed=processed)
        except Exception:
            log.exception("scheduled_send_sweep_round_failed")
        # cancel 透传：sleep 是循环唯一的常规挂起点，CancelledError 必须穿出
        # 循环保证 lifespan 的 cancel + await 干净落地。
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise
