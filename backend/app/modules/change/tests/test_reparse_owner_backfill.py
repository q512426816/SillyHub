"""2026-10-13-change-owner-backfill FR-01/FR-04：reparse 建行负责人兜底三分支。

背景：主力路径「agent 本地 CLI 写变更目录 + 平台 reparse 扫描登记」建行此前恒
owner_id=None（库中 300/342 无负责人）。本变更新建行兜底取工作区所有者
（workspace.created_by）；update 分支 _apply_parsed 不触碰 owner_id——已有 owner
不覆盖、存量空行不回填（存量可见性由前端展示层兜底，不改写数据）。

三分支 + 边界（created_by 为 None）走真实 reparse（sync）路径断言落库值。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from app.modules.change.model import Change
from app.modules.change.service import ChangeService
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace


async def _make_ws_with_creator(db_session, tmp_path, *, created_by) -> Workspace:
    """建工作区（created_by 可 None）+ 指向 tmp_path 的 spec_root 镜像行。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name="owner-backfill ws",
        slug=f"ob-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "root"),
        status="active",
        component_key="comp",
        created_by=created_by,
        last_scanned_at=datetime.now(UTC),
    )
    db_session.add(ws)
    spec_root = tmp_path / "spec-root" / "changes"
    spec_root.mkdir(parents=True, exist_ok=True)
    db_session.add(
        SpecWorkspace(
            workspace_id=ws.id,
            spec_root=str(spec_root.parent),
            strategy="platform-managed",
            sync_status="clean",
        )
    )
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


def _write_change_dir(tmp_path, key: str) -> None:
    d = tmp_path / "spec-root" / "changes" / key
    d.mkdir(parents=True, exist_ok=True)
    (d / "proposal.md").write_text(f"# {key}\n\n动机：测试。\n", encoding="utf-8")


async def _get_change(db_session, ws_id, key) -> Change | None:
    return (
        (
            await db_session.execute(
                select(Change).where(Change.workspace_id == ws_id, Change.change_key == key)
            )
        )
        .scalars()
        .first()
    )


async def test_reparse_created_backfills_owner_from_workspace_created_by(db_session, tmp_path):
    """FR-01 场景 1：新建行兜底填 workspace.created_by 为 owner。"""
    creator = uuid.uuid4()
    ws = await _make_ws_with_creator(db_session, tmp_path, created_by=creator)
    _write_change_dir(tmp_path, "2026-10-13-new-owner-demo")

    stats, _ = await ChangeService(db_session).reparse(ws.id)

    assert stats["created"] == 1
    row = await _get_change(db_session, ws.id, "2026-10-13-new-owner-demo")
    assert row is not None
    assert row.owner_id == creator


async def test_reparse_update_does_not_overwrite_existing_owner(db_session, tmp_path):
    """FR-01 场景 2：已有 owner（change_writer 代理路径落的值）reparse 更新不被覆盖。"""
    creator = uuid.uuid4()
    real_owner = uuid.uuid4()  # 与工作区所有者不同，证明没走兜底串写
    ws = await _make_ws_with_creator(db_session, tmp_path, created_by=creator)
    _write_change_dir(tmp_path, "2026-10-13-keep-owner")
    db_session.add(
        Change(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            change_key="2026-10-13-keep-owner",
            title="2026-10-13-keep-owner",
            status="active",
            location="active",
            path="changes/2026-10-13-keep-owner",
            affected_components=[],
            current_stage="brainstorm",
            owner_id=real_owner,
        )
    )
    await db_session.commit()

    stats, _ = await ChangeService(db_session).reparse(ws.id)

    assert stats["updated"] == 1
    assert stats["created"] == 0
    row = await _get_change(db_session, ws.id, "2026-10-13-keep-owner")
    assert row is not None
    assert row.owner_id == real_owner


async def test_reparse_update_does_not_backfill_null_owner(db_session, tmp_path):
    """FR-01 场景 3：存量空 owner 行 reparse 更新不回填（数据保持诚实，展示层兜底）。"""
    creator = uuid.uuid4()
    ws = await _make_ws_with_creator(db_session, tmp_path, created_by=creator)
    _write_change_dir(tmp_path, "2026-10-13-null-owner")
    db_session.add(
        Change(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            change_key="2026-10-13-null-owner",
            title="2026-10-13-null-owner",
            status="active",
            location="active",
            path="changes/2026-10-13-null-owner",
            affected_components=[],
            current_stage="brainstorm",
            owner_id=None,
        )
    )
    await db_session.commit()

    stats, _ = await ChangeService(db_session).reparse(ws.id)

    assert stats["updated"] == 1
    row = await _get_change(db_session, ws.id, "2026-10-13-null-owner")
    assert row is not None
    assert row.owner_id is None


async def test_reparse_created_owner_none_when_workspace_has_no_creator(db_session, tmp_path):
    """FR-01 场景 4（边界）：workspace.created_by 为 None → 新行 owner_id 为 None 不报错。"""
    ws = await _make_ws_with_creator(db_session, tmp_path, created_by=None)
    _write_change_dir(tmp_path, "2026-10-13-no-creator")

    stats, _ = await ChangeService(db_session).reparse(ws.id)

    assert stats["created"] == 1
    row = await _get_change(db_session, ws.id, "2026-10-13-no-creator")
    assert row is not None
    assert row.owner_id is None
