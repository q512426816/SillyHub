"""agent_sessions 列表变更信号的统一发布入口（task-01）。

session 创建 / 状态变更 / 删除时，向 Redis 全局频道 ``agent_sessions:changed``
广播一条轻量信号，订阅方（SSE/WS 列表推送）据此刷新列表视图。发布失败只
log.warning 不抛——容错语义对齐 ``session/service.py`` ``_publish_session_event``：
Redis 抖动不能阻断业务写路径。
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Literal

from app.core.logging import get_logger
from app.core.redis import get_redis

log = get_logger(__name__)

# 全局列表变更频道（区别于 per-session 的 agent_session:{session_id} 频道）
SESSIONS_CHANGED_CHANNEL = "agent_sessions:changed"

SessionChangeEvent = Literal["created", "status_changed", "deleted"]


async def publish_sessions_changed(
    event: SessionChangeEvent,
    session_id: uuid.UUID,
    user_id: uuid.UUID | None,
    *,
    audience_user_ids: Sequence[uuid.UUID] | None = None,
) -> None:
    """向 ``SESSIONS_CHANGED_CHANNEL`` 发布一条列表变更信号。

    * ``user_id`` 为 None 且无 audience 直接跳过——无主数据不进任何用户的
      列表视图，广播无意义。
    * ``audience_user_ids``（2026-09-01-session-group-chat task-06，design §5.3）：
      群会话事件的受众用户 id 列表**内嵌进 payload**（订阅侧免每事件查库）；
      ``_stream_sessions_events`` 过滤为「payload.user_id 命中或当前用户在
      audience_user_ids 中」。单聊调用点不传 → payload 不含该字段，存量行为
      零漂移。
    * 任何异常（Redis 不可用 / publish 超时 / 序列化失败）只记 warning 不抛，
      保证调用方（创建 / 结束 / 删除等业务路径）不被信号基建拖挂。
    """
    if user_id is None and not audience_user_ids:
        return
    payload: dict[str, object] = {
        "event": event,
        "session_id": str(session_id),
        "user_id": str(user_id) if user_id is not None else None,
        "at": datetime.now(UTC).isoformat(),
    }
    if audience_user_ids:
        payload["audience_user_ids"] = [str(uid) for uid in audience_user_ids]
    try:
        redis = get_redis()
        await redis.publish(SESSIONS_CHANGED_CHANNEL, json.dumps(payload))
    except Exception:
        # structlog 首参名即 event，键名用 redis_event 避免冲突（先例 service.py 同款）
        log.warning(
            "publish_sessions_changed_failed",
            redis_event=event,
            session_id=str(session_id),
            user_id=str(user_id),
        )
