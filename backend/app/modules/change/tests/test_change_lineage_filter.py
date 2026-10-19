"""Tests for ChangeService.list_ lineage 出身分类筛选。

Change 2026-10-14-change-center-lineage-tag-and-filter：
- ``lineage="thin"`` / ``lineage="full"`` 的行集合必须与 ``enrich_summaries`` 逐行
  ``ChangeSummary.is_thin`` 投影严格一致（同源 ``_is_thin_lineage`` 三分支 + 时间窗）；
- 归档 steps 兜底行（FR-03）：归档后阶段翻 archived、仅靠「steps 全无标准四阶段」
  识别的轻量出身行必须落 thin 集合；
- ``total`` = 过滤后全局 N（分页正确）；thin 空集合短路；未知值不过滤。

建行/建 progress 复用 test_enrich_projection.py 同款 helper（就地内联，模块私有
不跨测试文件 import 的既有惯例）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change.model import Change
from app.modules.change.service import ChangeService
from app.modules.platform_sync.model import PlatformChangeProgressORM
from app.modules.workspace.model import Workspace


async def _make_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _make_change(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    change_key: str,
    *,
    stage: str = "plan",
    change_type: str | None = None,
    location: str = "active",
    status: str = "active",
    created_at: datetime | None = None,
) -> Change:
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=change_key,
        title=change_key,
        status=status,
        location=location,
        path=f"changes/{change_key}",
        current_stage=stage,
        owner_id=None,
        change_type=change_type,
        created_at=created_at or datetime.now(UTC),
    )
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return change


async def _make_progress_row(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    change_name: str,
    latest_progress: dict,
) -> None:
    session.add(
        PlatformChangeProgressORM(
            workspace_id=workspace_id,
            change_name=change_name,
            latest_progress=latest_progress,
            last_pushed_at="2026-10-14T00:00:00Z",
            last_pusher="agent",
        )
    )
    await session.commit()


def _progress(stage: str, status: str = "in_progress", steps: list | None = None) -> dict:
    return {
        "project": {"name": "demo"},
        "changes": [{"name": "x", "current_stage": stage, "status": status}],
        "stages": [],
        "steps": steps if steps is not None else [],
        "batch_progress": [],
        "approvals": [],
    }


@pytest.mark.asyncio
async def test_lineage_thin_full_partition_matches_is_thin_projection(
    db_session: AsyncSession,
) -> None:
    """thin/full 两分类与逐行 is_thin 投影严格互斥且并集为全量（FR-05）。"""
    ws = await _make_workspace(db_session)
    service = ChangeService(db_session)
    # 三分支各自一行 + 完整流程一行：
    # ① stage=thin（active 期）；② change_type=quick（平台分流）；
    # ③ 归档 steps 兜底（progress 终态覆盖 + 顶层 steps 无标准四阶段）；完整流程 plan。
    await _make_change(db_session, ws.id, "c-thin-stage", stage="thin")
    await _make_progress_row(db_session, ws.id, "c-thin-stage", _progress("thin"))
    await _make_change(db_session, ws.id, "c-quick", stage="thin", change_type="quick")
    await _make_change(
        db_session,
        ws.id,
        "c-archived-thin",
        stage="archived",
        location="archive",
        status="archived",
    )
    await _make_progress_row(
        db_session,
        ws.id,
        "c-archived-thin",
        _progress("archived", "archived", steps=[{"stage": "flow-impl"}]),
    )
    await _make_change(db_session, ws.id, "c-full", stage="plan")
    await _make_progress_row(db_session, ws.id, "c-full", _progress("plan"))

    rows, _total = await service.list_(ws.id)
    enriched = await service.enrich_summaries(rows)
    projected_thin = {s.change_key for s in enriched if s.is_thin}
    assert projected_thin == {"c-thin-stage", "c-quick", "c-archived-thin"}

    thin_items, thin_total = await service.list_(ws.id, lineage="thin")
    full_items, full_total = await service.list_(ws.id, lineage="full")
    thin_keys = {c.change_key for c in thin_items}
    full_keys = {c.change_key for c in full_items}
    assert thin_keys == projected_thin
    assert thin_keys | full_keys == {c.change_key for c in rows}
    assert not thin_keys & full_keys
    # total = 过滤后全局 N（非本页数）
    assert (thin_total, full_total) == (3, 1)


@pytest.mark.asyncio
async def test_lineage_thin_hits_archived_steps_fallback_in_archive_tab(
    db_session: AsyncSession,
) -> None:
    """已归档 tab（location=archive）下归档 steps 兜底行落 thin 分类（FR-03）。

    对照组：旧口径 current_stage=thin 精确匹配在该行筛不出（投影阶段已翻
    archived）——新 lineage 口径修复此缺口。
    """
    ws = await _make_workspace(db_session)
    service = ChangeService(db_session)
    await _make_change(
        db_session,
        ws.id,
        "c-arch-thin",
        stage="archived",
        location="archive",
        status="archived",
    )
    await _make_progress_row(
        db_session,
        ws.id,
        "c-arch-thin",
        _progress("archived", "archived", steps=[{"stage": "flow-verify-lite"}]),
    )
    await _make_change(
        db_session,
        ws.id,
        "c-arch-full",
        stage="archived",
        location="archive",
        status="archived",
    )
    await _make_progress_row(
        db_session,
        ws.id,
        "c-arch-full",
        _progress("archived", "archived", steps=[{"stage": "execute"}]),
    )

    thin_items, thin_total = await service.list_(ws.id, location="archive", lineage="thin")
    full_items, full_total = await service.list_(ws.id, location="archive", lineage="full")
    assert {c.change_key for c in thin_items} == {"c-arch-thin"}
    assert thin_total == 1
    assert {c.change_key for c in full_items} == {"c-arch-full"}
    assert full_total == 1
    # 旧 current_stage=thin 口径在归档 tab 筛不出任何行（缺口实证，防回退）
    legacy_items, legacy_total = await service.list_(
        ws.id, location="archive", current_stage="thin"
    )
    assert legacy_items == [] and legacy_total == 0


@pytest.mark.asyncio
async def test_lineage_window_before_cutoff_is_full(db_session: AsyncSession) -> None:
    """时间窗外（created_at < 2026-09-25）一律非轻量出身 → 落 full 集合。"""
    ws = await _make_workspace(db_session)
    service = ChangeService(db_session)
    await _make_change(
        db_session,
        ws.id,
        "c-old-thin",
        stage="thin",
        created_at=datetime(2026, 9, 1, tzinfo=UTC),
    )

    thin_items, _ = await service.list_(ws.id, lineage="thin")
    full_items, full_total = await service.list_(ws.id, lineage="full")
    assert thin_items == []
    assert {c.change_key for c in full_items} == {"c-old-thin"}
    assert full_total == 1


@pytest.mark.asyncio
async def test_lineage_thin_empty_short_circuits(db_session: AsyncSession) -> None:
    """workspace 无轻量出身行 → lineage=thin 直接空页（([], 0)），不走主查询。"""
    ws = await _make_workspace(db_session)
    service = ChangeService(db_session)
    await _make_change(db_session, ws.id, "c-full", stage="plan")

    items, total = await service.list_(ws.id, lineage="thin")
    assert items == [] and total == 0


@pytest.mark.asyncio
async def test_lineage_unknown_value_ignored_and_full_with_empty_set(
    db_session: AsyncSession,
) -> None:
    """未知 lineage 值不过滤（sort 白名单 fallback 风格）；全 full 工作区下
    lineage=full 返回全量（NOT IN 空集路径，FR-02 边界）。"""
    ws = await _make_workspace(db_session)
    service = ChangeService(db_session)
    await _make_change(db_session, ws.id, "c-a", stage="plan")
    await _make_change(db_session, ws.id, "c-b", stage="execute")

    all_items, all_total = await service.list_(ws.id)
    items, total = await service.list_(ws.id, lineage="bogus")
    assert {c.change_key for c in items} == {c.change_key for c in all_items}
    assert total == all_total == 2

    full_items, full_total = await service.list_(ws.id, lineage="full")
    assert {c.change_key for c in full_items} == {"c-a", "c-b"}
    assert full_total == 2


@pytest.mark.asyncio
async def test_lineage_deleted_rows_never_thin_matches_is_thin_projection(
    db_session: AsyncSession,
) -> None:
    """deleted 行不进 thin 集合——与 is_thin 投影口径一致（评审 P1 修复回归）。

    enrich_summaries 对 deleted 行在 is_thin 赋值前 continue（投影恒 schema
    缺省 False → 渲染「完整」标签）；归档 tab 三源并集③行（location='deleted'
    + stage archived，评审指出的 change_type='quick' 分裂形态）必须落 full
    分类而非 thin，否则出现「lineage=thin 返回但渲染完整标签」的自相矛盾。
    """
    ws = await _make_workspace(db_session)
    service = ChangeService(db_session)
    # 归档 tab 三源并集③形态：location='deleted' + current_stage='archived'，
    # 且 change_type='quick'（row 现值判分支②会误命中 thin 的分裂形态）
    await _make_change(
        db_session,
        ws.id,
        "c-tombstone-quick",
        stage="archived",
        change_type="quick",
        location="deleted",
        status="archived",
    )

    thin_items, thin_total = await service.list_(ws.id, location="archive", lineage="thin")
    full_items, full_total = await service.list_(ws.id, location="archive", lineage="full")
    assert thin_items == [] and thin_total == 0
    assert {c.change_key for c in full_items} == {"c-tombstone-quick"}
    assert full_total == 1
    # 行本身仍在归档 tab 可见（三源并集③不过滤 location 维度），且 is_thin
    # 投影为 False——full 分类与「完整」标签一致
    rows, _ = await service.list_(ws.id, location="archive")
    enriched = await service.enrich_summaries(rows)
    assert [(s.change_key, s.is_thin) for s in enriched] == [("c-tombstone-quick", False)]


# ── 2026-10-18-change-list-type-filter：类型筛选（change_type 参数）──────────


@pytest.mark.asyncio
async def test_change_type_filter_feat_aliases_legacy_feature(db_session: AsyncSession) -> None:
    """feat 筛选等价命中旧值 feature（显示层 feature→feat 映射的逆口径，存量行不漏筛）。"""
    ws = await _make_workspace(db_session)
    service = ChangeService(db_session)
    await _make_change(db_session, ws.id, "c-feat-new", change_type="feat")
    await _make_change(db_session, ws.id, "c-feat-legacy", change_type="feature")
    await _make_change(db_session, ws.id, "c-fix", change_type="fix")

    items, total = await service.list_(ws.id, change_type="feat")
    assert {c.change_key for c in items} == {"c-feat-new", "c-feat-legacy"}
    assert total == 2


@pytest.mark.asyncio
async def test_change_type_filter_exact_match_and_fallback(db_session: AsyncSession) -> None:
    """非别名类型精确匹配；白名单外/缺省值不过滤（对齐 lineage/sort fallback 风格）。"""
    ws = await _make_workspace(db_session)
    service = ChangeService(db_session)
    await _make_change(db_session, ws.id, "c-fix", change_type="fix")
    await _make_change(db_session, ws.id, "c-prototype", change_type="prototype")
    await _make_change(db_session, ws.id, "c-none", change_type=None)

    # fix 精确匹配（feature/feat 行不混入）
    items, total = await service.list_(ws.id, change_type="fix")
    assert {c.change_key for c in items} == {"c-fix"}
    assert total == 1
    # prototype 旧值可筛
    items_proto, _ = await service.list_(ws.id, change_type="prototype")
    assert {c.change_key for c in items_proto} == {"c-prototype"}
    # 白名单外值不过滤（全部返回）
    _, total_garbage = await service.list_(ws.id, change_type="garbage")
    assert total_garbage == 3
    # 缺省不过滤
    _, total_none = await service.list_(ws.id)
    assert total_none == 3


@pytest.mark.asyncio
async def test_sort_created_at_desc_newest_first(db_session: AsyncSession) -> None:
    """created_at_desc 白名单键：越新的越靠前（2026-10-19-change-list-created-sort）。

    API 缺省 fallback 仍 updated_at_desc（契约零变化）；前端列表页默认显式传新键。
    """
    from datetime import timedelta

    ws = await _make_workspace(db_session)
    service = ChangeService(db_session)
    base = datetime.now(UTC)
    await _make_change(db_session, ws.id, "c-old", created_at=base - timedelta(days=2))
    await _make_change(db_session, ws.id, "c-mid", created_at=base - timedelta(days=1))
    await _make_change(db_session, ws.id, "c-new", created_at=base)

    items, total = await service.list_(ws.id, sort="created_at_desc")
    assert [c.change_key for c in items] == ["c-new", "c-mid", "c-old"]
    assert total == 3

    items_asc, _ = await service.list_(ws.id, sort="created_at_asc")
    assert [c.change_key for c in items_asc] == ["c-old", "c-mid", "c-new"]

    # 未知值 fallback 默认 updated_at_desc 不回归
    items_fb, _ = await service.list_(ws.id, sort="garbage")
    assert len(items_fb) == 3
