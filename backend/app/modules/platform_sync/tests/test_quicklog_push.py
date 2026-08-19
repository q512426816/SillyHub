"""POST /api/quicklog-entries 端点测试（task-02 / design §8 推送端点测试）。

覆盖：鉴权矩阵（无凭据 401 / shk_live_ 403 / JWT 403 / shpsync_ 200）、幂等 upsert
（同 ql_id 二推覆盖）、payload 校验 422、workspace 隔离（token 派生 + 复合键维度）。
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.platform_sync.model import QuicklogEntryORM

SAMPLE_ENTRY: dict[str, Any] = {
    "ql_id": "ql-20260817-001-abcd",
    "timestamp": "2026-08-17 01:30:00",
    "title": "修侧栏宽度塌陷",
    "status": "completed",
    "status_note": None,
    "author_raw": "qinyi",
    "linked_changes": ["2026-08-16-change-center-quick-tab"],
    "files": [{"path": "frontend/src/app/layout.tsx", "note": None}],
    "body_sections": {"需求": "修宽度", "结果": "绿"},
    "raw_block": "## ql-20260817-001-abcd | ...",
}


@pytest.mark.asyncio
async def test_push_no_auth_returns_401(client: AsyncClient) -> None:
    resp = await client.post("/api/quicklog-entries", json=SAMPLE_ENTRY)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_push_apikey_auth_403(client: AsyncClient, apikey_headers: dict[str, str]) -> None:
    """shk_live_ 凭据有效也 403——写通道仅 shpsync_（security-audit task-06 收紧口径）。"""
    resp = await client.post("/api/quicklog-entries", json=SAMPLE_ENTRY, headers=apikey_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_push_jwt_auth_403(client: AsyncClient, auth_headers: dict[str, str]) -> None:
    resp = await client.post("/api/quicklog-entries", json=SAMPLE_ENTRY, headers=auth_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_push_shpsync_ok_and_persisted(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """shpsync_ 200 + 落库（workspace=token 派生，payload 原文，D-003/D-005）。"""
    ws_id, headers = shpsync_headers
    resp = await client.post("/api/quicklog-entries", json=SAMPLE_ENTRY, headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "ql_id": "ql-20260817-001-abcd"}

    stmt = select(QuicklogEntryORM).where(QuicklogEntryORM.workspace_id == ws_id)
    rows = (await db_session.execute(stmt)).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert row.ql_id == "ql-20260817-001-abcd"
    assert row.payload is not None  # mypy 收窄（payload 为 dict|None 列）
    assert row.payload["title"] == "修侧栏宽度塌陷"
    assert row.payload["body_sections"]["结果"] == "绿"
    assert row.payload["linked_changes"] == ["2026-08-16-change-center-quick-tab"]


@pytest.mark.asyncio
async def test_push_idempotent_same_ql_overwrites(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """同 (workspace, ql_id) 二推整条覆盖不重复（D-004 幂等 upsert）。"""
    _ws_id, headers = shpsync_headers
    first = {**SAMPLE_ENTRY, "status": "in_progress", "title": "进行中标题"}
    resp1 = await client.post("/api/quicklog-entries", json=first, headers=headers)
    assert resp1.status_code == 200

    second = {**SAMPLE_ENTRY, "status": "completed", "title": "完成态标题"}
    resp2 = await client.post("/api/quicklog-entries", json=second, headers=headers)
    assert resp2.status_code == 200

    stmt = select(QuicklogEntryORM)
    rows = (await db_session.execute(stmt)).scalars().all()
    assert len(rows) == 1
    assert rows[0].payload is not None  # mypy 收窄（payload 为 dict|None 列）
    assert rows[0].payload["status"] == "completed"
    assert rows[0].payload["title"] == "完成态标题"


@pytest.mark.asyncio
async def test_push_two_workspaces_same_ql_two_rows(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """复合唯一键是 (workspace_id, ql_id)：另一 workspace 直接插同 ql_id 不撞约束。"""
    import uuid as _uuid

    ws_id, headers = shpsync_headers
    await client.post("/api/quicklog-entries", json=SAMPLE_ENTRY, headers=headers)

    other_ws = (
        _uuid.uuid4()
    )  # 无 token 的另一 workspace 模拟行（服务层不校验 FK 目标存在性外的语义）
    db_session.add(
        QuicklogEntryORM(
            workspace_id=other_ws,
            ql_id=SAMPLE_ENTRY["ql_id"],
            payload={"ql_id": SAMPLE_ENTRY["ql_id"], "title": "另一工作区"},
        )
    )
    await db_session.commit()

    stmt = select(QuicklogEntryORM).where(QuicklogEntryORM.ql_id == SAMPLE_ENTRY["ql_id"])
    rows = (await db_session.execute(stmt)).scalars().all()
    assert len(rows) == 2
    assert {r.workspace_id for r in rows} == {ws_id, other_ws}


@pytest.mark.asyncio
async def test_push_missing_ql_id_422(
    client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """缺 ql_id（复合键之一）422；多余 workspace 键被 extra=ignore 宽松吞掉不 422。"""
    _ws_id, headers = shpsync_headers
    resp = await client.post(
        "/api/quicklog-entries",
        json={"title": "无 ql_id"},
        headers=headers,
    )
    assert resp.status_code == 422

    resp2 = await client.post(
        "/api/quicklog-entries",
        json={**SAMPLE_ENTRY, "workspace": "00000000-0000-0000-0000-000000000000"},
        headers=headers,
    )
    assert resp2.status_code == 200
