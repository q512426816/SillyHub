"""Scoped reparse 零删除红线测试（task-02 / design §5 P1 R-08）。

Change 2026-08-14-change-center-conversation-driven task-02：``ChangeService.reparse``
新增 ``scope: list[str] | None`` 参数——scope=None 全量（含 delete，现状语义）；
scope=[...] 只 create/update，**零 delete**：

- 范围外变更不进 parsed 集合也不判删除；
- 范围内 key 磁盘确认消失也不删（留全量/手动重扫描收敛）；
- rename 检测同样只在全量模式下进行（scoped 是部分视图，误判 orphaned）。

删除仅发生在全量 reparse / 手动「重新扫描」（Grill P0 R-08）。

author: qinyi
created_at: 2026-08-14
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select

from app.modules.change.model import Change
from app.modules.change.service import ChangeService
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace


async def _make_ws(db_session) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="scoped-zero-delete ws",
        slug=f"szd-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/scoped-zero-delete-test-{uuid.uuid4().hex[:12]}",
        status="active",
        component_key="comp",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_spec_ws(db_session, ws: Workspace, spec_root: Path) -> SpecWorkspace:
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        spec_root=str(spec_root),
        strategy="platform-managed",
        sync_status="clean",
    )
    db_session.add(spec_ws)
    await db_session.commit()
    await db_session.refresh(spec_ws)
    return spec_ws


def _seed_change(spec_root: Path, key: str, title: str) -> None:
    d = spec_root / "changes" / key
    d.mkdir(parents=True, exist_ok=True)
    (d / "proposal.md").write_text(f"# {title}\n", encoding="utf-8")


async def _fetch(db_session, ws_id: uuid.UUID, key: str) -> Change | None:
    return (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws_id,
                    Change.change_key == key,
                )
            )
        )
        .scalars()
        .first()
    )


# ===========================================================================
# 红线核心：scoped 零删除
# ===========================================================================


async def test_scoped_reparse_does_not_delete_out_of_scope_changes(db_session, tmp_path):
    """范围外变更不删：B 目录磁盘消失，scoped 只扫 A → B 行保留、A 行更新。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-keep", "Keep")
    _seed_change(spec_root, "2026-08-14-remove", "Remove")

    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id)  # 全量建 A/B 两行
    assert stats["created"] == 2
    assert stats["deleted"] == 0
    assert await _fetch(db_session, ws.id, "2026-08-14-remove") is not None

    # B 磁盘消失 → scoped 只扫 A
    shutil.rmtree(spec_root / "changes" / "2026-08-14-remove")
    (spec_root / "changes" / "2026-08-14-keep" / "proposal.md").write_text(
        "# Keep v2\n", encoding="utf-8"
    )

    stats, _ = await service.reparse(ws.id, scope=["2026-08-14-keep"])
    assert stats["deleted"] == 0  # 零删除红线
    assert stats["updated"] == 1
    # 范围外 B 行保留；范围内 A 行更新
    assert await _fetch(db_session, ws.id, "2026-08-14-remove") is not None
    keep = await _fetch(db_session, ws.id, "2026-08-14-keep")
    assert keep is not None and keep.title == "Keep v2"


async def test_scoped_reparse_does_not_delete_scope_in_disappeared_change(db_session, tmp_path):
    """范围内 key 磁盘消失也不删：A 目录被删，scoped scope=["A"] → A 行保留。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-gone", "Gone")

    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id)
    assert stats["created"] == 1
    assert await _fetch(db_session, ws.id, "2026-08-14-gone") is not None

    # 范围内 key 磁盘消失 → scoped 不删（留全量/手动收敛）
    shutil.rmtree(spec_root / "changes" / "2026-08-14-gone")
    stats, _ = await service.reparse(ws.id, scope=["2026-08-14-gone"])
    assert stats["deleted"] == 0
    assert stats["created"] == 0
    assert stats["parsed"] == 0
    assert await _fetch(db_session, ws.id, "2026-08-14-gone") is not None


async def test_scoped_reparse_does_not_touch_other_workspace_changes(db_session, tmp_path):
    """scoped 只作用于本 workspace；其它 workspace 的变更不受影响。"""
    ws1 = await _make_ws(db_session)
    ws2 = await _make_ws(db_session)
    root1 = tmp_path / "root1"
    root2 = tmp_path / "root2"
    await _make_spec_ws(db_session, ws1, root1)
    await _make_spec_ws(db_session, ws2, root2)
    _seed_change(root1, "2026-08-14-a", "A")
    _seed_change(root2, "2026-08-14-b", "B")

    service1 = ChangeService(db_session)
    service2 = ChangeService(db_session)
    await service1.reparse(ws1.id)
    await service2.reparse(ws2.id)
    assert await _fetch(db_session, ws1.id, "2026-08-14-a") is not None
    assert await _fetch(db_session, ws2.id, "2026-08-14-b") is not None

    # ws1 scoped 重扫 → ws2 的 B 不受影响
    stats, _ = await service1.reparse(ws1.id, scope=["2026-08-14-a"])
    assert stats["deleted"] == 0
    assert await _fetch(db_session, ws2.id, "2026-08-14-b") is not None


# ===========================================================================
# scoped 仍 create/update
# ===========================================================================


async def test_scoped_reparse_creates_new_change(db_session, tmp_path):
    """scoped create：新变更目录在 scope 内 → 建行。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-fresh", "Fresh")

    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id, scope=["2026-08-14-fresh"])
    assert stats["created"] == 1
    assert stats["deleted"] == 0
    change = await _fetch(db_session, ws.id, "2026-08-14-fresh")
    assert change is not None and change.title == "Fresh"


async def test_scoped_reparse_updates_existing_change(db_session, tmp_path):
    """scoped update：已有变更目录在 scope 内 → 更新行。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-upd", "V1")

    service = ChangeService(db_session)
    await service.reparse(ws.id)
    (spec_root / "changes" / "2026-08-14-upd" / "proposal.md").write_text(
        "# V2\n", encoding="utf-8"
    )

    stats, _ = await service.reparse(ws.id, scope=["2026-08-14-upd"])
    assert stats["updated"] == 1
    assert stats["deleted"] == 0
    change = await _fetch(db_session, ws.id, "2026-08-14-upd")
    assert change is not None and change.title == "V2"


# ===========================================================================
# 全量 reparse 现状语义不变（delete 仅全量）
# ===========================================================================


async def test_full_reparse_still_deletes_disappeared_changes(db_session, tmp_path):
    """全量 reparse（scope=None）删除磁盘消失的变更行（现状语义，R-08 删除唯一路径）。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-gone", "Gone")

    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id)
    assert stats["created"] == 1

    shutil.rmtree(spec_root / "changes" / "2026-08-14-gone")
    stats, _ = await service.reparse(ws.id)  # 全量
    assert stats["deleted"] == 1
    assert await _fetch(db_session, ws.id, "2026-08-14-gone") is None


async def test_scoped_reparse_skips_rename_detection(db_session, tmp_path):
    """scoped 不跑 rename 检测：范围外变更目录"消失"不会被误判为 orphaned 而错配 rename。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-old", "Old")
    _seed_change(spec_root, "2026-08-14-new", "New")

    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id)
    assert stats["created"] == 2

    # 模拟 rename：旧目录消失、新目录出现，但只 scoped 扫新目录。
    # 全量模式会识别为 rename（保持状态）；scoped 必须当作独立 create，不吞旧行。
    shutil.rmtree(spec_root / "changes" / "2026-08-14-old")

    stats, _ = await service.reparse(ws.id, scope=["2026-08-14-new"])
    assert stats["renamed"] == 0
    # 旧行保留（未因 rename 匹配而迁移状态）
    assert await _fetch(db_session, ws.id, "2026-08-14-old") is not None
    # 新行作为独立变更创建
    assert await _fetch(db_session, ws.id, "2026-08-14-new") is not None


# Suppress unused-import warning for pytest fixture discovery.
pytestmark = pytest.mark.asyncio
