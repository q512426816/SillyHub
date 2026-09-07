"""POST /api/agent-logs/states 端点测试（task-08 / design §5.3 / FR-03）。

覆盖：鉴权矩阵（无凭据 401 / shk_live_ 403 / JWT 403 / shpsync_ 200）、既有行
状态四列更新且登记元信息不被覆盖、自发现裸会话 create（origin=liveness-discovered）、
无元信息且无行 → skipped 不建行、批量上限 64、state 非法值 422、blocked 段转移
检测（BLOCKED_SEGMENTS 进入/消解）、GET /agent-logs 透传状态四字段。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.platform_sync import service as platform_sync_service
from app.modules.platform_sync.model import AgentSessionLogORM
from app.modules.platform_sync.service import BLOCKED_SEGMENTS

REG_ENTRY: dict[str, Any] = {
    "harness": "codex",
    "log_path": "C:/Users/qinyi/.codex/sessions/2026/09/07/rollout-x.jsonl",
    "format": "codex-rollout-jsonl",
    "agent_cwd": "C:/Users/qinyi/IdeaProjects/demo",
    "session_id": "sess-reg-0001",
    "originator": "sillyhub-daemon",
    "exists": True,
    "size_bytes": 100,
    "mtime_ms": 1787446398096.99,
    "first_seen_at": "2026-09-07T00:40:11.000Z",
    "last_seen_at": "2026-09-07T01:53:22.000Z",
    "invocations": 3,
    "last_command": "scan --done",
}


def _state(path: str, state: str, **extra: Any) -> dict[str, Any]:
    return {
        "log_path": path,
        "state": state,
        "evidence": "last_event=model_io",
        "derived_at": "2026-09-07T10:00:00+00:00",
        "last_event_at": "2026-09-07T09:59:30+00:00",
        **extra,
    }


async def _seed_registered_row(client: AsyncClient, headers: dict[str, str]) -> None:
    resp = await client.post(
        "/api/agent-logs",
        json={"schema_version": 1, "pushed_at": "2026-09-07T01:53:22.000Z", "entries": [REG_ENTRY]},
        headers=headers,
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_states_no_auth_returns_401(client: AsyncClient) -> None:
    resp = await client.post("/api/agent-logs/states", json={"entries": [_state("a", "working")]})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_states_apikey_jwt_403(
    client: AsyncClient, apikey_headers: dict[str, str], auth_headers: dict[str, str]
) -> None:
    body = {"entries": [_state("a", "working")]}
    assert (
        await client.post("/api/agent-logs/states", json=body, headers=apikey_headers)
    ).status_code == 403
    assert (
        await client.post("/api/agent-logs/states", json=body, headers=auth_headers)
    ).status_code == 403


@pytest.mark.asyncio
async def test_states_update_existing_row_without_clobbering_registration(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    ws_id, headers = shpsync_headers
    await _seed_registered_row(client, headers)
    resp = await client.post(
        "/api/agent-logs/states",
        json={"entries": [_state(REG_ENTRY["log_path"], "idle", evidence="mtime_idle")]},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "updated": 1, "created": 0, "skipped": 0}
    row = (
        await db_session.execute(
            select(AgentSessionLogORM).where(AgentSessionLogORM.workspace_id == ws_id)
        )
    ).scalar_one()
    assert row.state == "idle"
    assert row.state_evidence == "mtime_idle"
    assert row.state_derived_at.replace(tzinfo=None) == datetime(2026, 9, 7, 10, 0)
    assert row.last_event_at.replace(tzinfo=None) == datetime(2026, 9, 7, 9, 59, 30)
    # 登记元信息不被状态上报覆盖（design §5.3）
    assert row.invocations == 3
    assert row.originator == "sillyhub-daemon"
    assert row.last_command == "scan --done"


@pytest.mark.asyncio
async def test_states_create_bare_session_row(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    ws_id, headers = shpsync_headers
    resp = await client.post(
        "/api/agent-logs/states",
        json={
            "entries": [
                _state(
                    "C:/Users/qinyi/.zcode/cli/rollout/model-io-sess-bare.jsonl",
                    "working",
                    harness="zcode",
                    format="zcode-model-io-jsonl",
                    agent_session_id="bare-0002",
                    agent_cwd="C:/Users/qinyi/IdeaProjects/demo",
                )
            ]
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "updated": 0, "created": 1, "skipped": 0}
    row = (
        await db_session.execute(
            select(AgentSessionLogORM).where(AgentSessionLogORM.workspace_id == ws_id)
        )
    ).scalar_one()
    assert row.originator == "liveness-discovered"
    assert row.harness == "zcode"
    assert row.format == "zcode-model-io-jsonl"
    assert row.session_id == "bare-0002"
    assert row.agent_cwd == "C:/Users/qinyi/IdeaProjects/demo"
    assert row.state == "working"


@pytest.mark.asyncio
async def test_states_missing_row_without_meta_skipped(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    ws_id, headers = shpsync_headers
    resp = await client.post(
        "/api/agent-logs/states",
        json={"entries": [_state("C:/nowhere/x.jsonl", "working")]},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["skipped"] == 1
    rows = (
        await db_session.execute(
            select(AgentSessionLogORM).where(AgentSessionLogORM.workspace_id == ws_id)
        )
    ).scalars()
    assert list(rows) == []


@pytest.mark.asyncio
async def test_states_batch_limit_64(
    client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    _, headers = shpsync_headers
    body = {"entries": [_state(f"p{i}.jsonl", "working", harness="zcode") for i in range(65)]}
    assert (
        await client.post("/api/agent-logs/states", json=body, headers=headers)
    ).status_code == 422


@pytest.mark.asyncio
async def test_states_invalid_state_422(
    client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    _, headers = shpsync_headers
    body = {"entries": [_state("a.jsonl", "busy")]}
    assert (
        await client.post("/api/agent-logs/states", json=body, headers=headers)
    ).status_code == 422


@pytest.mark.asyncio
async def test_states_blocked_segment_transition(
    client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """进入 blocked 记段（时间戳+段序号）；消解（离开 blocked）移除——task-09 消费。"""
    _, headers = shpsync_headers
    path = REG_ENTRY["log_path"]
    await _seed_registered_row(client, headers)
    BLOCKED_SEGMENTS.clear()
    await client.post(
        "/api/agent-logs/states",
        json={"entries": [_state(path, "blocked", evidence="PERMISSION_REQUEST(write)")]},
        headers=headers,
    )
    key = next(iter(BLOCKED_SEGMENTS))
    assert key[1] == path
    assert BLOCKED_SEGMENTS[key][1] == 1  # 段序号
    # 消解
    await client.post(
        "/api/agent-logs/states", json={"entries": [_state(path, "working")]}, headers=headers
    )
    assert BLOCKED_SEGMENTS == {}
    # 再次进入 = 新段（序号 2）
    await client.post(
        "/api/agent-logs/states", json={"entries": [_state(path, "blocked")]}, headers=headers
    )
    assert BLOCKED_SEGMENTS[next(iter(BLOCKED_SEGMENTS))][1] == 2
    assert platform_sync_service.LAST_BLOCKED_SEGMENT_SEQ.get(key) == 2


@pytest.mark.asyncio
async def test_get_agent_logs_exposes_state_fields(
    client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """GET /agent-logs 响应透传状态四字段；未上报状态的存量行 state=unknown。"""
    _, headers = shpsync_headers
    await _seed_registered_row(client, headers)
    lst = (await client.get("/api/agent-logs", headers=headers)).json()
    assert lst["items"][0]["state"] == "unknown"
    await client.post(
        "/api/agent-logs/states",
        json={"entries": [_state(REG_ENTRY["log_path"], "working")]},
        headers=headers,
    )
    lst = (await client.get("/api/agent-logs", headers=headers)).json()
    entry = lst["items"][0]
    assert entry["state"] == "working"
    assert entry["state_evidence"] == "last_event=model_io"
    assert entry["state_derived_at"] is not None
    assert entry["last_event_at"] is not None
