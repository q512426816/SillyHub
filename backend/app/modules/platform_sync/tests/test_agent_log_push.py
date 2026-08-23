"""POST/GET /api/agent-logs 端点测试（task-02 / design §3.2 / §5）。

覆盖：鉴权矩阵（无凭据 401 / shk_live_ 403 / JWT 403 / shpsync_ 200）、落库全字段
断言、幂等整行覆盖（created_at 保留）、同请求重复 log_path 后者胜、跨 workspace
复合键隔离、必填缺失 422 + extra=ignore 宽松、GET scope 过滤 + last_seen_at
倒序（NULLS LAST）+ workspace_id 越权空列表 + limit 生效。
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.platform_sync.model import AgentSessionLogORM

# 协议 §1 示例风格的两条 entry（codex rollout + claude-code transcript）。
CODEX_ENTRY: dict[str, Any] = {
    "harness": "codex",
    "log_path": (
        "C:/Users/qinyi/.codex/sessions/2026/08/23/rollout-2026-08-23T00-53-22-abc123.jsonl"
    ),
    "format": "codex-rollout-jsonl",
    "detected_via": "codex-session-meta-cwd",
    "agent_cwd": "C:/Users/qinyi/IdeaProjects/sillyspec",
    "session_id": "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
    "originator": "sillyhub-daemon",
    "exists": True,
    "size_bytes": 123456,
    "mtime_ms": 1787446398096.99,
    "first_seen_at": "2026-08-23T00:40:11.000Z",
    "last_seen_at": "2026-08-23T00:53:22.000Z",
    "invocations": 3,
    "last_command": "scan --done",
}

CLAUDE_ENTRY: dict[str, Any] = {
    "harness": "claude-code",
    "log_path": (
        "C:/Users/qinyi/.claude/projects/-C-Users-qinyi-IdeaProjects-sillyspec/"
        "9a8b7c6d-session-transcript.jsonl"
    ),
    "format": "claude-code-transcript-jsonl",
    "detected_via": "claude-code-project-cwd",
    "agent_cwd": "C:/Users/qinyi/IdeaProjects/sillyspec",
    "session_id": "9a8b7c6d-1234-4abc-9def-567890abcdef",
    "originator": "claude-code",
    "exists": True,
    "size_bytes": 4096,
    "mtime_ms": 1787446390000.0,
    "first_seen_at": "2026-08-23T00:30:00.000Z",
    "last_seen_at": "2026-08-23T00:44:00.000Z",
    "invocations": 1,
    "last_command": None,
}

# 顶层故意带 workspace_id：extra=ignore 吞掉，token 派生唯一权威（协议 §1）。
SAMPLE_BODY: dict[str, Any] = {
    "schema_version": 1,
    "pushed_at": "2026-08-23T00:53:22.020Z",
    "agent_cwd": "C:/Users/qinyi/IdeaProjects/sillyspec",
    "workspace_id": "ws-body-value-must-be-ignored",
    "scan_run_id": "run-20260823-0053",
    "entries": [CODEX_ENTRY, CLAUDE_ENTRY],
}


@pytest.mark.asyncio
async def test_push_no_auth_returns_401(client: AsyncClient) -> None:
    resp = await client.post("/api/agent-logs", json=SAMPLE_BODY)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_push_apikey_auth_403(client: AsyncClient, apikey_headers: dict[str, str]) -> None:
    """shk_live_ 凭据有效也 403——写通道仅 shpsync_（与 quicklog-entries 同款）。"""
    resp = await client.post("/api/agent-logs", json=SAMPLE_BODY, headers=apikey_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_push_jwt_auth_403(client: AsyncClient, auth_headers: dict[str, str]) -> None:
    resp = await client.post("/api/agent-logs", json=SAMPLE_BODY, headers=auth_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_push_shpsync_ok_and_persisted(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """shpsync_ 200 + 落库全字段断言（workspace=token 派生，body workspace 被忽略）。"""
    ws_id, headers = shpsync_headers
    resp = await client.post("/api/agent-logs", json=SAMPLE_BODY, headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "upserted": 2}

    rows = (
        (await db_session.execute(select(AgentSessionLogORM).order_by(AgentSessionLogORM.harness)))
        .scalars()
        .all()
    )
    assert len(rows) == 2
    codex = rows[1]  # harness 字典序 claude-code < codex
    assert codex.workspace_id == ws_id  # token 派生，非 body 值
    assert codex.harness == "codex"
    assert codex.log_path == CODEX_ENTRY["log_path"]
    assert codex.format == "codex-rollout-jsonl"
    assert codex.session_id == CODEX_ENTRY["session_id"]
    assert codex.originator == "sillyhub-daemon"
    assert codex.detected_via == "codex-session-meta-cwd"
    assert codex.agent_cwd == "C:/Users/qinyi/IdeaProjects/sillyspec"
    assert codex.exists is True
    assert codex.size_bytes == 123456
    assert codex.mtime_ms == 1787446398096.99
    assert codex.first_seen_at == "2026-08-23T00:40:11.000Z"
    assert codex.last_seen_at == "2026-08-23T00:53:22.000Z"
    assert codex.invocations == 3
    assert codex.last_command == "scan --done"
    assert codex.scan_run_id == "run-20260823-0053"
    assert codex.pushed_at == "2026-08-23T00:53:22.020Z"
    assert codex.created_at is not None
    assert codex.updated_at is not None

    claude = rows[0]
    assert claude.harness == "claude-code"
    assert claude.workspace_id == ws_id
    assert claude.last_command is None  # optional None 原样落 NULL
    assert claude.invocations == 1


@pytest.mark.asyncio
async def test_push_idempotent_overwrites_and_keeps_created_at(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """同 (workspace, log_path) 二推整行覆盖不重复（D-005），created_at 保留不动。"""
    _ws_id, headers = shpsync_headers
    resp1 = await client.post("/api/agent-logs", json=SAMPLE_BODY, headers=headers)
    assert resp1.status_code == 200

    stmt = select(AgentSessionLogORM).where(AgentSessionLogORM.log_path == CODEX_ENTRY["log_path"])
    first = (await db_session.execute(stmt)).scalar_one()
    created_at_first = first.created_at

    # 二推：invocations / size 变化（CLI 留底文件是计数权威，服务端整行覆盖）。
    second_body = {
        **SAMPLE_BODY,
        "entries": [
            {**CODEX_ENTRY, "invocations": 7, "size_bytes": 999999},
            {**CLAUDE_ENTRY, "invocations": 2, "size_bytes": 8192},
        ],
    }
    resp2 = await client.post("/api/agent-logs", json=second_body, headers=headers)
    assert resp2.status_code == 200
    assert resp2.json() == {"ok": True, "upserted": 2}

    # populate_existing：绕开本 session 身份映射里首推时加载的旧对象，强制读库新值。
    total = (
        (
            await db_session.execute(
                select(AgentSessionLogORM).execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    assert len(total) == 2  # 仍一行/log_path，无重复
    codex = next(r for r in total if r.harness == "codex")
    assert codex.invocations == 7  # 值更新为第二次（不累加）
    assert codex.size_bytes == 999999
    assert codex.created_at == created_at_first  # 首插时间保留
    assert codex.updated_at >= created_at_first


@pytest.mark.asyncio
async def test_push_duplicate_log_path_latter_wins(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """entries 内同 log_path 两条 → 去重后一行且以靠后条目为准（design §3.2）。"""
    _ws_id, headers = shpsync_headers
    body = {
        **SAMPLE_BODY,
        "entries": [
            {**CODEX_ENTRY, "invocations": 1, "last_command": "scan"},
            {**CODEX_ENTRY, "invocations": 5, "last_command": "status"},
        ],
    }
    resp = await client.post("/api/agent-logs", json=body, headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "upserted": 1}

    rows = (await db_session.execute(select(AgentSessionLogORM))).scalars().all()
    assert len(rows) == 1
    assert rows[0].invocations == 5
    assert rows[0].last_command == "status"


@pytest.mark.asyncio
async def test_push_two_workspaces_same_log_path_two_rows(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """复合唯一键是 (workspace_id, log_path)：另一 workspace 直接插同 log_path 不撞约束。"""
    import uuid as _uuid

    ws_id, headers = shpsync_headers
    resp = await client.post("/api/agent-logs", json=SAMPLE_BODY, headers=headers)
    assert resp.status_code == 200

    other_ws = _uuid.uuid4()  # 无 token 的另一 workspace 模拟行
    db_session.add(
        AgentSessionLogORM(
            workspace_id=other_ws,
            log_path=CODEX_ENTRY["log_path"],
            harness="codex",
        )
    )
    await db_session.commit()

    rows = (await db_session.execute(select(AgentSessionLogORM))).scalars().all()
    same_path = [r for r in rows if r.log_path == CODEX_ENTRY["log_path"]]
    assert len(same_path) == 2
    assert {r.workspace_id for r in same_path} == {ws_id, other_ws}


@pytest.mark.asyncio
async def test_push_missing_required_422_and_extra_workspace_ignored(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """缺 harness / 缺 log_path → 422；body 顶层多余 workspace_id 键 → 200 宽松。"""
    ws_id, headers = shpsync_headers

    resp_no_harness = await client.post(
        "/api/agent-logs",
        json={"entries": [{"log_path": "C:/tmp/any.jsonl"}]},
        headers=headers,
    )
    assert resp_no_harness.status_code == 422

    resp_no_log_path = await client.post(
        "/api/agent-logs",
        json={"entries": [{"harness": "codex"}]},
        headers=headers,
    )
    assert resp_no_log_path.status_code == 422

    resp_extra = await client.post(
        "/api/agent-logs",
        json={
            **SAMPLE_BODY,
            "workspace_id": "00000000-0000-0000-0000-000000000000",
        },
        headers=headers,
    )
    assert resp_extra.status_code == 200
    rows = (await db_session.execute(select(AgentSessionLogORM))).scalars().all()
    assert {r.workspace_id for r in rows} == {ws_id}  # body workspace 被吞掉


@pytest.mark.asyncio
async def test_get_shpsync_scope_and_last_seen_ordering(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """GET（shpsync）只回 token workspace 行；last_seen_at 降序、NULL 排最后（X-07）。"""
    import uuid as _uuid

    ws_id, headers = shpsync_headers
    zcode_entry: dict[str, Any] = {
        "harness": "zcode",
        "log_path": "C:/Users/qinyi/.zcode/sessions/zk-session-001.jsonl",
        "exists": True,
    }  # 无 last_seen_at → NULL 排最后
    resp = await client.post(
        "/api/agent-logs",
        json={**SAMPLE_BODY, "entries": [*SAMPLE_BODY["entries"], zcode_entry]},
        headers=headers,
    )
    assert resp.status_code == 200

    # 另一 workspace 直插一行更晚的 last_seen_at：scope 隔离下不可见。
    db_session.add(
        AgentSessionLogORM(
            workspace_id=_uuid.uuid4(),
            log_path="C:/other-ws/newer.jsonl",
            harness="codex",
            last_seen_at="2026-08-23T23:59:59.000Z",
        )
    )
    await db_session.commit()

    resp = await client.get("/api/agent-logs", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert [item["harness"] for item in data["items"]] == ["codex", "claude-code", "zcode"]
    assert all(item["workspace_id"] == str(ws_id) for item in data["items"])
    assert data["items"][2]["last_seen_at"] is None  # NULLS LAST
    # 字段 snake_case 原样（X-06）。
    first = data["items"][0]
    assert first["log_path"] == CODEX_ENTRY["log_path"]
    assert first["scan_run_id"] == "run-20260823-0053"
    assert first["pushed_at"] == "2026-08-23T00:53:22.020Z"


@pytest.mark.asyncio
async def test_get_workspace_filter_out_of_scope_empty(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
) -> None:
    """GET workspace_id 越权（随机 uuid 不在 token scope）→ 200 空列表（不 403 不泄漏）。"""
    import uuid as _uuid

    _ws_id, headers = shpsync_headers
    resp = await client.post("/api/agent-logs", json=SAMPLE_BODY, headers=headers)
    assert resp.status_code == 200

    resp = await client.get(
        "/api/agent-logs",
        params={"workspace_id": str(_uuid.uuid4())},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["items"] == []


@pytest.mark.asyncio
async def test_get_jwt_scope_and_out_of_scope_empty(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    auth_headers: dict[str, str],
) -> None:
    """JWT（platform admin → CHANGE_READ 并集）可见落库行；workspace_id 越权 → 空。"""
    ws_id, headers = shpsync_headers
    resp = await client.post("/api/agent-logs", json=SAMPLE_BODY, headers=headers)
    assert resp.status_code == 200

    resp_all = await client.get("/api/agent-logs", headers=auth_headers)
    assert resp_all.status_code == 200
    items = resp_all.json()["items"]
    assert len(items) == 2  # admin 并集读通道可见
    assert {item["workspace_id"] for item in items} == {str(ws_id)}

    import uuid as _uuid

    resp_filtered = await client.get(
        "/api/agent-logs",
        params={"workspace_id": str(_uuid.uuid4())},
        headers=auth_headers,
    )
    assert resp_filtered.status_code == 200
    assert resp_filtered.json()["items"] == []


@pytest.mark.asyncio
async def test_get_limit_applies(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
) -> None:
    """limit 生效：3 行 limit=2 → 2 条（且取 last_seen_at 最新的前 2 条）。"""
    _ws_id, headers = shpsync_headers
    third: dict[str, Any] = {
        "harness": "zcode",
        "log_path": "C:/Users/qinyi/.zcode/sessions/zk-session-002.jsonl",
        "last_seen_at": "2026-08-22T00:00:00.000Z",  # 最旧 → 被 limit 截掉
    }
    resp = await client.post(
        "/api/agent-logs",
        json={**SAMPLE_BODY, "entries": [*SAMPLE_BODY["entries"], third]},
        headers=headers,
    )
    assert resp.status_code == 200

    resp = await client.get("/api/agent-logs", params={"limit": 2}, headers=headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 2
    assert [item["harness"] for item in items] == ["codex", "claude-code"]

    resp_over = await client.get("/api/agent-logs", params={"limit": 101}, headers=headers)
    assert resp_over.status_code == 422  # 上限 100 校验
