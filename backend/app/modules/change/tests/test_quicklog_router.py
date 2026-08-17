"""GET quicklog 列表/详情端点测试（task-05 / design §6 契约）。

经 httpx AsyncClient 全链路（鉴权+路由+service+parser），fixture 建真实
workspace（root_path=tmp_path）+ spec_workspace 记录指向同一 spec 根。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.workspace.model import Workspace


def _ts(hours_ago: float) -> str:
    """相对真实 now 的时间串（router stale 派生用真实时钟，固定日期会随运行日漂移）。"""
    t = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=hours_ago)
    return t.strftime("%Y-%m-%d %H:%M:%S")


async def _setup_workspace(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
    tmp_path: Path,
) -> uuid.UUID:
    """建 workspace（root_path=tmp_path）→ spec 根 fallback tmp_path/.sillyspec。"""
    ws_id = uuid.uuid4()
    db_session.add(
        Workspace(
            id=ws_id,
            name=f"ws-ql-{ws_id.hex[:8]}",
            slug=f"ws-ql-{ws_id.hex[:8]}",
            root_path=str(tmp_path),
            status="active",
        )
    )
    await db_session.commit()
    (tmp_path / ".sillyspec" / "quicklog").mkdir(parents=True, exist_ok=True)
    return ws_id


def _write_entry(tmp_path: Path, name: str, text: str) -> None:
    (tmp_path / ".sillyspec" / "quicklog" / name).write_bytes(
        text.replace("\n", "\r\n").encode("utf-8")
    )


@pytest.mark.asyncio
async def test_list_quicklog_entries_unauthorized(client: AsyncClient, tmp_path: Path) -> None:
    resp = await client.get(f"/api/workspaces/{uuid.uuid4()}/quicklog-entries")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_and_detail_roundtrip(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
    tmp_path: Path,
) -> None:
    ws_id = await _setup_workspace(client, db_session, auth_headers, tmp_path)
    _write_entry(
        tmp_path,
        "QUICKLOG-qinyi.md",
        f"## ql-20260817-100-aaaa | {_ts(3)} | 侧栏宽度修复\n状态：已完成\n"
        "关联变更：2026-08-16-change-center-quick-tab\n"
        "文件：backend/app/modules/agent/service.py\n"
        "需求：修侧栏。\n根因：断点。\n方案：改样式。\n结果：绿。\n",
    )
    resp = await client.get(f"/api/workspaces/{ws_id}/quicklog-entries", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["ql_id"] == "ql-20260817-100-aaaa"
    assert item["status"] == "completed"
    assert item["author_raw"] == "qinyi"
    assert item["linked_changes"] == ["2026-08-16-change-center-quick-tab"]
    assert item["files"] == [{"path": "backend/app/modules/agent/service.py", "note": None}]
    assert item["source"] == "file"
    assert "body_sections" not in item or item.get("body_sections") in (
        None,
        {},
        {"需求": "修侧栏。"},
    )
    # 列表轻量：raw 不带
    assert "raw_block" not in item

    # 详情全字段
    detail = await client.get(
        f"/api/workspaces/{ws_id}/quicklog-entries/ql-20260817-100-aaaa",
        headers=auth_headers,
    )
    assert detail.status_code == 200
    d = detail.json()
    assert d["body_sections"]["结果"] == "绿。"
    assert "## ql-20260817-100-aaaa" in d["raw_block"]


@pytest.mark.asyncio
async def test_list_filters_via_query_params(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
    tmp_path: Path,
) -> None:
    ws_id = await _setup_workspace(client, db_session, auth_headers, tmp_path)
    _write_entry(
        tmp_path,
        "QUICKLOG-qinyi.md",
        f"## ql-20260817-110-bbbb | {_ts(30)} | 老任务\n状态：进行中\n"
        f"## ql-20260817-111-cccc | {_ts(1)} | (quick 任务)\n状态：进行中\n"
        f"## ql-20260817-112-dddd | {_ts(2)} | 新任务\n状态：已完成\n关联变更：2026-08-16-x\n",
    )
    # placeholder 默认隐藏 → 2 条；其中 30h 前的进行中 → stale
    r = await client.get(f"/api/workspaces/{ws_id}/quicklog-entries", headers=auth_headers)
    assert r.json()["total"] == 2
    statuses = {i["ql_id"]: i["status"] for i in r.json()["items"]}
    assert statuses["ql-20260817-110-bbbb"] == "stale"
    assert statuses["ql-20260817-112-dddd"] == "completed"

    # include_placeholder
    r2 = await client.get(
        f"/api/workspaces/{ws_id}/quicklog-entries",
        params={"include_placeholder": True},
        headers=auth_headers,
    )
    assert r2.json()["total"] == 3

    # status 筛选（派生 stale 态）
    r3 = await client.get(
        f"/api/workspaces/{ws_id}/quicklog-entries",
        params={"status": "stale"},
        headers=auth_headers,
    )
    assert r3.json()["total"] == 1

    # linked_change（FR-07 数据面）
    r4 = await client.get(
        f"/api/workspaces/{ws_id}/quicklog-entries",
        params={"linked_change": "2026-08-16-x"},
        headers=auth_headers,
    )
    assert r4.json()["total"] == 1

    # search 全文
    r5 = await client.get(
        f"/api/workspaces/{ws_id}/quicklog-entries",
        params={"search": "新任务"},
        headers=auth_headers,
    )
    assert r5.json()["total"] == 1


@pytest.mark.asyncio
async def test_detail_404(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
    tmp_path: Path,
) -> None:
    ws_id = await _setup_workspace(client, db_session, auth_headers, tmp_path)
    resp = await client.get(
        f"/api/workspaces/{ws_id}/quicklog-entries/ql-nope", headers=auth_headers
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_empty_without_quicklog_dir(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
    tmp_path: Path,
) -> None:
    """workspace 无 quicklog 内容 → 空列表（design §7 不报错）。"""
    ws_id = await _setup_workspace(client, db_session, auth_headers, tmp_path)
    resp = await client.get(f"/api/workspaces/{ws_id}/quicklog-entries", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {"items": [], "total": 0}
