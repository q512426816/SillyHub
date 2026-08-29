"""notifications:new 全局频道的 best-effort 发布助手（task-02 / D-006@v1）.

镜像 ``daemon/session_events.py`` 先例：向 Redis 频道发布站内通知到达信号，
订阅方（SSE ``/api/notifications/events``）据此外推。发布失败只 log.warning
不抛——Redis 抖动不能阻断业务写路径（落库结果与投递信号解耦）。
"""

from __future__ import annotations

import json
from typing import Any

from app.core.logging import get_logger
from app.core.redis import get_redis

log = get_logger(__name__)

# 站内通知到达频道（SSE 订阅方按 payload.recipient_user_ids 过滤下发）。
NOTIFICATIONS_CHANNEL = "notifications:new"


async def publish_notifications_new(payload: dict[str, Any]) -> None:
    """向 ``NOTIFICATIONS_CHANNEL`` 发布一条通知到达信号。

    任何异常（Redis 不可用 / publish 超时 / 序列化失败）只记 warning 不抛，
    保证调用方（notify_broadcast / notify_user / InAppChannel.deliver）
    不被信号基建拖挂。
    """
    try:
        redis = get_redis()
        await redis.publish(NOTIFICATIONS_CHANNEL, json.dumps(payload))
    except Exception:
        # structlog 首参名即 event，键名用 redis_event 避免冲突
        # （先例 daemon/session_events.py 同款）。
        log.warning(
            "publish_notifications_new_failed",
            redis_event="notification",
            channel=NOTIFICATIONS_CHANNEL,
        )
