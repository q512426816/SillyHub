"""轻量性能监控。

三件套，零依赖，生产/本地通用：
1. 慢请求中间件：任何接口耗时 >1s 打 slow.request 日志
2. 事件循环堵塞看门狗：后台协程每 100ms 自检，被堵 >500ms 打 event_loop.blocked 日志
3. 慢查询日志：SQLAlchemy 事件监听，SQL 执行 >500ms 打 slow.query 日志
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.logging import get_logger

log = get_logger(__name__)

# 阈值（硬编码，后续要调再加 settings）
SLOW_REQUEST_THRESHOLD_S = 1.0  # 慢请求：>1 秒
SLOW_QUERY_THRESHOLD_S = 0.5  # 慢查询：>500 毫秒
EVENT_LOOP_BLOCKED_THRESHOLD_S = 0.5  # 事件循环堵塞：>500 毫秒
EVENT_LOOP_CHECK_INTERVAL_S = 0.1  # 看门狗自检间隔：100 毫秒


async def slow_request_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """慢请求中间件：任何接口耗时 >1s 打 slow.request 日志。

    挂在 main.py request_id_middleware 旁边，复用 request.state.request_id。
    """
    start = time.perf_counter()
    response = await call_next(request)
    duration_s = time.perf_counter() - start

    if duration_s >= SLOW_REQUEST_THRESHOLD_S:
        log.warning(
            "slow.request",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=round(duration_s * 1000, 2),
            request_id=getattr(request.state, "request_id", None),
        )

    return response


async def _event_loop_watchdog() -> None:
    """事件循环堵塞看门狗（后台协程）。

    每 100ms 自检一次：记录上次醒来时间，如果本次醒来晚了 >500ms，
    说明事件循环被同步调用堵住了，打 event_loop.blocked 日志。
    """
    last_wake = time.perf_counter()
    while True:
        await asyncio.sleep(EVENT_LOOP_CHECK_INTERVAL_S)
        now = time.perf_counter()
        blocked_s = now - last_wake - EVENT_LOOP_CHECK_INTERVAL_S
        if blocked_s >= EVENT_LOOP_BLOCKED_THRESHOLD_S:
            log.warning(
                "event_loop.blocked",
                blocked_ms=round(blocked_s * 1000, 2),
                expected_interval_ms=round(EVENT_LOOP_CHECK_INTERVAL_S * 1000, 2),
            )
        last_wake = now


def start_event_loop_watchdog() -> asyncio.Task[None]:
    """启动事件循环堵塞看门狗（返回 task，供 lifespan 管理）。"""
    return asyncio.create_task(_event_loop_watchdog())


def stop_event_loop_watchdog(task: asyncio.Task[None]) -> None:
    """停止看门狗（lifespan shutdown 时调用）。"""
    task.cancel()
    try:
        # 不 await cancel 完成（lifespan shutdown 上下文，立即返回即可）
        pass
    except Exception:
        log.exception("event_loop.watchdog_stop_failed")


def setup_slow_query_logging(engine: AsyncEngine) -> None:
    """慢查询日志：SQLAlchemy 事件监听，SQL 执行 >500ms 打 slow.query 日志。

    在 db.py 创建 engine 后调用一次。
    """
    sync_engine = engine.sync_engine

    @event.listens_for(sync_engine, "before_cursor_execute")
    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        conn.info["query_start_time"] = time.perf_counter()

    @event.listens_for(sync_engine, "after_cursor_execute")
    def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        start_time = conn.info.pop("query_start_time", None)
        if start_time is None:
            return
        duration_s = time.perf_counter() - start_time

        if duration_s >= SLOW_QUERY_THRESHOLD_S:
            # 截断 SQL 防日志爆炸（最多 500 字符）
            sql_preview = statement[:500] + ("..." if len(statement) > 500 else "")
            log.warning(
                "slow.query",
                duration_ms=round(duration_s * 1000, 2),
                sql=sql_preview,
                parameters=str(parameters)[:200] if parameters else None,
            )
