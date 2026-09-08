"""会话定时消息 CRUD（D-010 第二回合自 main 2ad590192 移植新域）。

来源 2026-09-07-session-pin-rename-scheduled-send task-03（原单文件
session/service.py 的 list/create/cancel 三方法，位于 rename_session 与
update_ctx_window 之间）；拆分包形态下 queue.py 已 725 行（+235 超 D-005@v3
子模块 ≤800 上限），故独立成域文件。定时消息与排队消息（queue.py）语义相邻
但生命周期独立（pending → dispatched/cancelled/failed 单向状态机，到点派发归
backend/app/modules/daemon/scheduled_send.py sweeper 调
inject_session_as_service）。

D-007：``SCHEDULED_DISPATCH_MIN_LEAD_SEC`` 常量归包 ``__init__`` 命名空间，
本模块经 ``_svc.`` 延迟解析（对齐 RECONNECTING_RETRY_WINDOW_SEC 惯例）。
本域方法不发 publish_sessions_changed——定时列表由前端 30s 轮询 + invalidate
消费（design §Wave 3），不在 sessions 列表 SSE 信号语义域内。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

import app.modules.daemon.session.service as _svc
from app.modules.agent.model import AgentSession, AgentSessionScheduledMessage
from app.modules.daemon.schema import ScheduledMessageCreateRequest

from .errors import (
    DaemonScheduledMessageDispatchTooSoon,
    DaemonScheduledMessageNotFound,
    DaemonScheduledMessageNotPending,
    DaemonScheduledMessageSessionInactive,
    DaemonSessionNotFound,
    SessionEmptyPrompt,
)


async def list_scheduled_messages(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> list[AgentSessionScheduledMessage]:
    """List all scheduled messages of an owned session (task-03 / FR-04).

    归属校验 404 不泄露存在性（get_agent_session_logs 无锁只读先例）；返回
    **全部状态**条目（dispatched / cancelled / failed 审计留档一并返回，
    前端列表条带状态 tag），按 ``dispatch_at`` 升序（design §Wave 2）。
    """
    owned = (
        await svc._session.execute(
            select(AgentSession.id).where(
                AgentSession.id == session_id,
                AgentSession.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if owned is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )
    rows = await svc._session.execute(
        select(AgentSessionScheduledMessage)
        .where(AgentSessionScheduledMessage.agent_session_id == session_id)
        .order_by(AgentSessionScheduledMessage.dispatch_at.asc())
    )
    return list(rows.scalars().all())


async def create_scheduled_message(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    data: ScheduledMessageCreateRequest,
) -> AgentSessionScheduledMessage:
    """Create a one-shot scheduled message for an owned session (task-03 / FR-04).

    行锁取归属会话（404 不泄露存在性）→ 三重校验（不落库）→ 落一行
    status=pending。本方法不触发任何 inject 链路——到点由 task-04 sweeper
    调 :meth:`inject_session_as_service` 派发（空闲直发 / 忙轮入队）。

    三重校验（错误码口径 FR-04：422 / 422 / 409 / 404）：

    1. prompt strip 非空，``attachment_ids`` 非空豁免（D-7 看图说话，
       与 :meth:`inject_session` 入口同口径）→ :class:`SessionEmptyPrompt`；
    2. ``dispatch_at`` 早于 now(UTC)+60s →
       :class:`DaemonScheduledMessageDispatchTooSoon`（naive 入参先归一为
       UTC，SQLite 测试读回 naive 先例同款）；
    3. 会话终态（ended/failed）或 ``deleted_at`` 非空 →
       :class:`DaemonScheduledMessageSessionInactive`（锁内复核，与
       end_session / delete_agent_session 串行，无 TOCTOU 窗口，R-01）。

    快照字段（prompt / attachment_ids 转 str 列表 / agent_profile_id /
    llm_provider_id）原样落库；``sender_user_id`` 记账创建者（派发时作
    queue_sender_user_id，design §Wave 2 归属语义）。
    """
    agent_session = (
        await svc._session.execute(
            select(AgentSession)
            .where(
                AgentSession.id == session_id,
                AgentSession.user_id == user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if agent_session is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )
    # 校验一：空 prompt（含全空白）拒绝口径与 inject_session 入口一致
    # （SessionEmptyPrompt 422 中文文案）；附件非空豁免（D-7 看图说话）。
    if not data.prompt.strip() and not data.attachment_ids:
        await svc._session.rollback()  # 释放 FOR UPDATE 行锁（校验失败不悬挂事务）
        raise SessionEmptyPrompt(
            "消息内容不能为空",
            details={"reason": "empty_prompt"},
        )
    # 校验二：dispatch_at 至少领先 now+60s（naive 入参按 UTC 补齐后再比较，
    # 防「刚建即过期」竞态，SCHEDULED_DISPATCH_MIN_LEAD_SEC）。
    dispatch_at = data.dispatch_at
    if dispatch_at.tzinfo is None:
        dispatch_at = dispatch_at.replace(tzinfo=UTC)
    if dispatch_at < datetime.now(UTC) + timedelta(seconds=_svc.SCHEDULED_DISPATCH_MIN_LEAD_SEC):
        await svc._session.rollback()  # 释放 FOR UPDATE 行锁
        raise DaemonScheduledMessageDispatchTooSoon(
            f"定时发送时间必须至少在 {_svc.SCHEDULED_DISPATCH_MIN_LEAD_SEC} 秒之后。",
            details={
                "session_id": str(session_id),
                "dispatch_at": dispatch_at.isoformat(),
            },
        )
    # 校验三：终态/软删会话不能接受定时消息（锁内复核，与 sweeper 到点
    # 复核同结论——软删会话余留条目到点置 failed 收敛，此处前置拒绝）。
    if agent_session.status in ("ended", "failed") or agent_session.deleted_at is not None:
        status = agent_session.status
        deleted = agent_session.deleted_at is not None
        await svc._session.rollback()  # 释放 FOR UPDATE 行锁
        raise DaemonScheduledMessageSessionInactive(
            "会话已结束或已删除，无法创建定时消息。",
            details={
                "session_id": str(session_id),
                "status": status,
                "deleted": deleted,
            },
        )
    row = AgentSessionScheduledMessage(
        agent_session_id=agent_session.id,
        sender_user_id=user_id,
        prompt=data.prompt,
        # 附件快照转 str 列表（SessionAttachment id 字符串形态，对齐
        # AgentSessionQueuedMessage.attachment_ids 落库惯例；到点派发转回
        # uuid 走锁内附件校验兜底）。
        attachment_ids=([str(a) for a in data.attachment_ids] if data.attachment_ids else None),
        agent_profile_id=data.agent_profile_id,
        llm_provider_id=data.llm_provider_id,
        dispatch_at=dispatch_at,
        status="pending",
    )
    svc._session.add(row)
    await svc._session.commit()
    return row


async def cancel_scheduled_message(
    svc,
    session_id: uuid.UUID,
    message_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Cancel a pending scheduled message (task-03 / FR-04).

    会话归属复核（404 不泄露存在性）→ 行锁取条目（条目不存在 / 非该会话
    条目 → 404 :class:`DaemonScheduledMessageNotFound`）→ 非 pending → 409
    :class:`DaemonScheduledMessageNotPending`（终态不回退）→ 置
    ``cancelled`` 并写 ``cancelled_at = now(UTC)``。

    条目行锁 + 锁内状态复核与 task-04 sweeper 到点派发互为串行化（R-01）：
    取消与派发谁先拿到锁谁生效，后到者见非 pending 幂等退出（派发侧）/
    409（取消侧）。
    """
    owned = (
        await svc._session.execute(
            select(AgentSession.id).where(
                AgentSession.id == session_id,
                AgentSession.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if owned is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )
    entry = (
        await svc._session.execute(
            select(AgentSessionScheduledMessage)
            .where(
                AgentSessionScheduledMessage.id == message_id,
                AgentSessionScheduledMessage.agent_session_id == session_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if entry is None:
        raise DaemonScheduledMessageNotFound(
            f"ScheduledMessage '{message_id}' not found in session '{session_id}'.",
            details={"session_id": str(session_id), "message_id": str(message_id)},
        )
    if entry.status != "pending":
        status = entry.status
        await svc._session.rollback()  # 释放 FOR UPDATE 行锁（终态不可取消）
        raise DaemonScheduledMessageNotPending(
            f"定时消息已处于 {status} 状态，仅待发送条目可取消。",
            details={
                "session_id": str(session_id),
                "message_id": str(message_id),
                "status": status,
            },
        )
    entry.status = "cancelled"
    entry.cancelled_at = datetime.now(UTC)
    await svc._session.commit()
