"""轻量性能监控。

四件套，零依赖，生产/本地通用：
1. 慢请求中间件：任何接口耗时 >1s 打 slow.request 日志
2. 事件循环堵塞看门狗：后台协程每 100ms 自检，被堵 >500ms 打 event_loop.blocked 日志
3. 慢查询日志：SQLAlchemy 事件监听，SQL 执行 >500ms 打 slow.query 日志
4. DB 阻塞应急采样：请求耗时 >=10s 时异步采样 pg_stat_activity
   （含 wait_event、锁等待链），打 db.stat_activity_sample 日志——
   容器重建会清掉 `docker exec psql` 的现场，落进日志才能事后追因
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Request, Response
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.logging import get_logger

log = get_logger(__name__)

# 阈值（硬编码，后续要调再加 settings）
SLOW_REQUEST_THRESHOLD_S = 1.0  # 慢请求：>1 秒
SLOW_QUERY_THRESHOLD_S = 0.5  # 慢查询：>500 毫秒
EVENT_LOOP_BLOCKED_THRESHOLD_S = 0.5  # 事件循环堵塞：>500 毫秒
EVENT_LOOP_CHECK_INTERVAL_S = 0.1  # 看门狗自检间隔：100 毫秒

# DB 阻塞应急采样阈值：请求 >=10s（大概率是 DB 卡住而非业务慢）才值得采快照
DB_BLOCKING_SAMPLE_THRESHOLD_S = 10.0
# 采样节流：窗口内多个慢请求只采一次，防日志爆炸
DB_BLOCKING_SAMPLE_MIN_INTERVAL_S = 30.0
# 采样自身超时：观测手段不能反过来卡住自己（独立连接 + 短超时兜底）
DB_BLOCKING_SAMPLE_TIMEOUT_S = 5.0

# 非空闲会话快照：wait_event + 已运行时长 + SQL 预览（截断防日志爆炸）
_PG_ACTIVITY_SQL = text(
    """
    SELECT pid, state, wait_event_type, wait_event,
           now() - query_start AS query_duration,
           left(query, 300) AS query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND state IS DISTINCT FROM 'idle'
    ORDER BY query_start NULLS LAST
    LIMIT 50
    """
)

# 锁等待链：谁被谁挡着（pg_blocking_pids 展开到 blocker 行，含 blocker 的 SQL）
_PG_BLOCKING_SQL = text(
    """
    SELECT blocked.pid AS blocked_pid,
           pg_blocking_pids(blocked.pid) AS blocked_by,
           left(blocked.query, 300) AS blocked_query,
           blocker.pid AS blocker_pid,
           blocker.state AS blocker_state,
           left(blocker.query, 300) AS blocker_query
    FROM pg_stat_activity AS blocked
    LEFT JOIN pg_stat_activity AS blocker
           ON blocker.pid = ANY(pg_blocking_pids(blocked.pid))
    WHERE cardinality(pg_blocking_pids(blocked.pid)) > 0
    LIMIT 50
    """
)

# 采样专用引擎：NullPool 短连接，不占共享池（DB 阻塞时共享池往往已耗尽）
_sample_engine: AsyncEngine | None = None
_last_sample_at: float = 0.0
# 持有进行中的采样任务强引用，防 GC 中途回收
_sample_tasks: set[asyncio.Task[None]] = set()


def _get_sample_engine() -> AsyncEngine | None:
    """返回采样专用引擎；非 PostgreSQL（测试 SQLite）返回 None 表示跳过。"""
    global _sample_engine
    if _sample_engine is not None:
        return _sample_engine
    from app.core.config import get_settings

    url = str(get_settings().database_url)
    if not url.startswith("postgresql"):
        return None
    # 不挂慢查询监听（采样是观测手段，别自我递归）；NullPool 用完即还，无需 dispose
    _sample_engine = create_async_engine(url, poolclass=NullPool)
    return _sample_engine


def _row_to_plain(row: Any) -> dict[str, Any]:
    """把 SQL 行转成可安全进 JSON 日志的 dict（timedelta 等非基础类型转字符串）。"""
    plain: dict[str, Any] = {}
    for key, value in row.items():
        plain[key] = (
            value
            if isinstance(value, (str, int, float, bool, list)) or value is None
            else str(value)
        )
    return plain


async def _sample_pg_stat_activity(trigger: dict[str, Any]) -> None:
    """采样 pg_stat_activity 快照写入 db.stat_activity_sample 日志。

    任何失败（超时 / 连接失败 / 权限）只打 db.stat_activity_sample_failed，
    绝不向上抛——这是应急观测，不能成为新的故障源。
    """
    global _last_sample_at
    now = time.monotonic()
    if now - _last_sample_at < DB_BLOCKING_SAMPLE_MIN_INTERVAL_S:
        return  # 节流窗口内，跳过
    _last_sample_at = now
    try:
        engine = _get_sample_engine()
        if engine is None:
            return  # 非 PG 环境（SQLite 测试），无事可做
        async with asyncio.timeout(DB_BLOCKING_SAMPLE_TIMEOUT_S):
            async with engine.connect() as conn:
                activity = (await conn.execute(_PG_ACTIVITY_SQL)).mappings().all()
                blocking = (await conn.execute(_PG_BLOCKING_SQL)).mappings().all()
        log.warning(
            "db.stat_activity_sample",
            trigger=trigger,
            activity=[_row_to_plain(r) for r in activity],
            blocking_chain=[_row_to_plain(r) for r in blocking],
        )
    except Exception:
        log.exception("db.stat_activity_sample_failed", trigger=trigger)


def _fire_db_blocking_sample(**trigger: Any) -> None:
    """后台调度一次采样（fire-and-forget，不阻塞响应返回）。"""
    try:
        task = asyncio.create_task(_sample_pg_stat_activity(dict(trigger)))
    except RuntimeError:
        return  # 无运行中的事件循环（非请求上下文误调），静默跳过
    _sample_tasks.add(task)
    task.add_done_callback(_sample_tasks.discard)


async def slow_request_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """慢请求中间件：任何接口耗时 >1s 打 slow.request 日志。

    挂在 main.py request_id_middleware 旁边，复用 request.state.request_id。
    耗时 >=10s 时额外异步采样 pg_stat_activity（DB 阻塞应急观测）。
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
        if duration_s >= DB_BLOCKING_SAMPLE_THRESHOLD_S:
            _fire_db_blocking_sample(
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
