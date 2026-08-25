"""POST/GET /api/agent-logs 端点测试（task-02 / design §3.2 / §5；task-04 归属扩展）。

覆盖：鉴权矩阵（无凭据 401 / shk_live_ 403 / JWT 403 / shpsync_ 200）、落库全字段
断言、幂等整行覆盖（created_at 保留）、同请求重复 log_path 后者胜、跨 workspace
复合键隔离、必填缺失 422 + extra=ignore 宽松、GET scope 过滤 + last_seen_at
倒序（NULLS LAST）+ workspace_id 越权空列表 + limit 生效。

2026-08-23-agent-activity-sessions task-04（design §3.3.3/§3.3.6 / D-005/D-006/
D-007/D-009）：hub_session_id 关联命中与跨 ws 降级、无 hub 按 (harness, entry.ctx)
分组 find-or-create tool_report 会话（幂等收敛 / entry 级 ctx 分组 / 无 ctx 单桶 /
字段断言含 provider 映射）、GET session_id 过滤与越权空列表。

2026-08-25-session-spec-binding task-06（design §5.W2.2/W2.3 / D-003 / D-005@v2）：
双分支 ctx 自动绑定——hub 命中补消费 entry 级 change_key/quick_id（quick_id 落
quicklog_session_links、change_key 落 change_session_links、并存 quick 优先、
default 伪键无 placeholder 无绑定）、聚合分支 tool_report 会话同款绑定、空 ctx
单桶不落、降级路径不产生绑定。
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.change.model import Change, ChangeSessionLink, QuicklogSessionLink
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


# ── 2026-08-23-agent-activity-sessions task-04：归属（hub 关联 / tool_report 聚合）──


async def _tool_report_sessions(db_session: AsyncSession) -> list[AgentSession]:
    """查全部未软删 ``origin='tool_report'`` 会话（populate_existing 强制读库新值）。"""
    stmt = (
        select(AgentSession)
        .where(AgentSession.origin == "tool_report", AgentSession.deleted_at.is_(None))
        .execution_options(populate_existing=True)
    )
    return list((await db_session.execute(stmt)).scalars().all())


async def _all_log_rows(db_session: AsyncSession) -> list[AgentSessionLogORM]:
    """查全部日志行（populate_existing 绕开身份映射旧值，见既有惯例）。"""
    stmt = select(AgentSessionLogORM).execution_options(populate_existing=True)
    return list((await db_session.execute(stmt)).scalars().all())


async def _change_links(db_session: AsyncSession) -> list[ChangeSessionLink]:
    """查全部 change_session_links（task-06 绑定断言；populate_existing 惯例）。"""
    stmt = select(ChangeSessionLink).execution_options(populate_existing=True)
    return list((await db_session.execute(stmt)).scalars().all())


async def _quicklog_links(db_session: AsyncSession) -> list[QuicklogSessionLink]:
    """查全部 quicklog_session_links（task-06 绑定断言；populate_existing 惯例）。"""
    stmt = select(QuicklogSessionLink).execution_options(populate_existing=True)
    return list((await db_session.execute(stmt)).scalars().all())


async def _all_changes(db_session: AsyncSession) -> list[Change]:
    """查全部 changes 行（task-06 placeholder 断言；populate_existing 惯例）。"""
    stmt = select(Change).execution_options(populate_existing=True)
    return list((await db_session.execute(stmt)).scalars().all())


@pytest.mark.asyncio
async def test_push_hub_session_hit_links_entries(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """hub_session_id 命中（同 ws 未软删）→ 本批 entries 全挂该会话，status 不变。"""
    import uuid as _uuid

    ws_id, headers = shpsync_headers
    hub = AgentSession(
        id=_uuid.uuid4(),
        user_id=_uuid.uuid4(),  # SQLite 测试库不强制 FK，任意 owner 即可
        workspace_id=ws_id,
        provider="claude",
        status="active",  # 故意非默认 pending：断言归属不改 status（生命周期契约）
    )
    db_session.add(hub)
    await db_session.commit()

    resp = await client.post(
        "/api/agent-logs",
        json={
            **SAMPLE_BODY,
            "hub_session_id": str(hub.id),
            "entries": [
                # task-06：两键并存防御——quick 优先只落 quicklog 绑定（schema 互斥注释）。
                {**CODEX_ENTRY, "change_key": "change-hub-both", "quick_id": "ql-20260825-hit"},
                {**CLAUDE_ENTRY, "change_key": "change-hub-claude"},
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "upserted": 2}

    rows = await _all_log_rows(db_session)
    assert len(rows) == 2
    assert {r.agent_session_id for r in rows} == {hub.id}

    hub_after = (
        await db_session.execute(
            select(AgentSession)
            .where(AgentSession.id == hub.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert hub_after.status == "active"  # 目标会话 status 不变，仅 entries 挂接
    assert await _tool_report_sessions(db_session) == []  # hub 分支不建聚合会话

    # task-06 ctx 断言（design §5.W2.2 / D-003）：quick_id 落 quicklog link、
    # change_key 落 change link（placeholder）；并存条目只落 quicklog 不落 change。
    quicklog_links = await _quicklog_links(db_session)
    assert [(ln.workspace_id, ln.ql_id, ln.session_id) for ln in quicklog_links] == [
        (ws_id, "ql-20260825-hit", hub.id)
    ]
    changes = await _all_changes(db_session)
    by_key = {c.change_key: c for c in changes}
    assert set(by_key) == {"change-hub-claude"}  # 并存条目无 change placeholder
    change_links = await _change_links(db_session)
    assert [(ln.change_id, ln.session_id) for ln in change_links] == [
        (by_key["change-hub-claude"].id, hub.id)
    ]


@pytest.mark.asyncio
async def test_push_hub_session_random_uuid_degrades(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """D-005：hub_session_id 随机不存在 → 200 且 entries 无归属（不入聚合分支）。"""
    import uuid as _uuid

    _ws_id, headers = shpsync_headers
    resp = await client.post(
        "/api/agent-logs",
        json={
            **SAMPLE_BODY,
            "hub_session_id": str(_uuid.uuid4()),
            # task-06：带 ctx 也降级——hub 未命中不产生任何绑定。
            "entries": [
                {**CODEX_ENTRY, "change_key": "change-degrade-random"},
                {**CLAUDE_ENTRY, "quick_id": "ql-20260825-degrade"},
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["upserted"] == 2

    rows = await _all_log_rows(db_session)
    assert len(rows) == 2
    assert all(r.agent_session_id is None for r in rows)  # 静默降级，仍入库
    assert await _tool_report_sessions(db_session) == []
    # task-06：降级路径无 placeholder、无两类绑定行。
    assert await _all_changes(db_session) == []
    assert await _change_links(db_session) == []
    assert await _quicklog_links(db_session) == []


@pytest.mark.asyncio
async def test_push_hub_session_cross_workspace_degrades(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """D-005：hub_session_id 指向他 workspace 的会话（存在但 ws 不匹配）→ 同样降级。"""
    import uuid as _uuid

    _ws_id, headers = shpsync_headers
    other_ws_session = AgentSession(
        id=_uuid.uuid4(),
        user_id=_uuid.uuid4(),
        workspace_id=_uuid.uuid4(),  # 跨 ws：行存在但非 token 派生 workspace
        provider="claude",
    )
    db_session.add(other_ws_session)
    await db_session.commit()

    resp = await client.post(
        "/api/agent-logs",
        json={
            **SAMPLE_BODY,
            "hub_session_id": str(other_ws_session.id),
            # task-06：带 ctx 也降级——跨 ws 不产生任何绑定。
            "entries": [{**CODEX_ENTRY, "change_key": "change-degrade-cross-ws"}],
        },
        headers=headers,
    )
    assert resp.status_code == 200

    rows = await _all_log_rows(db_session)
    assert len(rows) == 1
    assert all(r.agent_session_id is None for r in rows)
    assert await _tool_report_sessions(db_session) == []
    # task-06：降级路径无 placeholder、无两类绑定行。
    assert await _all_changes(db_session) == []
    assert await _change_links(db_session) == []
    assert await _quicklog_links(db_session) == []


@pytest.mark.asyncio
async def test_push_aggregation_idempotent_single_session(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """D-001/D-006：同 (harness, ctx) 两次上报 → 只 1 个 tool_report 会话，二推只刷 last_active_at。"""
    _ws_id, headers = shpsync_headers
    body = {
        **SAMPLE_BODY,
        "entries": [{**CODEX_ENTRY, "change_key": "change-aggregate"}],
    }

    resp1 = await client.post("/api/agent-logs", json=body, headers=headers)
    assert resp1.status_code == 200
    sessions1 = await _tool_report_sessions(db_session)
    assert len(sessions1) == 1
    first = sessions1[0]
    assert first.aggregation_key == "codex|change-aggregate"
    first_active_at = first.last_active_at
    # task-06（design §5.W2.3）：change ctx 组落 change link（placeholder 变更行）。
    changes = await _all_changes(db_session)
    assert [c.change_key for c in changes] == ["change-aggregate"]
    assert [(ln.change_id, ln.session_id) for ln in await _change_links(db_session)] == [
        (changes[0].id, first.id)
    ]

    resp2 = await client.post("/api/agent-logs", json=body, headers=headers)
    assert resp2.status_code == 200
    sessions2 = await _tool_report_sessions(db_session)
    assert len(sessions2) == 1  # 幂等收敛：不重复建会话
    second = sessions2[0]
    assert second.id == first.id
    assert first_active_at is not None
    assert second.last_active_at is not None
    assert second.last_active_at >= first_active_at  # 只刷活跃时间
    assert second.status == "pending"  # 不改 status / turn_count
    assert second.turn_count == 0

    rows = await _all_log_rows(db_session)
    assert len(rows) == 1
    assert rows[0].agent_session_id == second.id
    # task-06：二推幂等——change link 仍恰一条（bind 查存在即返回）。
    assert len(await _change_links(db_session)) == 1


@pytest.mark.asyncio
async def test_push_entry_level_ctx_groups_two_sessions(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """D-009：一次 POST 同 harness 两条 entry（change_key 不同）→ 两个会话各挂一条。"""
    _ws_id, headers = shpsync_headers
    body = {
        **SAMPLE_BODY,
        "entries": [
            {
                **CODEX_ENTRY,
                "log_path": "C:/Users/qinyi/.codex/sessions/rollout-a.jsonl",
                "change_key": "change-a",
            },
            {
                **CODEX_ENTRY,
                "log_path": "C:/Users/qinyi/.codex/sessions/rollout-b.jsonl",
                "change_key": "change-b",
            },
        ],
    }
    resp = await client.post("/api/agent-logs", json=body, headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "upserted": 2}

    sessions = await _tool_report_sessions(db_session)
    assert len(sessions) == 2
    by_key = {s.aggregation_key: s for s in sessions}
    assert set(by_key) == {"codex|change-a", "codex|change-b"}
    assert by_key["codex|change-a"].title == "codex · change-a"
    assert by_key["codex|change-b"].title == "codex · change-b"

    rows = await _all_log_rows(db_session)
    assert len(rows) == 2
    for row in rows:
        expected_key = (
            "codex|change-a" if row.log_path.endswith("rollout-a.jsonl") else "codex|change-b"
        )
        assert row.agent_session_id == by_key[expected_key].id  # 各挂一条

    # task-06（design §5.W2.3）：两组各落 change link（placeholder 对应组会话）。
    changes = await _all_changes(db_session)
    change_by_key = {c.change_key: c for c in changes}
    assert set(change_by_key) == {"change-a", "change-b"}
    assert {(ln.change_id, ln.session_id) for ln in await _change_links(db_session)} == {
        (change_by_key["change-a"].id, by_key["codex|change-a"].id),
        (change_by_key["change-b"].id, by_key["codex|change-b"].id),
    }


@pytest.mark.asyncio
async def test_push_no_ctx_single_bucket_session(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """无 change_key/quick_id → ws+harness 单桶会话，title「{harness} · 本地活动」（D-001 回落）。"""
    _ws_id, headers = shpsync_headers
    body = {
        **SAMPLE_BODY,
        "entries": [
            {**CLAUDE_ENTRY, "log_path": "C:/Users/qinyi/.claude/projects/p/claude-a.jsonl"},
            {**CLAUDE_ENTRY, "log_path": "C:/Users/qinyi/.claude/projects/p/claude-b.jsonl"},
        ],
    }
    resp = await client.post("/api/agent-logs", json=body, headers=headers)
    assert resp.status_code == 200

    sessions = await _tool_report_sessions(db_session)
    assert len(sessions) == 1  # 同 harness 无 ctx → 单桶
    bucket = sessions[0]
    assert bucket.aggregation_key == "claude-code|"
    assert bucket.title == "claude-code · 本地活动"

    rows = await _all_log_rows(db_session)
    assert len(rows) == 2
    assert {r.agent_session_id for r in rows} == {bucket.id}

    # task-06（design §5.W2.3）：空 ctx 单桶（本地活动）不落任何绑定。
    assert await _all_changes(db_session) == []
    assert await _change_links(db_session) == []
    assert await _quicklog_links(db_session) == []


@pytest.mark.asyncio
async def test_get_session_id_filter_and_out_of_scope_empty(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """GET session_id 只回该会话关联条目；越权（他 ws 会话）→ 空列表（design §3.3.6）。"""
    import uuid as _uuid

    _ws_id, headers = shpsync_headers
    body = {
        **SAMPLE_BODY,
        "entries": [
            {**CODEX_ENTRY, "change_key": "change-x"},
            {**CLAUDE_ENTRY, "change_key": "change-y"},
        ],
    }
    resp = await client.post("/api/agent-logs", json=body, headers=headers)
    assert resp.status_code == 200
    sessions = await _tool_report_sessions(db_session)
    assert len(sessions) == 2
    target = next(s for s in sessions if s.aggregation_key == "codex|change-x")

    resp = await client.get(
        "/api/agent-logs", params={"session_id": str(target.id)}, headers=headers
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1  # 只回该会话 entries
    assert items[0]["agent_session_id"] == str(target.id)
    assert items[0]["harness"] == "codex"

    # 越权：会话存在但不属 token scope（另一 ws 的会话 + 关联行直插库）。
    other_ws = _uuid.uuid4()
    other_session = AgentSession(
        id=_uuid.uuid4(),
        user_id=_uuid.uuid4(),
        workspace_id=other_ws,
        provider="claude",
        origin="tool_report",
        aggregation_key="codex|foreign",
    )
    db_session.add(other_session)
    db_session.add(
        AgentSessionLogORM(
            workspace_id=other_ws,
            log_path="C:/other-ws/codex-foreign.jsonl",
            harness="codex",
            agent_session_id=other_session.id,
        )
    )
    await db_session.commit()

    resp_foreign = await client.get(
        "/api/agent-logs", params={"session_id": str(other_session.id)}, headers=headers
    )
    assert resp_foreign.status_code == 200
    assert resp_foreign.json()["items"] == []  # 空列表，不 403 不泄漏存在性


@pytest.mark.asyncio
async def test_push_tool_report_session_fields_and_provider_mapping(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """tool_report 会话字段全断言：origin/status/title/config_snapshot/owner + D-007 映射。"""
    from app.modules.platform_sync.token_model import PlatformSyncTokenORM

    ws_id, headers = shpsync_headers
    zcode_entry: dict[str, Any] = {
        "harness": "zcode",
        "log_path": "C:/Users/qinyi/.zcode/sessions/zk-agg-001.jsonl",
        "quick_id": "ql-20260823-001",  # quick ctx：原样短码入标题（D-009）
    }
    body = {
        **SAMPLE_BODY,
        "entries": [
            {**CODEX_ENTRY, "change_key": "provider-map-check"},
            zcode_entry,
        ],
    }
    resp = await client.post("/api/agent-logs", json=body, headers=headers)
    assert resp.status_code == 200

    sessions = await _tool_report_sessions(db_session)
    by_key = {s.aggregation_key: s for s in sessions}
    assert set(by_key) == {"codex|provider-map-check", "zcode|ql-20260823-001"}

    codex_session = by_key["codex|provider-map-check"]
    zcode_session = by_key["zcode|ql-20260823-001"]
    for s in (codex_session, zcode_session):
        assert s.origin == "tool_report"
        assert s.status == "pending"
        assert s.turn_count == 0
        assert s.last_active_at is not None
        assert s.lease_id is None  # 未激活（懒激活在 daemon 侧 task）
        assert s.workspace_id == ws_id
    # D-007 provider 映射：codex→codex、其余（zcode）→claude。
    assert codex_session.provider == "codex"
    assert zcode_session.provider == "claude"
    # 标题：change ctx 直显、quick ctx 用原样短码。
    assert codex_session.title == "codex · provider-map-check"
    assert zcode_session.title == "zcode · ql-20260823-001"
    # harness 真实身份由 config_snapshot 展示（D-007）。
    assert codex_session.config_snapshot == {"harness": "codex"}
    assert zcode_session.config_snapshot == {"harness": "zcode"}
    # owner = token 签发人（R-02：token 派生 user 建会话）。
    token = (
        await db_session.execute(
            select(PlatformSyncTokenORM).where(PlatformSyncTokenORM.workspace_id == ws_id)
        )
    ).scalar_one()
    assert codex_session.user_id == token.created_by
    assert zcode_session.user_id == token.created_by

    # task-06（design §5.W2.3）：聚合分支双 ctx 落绑定——change_key 组落 change
    # link（placeholder）、quick_id 组落 quicklog link（绑定主体为各组会话）。
    changes = await _all_changes(db_session)
    assert [c.change_key for c in changes] == ["provider-map-check"]
    assert [(ln.change_id, ln.session_id) for ln in await _change_links(db_session)] == [
        (changes[0].id, codex_session.id)
    ]
    assert [
        (ln.workspace_id, ln.ql_id, ln.session_id) for ln in await _quicklog_links(db_session)
    ] == [(ws_id, "ql-20260823-001", zcode_session.id)]


# ── 2026-08-25-session-spec-binding task-06：双分支 ctx 自动绑定专测（design §5.W2.2/W2.3 / D-003）──


@pytest.mark.asyncio
async def test_push_hub_hit_quick_id_binds_quicklog_link(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """task-06 ①（design §5.W2.2 / D-003）：hub 命中 + entry.quick_id → quicklog_session_links（FR-02 唯一可靠通道）。"""
    import uuid as _uuid

    ws_id, headers = shpsync_headers
    hub = AgentSession(
        id=_uuid.uuid4(),
        user_id=_uuid.uuid4(),
        workspace_id=ws_id,
        provider="claude",
        status="active",
    )
    db_session.add(hub)
    await db_session.commit()

    body = {
        **SAMPLE_BODY,
        "hub_session_id": str(hub.id),
        "entries": [{**CODEX_ENTRY, "quick_id": "ql-20260825-001"}],
    }
    resp = await client.post("/api/agent-logs", json=body, headers=headers)
    assert resp.status_code == 200

    # D-001@v1：quicklog 条目行不存在也先绑（agent-logs 与条目推送到达顺序不保证）。
    quicklog_links = await _quicklog_links(db_session)
    assert [(ln.workspace_id, ln.ql_id, ln.session_id) for ln in quicklog_links] == [
        (ws_id, "ql-20260825-001", hub.id)
    ]
    assert await _change_links(db_session) == []
    assert await _all_changes(db_session) == []


@pytest.mark.asyncio
async def test_push_hub_hit_change_key_binds_change_link_with_placeholder(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """task-06 ②（design §5.W2.2）：hub 命中 + entry.change_key（变更不存在）→ placeholder 建行 + change link。"""
    import uuid as _uuid

    ws_id, headers = shpsync_headers
    hub = AgentSession(
        id=_uuid.uuid4(),
        user_id=_uuid.uuid4(),
        workspace_id=ws_id,
        provider="claude",
        status="active",
    )
    db_session.add(hub)
    await db_session.commit()

    body = {
        **SAMPLE_BODY,
        "hub_session_id": str(hub.id),
        "entries": [{**CODEX_ENTRY, "change_key": "change-hub-placeholder"}],
    }
    resp = await client.post("/api/agent-logs", json=body, headers=headers)
    assert resp.status_code == 200

    changes = await _all_changes(db_session)
    assert len(changes) == 1
    ch = changes[0]
    assert ch.workspace_id == ws_id
    assert ch.change_key == "change-hub-placeholder"
    # placeholder defaults 对齐 _ensure_change_row（binding.py task-02 同款）。
    assert ch.status == "draft"
    assert ch.location == "active"
    assert ch.path == "changes/change-hub-placeholder"

    change_links = await _change_links(db_session)
    assert [(ln.change_id, ln.session_id) for ln in change_links] == [(ch.id, hub.id)]
    assert await _quicklog_links(db_session) == []


@pytest.mark.asyncio
async def test_push_hub_hit_default_change_key_no_placeholder_no_link(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """task-06 ③（D-005@v2 / X-004）：hub 命中 + change_key='default' 伪键 → 无 placeholder 无绑定，归属不受影响。"""
    import uuid as _uuid

    ws_id, headers = shpsync_headers
    hub = AgentSession(
        id=_uuid.uuid4(),
        user_id=_uuid.uuid4(),
        workspace_id=ws_id,
        provider="claude",
        status="active",
    )
    db_session.add(hub)
    await db_session.commit()

    body = {
        **SAMPLE_BODY,
        "hub_session_id": str(hub.id),
        "entries": [{**CODEX_ENTRY, "change_key": "default"}],
    }
    resp = await client.post("/api/agent-logs", json=body, headers=headers)
    assert resp.status_code == 200

    # 归属主流程不受绑定守卫影响（entry 仍挂 hub 会话）。
    rows = await _all_log_rows(db_session)
    assert {r.agent_session_id for r in rows} == {hub.id}

    # default 伪键：bind_session_to_change 内部守卫直接返回——无 placeholder 行、
    # 无任何绑定行（D-005@v2 收敛在 bind 函数内，agent-logs 通道统一生效）。
    assert await _all_changes(db_session) == []
    assert await _change_links(db_session) == []
    assert await _quicklog_links(db_session) == []


@pytest.mark.asyncio
async def test_push_aggregation_change_key_binds_tool_report_session(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """task-06 ④（design §5.W2.3）：无 hub + entry.change_key → tool_report 会话 + change link（placeholder）。"""
    _ws_id, headers = shpsync_headers
    body = {
        **SAMPLE_BODY,
        "entries": [{**CODEX_ENTRY, "change_key": "change-agg-bind"}],
    }
    resp = await client.post("/api/agent-logs", json=body, headers=headers)
    assert resp.status_code == 200

    sessions = await _tool_report_sessions(db_session)
    assert len(sessions) == 1
    group_session = sessions[0]
    assert group_session.aggregation_key == "codex|change-agg-bind"

    changes = await _all_changes(db_session)
    assert [c.change_key for c in changes] == ["change-agg-bind"]
    change_links = await _change_links(db_session)
    assert [(ln.change_id, ln.session_id) for ln in change_links] == [
        (changes[0].id, group_session.id)
    ]
    assert await _quicklog_links(db_session) == []


@pytest.mark.asyncio
async def test_push_aggregation_quick_id_binds_quicklog_link(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """task-06 ⑤（design §5.W2.3）：无 hub + entry.quick_id → tool_report 会话 + quicklog link（绑定主体为组会话）。"""
    ws_id, headers = shpsync_headers
    body = {
        **SAMPLE_BODY,
        "entries": [{**CODEX_ENTRY, "quick_id": "ql-20260825-002"}],
    }
    resp = await client.post("/api/agent-logs", json=body, headers=headers)
    assert resp.status_code == 200

    sessions = await _tool_report_sessions(db_session)
    assert len(sessions) == 1
    group_session = sessions[0]
    assert group_session.aggregation_key == "codex|ql-20260825-002"

    quicklog_links = await _quicklog_links(db_session)
    assert [(ln.workspace_id, ln.ql_id, ln.session_id) for ln in quicklog_links] == [
        (ws_id, "ql-20260825-002", group_session.id)
    ]
    assert await _change_links(db_session) == []
    assert await _all_changes(db_session) == []
