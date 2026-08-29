"""notification router — REST 四端点（task-07 / design §7.2）.

- GET  /notifications：本人通知列表（?limit=20&offset=0&unread_only=false，
  created_at DESC）→ NotificationListResponse{items, total}
- GET  /notifications/unread-count → {count}
- POST /notifications/{id}/read：单条已读 → NotificationRead；越权/不存在
  由 service 抛 NotificationNotFound（AppError 子类，http_status=404，经
  全局 error handler 转 JSON 错误响应）
- POST /notifications/read-all → {updated}
- GET  /notifications/events：SSE 实时推送（task-08 / design §7.2）——
  订阅 ``notifications:new`` 频道，仅当 payload.recipient_user_ids 含
  当前用户才下发 ``event: notification`` 帧（服务端过滤，R-06 跨用户隔离）

鉴权仅登录（``get_current_user``）——返回行天然限定为调用者本人，
无需 RBAC（对齐 workspace 列表端点惯例）。SSE 的 token 经 Authorization
header 由前端 fetch-sse 传（EventSource 不支持自定义 header）。
main 挂 ``prefix="/api"`` 落地 ``/api/notifications...``。
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user
from app.core.db import get_session
from app.core.redis import get_redis
from app.modules.auth.model import User
from app.modules.notification.events import NOTIFICATIONS_CHANNEL
from app.modules.notification.schema import (
    NotificationListResponse,
    NotificationRead,
    ReadAllResponse,
    UnreadCountResponse,
    to_notification_read,
)
from app.modules.notification.service import NotificationService

router = APIRouter(prefix="/notifications", tags=["notification"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    session: SessionDep,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    unread_only: bool = False,
) -> NotificationListResponse:
    """本人通知列表（created_at DESC）+ 总数，供分页。"""
    service = NotificationService(session)
    rows, total = await service.list_for_user(
        user_id=user.id, limit=limit, offset=offset, unread_only=unread_only
    )
    return NotificationListResponse(items=[to_notification_read(r) for r in rows], total=total)


@router.get("/unread-count", response_model=UnreadCountResponse)
async def get_unread_count(session: SessionDep, user: CurrentUser) -> UnreadCountResponse:
    """本人未读数（徽标首载/兜底轮询）。"""
    service = NotificationService(session)
    return UnreadCountResponse(count=await service.unread_count(user_id=user.id))


@router.post("/{notification_id}/read", response_model=NotificationRead)
async def mark_notification_read(
    notification_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> NotificationRead:
    """单条标记已读；非本人或不存在 → NotificationNotFound（404）。"""
    service = NotificationService(session)
    row = await service.mark_read(user_id=user.id, notification_id=notification_id)
    return to_notification_read(row)


@router.post("/read-all", response_model=ReadAllResponse)
async def mark_all_notifications_read(session: SessionDep, user: CurrentUser) -> ReadAllResponse:
    """全部已读，返回更新行数。"""
    service = NotificationService(session)
    return ReadAllResponse(updated=await service.mark_all_read(user_id=user.id))


# ---------------------------------------------------------------------------
# SSE：GET /api/notifications/events（task-08 / FR-07 / design §7.2）
# ---------------------------------------------------------------------------

# SSE response headers——逐字照抄 daemon/router.py _SESSION_SSE_HEADERS 先例
# （agent/router.py 同款）：代理/缓冲不得扣留 SSE 帧。
_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

# keepalive 间隔（饥饿防护，照 daemon SESSIONS_EVENTS_KEEPALIVE_INTERVAL_SEC
# 先例）：无论是否收到消息，超过该秒数未向客户端产出任何帧即补一条
# ``: keepalive`` 注释帧。取 25s——早于 get_message 的 30s 轮询超时与常见
# 代理的 60s 空闲断连线。模块级常量便于测试置 0 模拟「静默即 keepalive」。
NOTIFICATIONS_EVENTS_KEEPALIVE_INTERVAL_SEC = 25.0


@router.get("/events")
async def stream_notifications_events(
    user: CurrentUser,
) -> StreamingResponse:
    """SSE 实时通知流（task-08 / FR-07 / design §7.2）。

    前端 fetch-sse 订阅 ``GET /api/notifications/events``（token 经
    Authorization header 传，EventSource 不支持自定义 header 故不适用），
    收到 ``event: notification`` 帧后刷新列表/徽标。无 Last-Event-ID 回放
    （漏发由前端重连后列表查询兜底，D-003@v2 Non-Goal）。

    单频道 + 服务端过滤（R-06 跨用户隔离）：所有用户共享
    ``NOTIFICATIONS_CHANNEL`` 全局频道，本生成器仅当 payload 的
    ``recipient_user_ids`` 含当前用户 id 时下发通知摘要，他人信号静默丢弃。

    连接池安全（对齐 daemon stream_sessions_events）：不注入请求级 DB
    session；鉴权链（get_current_user）查库完成后即归还 DB 连接，生成器内
    零 DB 访问——流存续期间不占用任何连接池 slot。
    """
    return StreamingResponse(
        _stream_notifications_events(str(user.id)),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


async def _stream_notifications_events(user_id: str) -> AsyncGenerator[str, None]:
    """订阅 ``notifications:new`` 频道并按收件人过滤下发（生成器体）。

    帧协议（对齐 daemon _stream_sessions_events 先例）：
    * ``: connected`` 初始注释——立即冲掉代理缓冲，让客户端尽快 open；
    * ``event: notification`` + ``data: <json>`` —— payload 含当前用户时
      下发通知摘要（payload["notification"]，InAppChannel.deliver 发布侧
      构造：id/type/title/body/link/created_at）；
    * ``: keepalive`` —— 静默约 30s（get_message timeout 到点返回 None）或
      持续他人信号（跳过不产出帧）超过 keepalive 间隔无产出时，发一条
      注释帧维持连接；
    * finally —— 客户端断开（GeneratorExit）或异常时 unsubscribe + aclose，
      不泄漏 Redis 订阅连接。
    """
    redis = get_redis()
    pubsub = redis.pubsub()
    keepalive_interval_sec = NOTIFICATIONS_EVENTS_KEEPALIVE_INTERVAL_SEC
    loop = asyncio.get_running_loop()
    last_frame_at = loop.time()
    try:
        yield ": connected\n\n"

        await pubsub.subscribe(NOTIFICATIONS_CHANNEL)

        while True:
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=30.0)
            emitted = False
            if msg and msg.get("type") == "message":
                raw = msg.get("data")
                try:
                    payload = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    payload = {}
                # 非对象 JSON（list / str / number…）没有 recipient_user_ids
                # 可过滤，按非本人信号跳过；防御 payload.get 的
                # AttributeError 炸掉整条流（daemon 先例 2026-08-25 P1）。
                if not isinstance(payload, dict):
                    payload = {}
                recipients = payload.get("recipient_user_ids")
                notification = payload.get("notification")
                # 单频道广播 + 服务端过滤（R-06）：仅当前用户是收件人才下发；
                # notification 摘要缺失（异常 payload）按无信号跳过。
                if (
                    isinstance(recipients, list)
                    and user_id in recipients
                    and isinstance(notification, dict)
                ):
                    yield (
                        f"event: notification\ndata: {json.dumps(notification, default=str)}\n\n"
                    )
                    emitted = True
            if emitted:
                last_frame_at = loop.time()
            elif loop.time() - last_frame_at >= keepalive_interval_sec:
                yield ": keepalive\n\n"
                last_frame_at = loop.time()
    finally:
        # 两步清理各自隔离（daemon 先例 2026-08-25 P1）：连接已死时
        # unsubscribe 可能抛 ConnectionError——吞掉并记 warning，保证随后的
        # aclose（归还 Redis 连接）仍然执行。
        try:
            await pubsub.unsubscribe(NOTIFICATIONS_CHANNEL)
        except Exception:
            from app.core.logging import get_logger

            get_logger(__name__).warning(
                "notifications_events_unsubscribe_failed",
                channel=NOTIFICATIONS_CHANNEL,
            )
        await pubsub.aclose()
