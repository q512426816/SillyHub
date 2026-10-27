"""POST /changes/-/hits-sync 知识遥测 CLI 直报端点测试（2026-10-28-knowledge-hits-cli-direct）。

覆盖：鉴权矩阵（无凭据 401 / shk_live_ 403 / JWT 403 / shpsync_ 200——四轨分轨
铁律）、行落令牌派生 workspace + daemon_local_id 通道标识、重复行 duplicates 幂等
与坏行 skipped_bad 宽容计数（与既有 ingest 语义同源）、令牌无归属 403
fail-closed（dependency_overrides 注入无归属 scope——防御分支正常流量不可达）。
fixture 复用本 conftest 的 shpsync_headers（建 workspace + 签发 shpsync_ token）。
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.modules.knowledge.hits import KnowledgeHit

LINE_1 = '{"type":"inject","change":"2026-10-28-demo","matchedFiles":["fr/backend.md#条目一"],"at":"2026-10-28T12:00:00Z"}'
LINE_2 = '{"type":"fr-inject","change":"2026-10-28-demo","matchedFiles":["decisions/backend.md#D-001@v1"],"at":"2026-10-28T12:01:00Z"}'


async def _hit_rows(db_session: Any, workspace_id: Any) -> list[KnowledgeHit]:
    res = await db_session.execute(
        select(KnowledgeHit).where(KnowledgeHit.workspace_id == workspace_id)
    )
    return list(res.scalars().all())


async def test_cli_push_lands_in_token_workspace(
    client: AsyncClient, db_session: Any, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """shpsync_ 直报：行落令牌派生 workspace，daemon_local_id 通道标识原样落库。"""
    ws_id, headers = shpsync_headers
    resp = await client.post(
        "/api/changes/-/hits-sync",
        json={"lines": [LINE_1, LINE_2], "daemon_local_id": "cli-alice"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body == {"ingested": 2, "skipped_bad": 0, "duplicates": 0}

    rows = await _hit_rows(db_session, ws_id)
    assert len(rows) == 2
    # 通道标识与行内容（matched_anchors 原样数组、type、change_name）。
    assert all(r.daemon_local_id == "cli-alice" for r in rows)
    by_change = {r.change_name: r for r in rows}
    assert set(by_change) == {"2026-10-28-demo"}
    inject = next(r for r in rows if r.type == "inject")
    assert inject.matched_anchors == ["fr/backend.md#条目一"]


async def test_cli_push_no_auth_401(client: AsyncClient) -> None:
    """无凭据 401（鉴权矩阵）。"""
    resp = await client.post("/api/changes/-/hits-sync", json={"lines": [LINE_1]})
    assert resp.status_code == 401


async def test_cli_push_apikey_403(client: AsyncClient, apikey_headers: dict[str, str]) -> None:
    """shk_live_ 凭据有效也 403——写通道仅 shpsync_（四轨分轨，quicklog-entries 同款）。"""
    resp = await client.post(
        "/api/changes/-/hits-sync",
        json={"lines": [LINE_1]},
        headers=apikey_headers,
    )
    assert resp.status_code == 403


async def test_cli_push_jwt_403(client: AsyncClient, auth_headers: dict[str, str]) -> None:
    """JWT 凭据有效也 403——CLI 直报端点不混开用户轨（四轨分轨）。"""
    resp = await client.post(
        "/api/changes/-/hits-sync",
        json={"lines": [LINE_1]},
        headers=auth_headers,
    )
    assert resp.status_code == 403


async def test_cli_push_duplicate_and_bad_lines(
    client: AsyncClient, db_session: Any, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """重复行 duplicates 幂等 + 坏行 skipped_bad 宽容——与既有 ingest 语义同源（FR-03）。

    同批行重报零新增入库（行 sha256 幂等）；非 JSON 坏行跳过计数不炸批。
    """
    ws_id, headers = shpsync_headers
    first = await client.post(
        "/api/changes/-/hits-sync",
        json={"lines": [LINE_1, LINE_2]},
        headers=headers,
    )
    assert first.json()["ingested"] == 2

    second = await client.post(
        "/api/changes/-/hits-sync",
        json={"lines": [LINE_1, LINE_2, "not-json{{{"]},
        headers=headers,
    )
    assert second.status_code == 200
    assert second.json() == {"ingested": 0, "skipped_bad": 1, "duplicates": 2}

    rows = await _hit_rows(db_session, ws_id)
    assert len(rows) == 2  # 重报零新增（FR-03 幂等）


async def test_cli_push_no_workspace_scope_403(
    client: AsyncClient, db_session: Any, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """令牌无工作区归属 → 403 fail-closed（防御分支；dependency_overrides 注入）。"""
    from fastapi import HTTPException

    from app.modules.knowledge.schema import HitsBatchIn as KnowledgeHitsBatchIn
    from app.modules.platform_sync.auth import PlatformSyncAuthScope
    from app.modules.platform_sync.router import push_knowledge_hits_cli

    _ws_id, _headers = shpsync_headers  # 复用 fixture 建用户（scope 本身被覆写）
    from app.modules.auth.model import User

    user = (await db_session.execute(select(User).limit(1))).scalars().first()
    scope = PlatformSyncAuthScope(workspace_id=None)
    with pytest.raises(HTTPException) as exc_info:
        await push_knowledge_hits_cli(
            KnowledgeHitsBatchIn(lines=[LINE_1], daemon_local_id=None),
            db_session,
            (user, scope),
        )
    assert exc_info.value.status_code == 403
