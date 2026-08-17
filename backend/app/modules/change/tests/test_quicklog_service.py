"""quicklog_service 双源合并测试（task-04 / design §8 合并逻辑测试）。

覆盖：双源同 ql_id 取 PG、仅文件源、仅 PG 源、双空、stale 24h 阈值（注入 now）、
enrich 命中/未命中回退、筛选（search 全文/status/author/linked_change/placeholder）、
分页、模块推导。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import User
from app.modules.change.quicklog_service import (
    QuicklogQueryService,
    derive_stale,
)
from app.modules.platform_sync.model import QuicklogEntryORM


class _FakeWorkspace:
    """轻量 workspace 替身（service 只用 id / root_path）。"""

    def __init__(self, ws_id: uuid.UUID, root_path: str) -> None:
        self.id = ws_id
        self.root_path = root_path


async def _setup(db_session: AsyncSession, tmp_path: Path) -> tuple[uuid.UUID, _FakeWorkspace]:
    """root_path=tmp_path → service 解析 spec 根 = tmp_path/.sillyspec（无 spec_workspace 记录 fallback）。"""
    ws_id = uuid.uuid4()
    (tmp_path / ".sillyspec" / "quicklog").mkdir(parents=True, exist_ok=True)
    return ws_id, _FakeWorkspace(ws_id, str(tmp_path))


def _now() -> datetime:
    return datetime(2026, 8, 17, 12, 0, 0, tzinfo=UTC)


def _write_file(tmp_path: Path, name: str, text: str) -> None:
    ql_dir = tmp_path / ".sillyspec" / "quicklog"
    (ql_dir / name).write_bytes(text.replace("\n", "\r\n").encode("utf-8"))


def _ts(hours_ago: float) -> str:
    t = _now().replace(tzinfo=None) - timedelta(hours=hours_ago)
    return t.strftime("%Y-%m-%d %H:%M:%S")


async def _add_pushed(
    db_session: AsyncSession, ws_id: uuid.UUID, ql_id: str, payload: dict[str, Any]
) -> None:
    db_session.add(
        QuicklogEntryORM(workspace_id=ws_id, ql_id=ql_id, payload={"ql_id": ql_id, **payload})
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_merge_pg_wins_on_same_ql_id(db_session: AsyncSession, tmp_path: Path) -> None:
    """双源同 ql_id 取 PG（D-003：推送时点新于文件同步）。"""
    ws_id, ws = await _setup(db_session, tmp_path)
    _write_file(
        tmp_path,
        "QUICKLOG-qinyi.md",
        f"## ql-20260817-001-aaaa | {_ts(2)} | 文件版标题\n状态：进行中\n",
    )
    await _add_pushed(
        db_session,
        ws_id,
        "ql-20260817-001-aaaa",
        {"title": "推送版标题", "status": "completed", "timestamp": _ts(1)},
    )
    result = await QuicklogQueryService(db_session).list_entries(ws, now=_now())
    assert result.total == 1
    assert result.items[0].title == "推送版标题"
    assert result.items[0].status == "completed"
    assert result.items[0].source == "pushed"


@pytest.mark.asyncio
async def test_merge_file_only(db_session: AsyncSession, tmp_path: Path) -> None:
    """仅文件源（daemon 同步可见，无 CLI 推送）。"""
    _ws_id, ws = await _setup(db_session, tmp_path)
    _write_file(
        tmp_path,
        "QUICKLOG-qinyi.md",
        f"## ql-20260817-002-bbbb | {_ts(3)} | 文件源条目\n状态：已完成\n",
    )
    result = await QuicklogQueryService(db_session).list_entries(ws, now=_now())
    assert result.total == 1
    assert result.items[0].source == "file"
    assert result.items[0].status == "completed"


@pytest.mark.asyncio
async def test_merge_pushed_only(db_session: AsyncSession, tmp_path: Path) -> None:
    """仅 PG 源（quick 刚启动、daemon 尚未同步文件——即时性场景）。"""
    ws_id, ws = await _setup(db_session, tmp_path)
    await _add_pushed(
        db_session,
        ws_id,
        "ql-20260817-003-cccc",
        {"title": "推送源条目", "status": "in_progress", "timestamp": _ts(1)},
    )
    result = await QuicklogQueryService(db_session).list_entries(ws, now=_now())
    assert result.total == 1
    assert result.items[0].source == "pushed"
    assert result.items[0].status == "in_progress"


@pytest.mark.asyncio
async def test_merge_both_empty(db_session: AsyncSession, tmp_path: Path) -> None:
    """双空：无目录内容 + 无推送 → 空列表（design §7）。"""
    _ws_id, ws = await _setup(db_session, tmp_path)
    result = await QuicklogQueryService(db_session).list_entries(ws, now=_now())
    assert result.total == 0
    assert result.items == []


@pytest.mark.asyncio
async def test_stale_derivation_24h_threshold(db_session: AsyncSession, tmp_path: Path) -> None:
    """in_progress：>24h → stale；≤24h → in_progress；completed 不派生（D-007）。"""
    _ws_id, ws = await _setup(db_session, tmp_path)
    _write_file(
        tmp_path,
        "QUICKLOG-qinyi.md",
        f"## ql-20260817-010-dddd | {_ts(25)} | 老进行中\n状态：进行中\n"
        f"## ql-20260817-011-eeee | {_ts(2)} | 新进行中\n状态：进行中\n"
        f"## ql-20260817-012-ffff | {_ts(48)} | 老完成\n状态：已完成\n",
    )
    result = await QuicklogQueryService(db_session).list_entries(ws, now=_now())
    by_id = {e.ql_id: e.status for e in result.items}
    assert by_id["ql-20260817-010-dddd"] == "stale"
    assert by_id["ql-20260817-011-eeee"] == "in_progress"
    assert by_id["ql-20260817-012-ffff"] == "completed"


def test_derive_stale_missing_timestamp_not_marked() -> None:
    """timestamp 缺失（解析失败）不派生 stale（保守 in_progress）。"""
    from app.modules.change.quicklog_service import QuicklogMergedEntry

    e = QuicklogMergedEntry(
        ql_id="ql-x",
        timestamp=None,
        title="t",
        status="in_progress",
        status_note=None,
        placeholder=False,
        author_raw="qinyi",
    )
    out = derive_stale([e], now=_now())
    assert out[0].status == "in_progress"


@pytest.mark.asyncio
async def test_author_enrich_hit_and_fallback(db_session: AsyncSession, tmp_path: Path) -> None:
    """enrich：users.username 命中 display_name 优先；未命中回退 author_raw。"""
    _ws_id, ws = await _setup(db_session, tmp_path)
    db_session.add(
        User(
            email="qinyi@example.com",
            username="qinyi",
            password_hash="x",
            display_name="秦毅",
            status="active",
        )
    )
    await db_session.commit()
    _write_file(
        tmp_path,
        "QUICKLOG-qinyi.md",
        f"## ql-20260817-020-gggg | {_ts(2)} | qinyi 的条目\n状态：已完成\n",
    )
    _write_file(
        tmp_path,
        "QUICKLOG-WhaleFall.md",
        f"## ql-20260817-021-hhhh | {_ts(3)} | WhaleFall 的条目\n状态：已完成\n",
    )
    result = await QuicklogQueryService(db_session).list_entries(ws, now=_now())
    by_author = {e.author_raw: e for e in result.items}
    assert by_author["qinyi"].author_name == "秦毅"
    assert by_author["WhaleFall"].author_name == "WhaleFall"  # 未命中回退原始名


@pytest.mark.asyncio
async def test_filters_search_status_author_placeholder(
    db_session: AsyncSession, tmp_path: Path
) -> None:
    """筛选矩阵：search 全文（标题+正文）/status/author/placeholder 默认隐藏。"""
    _ws_id, ws = await _setup(db_session, tmp_path)
    _write_file(
        tmp_path,
        "QUICKLOG-qinyi.md",
        f"## ql-20260817-030-iiii | {_ts(5)} | 侧栏修复\n状态：已完成\n需求：修侧栏宽度。\n"
        f"## ql-20260817-031-jjjj | {_ts(4)} | (quick 任务)\n状态：进行中\n"
        f"## ql-20260817-032-kkkk | {_ts(3)} | daemon 重连\n状态：进行中\n需求：daemon 断线。\n"
        f"## ql-20260817-033-llll | {_ts(2)} | 侧栏回归\n状态：已暂存（待 commit）\n",
    )
    svc = QuicklogQueryService(db_session)

    # placeholder 默认隐藏（D-007）
    r = await svc.list_entries(ws, now=_now())
    assert r.total == 3
    # include_placeholder=True 显式打开
    r2 = await svc.list_entries(ws, include_placeholder=True, now=_now())
    assert r2.total == 4
    # search 命中标题
    r3 = await svc.list_entries(ws, search="侧栏", now=_now())
    assert r3.total == 2
    # search 命中正文（四段全文）
    r4 = await svc.list_entries(ws, search="daemon 断线", now=_now())
    assert r4.total == 1
    # status 精确（派生后 4 态）
    r5 = await svc.list_entries(ws, status="partial_done", now=_now())
    assert r5.total == 1 and r5.items[0].status_note == "待 commit"
    # author
    r6 = await svc.list_entries(ws, author="qinyi", now=_now())
    assert r6.total == 3


@pytest.mark.asyncio
async def test_filter_linked_change(db_session: AsyncSession, tmp_path: Path) -> None:
    """linked_change 筛选（FR-07 反向区块数据面）。"""
    _ws_id, ws = await _setup(db_session, tmp_path)
    _write_file(
        tmp_path,
        "QUICKLOG-qinyi.md",
        f"## ql-20260817-040-mmmm | {_ts(5)} | 关联条目\n状态：已完成\n"
        "关联变更：2026-08-16-change-center-quick-tab\n"
        f"## ql-20260817-041-nnnn | {_ts(4)} | 无关条目\n状态：已完成\n关联变更：（无）\n",
    )
    svc = QuicklogQueryService(db_session)
    r = await svc.list_entries(ws, linked_change="2026-08-16-change-center-quick-tab", now=_now())
    assert r.total == 1
    assert r.items[0].ql_id == "ql-20260817-040-mmmm"


@pytest.mark.asyncio
async def test_pagination_and_sort_desc(db_session: AsyncSession, tmp_path: Path) -> None:
    """timestamp desc 排序 + 分页窗口。"""
    _ws_id, ws = await _setup(db_session, tmp_path)
    lines = []
    for i in range(1, 6):
        lines.append(
            f"## ql-20260817-05{i}-{chr(ord('p') + i)}1{i * 7} | {_ts(i)} | 条目{i}\n状态：已完成\n"
        )
    _write_file(tmp_path, "QUICKLOG-qinyi.md", "\n".join(lines))
    svc = QuicklogQueryService(db_session)
    page1 = await svc.list_entries(ws, page=1, page_size=2, now=_now())
    page2 = await svc.list_entries(ws, page=2, page_size=2, now=_now())
    assert page1.total == 5
    assert [e.title for e in page1.items] == ["条目1", "条目2"]  # 最新在前
    assert [e.title for e in page2.items] == ["条目3", "条目4"]


@pytest.mark.asyncio
async def test_get_entry_full_fields(db_session: AsyncSession, tmp_path: Path) -> None:
    """详情：全字段（body 全文 + raw_block + 文件括注）。"""
    _ws_id, ws = await _setup(db_session, tmp_path)
    _write_file(
        tmp_path,
        "QUICKLOG-qinyi.md",
        f"## ql-20260817-060-rrrr | {_ts(30)} | 详情条目\n状态：进行中\n"
        "文件：\n- backend/app/modules/agent/service.py（修调度）\n"
        "需求：完整正文。\n根因：根因文本。\n方案：方案文本。\n结果：结果文本。\n",
    )
    e = await QuicklogQueryService(db_session).get_entry(ws, "ql-20260817-060-rrrr", now=_now())
    assert e is not None
    assert e.status == "stale"  # 详情也派生 stale
    assert e.body_sections is not None
    assert e.body_sections["需求"] == "完整正文。"
    assert e.files == (("backend/app/modules/agent/service.py", "修调度"),)
    assert "## ql-20260817-060-rrrr" in (e.raw_block or "")
    assert await QuicklogQueryService(db_session).get_entry(ws, "nope", now=_now()) is None


@pytest.mark.asyncio
async def test_modules_derivation_via_module_map(db_session: AsyncSession, tmp_path: Path) -> None:
    """模块推导：spec docs _module-map.yaml 前缀命中（复用 ChangeParser 口径）。"""
    _ws_id, ws = await _setup(db_session, tmp_path)
    # module map 放在 spec 根下（service fallback root_path/.sillyspec → docs 查找路径）
    spec_docs = tmp_path / ".sillyspec" / "docs" / "proj" / "modules"
    spec_docs.mkdir(parents=True, exist_ok=True)
    (spec_docs / "_module-map.yaml").write_text(
        "modules:\n  agent:\n    paths:\n      - backend/app/modules/agent/**\n",
        encoding="utf-8",
    )
    _write_file(
        tmp_path,
        "QUICKLOG-qinyi.md",
        f"## ql-20260817-070-ssss | {_ts(2)} | agent 修复\n状态：已完成\n"
        "文件：backend/app/modules/agent/service.py, frontend/src/lib/x.ts\n",
    )
    result = await QuicklogQueryService(db_session).list_entries(ws, now=_now())
    assert result.modules_by_ql.get("ql-20260817-070-ssss") == ["agent"]
