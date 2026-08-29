"""删除闭环测试（task-03 / design §5.2 + §5.4 加固项 B-1 / §13）。

Change 2026-08-29-change-delete-closure-and-spec-pull task-03 覆盖：

1. **B-1 三点豁免（R-09）**——``location='deleted'`` 墓碑行（平台删除审计锚点）：
   ① scoped 删除环不物理删；② 全量删除环不物理删；③ ``_apply_parsed`` 遇
   deleted 行不回翻 location（parser 产出同名 parsed 时仅 location 字段受保护，
   其余字段照常更新）。
2. **progress 联动删（FR-03a）**——删除环删 Change 行处连带删
   ``platform_change_progress`` 收件箱行；豁免/受保护跳过的行不触发联动删。
3. **7 天占位保护回归**——``_progress_reported_active_keys`` + 无文档条件在
   scoped 与全量两模式同样生效（task-03 起两模式共用，语义原样）。

author: qinyi
created_at: 2026-08-29
"""

from __future__ import annotations

import shutil
import uuid
from datetime import UTC, datetime, timedelta
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
        name="delete-closure ws",
        slug=f"dc-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/delete-closure-test-{uuid.uuid4().hex[:12]}",
        status="active",
        component_key="comp",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_spec_ws(db_session, ws: Workspace, spec_root: Path) -> None:
    db_session.add(
        SpecWorkspace(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            spec_root=str(spec_root),
            strategy="platform-managed",
            sync_status="clean",
        )
    )
    await db_session.commit()


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


async def _seed_progress_row(
    db_session, ws_id: uuid.UUID, change_name: str, *, updated_at: datetime | None = None
) -> None:
    """插收件箱行（latest_progress 报 active；表由 conftest autouse fixture 建）。"""
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
            **({"updated_at": updated_at} if updated_at is not None else {}),
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


async def _insert_deleted_change_row(db_session, ws_id: uuid.UUID, key: str) -> Change:
    """预插 location='deleted' 墓碑行（平台删除动作/task-04 CLI 墓碑的落点形态）。"""
    row = Change(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        change_key=key,
        title=key,
        status="active",
        location="deleted",
        path=f"changes/{key}",
        current_stage="brainstorm",
        updated_at=datetime.now(UTC),
    )
    db_session.add(row)
    await db_session.commit()
    return row


async def _insert_placeholder_change(db_session, ws_id: uuid.UUID, key: str) -> Change:
    """模拟 platform_sync 首推占位建行（无任何 change_documents、镜像无目录）。"""
    row = Change(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        change_key=key,
        title=key,
        status="draft",
        location="active",
        path=f"changes/{key}",
        current_stage="brainstorm",
        updated_at=datetime.now(UTC),
    )
    db_session.add(row)
    await db_session.commit()
    return row


# ===========================================================================
# B-1 三点豁免：location='deleted' 墓碑行保活（R-09）
# ===========================================================================


async def test_scoped_delete_loop_skips_deleted_location_rows(db_session, tmp_path):
    """豁免①：scoped 删除环跳过 deleted 行——scope 内磁盘消失也不物理删，
    且不触发 progress 联动删（豁免行不联动）。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    spec_root.mkdir()
    await _make_spec_ws(db_session, ws, spec_root)
    await _insert_deleted_change_row(db_session, ws.id, "2026-08-29-tomb")
    await _seed_progress_row(db_session, ws.id, "2026-08-29-tomb")

    stats, _ = await ChangeService(db_session).reparse(ws.id, scope=["2026-08-29-tomb"])

    assert stats["deleted"] == 0
    row = await _fetch(db_session, ws.id, "2026-08-29-tomb")
    assert row is not None, "B-1：墓碑行不被 scoped 删除环物理删（R-09）"
    assert row.location == "deleted"
    # 豁免行不触发联动删
    assert await _fetch_progress(db_session, ws.id, "2026-08-29-tomb") is not None


async def test_full_delete_loop_skips_deleted_location_rows(db_session, tmp_path):
    """豁免②：全量删除环同样跳过 deleted 行（磁盘确认消失也不物理删）。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    spec_root.mkdir()
    await _make_spec_ws(db_session, ws, spec_root)
    await _insert_deleted_change_row(db_session, ws.id, "2026-08-29-tomb")

    stats, _ = await ChangeService(db_session).reparse(ws.id)  # 全量

    assert stats["deleted"] == 0
    row = await _fetch(db_session, ws.id, "2026-08-29-tomb")
    assert row is not None, "B-1：墓碑行不被全量删除环物理删（R-09）"
    assert row.location == "deleted"


async def test_apply_parsed_keeps_deleted_location_on_same_key_parsed(db_session, tmp_path):
    """豁免③：_apply_parsed 不回翻 location——parser 产出同名 parsed（目录仍在
    磁盘）时 location 保持 deleted；其余字段（title）更新语义不变。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-29-tomb", "Tomb V1")

    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id)
    assert stats["created"] == 1

    # 平台删除动作置墓碑（task-06 落点形态；此处直接翻 location 模拟）
    row = await _fetch(db_session, ws.id, "2026-08-29-tomb")
    assert row is not None
    row.location = "deleted"
    await db_session.commit()

    # 目录仍在磁盘 + 内容更新 → parser 产出同名 parsed → 走 _apply_parsed 更新路径
    (spec_root / "changes" / "2026-08-29-tomb" / "proposal.md").write_text(
        "# Tomb V2\n", encoding="utf-8"
    )
    stats, _ = await service.reparse(ws.id, scope=["2026-08-29-tomb"])
    assert stats["updated"] == 1

    row = await _fetch(db_session, ws.id, "2026-08-29-tomb")
    assert row is not None
    assert row.location == "deleted", "B-1：parser 同名 parsed 不回翻墓碑 location"
    assert row.title == "Tomb V2", "仅保护 location 字段，其余字段更新语义不变"


async def test_tombstone_row_not_rename_matched_to_same_day_new_change(db_session, tmp_path):
    """墓碑行不进 rename 候选（2026-08-30 审计②）。

    墓碑行（location='deleted'）目录已被平台删除搬走、删除环不物理删——是永生的
    "not-in-parsed 且磁盘不在"行。同日新建合法变更触发全量 reparse 时，若墓碑行
    进 orphaned 候选会被日期前缀唯一匹配为 "rename"：``_apply_parsed`` 把墓碑行
    change_key 改写为新 key 且 location 保持 deleted → 新变更出生即在变更中心
    隐藏 + 上行 progress 永久 409（change_deleted），全仓无逆转 API。
    """
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    # 墓碑：目录不在磁盘（平台删除已搬走），location='deleted'
    await _insert_deleted_change_row(db_session, ws.id, "2026-08-29-alpha")
    # 同日新建合法变更（磁盘目录真实存在）
    _seed_change(spec_root, "2026-08-29-beta", "Beta")

    stats, _ = await ChangeService(db_session).reparse(ws.id)  # 全量

    # 墓碑行原样保留——key 不被 rename 错配改写为 beta
    tomb = await _fetch(db_session, ws.id, "2026-08-29-alpha")
    assert tomb is not None, "墓碑行保活（B-1）"
    assert tomb.location == "deleted"
    # beta 正常新建为 active 行——修复前墓碑被错配给 beta（created=0、beta 行
    # location='deleted' 永久隐身）
    assert stats["created"] == 1
    assert stats["renamed"] == 0
    beta = await _fetch(db_session, ws.id, "2026-08-29-beta")
    assert beta is not None, "新变更正常建行，不吃墓碑"
    assert beta.location == "active"
    assert beta.id != tomb.id, "beta 是全新行，非墓碑行换 key 而来"


# ===========================================================================
# progress 联动删（FR-03a）
# ===========================================================================


async def test_delete_loop_cascades_progress_row_and_skips_protected(db_session, tmp_path):
    """删除环删 Change 行 → 收件箱行连带删；占位保护跳过的行不联动删。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-29-dock", "Dock")
    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id)
    assert stats["created"] == 1  # Dock 行有文档（磁盘权威，不吃占位保护）

    # 占位行：无文档 + progress 仍报 active（窗内）→ 受保护
    await _insert_placeholder_change(db_session, ws.id, "2026-08-29-ghost")
    await _seed_progress_row(db_session, ws.id, "2026-08-29-dock")
    await _seed_progress_row(db_session, ws.id, "2026-08-29-ghost")

    # Dock 磁盘消失（ghost 本就无目录）
    shutil.rmtree(spec_root / "changes" / "2026-08-29-dock")

    stats, _ = await service.reparse(ws.id, scope=["2026-08-29-dock", "2026-08-29-ghost"])
    assert stats["deleted"] == 1
    # 被删行 → progress 连带删
    assert await _fetch(db_session, ws.id, "2026-08-29-dock") is None
    assert await _fetch_progress(db_session, ws.id, "2026-08-29-dock") is None
    # 受保护跳过行 → 行保留、progress 不联动删
    assert await _fetch(db_session, ws.id, "2026-08-29-ghost") is not None
    assert await _fetch_progress(db_session, ws.id, "2026-08-29-ghost") is not None


# ===========================================================================
# 7 天占位保护回归：scoped 与全量两模式共用（语义原样）
# ===========================================================================


async def test_placeholder_protected_within_window_scoped(db_session, tmp_path):
    """scoped 模式窗内（6 天）占位行仍受保护：scope 内磁盘消失也不删。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    spec_root.mkdir()
    await _make_spec_ws(db_session, ws, spec_root)
    await _insert_placeholder_change(db_session, ws.id, "2026-08-29-window")
    await _seed_progress_row(
        db_session,
        ws.id,
        "2026-08-29-window",
        updated_at=datetime.now(UTC) - timedelta(days=6),
    )

    stats, _ = await ChangeService(db_session).reparse(ws.id, scope=["2026-08-29-window"])

    assert stats["deleted"] == 0
    assert await _fetch(db_session, ws.id, "2026-08-29-window") is not None


async def test_placeholder_unprotected_after_window_scoped(db_session, tmp_path):
    """scoped 模式窗外（8 天）占位行不再受保护：scope 内消失即删 + progress 联动删。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    spec_root.mkdir()
    await _make_spec_ws(db_session, ws, spec_root)
    await _insert_placeholder_change(db_session, ws.id, "2026-08-29-stale")
    await _seed_progress_row(
        db_session,
        ws.id,
        "2026-08-29-stale",
        updated_at=datetime.now(UTC) - timedelta(days=8),
    )

    stats, _ = await ChangeService(db_session).reparse(ws.id, scope=["2026-08-29-stale"])

    assert stats["deleted"] == 1
    assert await _fetch(db_session, ws.id, "2026-08-29-stale") is None
    assert await _fetch_progress(db_session, ws.id, "2026-08-29-stale") is None


async def test_placeholder_protected_within_window_full(db_session, tmp_path):
    """全量模式窗内占位行保护回归（task-03 起两模式共用，语义原样）。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    spec_root.mkdir()
    await _make_spec_ws(db_session, ws, spec_root)
    await _insert_placeholder_change(db_session, ws.id, "2026-08-29-window-full")
    await _seed_progress_row(
        db_session,
        ws.id,
        "2026-08-29-window-full",
        updated_at=datetime.now(UTC) - timedelta(days=6),
    )

    stats, _ = await ChangeService(db_session).reparse(ws.id)

    assert stats["deleted"] == 0
    assert await _fetch(db_session, ws.id, "2026-08-29-window-full") is not None


# ===========================================================================
# 审计 A5（2026-08-29 合入后修复轮）：progress 联动删独立短事务化
# ===========================================================================


async def test_reparse_main_commit_survives_progress_cleanup_failure(
    db_session, db_engine, tmp_path, monkeypatch
):
    """审计 A5：progress 表缺失（联动删 SELECT 抛错）只告警，不放大成主 reparse
    事务中止（PG 下 SELECT 异常使事务 aborted → 外层 commit 抛
    InFailedSqlTransaction → 整次 reparse 回滚）。

    双断言：
    - 行为：Change 行删除照常 commit（主流程不因联动删失败回滚）；
    - 结构：联动删在 ``get_session_factory()`` 新开的独立短事务 session 上执行
      （对齐 spec_workspace._trigger_change_reparse 范式，彻底隔离主事务）。
    """
    import app.core.db as db_module

    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    spec_root.mkdir()
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-29-gone", "Gone")
    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id)
    assert stats["created"] == 1
    await _seed_progress_row(db_session, ws.id, "2026-08-29-gone")
    shutil.rmtree(spec_root / "changes" / "2026-08-29-gone")

    # 探针：记录 reparse 期间经 get_session_factory 开出的独立 session
    created: list[object] = []
    original_factory = db_module.get_session_factory

    class _TrackingFactory:
        def __init__(self, inner) -> None:
            self._inner = inner

        def __call__(self):
            session = self._inner()
            created.append(session)
            return session

        def __getattr__(self, name):
            return getattr(self._inner, name)

    monkeypatch.setattr(
        db_module, "get_session_factory", lambda: _TrackingFactory(original_factory())
    )

    # 模拟 progress 收件箱表不可用（迁移窗口 / 表缺失）
    from sqlalchemy import text

    async with db_engine.begin() as conn:
        await conn.execute(text("DROP TABLE platform_change_progress"))

    stats, _ = await service.reparse(ws.id)
    assert stats["deleted"] == 1
    # 主事务照常 commit：Change 行删除已落库，未被联动删失败牵连回滚
    assert await _fetch(db_session, ws.id, "2026-08-29-gone") is None
    # 联动删在独立短事务上执行（非主 reparse session）
    assert created, "progress 联动删必须在 get_session_factory 独立 session 执行"


# Suppress unused-import warning for pytest fixture discovery.
pytestmark = pytest.mark.asyncio


# ===========================================================================
# 平台删除半删窗口兜底（2026-08-30 审计③）
# ===========================================================================


async def test_half_deleted_platform_tombstone_demoted_not_physical_deleted(db_session, tmp_path):
    """平台删除半删窗口兜底：删除环遇 manifest 墓碑锚点的 'active' 行降级置软删。

    delete_change 步骤①（镜像软删）内部先 commit——manifest 行 platform_deleted=True
    + 文件搬走已落定；Change 行 location='deleted' 要到步骤⑤才随主事务落库。两
    commit 之间中断 → 行仍 'active' 且目录已不在。修复前下次 reparse 删除环把它
    物理删 → change_events/change_documents/change_session_links 随 ondelete=
    CASCADE 全部抹掉（R-09 要保护的审计数据丢失）。修复后降级置软删：行保活、
    审计子表保留、不触发 progress 联动删。
    """
    from app.modules.change.model import ChangeEventORM
    from app.modules.spec_workspace.model import SpecFileManifest

    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-29-half", "Half")
    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id)
    assert stats["created"] == 1
    row = await _fetch(db_session, ws.id, "2026-08-29-half")
    assert row is not None and row.location == "active"

    # 审计事件（子表，物理删时随 CASCADE 抹掉——本用例的保活断言对象）
    db_session.add(
        ChangeEventORM(
            workspace_id=ws.id,
            change_id=row.id,
            event_type="stage_change",
            detail={"from": "brainstorm"},
        )
    )
    await db_session.commit()

    # 模拟步骤① 完成 + 步骤⑤ 前中断：目录已搬走、manifest 墓碑已 commit、行仍 active
    shutil.rmtree(spec_root / "changes" / "2026-08-29-half")
    db_session.add(
        SpecFileManifest(
            workspace_id=ws.id,
            path="changes/2026-08-29-half/proposal.md",
            content_hash="0" * 64,
            exists=False,
            platform_deleted=True,
        )
    )
    await db_session.commit()

    stats, _ = await service.reparse(ws.id)  # 全量

    assert stats["deleted"] == 0, "半删行不物理删（审计锚点行保活）"
    assert stats["tombstoned"] == 1, "降级置软删"
    row2 = await _fetch(db_session, ws.id, "2026-08-29-half")
    assert row2 is not None and row2.id == row.id
    assert row2.location == "deleted", "收敛为墓碑态（与 B-1 豁免行同态）"
    events = (
        (await db_session.execute(select(ChangeEventORM).where(ChangeEventORM.change_id == row.id)))
        .scalars()
        .all()
    )
    assert len(events) == 1, "change_events 不随删除环丢失（修复前 CASCADE 抹掉）"


async def test_member_local_delete_without_anchor_still_physical_deleted(db_session, tmp_path):
    """反例：成员本地删除（manifest 无 platform_deleted 锚点）仍走物理删——
    降级只认平台墓碑锚点，不吞正常删除语义。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-29-local", "Local")
    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id)
    assert stats["created"] == 1

    # 成员本地删除目录（无平台墓碑锚点）
    shutil.rmtree(spec_root / "changes" / "2026-08-29-local")

    stats, _ = await service.reparse(ws.id)
    assert stats["deleted"] == 1, "无锚点 → 照常物理删"
    assert stats["tombstoned"] == 0
    assert await _fetch(db_session, ws.id, "2026-08-29-local") is None
