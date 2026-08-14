"""monitoring.py 单测：慢请求中间件阈值 + DB 阻塞应急采样（pg_stat_activity）。

采样逻辑不依赖真实 PG：引擎获取 / 连接执行全部用替身注入，
验证触发条件、节流、非 PG 跳过、超时兜底与日志落盘字段。
"""

from __future__ import annotations

import asyncio
import types
from typing import Any

from app.core import monitoring


def _make_request(path: str = "/api/test", method: str = "GET") -> Any:
    """构造 slow_request_middleware 需要的最小 request 替身。"""
    return types.SimpleNamespace(
        method=method,
        url=types.SimpleNamespace(path=path),
        state=types.SimpleNamespace(request_id="rid-1"),
    )


class SpyLog:
    """记录 warning/exception 调用的日志替身。"""

    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []

    def warning(self, event: str, **kw: Any) -> None:
        self.events.append((event, kw))

    def exception(self, event: str, **kw: Any) -> None:
        self.events.append((event, kw))


class FakeResult:
    """模拟 SQLAlchemy Result.mappings().all() 链。"""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def mappings(self) -> "FakeResult":
        return self

    def all(self) -> list[dict[str, Any]]:
        return self._rows


class FakeConn:
    """按调用顺序返回 activity / blocking 两批结果。"""

    def __init__(self, results: list[list[dict[str, Any]]]) -> None:
        self._results = list(results)

    async def execute(self, _sql: Any) -> FakeResult:
        return FakeResult(self._results.pop(0))


class FakeConnCtx:
    def __init__(self, conn: Any) -> None:
        self._conn = conn

    async def __aenter__(self) -> Any:
        return self._conn

    async def __aexit__(self, *exc: Any) -> bool:
        return False


class FakeEngine:
    def __init__(self, conn: Any) -> None:
        self._conn = conn

    def connect(self) -> FakeConnCtx:
        return FakeConnCtx(self._conn)


# ── 中间件触发条件 ──────────────────────────────────────────────


async def test_slow_request_over_blocking_threshold_fires_db_sample(monkeypatch) -> None:
    """>=10s 的慢请求应触发 DB 阻塞采样，且携带 path/request_id/duration。"""
    fired: list[dict[str, Any]] = []
    monkeypatch.setattr(monitoring, "SLOW_REQUEST_THRESHOLD_S", 0.0)
    monkeypatch.setattr(monitoring, "DB_BLOCKING_SAMPLE_THRESHOLD_S", 0.0)
    monkeypatch.setattr(monitoring, "_fire_db_blocking_sample", lambda **kw: fired.append(kw))

    async def call_next(_request: Any) -> Any:
        await asyncio.sleep(0.01)
        return types.SimpleNamespace(status_code=200)

    response = await monitoring.slow_request_middleware(_make_request(), call_next)
    assert response.status_code == 200
    assert len(fired) == 1
    assert fired[0]["path"] == "/api/test"
    assert fired[0]["request_id"] == "rid-1"
    assert fired[0]["duration_ms"] > 0


async def test_slow_request_under_blocking_threshold_no_db_sample(monkeypatch) -> None:
    """1s~10s 的普通慢请求只打 slow.request 日志，不采样。"""
    fired: list[dict[str, Any]] = []
    monkeypatch.setattr(monitoring, "SLOW_REQUEST_THRESHOLD_S", 0.0)
    monkeypatch.setattr(monitoring, "DB_BLOCKING_SAMPLE_THRESHOLD_S", 10.0)
    monkeypatch.setattr(monitoring, "_fire_db_blocking_sample", lambda **kw: fired.append(kw))

    async def call_next(_request: Any) -> Any:
        await asyncio.sleep(0.01)
        return types.SimpleNamespace(status_code=200)

    await monitoring.slow_request_middleware(_make_request(), call_next)
    assert fired == []


async def test_fire_db_blocking_sample_runs_sample(monkeypatch) -> None:
    """异步上下文里 _fire 调度采样任务并真实执行一次。"""
    sampled: list[dict[str, Any]] = []

    async def fake_sample(trigger: dict[str, Any]) -> None:
        sampled.append(trigger)

    monkeypatch.setattr(monitoring, "_sample_pg_stat_activity", fake_sample)
    monitoring._fire_db_blocking_sample(path="/api/x", request_id="r")
    await asyncio.sleep(0)
    assert sampled == [{"path": "/api/x", "request_id": "r"}]


# ── 采样引擎获取 ────────────────────────────────────────────────


def test_get_sample_engine_skips_non_pg(monkeypatch) -> None:
    """SQLite（测试环境）无 pg_stat_activity，应返回 None 且不建引擎。"""
    from app.core import config

    monkeypatch.setattr(
        config,
        "get_settings",
        lambda: types.SimpleNamespace(database_url="sqlite+aiosqlite:///./test.db"),
    )
    monkeypatch.setattr(monitoring, "_sample_engine", None)
    assert monitoring._get_sample_engine() is None


def test_get_sample_engine_creates_pg_engine_and_caches(monkeypatch) -> None:
    """PG URL 建独立 NullPool 引擎并缓存（二次调用复用，不重复建）。"""
    from app.core import config

    monkeypatch.setattr(
        config,
        "get_settings",
        lambda: types.SimpleNamespace(database_url="postgresql+asyncpg://u:p@localhost:5432/db"),
    )
    monkeypatch.setattr(monitoring, "_sample_engine", None)
    engine = monitoring._get_sample_engine()
    assert engine is not None
    assert engine.dialect.name == "postgresql"
    assert monitoring._get_sample_engine() is engine


# ── 采样执行 ────────────────────────────────────────────────────


async def test_sample_logs_activity_and_blocking_chain(monkeypatch) -> None:
    """正常采样：activity + 锁等待链两批结果写入 db.stat_activity_sample 日志。"""
    monkeypatch.setattr(monitoring, "_last_sample_at", 0.0)
    spy = SpyLog()
    monkeypatch.setattr(monitoring, "log", spy)

    activity_rows = [
        {
            "pid": 123,
            "state": "active",
            "wait_event_type": "Lock",
            "wait_event": "relation",
            "query_duration": "0:00:12.5",
            "query": "UPDATE task_run SET ...",
        }
    ]
    blocking_rows = [
        {
            "blocked_pid": 123,
            "blocked_by": [456],
            "blocked_query": "UPDATE task_run SET ...",
            "blocker_pid": 456,
            "blocker_state": "idle in transaction",
            "blocker_query": "SELECT ... FOR UPDATE",
        }
    ]
    conn = FakeConn([activity_rows, blocking_rows])
    monkeypatch.setattr(monitoring, "_get_sample_engine", lambda: FakeEngine(conn))

    await monitoring._sample_pg_stat_activity({"path": "/api/x", "request_id": "r"})

    assert len(spy.events) == 1
    event, kw = spy.events[0]
    assert event == "db.stat_activity_sample"
    assert kw["trigger"] == {"path": "/api/x", "request_id": "r"}
    assert kw["activity"] == activity_rows
    assert kw["blocking_chain"] == blocking_rows


async def test_sample_throttled_within_interval(monkeypatch) -> None:
    """节流窗口内重复触发只采一次，防日志爆炸。"""
    monkeypatch.setattr(monitoring, "_last_sample_at", 0.0)
    calls: list[int] = []

    def _counting_engine() -> None:
        calls.append(1)
        return None

    monkeypatch.setattr(monitoring, "_get_sample_engine", _counting_engine)
    spy = SpyLog()
    monkeypatch.setattr(monitoring, "log", spy)

    await monitoring._sample_pg_stat_activity({})
    assert len(calls) == 1
    await monitoring._sample_pg_stat_activity({})
    assert len(calls) == 1  # 节流生效，未二次取引擎


async def test_sample_timeout_logged_not_raised(monkeypatch) -> None:
    """采样查询超时被兜底：打 db.stat_activity_sample_failed，不向调用方抛错。"""
    monkeypatch.setattr(monitoring, "_last_sample_at", 0.0)
    monkeypatch.setattr(monitoring, "DB_BLOCKING_SAMPLE_TIMEOUT_S", 0.05)
    spy = SpyLog()
    monkeypatch.setattr(monitoring, "log", spy)

    class SlowConn:
        async def execute(self, _sql: Any) -> FakeResult:
            await asyncio.sleep(1.0)
            raise AssertionError("should be cancelled before here")

    monkeypatch.setattr(monitoring, "_get_sample_engine", lambda: FakeEngine(SlowConn()))

    # 不抛 TimeoutError 即为通过
    await monitoring._sample_pg_stat_activity({})
    assert [e for e, _ in spy.events] == ["db.stat_activity_sample_failed"]


async def test_sample_engine_error_logged_not_raised(monkeypatch) -> None:
    """连接建立失败（如共享故障）同样兜底打日志，不打断任何请求路径。"""
    monkeypatch.setattr(monitoring, "_last_sample_at", 0.0)
    spy = SpyLog()
    monkeypatch.setattr(monitoring, "log", spy)

    class BoomEngine:
        def connect(self) -> Any:
            raise RuntimeError("pool dead")

    monkeypatch.setattr(monitoring, "_get_sample_engine", lambda: BoomEngine())

    await monitoring._sample_pg_stat_activity({})
    assert [e for e, _ in spy.events] == ["db.stat_activity_sample_failed"]
