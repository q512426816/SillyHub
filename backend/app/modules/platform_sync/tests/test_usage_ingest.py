"""agent-logs 用量快照摄取测试（2026-10-02-change-center-token-usage task-02）。

覆盖（task 卡 acceptance / design FR-01）：

- 候选筛选：白名单外 format / 无会话归属 / exists=False 不发 RPC 不落库；
- 节流：size+mtime 与库一致且 300s 内已解析 → 跳过；日志增长（mtime 变化）不跳过；
- 成功落库：status=parsed + totalUsage → 五列快照（cacheWriteTokens →
  usage_cache_write_tokens 映射锚定）；
- 降级：totalUsage null / status 非 parsed / RPC AppError（旧 daemon
  method_not_found 422、无绑定 daemon 404、网关 502）静默跳过不抛；
- 幂等：重复摄取覆盖写同值；
- fire 入口：fire_usage_ingest_for_push 创建任务并执行（run 函数被调用）；
- 端点挂载：POST /api/agent-logs 响应后 fire 被调用且参数透传（上报语义不变）；
- 回归（2026-10-03-usage-ingest-session-concurrency）：定位段永不重叠（旧实现
  定位在 Semaphore(3) 内并发共用 AsyncSession，触发 SQLAlchemy 并发禁令）；
  畸形 totalUsage 校验异常只废单条，不丢弃同批已成功条目（旧实现
  model_validate 在 try 圈外，一坏整批丢）。

RPC 层（_resolve_agent_log_read_target / _send_agent_log_rpc）全部 monkeypatch
（延迟 import 按 router 模块属性解析，patch router 命名空间即可拦截）——不依赖
真实 daemon 连接；后台任务路径（run_usage_ingest_for_push 的自开 session）同样
patch 掉，本文件只验 service 层语义与挂载接线。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.modules.platform_sync.model import AgentSessionLogORM
from app.modules.platform_sync.schema import AgentLogEntry
from app.modules.platform_sync.usage_ingest import (
    AgentLogUsageIngestService,
    fire_usage_ingest_for_push,
)


def _entry(
    log_path: str,
    *,
    format: str = "zcode-model-io-jsonl",
    size_bytes: int | None = 1000,
    mtime_ms: float | None = 1787446398096.0,
    exists: bool = True,
) -> AgentLogEntry:
    """白名单内最小 entry（其余字段走 AgentLogEntry 默认）。"""
    return AgentLogEntry(
        harness="zcode",
        log_path=log_path,
        format=format,
        exists=exists,
        size_bytes=size_bytes,
        mtime_ms=mtime_ms,
    )


async def _seed_row(
    db_session: AsyncSession,
    workspace_id: uuid.UUID,
    *,
    log_path: str = "C:/Users/qinyi/.zcode/cli/rollout/model-io-sess-a.jsonl",
    format: str = "zcode-model-io-jsonl",
    linked_session: uuid.UUID | None = None,
    size_bytes: int | None = 1000,
    mtime_ms: float | None = 1787446398096.0,
    parsed_at: datetime | None = None,
) -> AgentSessionLogORM:
    row = AgentSessionLogORM(
        workspace_id=workspace_id,
        log_path=log_path,
        harness="zcode",
        format=format,
        agent_session_id=linked_session,
        size_bytes=size_bytes,
        mtime_ms=mtime_ms,
        usage_parsed_at=parsed_at,
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return row


_DEFAULT_TOTAL_USAGE: dict[str, int] = {
    "inputTokens": 1200,
    "outputTokens": 340,
    "cacheReadTokens": 5600,
    "cacheWriteTokens": 780,
}


def _rpc_result(
    *,
    status: str = "parsed",
    total_usage: dict[str, int] | None = None,
) -> dict[str, Any]:
    return {
        "status": status,
        "totalUsage": _DEFAULT_TOTAL_USAGE if total_usage is None else total_usage,
    }


class _RpcChannel:
    """测试用 RPC 桩：calls 记录每次定位调用，results 为应答/异常队列。"""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.results: list[Any] = []


@pytest.fixture()
def rpc_channel(monkeypatch: pytest.MonkeyPatch) -> _RpcChannel:
    """patch 定位+RPC 为记录器：按 results 队列顺序回结果/异常（空则默认成功体）。"""
    ch = _RpcChannel()

    async def fake_resolve(session, entry_id, scope):
        row = (
            await session.execute(
                select(AgentSessionLogORM).where(AgentSessionLogORM.id == entry_id)
            )
        ).scalar_one()
        ch.calls.append({"entry_id": entry_id, "workspace": scope.workspace_id})
        return row, uuid.UUID(int=1)

    async def fake_send(entry, daemon_id, method, args, **kw):
        item = ch.results.pop(0) if ch.results else _rpc_result()
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(
        "app.modules.platform_sync.router._resolve_agent_log_read_target",
        fake_resolve,
    )
    monkeypatch.setattr("app.modules.platform_sync.router._send_agent_log_rpc", fake_send)
    return ch


@pytest.mark.asyncio
async def test_ingest_writes_snapshot_with_column_mapping(
    db_session: AsyncSession, rpc_channel: _RpcChannel
) -> None:
    """parsed + totalUsage → 五列落库；cacheWriteTokens → usage_cache_write_tokens。"""
    ws = uuid.uuid4()
    session_id = uuid.uuid4()
    row = await _seed_row(db_session, ws, linked_session=session_id)

    ingested = await AgentLogUsageIngestService(db_session).ingest_for_push(
        ws, [_entry(row.log_path)]
    )

    assert ingested == 1
    await db_session.refresh(row)
    assert row.usage_input_tokens == 1200
    assert row.usage_output_tokens == 340
    assert row.usage_cache_read_tokens == 5600
    # 列名映射链锚定（design X6）：daemon cacheWriteTokens ↔ 本列。
    assert row.usage_cache_write_tokens == 780
    assert row.usage_parsed_at is not None
    assert len(rpc_channel.calls) == 1


@pytest.mark.asyncio
async def test_ingest_skips_unsupported_format_and_unlinked(
    db_session: AsyncSession, rpc_channel: _RpcChannel
) -> None:
    """白名单外 format（codex/cursor）与无会话归属的 entry：零 RPC、不落库。"""
    ws = uuid.uuid4()
    codex_row = await _seed_row(
        db_session, ws, format="codex-rollout-jsonl", linked_session=uuid.uuid4()
    )
    unlinked_row = await _seed_row(
        db_session,
        ws,
        log_path="C:/x/model-io-sess-b.jsonl",
        linked_session=None,
    )

    svc = AgentLogUsageIngestService(db_session)
    count = await svc.ingest_for_push(
        ws,
        [
            _entry(codex_row.log_path, format="codex-rollout-jsonl"),
            _entry(unlinked_row.log_path),
        ],
    )

    assert count == 0
    assert rpc_channel.calls == []
    for row in (codex_row, unlinked_row):
        await db_session.refresh(row)
        assert row.usage_parsed_at is None


@pytest.mark.asyncio
async def test_ingest_throttles_unchanged_recent_snapshot(
    db_session: AsyncSession, rpc_channel: _RpcChannel
) -> None:
    """size+mtime 一致且 300s 内已解析 → 跳过；mtime 增长 → 照常解析。"""
    ws = uuid.uuid4()
    fresh_row = await _seed_row(
        db_session,
        ws,
        linked_session=uuid.uuid4(),
        parsed_at=datetime.now(UTC) - timedelta(seconds=60),
    )
    grown_row = await _seed_row(
        db_session,
        ws,
        log_path="C:/x/model-io-sess-c.jsonl",
        linked_session=uuid.uuid4(),
        parsed_at=datetime.now(UTC) - timedelta(seconds=60),
        mtime_ms=1787446399999.0,  # 库中 mtime 与上报不一致 = 日志已增长
    )

    count = await AgentLogUsageIngestService(db_session).ingest_for_push(
        ws,
        [_entry(fresh_row.log_path), _entry(grown_row.log_path)],
    )

    assert count == 1
    assert [c["entry_id"] for c in rpc_channel.calls] == [grown_row.id]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("result", "label"),
    [
        ({"status": "parsed", "totalUsage": None}, "totalUsage null（零 usage 契约）"),
        (_rpc_result(status="unsupported"), "unsupported"),
        (_rpc_result(status="too_large"), "too_large"),
    ],
)
async def test_ingest_skips_non_parsed_or_null_usage(
    db_session: AsyncSession,
    rpc_channel: _RpcChannel,
    result: dict[str, Any],
    label: str,
) -> None:
    """非 parsed / null totalUsage：不落库不抛（参数化：label 仅为断言可读性）。"""
    assert label
    ws = uuid.uuid4()
    row = await _seed_row(db_session, ws, linked_session=uuid.uuid4())
    rpc_channel.results.append(result)

    count = await AgentLogUsageIngestService(db_session).ingest_for_push(ws, [_entry(row.log_path)])

    assert count == 0
    await db_session.refresh(row)
    assert row.usage_input_tokens is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("exc", "label"),
    [
        (
            AppError(
                "老 daemon 未注册该 RPC。",
                code="HTTP_422_AGENT_LOG_UNSUPPORTED",
                http_status=422,
            ),
            "method_not_found 422",
        ),
        (
            AppError(
                "未找到可读取该日志的机器。",
                code="HTTP_404_AGENT_LOG_NO_BOUND_DAEMON",
                http_status=404,
            ),
            "无绑定 daemon 404",
        ),
        # Execute Review P3-2：意外非 AppError 异常同样落防御兜底分支（best-effort
        # 语义下任何意外都不抛进 gather/上报链路）。
        (RuntimeError("意外炸裂"), "意外非 AppError"),
    ],
)
async def test_ingest_degrades_on_app_error(
    db_session: AsyncSession,
    rpc_channel: _RpcChannel,
    exc: Exception,
    label: str,
) -> None:
    """RPC 语义性失败（旧 daemon/无绑定机器）静默跳过：不抛、快照保持 NULL。"""
    assert label
    ws = uuid.uuid4()
    row = await _seed_row(db_session, ws, linked_session=uuid.uuid4())
    rpc_channel.results.append(exc)

    count = await AgentLogUsageIngestService(db_session).ingest_for_push(ws, [_entry(row.log_path)])

    assert count == 0
    await db_session.refresh(row)
    assert row.usage_parsed_at is None


@pytest.mark.asyncio
async def test_ingest_idempotent_overwrite(
    db_session: AsyncSession, rpc_channel: _RpcChannel
) -> None:
    """两次摄取覆盖写同值：终态一致（幂等，RPC 两次都被发起——无节流命中）。"""
    ws = uuid.uuid4()
    row = await _seed_row(db_session, ws, linked_session=uuid.uuid4())

    svc = AgentLogUsageIngestService(db_session)
    first = await svc.ingest_for_push(ws, [_entry(row.log_path, mtime_ms=1.0)])
    second = await svc.ingest_for_push(ws, [_entry(row.log_path, mtime_ms=2.0)])

    assert first == second == 1
    await db_session.refresh(row)
    assert row.usage_input_tokens == 1200
    assert row.usage_cache_write_tokens == 780


@pytest.mark.asyncio
async def test_ingest_locate_never_overlaps_across_batch(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """回归（2026-10-03-usage-ingest-session-concurrency）：定位段必须串行。

    旧实现定位（_resolve_agent_log_read_target）在 Semaphore(3) 内并发——多个
    协程持同一 AsyncSession execute，触发 SQLAlchemy 并发禁令，多日志批次摄取
    大面积失败。fake 定位内制造并发窗口并记录重叠：旧实现必红（overlapped 或
    count<4），新实现（定位串行在并发区外）恒绿。
    """
    ws = uuid.uuid4()
    rows = [
        await _seed_row(
            db_session,
            ws,
            log_path=f"C:/x/model-io-sess-conc-{i}.jsonl",
            linked_session=uuid.uuid4(),
        )
        for i in range(4)
    ]

    state = {"active": 0, "overlapped": False}

    async def fake_resolve(session, entry_id, scope):
        state["active"] += 1
        if state["active"] > 1:
            state["overlapped"] = True
        try:
            await asyncio.sleep(0.01)  # 并发窗口：旧实现下第二个协程会闯入
            row = (
                await session.execute(
                    select(AgentSessionLogORM).where(AgentSessionLogORM.id == entry_id)
                )
            ).scalar_one()
            return row, uuid.UUID(int=1)
        finally:
            state["active"] -= 1

    monkeypatch.setattr(
        "app.modules.platform_sync.router._resolve_agent_log_read_target", fake_resolve
    )

    async def fake_send(entry, daemon_id, method, args, **kw):
        return _rpc_result()

    monkeypatch.setattr("app.modules.platform_sync.router._send_agent_log_rpc", fake_send)

    count = await AgentLogUsageIngestService(db_session).ingest_for_push(
        ws, [_entry(r.log_path) for r in rows]
    )

    assert not state["overlapped"], "定位调用重叠：AsyncSession 被并发使用"
    assert count == 4


@pytest.mark.asyncio
async def test_ingest_malformed_usage_isolates_failure(
    db_session: AsyncSession,
    rpc_channel: _RpcChannel,
) -> None:
    """回归：畸形 totalUsage（校验异常）只废单条，不丢弃同批已成功条目。

    旧实现 model_validate 在 try 保护圈外，ValidationError 炸出 gather 且
    commit 不可达——同批已成功条目一起丢弃。新实现校验入圈：坏条目降级跳过、
    好条目照常落库。
    """
    ws = uuid.uuid4()
    bad = await _seed_row(db_session, ws, linked_session=uuid.uuid4())
    good = await _seed_row(
        db_session,
        ws,
        log_path="C:/x/model-io-sess-good.jsonl",
        linked_session=uuid.uuid4(),
    )
    # 定位按 pending 顺序串行（bad 在前），RPC 队列同序：bad 拿畸形体，good 走默认成功体。
    # 畸形体直接字面量构造（字符串值故意违 int 契约）——不经 _rpc_result 的类型化参数。
    rpc_channel.results.append({"status": "parsed", "totalUsage": {"inputTokens": "not-a-number"}})

    count = await AgentLogUsageIngestService(db_session).ingest_for_push(
        ws, [_entry(bad.log_path), _entry(good.log_path)]
    )

    assert count == 1
    await db_session.refresh(bad)
    await db_session.refresh(good)
    assert bad.usage_parsed_at is None
    assert good.usage_input_tokens == 1200


@pytest.mark.asyncio
async def test_fire_usage_ingest_creates_and_runs_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """fire 入口创建后台任务并执行 run 函数（强引用集进出平衡）。"""

    from app.modules.platform_sync import usage_ingest

    seen: list[tuple[uuid.UUID, int]] = []

    async def fake_run(workspace_id, entries):
        seen.append((workspace_id, len(entries)))
        return 0

    monkeypatch.setattr(usage_ingest, "run_usage_ingest_for_push", fake_run)

    ws = uuid.uuid4()
    task = fire_usage_ingest_for_push(ws, [_entry("C:/x/a.jsonl")])
    assert task in usage_ingest._background_tasks  # 强引用防 GC 语义锚定
    await task
    assert seen == [(ws, 1)]
    assert task not in usage_ingest._background_tasks  # done 回调出引用集


@pytest.mark.asyncio
async def test_push_endpoint_fires_ingest_with_entries(
    client: Any,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """POST /api/agent-logs 200 后 fire 被调用且 workspace/entries 透传（挂载接线）。"""
    from app.modules.platform_sync import router as ps_router

    fired: list[tuple[uuid.UUID, list[AgentLogEntry]]] = []

    def fake_fire(workspace_id, entries):
        fired.append((workspace_id, entries))

    monkeypatch.setattr(ps_router, "fire_usage_ingest_for_push", fake_fire)

    ws_id, headers = shpsync_headers
    resp = await client.post(
        "/api/agent-logs",
        json={
            "pushed_at": "2026-10-02T00:00:00.000Z",
            "entries": [
                {
                    "harness": "zcode",
                    "log_path": "C:/Users/qinyi/.zcode/cli/rollout/model-io-s.jsonl",
                    "format": "zcode-model-io-jsonl",
                    "exists": True,
                }
            ],
        },
        headers=headers,
    )

    assert resp.status_code == 200
    assert len(fired) == 1
    assert fired[0][0] == ws_id
    assert fired[0][1][0].format == "zcode-model-io-jsonl"
