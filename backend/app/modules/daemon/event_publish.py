"""同构 Redis publish helper 共享核心（task-11 轻重构④，design §5 Wave 2）。

五处同构「get_redis 延迟解析 → ``json.dumps(default=str)`` → publish → 异常
吞噬 + ``log.warning``」的收敛基线：

- session/service/helpers.py ``_publish_session_event``；
- run_sync/service/publish.py ``publish_session_event`` / ``_publish_run_event``；
- group/service/typing_presence.py ``_publish_group_channel_event`` /
  ``_publish_group_typing_event``（rate_limit / member_interrupted /
  trigger_failed 三个系统行组装器与 typing/presence 组装器经此二者间接复用）。

收敛口径（严格）：只共享低层「序列化 + publish + 异常吞噬 + 日志」核心；
channel 构造、payload 组装（含 BaseModel ``model_dump(by_alias=True)`` 预处理）、
各处公开签名、失败日志事件名与上下文字段全部留在调用点——调用方可见行为
零变化（publish_submitted_messages 的 pipeline 批量发布形态不同构，不收敛）。

D-007：本模块**不直接 import get_redis**——``redis_getter`` 由调用方传入，
各包一律经 ``_svc/_rsvc/_gsvc.get_redis`` 命名空间属性在调用时延迟解析
（既有 patch 面全部继续拦截）；``log`` 同理由调用方传入（各包 ``_svc.log``
等，模块级 logger 身份与事件名不变）。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any


async def publish_json_event(
    *,
    redis_getter: Callable[[], Any],
    channel: str,
    payload: object,
    log: Any,
    failure_event: str,
    **log_context: object,
) -> None:
    """``json.dumps(default=str)`` → ``redis.publish`` → 异常吞噬 + ``log.warning``。

    与收敛前各处逐字等价的执行序：getter 取 redis 与 publish 同在 try 内
    （``get_redis()`` 本身抛错同样被吞噬，不向上冒泡）；序列化统一
    ``default=str`` 兜底不可序列化对象；失败仅记 ``log.warning(failure_event,
    **log_context)``——Redis Pub/Sub 无历史，漏发实时事件不影响 DB 真相，
    前端重连即续流。
    """
    try:
        redis = redis_getter()
        await redis.publish(channel, json.dumps(payload, default=str))
    except Exception:
        log.warning(failure_event, **log_context)
