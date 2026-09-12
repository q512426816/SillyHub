"""session 排队消息端点（task-07 拆分，原 session_extras 队列域）。

排队消息 6 端点（ql-20260825-011 / 2026-08-31-session-queue-ux）：
GET / DELETE / PATCH / reorder / retry / dispatch-now。路由注册顺序铁律
（design §5）：``/queue/reorder`` 必须先于 ``/queue/{entry_id}`` 声明——
FastAPI 按注册顺序匹配，否则字面量 reorder 被路径参数捕获 → 422。
``SessionQueueEntry`` / ``_queue_entry_dto`` / ``SessionQueueResponse`` /
``SessionQueueEntryUpdateResponse`` 随域同迁。

D-010 第二回合（merge main 2ad590192）：定时消息三端点（2026-09-07-session-
pin-rename-scheduled-send task-03）按域落位于此（非即时消息族：排队=忙轮
缓冲、定时=到点派发，派发侧同走 inject/队列链路）。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import status
from pydantic import BaseModel, Field

from app.modules.daemon.router import SessionDep, TaskRunAgentUser, router
from app.modules.daemon.schema import (
    QueueDispatchNowResponse,
    QueueEntryUpdateRequest,
    QueueReorderRequest,
    ScheduledMessageCreateRequest,
    ScheduledMessageRead,
)
from app.modules.daemon.service import DaemonService


class SessionQueueEntry(BaseModel):
    """排队消息条目（ql-20260825-011，GET /sessions/{id}/queue 项）。

    ``position``（2026-08-31-session-queue-ux FR-04/D-002）：队列序键，与
    派发序同源（ORDER BY position, created_at）——拖拽重排后据此渲染顺序。
    """

    id: uuid.UUID
    prompt: str
    attachment_ids: list[uuid.UUID] = Field(default_factory=list)
    agent_profile_id: str | None = None
    llm_provider_id: str | None = None
    status: str
    error_msg: str | None = None
    position: int
    # 2026-09-12-chat-turn-auto-recovery FR-5.0：'auto_resume:<rid>' = 系统
    # 自动恢复入队（列 2026-09-10 已建，DTO 此前未透出）；None = 用户排队。
    origin: str | None = None
    created_at: datetime


def _queue_entry_dto(entry) -> SessionQueueEntry:
    """ORM 行 → DTO（attachment_ids JSON 字符串列表宽容解析）。"""
    parsed: list[uuid.UUID] = []
    for raw in entry.attachment_ids or []:
        try:
            parsed.append(uuid.UUID(str(raw)))
        except (ValueError, TypeError):
            continue
    return SessionQueueEntry(
        id=entry.id,
        prompt=entry.prompt,
        attachment_ids=parsed,
        agent_profile_id=entry.agent_profile_id,
        llm_provider_id=entry.llm_provider_id,
        status=entry.status,
        error_msg=entry.error_msg,
        position=entry.position,
        origin=entry.origin,
        created_at=entry.created_at,
    )


class SessionQueueResponse(BaseModel):
    session_id: uuid.UUID
    items: list[SessionQueueEntry] = Field(default_factory=list)


class SessionQueueEntryUpdateResponse(BaseModel):
    """PATCH /sessions/{id}/queue/{entry_id} 响应体（2026-08-31-session-queue-ux
    design §5）：``entry`` 包裹键（区别于 retry 端点的裸 DTO）。"""

    entry: SessionQueueEntry


@router.get(
    "/sessions/{session_id}/queue",
    response_model=SessionQueueResponse,
)
async def list_session_queue(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> SessionQueueResponse:
    """列出会话排队消息（ql-20260825-011，created_at 升序 = 派发顺序）。"""
    svc = DaemonService(session)
    entries = await svc.list_queued_messages(session_id, user.id)
    return SessionQueueResponse(
        session_id=session_id,
        items=[_queue_entry_dto(entry) for entry in entries],
    )


# 路由注册顺序铁律（design §5）：/queue/reorder 必须先于 /queue/{entry_id}
# 声明——FastAPI 按注册顺序匹配，否则字面量 reorder 被路径参数捕获 → 422。
@router.patch(
    "/sessions/{session_id}/queue/reorder",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def reorder_session_queue(
    session_id: uuid.UUID,
    data: QueueReorderRequest,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> None:
    """拖拽排序持久化（2026-08-31-session-queue-ux FR-04）。

    全量 entry_ids 按上传序重写 position 0..n-1；集合不一致 422
    QUEUE_ORDER_MISMATCH（D-003）。
    """
    svc = DaemonService(session)
    await svc.reorder_queued_messages(session_id, data.entry_ids, user.id)


@router.delete(
    "/sessions/{session_id}/queue/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_session_queue_entry(
    session_id: uuid.UUID,
    entry_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> None:
    """删除一条排队消息（用户在队列条上点 ×）。"""
    svc = DaemonService(session)
    await svc.delete_queued_message(session_id, entry_id, user.id)


@router.patch(
    "/sessions/{session_id}/queue/{entry_id}",
    response_model=SessionQueueEntryUpdateResponse,
)
async def update_session_queue_entry(
    session_id: uuid.UUID,
    entry_id: uuid.UUID,
    data: QueueEntryUpdateRequest,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> SessionQueueEntryUpdateResponse:
    """编辑排队消息 prompt（2026-08-31-session-queue-ux FR-06）。

    仅改文本（附件/快照不动，NG-01）；空文本/超 8000 → 422；TASK_WAKEUP
    系统通知条目 → 409（D-009）；failed 条目保存后重置 pending + 清 error
    并尝试派发。响应体为 ``entry`` 包裹键（design §5，区别于 retry 裸 DTO）。
    """
    svc = DaemonService(session)
    entry = await svc.update_queued_message(session_id, entry_id, data.prompt, user.id)
    return SessionQueueEntryUpdateResponse(entry=_queue_entry_dto(entry))


@router.post(
    "/sessions/{session_id}/queue/{entry_id}/retry",
    response_model=SessionQueueEntry,
)
async def retry_session_queue_entry(
    session_id: uuid.UUID,
    entry_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
):
    """failed 排队消息重试（翻 pending 并立即尝试派发，忙则留队）。"""
    svc = DaemonService(session)
    entry = await svc.retry_queued_message(session_id, entry_id, user.id)
    return _queue_entry_dto(entry)


@router.post(
    "/sessions/{session_id}/queue/{entry_id}/dispatch-now",
    response_model=QueueDispatchNowResponse,
)
async def dispatch_now_session_queue_entry(
    session_id: uuid.UUID,
    entry_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> QueueDispatchNowResponse:
    """立即发送排队消息（2026-08-31-session-queue-ux FR-05 / D-001）。

    条目置队首；忙=打断当前轮（interrupt 接力派发，``interrupted=true``），
    空闲=当场派发（``interrupted=false``，条目可能已删行）；非 active 409。
    """
    svc = DaemonService(session)
    interrupted = await svc.dispatch_queued_message_now(session_id, entry_id, user.id)
    return QueueDispatchNowResponse(interrupted=interrupted)


# task-03（2026-09-07-session-pin-rename-scheduled-send / FR-04 / D-001@v1）：
# 定时消息三端点——创建（201）/列表/取消（204），TaskRunAgentUser 鉴权。三重
# 校验（空 prompt 422 / dispatch_at 过近 422 / 终态或软删会话 409）与归属
# 404 均归 SessionService；到点派发归 task-04 sweeper，端点不触发 inject。


@router.post(
    "/sessions/{session_id}/scheduled",
    status_code=status.HTTP_201_CREATED,
)
async def create_scheduled_message(
    session_id: uuid.UUID,
    data: ScheduledMessageCreateRequest,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> ScheduledMessageRead:
    """Create a one-shot scheduled message for an owned session (status=pending)."""
    row = await DaemonService(session).create_scheduled_message(session_id, user.id, data)
    return ScheduledMessageRead.model_validate(row)


@router.get("/sessions/{session_id}/scheduled")
async def list_scheduled_messages(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> list[ScheduledMessageRead]:
    """List all scheduled messages of an owned session (all statuses, dispatch_at asc)."""
    rows = await DaemonService(session).list_scheduled_messages(session_id, user.id)
    return [ScheduledMessageRead.model_validate(row) for row in rows]


@router.delete(
    "/sessions/{session_id}/scheduled/{message_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def cancel_scheduled_message(
    session_id: uuid.UUID,
    message_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> None:
    """Cancel a pending scheduled message (non-pending → 409, terminal no-revert)."""
    await DaemonService(session).cancel_scheduled_message(session_id, message_id, user.id)
