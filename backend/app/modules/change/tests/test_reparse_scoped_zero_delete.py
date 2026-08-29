"""scoped reparse 定向删除测试（task-03 / design §5.2 R-08 收窄修订）。

Change 2026-08-29-change-delete-closure-and-spec-pull task-03：``ChangeService.reparse``
的 scoped 模式从「零删除红线（R-08 原版）」修订为**定向删除**——scope 非空也进
删除环，但仅删「key ∈ scope 集 且磁盘确认消失（key ∉ seen_keys）」的行，使本地
裸删后经 apply_ops → scoped reparse 自动收敛（FR-01）：

- **scope 外行零动作**：范围外变更不进 parsed 集合也不判删除（R-08 原始动机保留
  ——防部分视图误删范围外变更）；
- **scope 内磁盘消失即删**：行删除 + ``platform_change_progress`` 收件箱行连带删
  （FR-03a）；
- rename 检测两模式都跑：scoped 下 orphaned 候选仅取 scope 集内行，scope 集内
  old→new 目录改名被识别并保留 workflow 状态，scope 外变更不被误判 orphaned
  （R-11）；
- 全量 reparse（scope=None）删除语义不变（现状回归）。

历史（2026-08-14-change-center-conversation-driven task-02 的 scoped 零删除红线）
已被本变更 R-08 收窄修订取代，原「scope 内消失也不删」用例反转为定向删除。

author: qinyi
created_at: 2026-08-14（2026-08-29 task-03 改写）
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select

from app.modules.change.model import Change
from app.modules.change.service import ChangeService
from app.modules.platform_sync.model import PlatformChangeProgressORM
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


async def _seed_progress_row(db_session, ws_id: uuid.UUID, change_name: str) -> None:
    """插 platform_change_progress 收件箱行（表由 conftest autouse fixture 建）。"""
    db_session.add(
        PlatformChangeProgressORM(
            workspace_id=ws_id,
            change_name=change_name,
            latest_progress={
                "project": {"name": "demo"},
                "changes": [{"name": change_name, "status": "active"}],
            },
            last_pushed_at="2026-08-29T00:00:00.000Z",
            last_pusher="tester",
        )
    )
    await db_session.commit()


async def _fetch_progress(db_session, ws_id: uuid.UUID, change_name: str):
    return (
        (
            await db_session.execute(
                select(PlatformChangeProgressORM).where(
                    PlatformChangeProgressORM.workspace_id == ws_id,
                    PlatformChangeProgressORM.change_name == change_name,
                )
            )
        )
        .scalars()
        .one_or_none()
    )


# ===========================================================================
# 定向删除核心：scope 内消失删 / scope 外不删（双断言）
# ===========================================================================


async def test_scoped_reparse_deletes_scope_in_keeps_out_of_scope(db_session, tmp_path):
    """双断言（design §13）：scope 内磁盘消失 → 删；scope 外磁盘消失 → 零动作。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-keep", "Keep")
    _seed_change(spec_root, "2026-08-14-gone-in", "GoneIn")
    _seed_change(spec_root, "2026-08-14-gone-out", "GoneOut")

    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id)  # 全量建三行
    assert stats["created"] == 3

    # scope 内 gone-in 与 scope 外 gone-out 磁盘同批消失；keep 更新
    shutil.rmtree(spec_root / "changes" / "2026-08-14-gone-in")
    shutil.rmtree(spec_root / "changes" / "2026-08-14-gone-out")
    (spec_root / "changes" / "2026-08-14-keep" / "proposal.md").write_text(
        "# Keep v2\n", encoding="utf-8"
    )

    stats, _ = await service.reparse(ws.id, scope=["2026-08-14-keep", "2026-08-14-gone-in"])
    # scope 内确认消失 → 删；scope 外零动作（双断言核心）
    assert stats["deleted"] == 1
    assert stats["updated"] == 1
    assert await _fetch(db_session, ws.id, "2026-08-14-gone-in") is None
    assert await _fetch(db_session, ws.id, "2026-08-14-gone-out") is not None
    keep = await _fetch(db_session, ws.id, "2026-08-14-keep")
    assert keep is not None and keep.title == "Keep v2"


async def test_scoped_reparse_deletes_disappeared_change_with_progress_row(db_session, tmp_path):
    """scope 内消失即删 + platform_change_progress 行连带删（FR-01 + FR-03a）。

    原「scope 内消失也不删」红测（2026-08-14 task-02）反转：本地裸删 →
    apply_ops 触发 scoped reparse → 变更中心自动收敛，收件箱行不残留。
    scope 外变更（gone-out）的收件箱行不受牵连（联动删只作用于被删行）。
    """
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-gone", "Gone")
    _seed_change(spec_root, "2026-08-14-out", "Out")

    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id)
    assert stats["created"] == 2
    await _seed_progress_row(db_session, ws.id, "2026-08-14-gone")
    await _seed_progress_row(db_session, ws.id, "2026-08-14-out")

    # scope 内 key 磁盘消失（含空目录已被 task-02 空目录清理移除的形态）
    shutil.rmtree(spec_root / "changes" / "2026-08-14-gone")
    shutil.rmtree(spec_root / "changes" / "2026-08-14-out")

    stats, _ = await service.reparse(ws.id, scope=["2026-08-14-gone"])
    assert stats["deleted"] == 1
    assert stats["parsed"] == 0
    # Change 行 + progress 收件箱行连带删（FR-03a）
    assert await _fetch(db_session, ws.id, "2026-08-14-gone") is None
    assert await _fetch_progress(db_session, ws.id, "2026-08-14-gone") is None
    # scope 外：Change 行与 progress 行都零动作
    assert await _fetch(db_session, ws.id, "2026-08-14-out") is not None
    assert await _fetch_progress(db_session, ws.id, "2026-08-14-out") is not None


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


# ===========================================================================
# scoped rename（R-11）：scope 集内改名识别 + scope 外不误判
# ===========================================================================


async def test_scoped_reparse_detects_rename_within_scope(db_session, tmp_path):
    """scope 集内 old→new 目录改名被识别：renamed 计数 + workflow 状态保留（R-11）。

    生产触发形态：rename op 的 op.path 与 op.new_path 都进 scope（
    spec_workspace._compute_reparse_scope 扫描两路径取 name）。gone-out 与新目录
    同日期前缀——若它被误判为 orphaned 候选，同前缀候选变 2 个、匹配不唯一 →
    renamed 必为 0；断言 renamed==1 即证明 scope 外行未进候选集。
    """
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    # old 带 proposal+tasks（推断 plan）；out 与 new 同日期前缀（误判探针）
    old_dir = spec_root / "changes" / "2026-08-14-old"
    old_dir.mkdir(parents=True)
    (old_dir / "proposal.md").write_text("# Old\n", encoding="utf-8")
    (old_dir / "tasks.md").write_text("# Tasks\n", encoding="utf-8")
    _seed_change(spec_root, "2026-08-14-out", "Out")

    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id)
    assert stats["created"] == 2

    old_row = await _fetch(db_session, ws.id, "2026-08-14-old")
    assert old_row is not None
    old_row_id = old_row.id
    # 手工注入 workflow 状态（_apply_parsed 不触碰 status/stages，rename 后应保留）
    old_row.status = "in_progress"
    old_row.stages = {"plan": {"status": "done"}}
    await db_session.commit()

    # 目录改名：old 消失、new 出现（同日期前缀 + 同文档集 → 推断 stage 一致）；
    # out 目录同时消失（scope 外消失，不得被误判 orphaned）
    new_dir = spec_root / "changes" / "2026-08-14-new"
    shutil.move(str(old_dir), str(new_dir))
    shutil.rmtree(spec_root / "changes" / "2026-08-14-out")

    stats, _ = await service.reparse(ws.id, scope=["2026-08-14-old", "2026-08-14-new"])
    assert stats["renamed"] == 1
    assert stats["created"] == 0
    assert stats["deleted"] == 0  # scope 外 out 行零动作

    # 旧 key 行迁移为 new key 且是同一行（workflow 状态保留，非删旧建新）
    assert await _fetch(db_session, ws.id, "2026-08-14-old") is None
    new_row = await _fetch(db_session, ws.id, "2026-08-14-new")
    assert new_row is not None
    assert new_row.id == old_row_id
    assert new_row.status == "in_progress"
    assert new_row.stages == {"plan": {"status": "done"}}
    assert new_row.current_stage == "plan"
    # scope 外 out 行保留（未被误判 orphaned、未被删除）
    assert await _fetch(db_session, ws.id, "2026-08-14-out") is not None


# ===========================================================================
# 审计 A2（2026-08-29 合入后修复轮）：删除候选守卫——零候选不查 progress 表
# ===========================================================================


async def test_scoped_reparse_zero_delete_candidates_skips_progress_query(
    db_session, tmp_path, monkeypatch
):
    """审计 A2：scope 内全部 seen（零删除候选）→ ``_progress_reported_active_keys``
    零调用——scoped reparse 不再无条件拉全 workspace progress 整实体（含
    latest_progress 六表 JSON 肥列，占位保护只服务于删除候选）。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-zero-cand", "Zero")

    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id)
    assert stats["created"] == 1

    calls: list[object] = []
    original = ChangeService._progress_reported_active_keys

    async def _spy(self, ws_id, keys=None):
        calls.append(keys)
        return await original(self, ws_id, keys=keys)

    monkeypatch.setattr(ChangeService, "_progress_reported_active_keys", _spy)

    # scope 内变更仍在磁盘 → 全部 seen → 零删除候选 → progress 表零查询
    stats, _ = await service.reparse(ws.id, scope=["2026-08-14-zero-cand"])
    assert stats["updated"] == 1
    assert stats["deleted"] == 0
    assert calls == [], "零删除候选时不得查询 platform_change_progress"

    # 对照锚：scope 内磁盘消失（候选非空）→ 查询按需发生且带 IN 过滤键
    shutil.rmtree(spec_root / "changes" / "2026-08-14-zero-cand")
    stats, _ = await service.reparse(ws.id, scope=["2026-08-14-zero-cand"])
    assert stats["deleted"] == 1
    assert calls == [["2026-08-14-zero-cand"]], "候选非空时按候选键 IN 过滤查询"


# Suppress unused-import warning for pytest fixture discovery.
pytestmark = pytest.mark.asyncio
