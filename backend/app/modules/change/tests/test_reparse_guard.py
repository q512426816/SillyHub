"""task-06（2026-08-01-proxy-create-race-fix）：_apply_parsed owner_id 守卫 +
reparse created 撞键 IntegrityError 转 update 单测。

覆盖 design §5 Phase 2a/2b（D-002@v1 / D-004@v1）+ AC-06/AC-07。弥补 test_router.py
真实文件 fixture（owner_id=None 扫描行）覆盖不到的 owner_id 非空 + 撞键兜底分支。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock


def _make_row(*, owner_id, current_stage="draft", updated_at=None):
    """最小 Change-like（MagicMock）供 _apply_parsed 直接操作，避免建库。

    updated_at 显式传入（默认 2026-01-01）—— _apply_parsed 现会读 row.updated_at
    与文件 mtime 取较大值，未设属性时 MagicMock 返回 mock 对象与 datetime 比较抛
    TypeError。None 透传用于 create 分支测试。
    """
    row = MagicMock()
    row.owner_id = owner_id
    row.current_stage = current_stage
    row.change_type = None
    row.title = "Demo"
    row.change_key = "2026-08-02-demo"
    row.location = "active"
    row.path = "changes/2026-08-02-demo"
    row.affected_components = []
    row.updated_at = updated_at if updated_at is not None else datetime(2026, 1, 1, tzinfo=UTC)
    return row


def _make_parsed(
    *,
    current_stage="brainstorm",
    change_key="2026-08-02-demo",
    last_modified_at=None,
):
    """last_modified_at 显式传入（默认 None）—— _apply_parsed 取较大值时读此字段，
    MagicMock 默认属性返回 mock 对象与 datetime 比较抛 TypeError，None 短路守卫。"""
    parsed = MagicMock()
    parsed.title = "Demo Parsed"
    parsed.status = "active"
    parsed.change_type = "feature"
    parsed.affected_components = []
    parsed.change_key = change_key
    parsed.location = "active"
    parsed.path = f"changes/{change_key}"
    parsed.current_stage = current_stage
    parsed.docs = []
    parsed.last_modified_at = last_modified_at
    return parsed


def test_apply_parsed_protects_stage_when_owner_id_set():
    """AC-06：owner_id 非空（proxy/worktree-lease 创建）行 stage 不被文件推断覆盖。"""
    from app.modules.change.service import ChangeService

    row = _make_row(owner_id=uuid.uuid4(), current_stage="draft")
    parsed = _make_parsed(current_stage="brainstorm")
    ChangeService._apply_parsed(row, parsed, workspace_id=uuid.uuid4())
    assert row.current_stage == "draft"  # 不被覆盖成 brainstorm


def test_apply_parsed_overrides_stage_when_owner_id_none():
    """AC-06：owner_id=None（扫描创建）行 stage 仍被文件推断覆盖（行为同前）。"""
    from app.modules.change.service import ChangeService

    row = _make_row(owner_id=None, current_stage="draft")
    parsed = _make_parsed(current_stage="brainstorm")
    ChangeService._apply_parsed(row, parsed, workspace_id=uuid.uuid4())
    assert row.current_stage == "brainstorm"  # 被覆盖


async def test_reparse_created_unique_violation_falls_back_to_update(db_session, monkeypatch):
    """AC-07：created 分支撞 ux_changes_workspace_key → savepoint rollback 转 update 不抛 500。

    D-004@v1 极端并发兜底：模拟占坑 commit 与 reparse created 几乎同时——reparse 第一次
    _fetch_existing_changes 没读到占坑行（强制走 created），savepoint flush 撞占坑行唯一键
    → IntegrityError → 重查读到占坑行 → 转 _apply_parsed(update)。owner_id 守卫保护 stage
    不被文件推断的 brainstorm 覆盖。
    """
    from datetime import UTC, datetime

    from app.modules.change.model import Change
    from app.modules.change.service import ChangeService
    from app.modules.workspace.model import Workspace

    ws_id = uuid.uuid4()
    user_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="Race WS",
        slug=f"race-{ws_id.hex[:8]}",
        root_path=f"/home/race-{ws_id.hex[:8]}",
        status="active",
        component_key="backend",
        default_agent="claude",
        created_by=user_id,
        last_scanned_at=datetime.now(UTC),
    )
    db_session.add(ws)
    # 占坑行（模拟 proxy 已建，change_key 与 reparse parsed 相同）。
    preempt = Change(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        change_key="2026-08-02-race",
        title="Race",
        status="active",
        location="active",
        path="changes/2026-08-02-race",
        affected_components=[],
        change_type="feature",
        current_stage="draft",
        owner_id=user_id,
    )
    db_session.add(preempt)
    await db_session.commit()

    service = ChangeService(db_session)
    # parser mock 返回 change_key 同占坑行的 ParsedChange（文件推断 brainstorm）。
    parsed = _make_parsed(current_stage="brainstorm", change_key="2026-08-02-race")
    service._parser = MagicMock()
    service._parser.parse_workspace.return_value = MagicMock(changes=[parsed])

    # _fetch_existing_changes：第一次 [] 强制 created 撞键，第二次返回占坑行转 update。
    call_count = {"n": 0}

    async def fake_fetch(self_, workspace_id):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return []
        return [preempt]

    monkeypatch.setattr(ChangeService, "_fetch_existing_changes", fake_fetch)

    # 不抛 500 / 不抛 IntegrityError。
    stats, _ = await service.reparse(ws_id)

    # 撞键后转 update（不计 created），占坑行 stage 因 owner_id 非空不被覆盖。
    assert stats["updated"] == 1
    assert stats["created"] == 0
    await db_session.refresh(preempt)
    assert preempt.current_stage == "draft"


# ── ql-20260813-008：reparse 用文件 mtime 填 updated_at（取较大值，不倒退）──
# _apply_parsed 现 updated_at = max(row.updated_at, parsed.last_modified_at)，让变更列表
# "更新时间"反映变更目录文件的真实活动，而非一次 reparse 的写入时刻。


def test_apply_parsed_updated_at_takes_max_when_mtime_newer():
    """文件 mtime > 现 updated_at → 刷新为 mtime（最近活动反映上去）。"""
    from app.modules.change.service import ChangeService

    row = _make_row(owner_id=None, updated_at=datetime(2026, 1, 1, tzinfo=UTC))
    parsed = _make_parsed(last_modified_at=datetime(2026, 6, 1, tzinfo=UTC))
    ChangeService._apply_parsed(row, parsed, workspace_id=uuid.uuid4())
    assert row.updated_at == datetime(2026, 6, 1, tzinfo=UTC)


def test_apply_parsed_preserves_updated_at_when_mtime_older():
    """文件 mtime < 现 updated_at → 保留现值（手动操作刷的较新时间不被旧 mtime 打回）。"""
    from app.modules.change.service import ChangeService

    row = _make_row(owner_id=None, updated_at=datetime(2026, 6, 1, tzinfo=UTC))
    parsed = _make_parsed(last_modified_at=datetime(2026, 1, 1, tzinfo=UTC))
    ChangeService._apply_parsed(row, parsed, workspace_id=uuid.uuid4())
    assert row.updated_at == datetime(2026, 6, 1, tzinfo=UTC)


def test_apply_parsed_skips_when_last_modified_at_none():
    """空目录 mtime=None → 保留现值（is not None 守卫，不抛 TypeError）。"""
    from app.modules.change.service import ChangeService

    row = _make_row(owner_id=None, updated_at=datetime(2026, 1, 1, tzinfo=UTC))
    parsed = _make_parsed(last_modified_at=None)
    ChangeService._apply_parsed(row, parsed, workspace_id=uuid.uuid4())
    assert row.updated_at == datetime(2026, 1, 1, tzinfo=UTC)


def test_apply_parsed_updated_at_applies_to_proxy_row():
    """owner_id 非空（proxy/worktree-lease 创建）行 updated_at 同样取较大值——
    updated_at 是展示字段，不按 owner 区分（与 current_stage 的 owner_id 守卫不同）。"""
    from app.modules.change.service import ChangeService

    row = _make_row(owner_id=uuid.uuid4(), updated_at=datetime(2026, 1, 1, tzinfo=UTC))
    parsed = _make_parsed(last_modified_at=datetime(2026, 6, 1, tzinfo=UTC))
    ChangeService._apply_parsed(row, parsed, workspace_id=uuid.uuid4())
    assert row.updated_at == datetime(2026, 6, 1, tzinfo=UTC)


def test_apply_parsed_handles_naive_updated_at_from_sqlite():
    """SQLite 返回的 updated_at 是 offset-naive（不存 tz），parsed mtime 带 UTC tzinfo。
    直接比较抛 TypeError——_apply_parsed 须把 naive 归一化为 UTC 再比较（真实 DB 路径）。
    此测钉死该边界：naive 2026-06-01 vs aware 2026-07-01 → 刷新，不抛异常。"""
    from app.modules.change.service import ChangeService

    row = _make_row(owner_id=None, updated_at=datetime(2026, 6, 1))  # naive（模拟 SQLite 返回）
    parsed = _make_parsed(last_modified_at=datetime(2026, 7, 1, tzinfo=UTC))  # aware
    ChangeService._apply_parsed(row, parsed, workspace_id=uuid.uuid4())
    assert row.updated_at == datetime(2026, 7, 1, tzinfo=UTC)


# ── ql-20260815-002 全量 reparse 镜像滞后保护（占位行不删）───────────────────────


async def _make_guard_ws(db_session):
    import uuid

    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name="guard-progress ws",
        slug=f"gp-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/guard-progress-{uuid.uuid4().hex[:12]}",
        status="active",
        component_key="comp",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_guard_spec_ws(db_session, ws, spec_root) -> None:
    from app.modules.spec_workspace.model import SpecWorkspace

    db_session.add(
        SpecWorkspace(
            workspace_id=ws.id,
            spec_root=str(spec_root),
            strategy="platform-managed",
            sync_status="clean",
        )
    )
    await db_session.commit()


async def _seed_progress_row(
    db_session, db_engine, ws_id, change_name, status, *, updated_at=None
) -> None:
    """插 platform_change_progress 行（该表不在根 conftest 注册列表，先建表）。"""
    from app.models.base import BaseModel
    from app.modules.platform_sync import model as _ps_model

    async with db_engine.begin() as conn:
        await conn.run_sync(
            BaseModel.metadata.create_all,
            tables=[_ps_model.PlatformChangeProgressORM.__table__],
        )
    db_session.add(
        _ps_model.PlatformChangeProgressORM(
            workspace_id=ws_id,
            change_name=change_name,
            latest_progress={
                "project": {"name": "demo"},
                "changes": [{"name": change_name, "status": status}],
            },
            last_pushed_at="2026-08-15T00:00:00.000Z",
            last_pusher="tester",
            **({"updated_at": updated_at} if updated_at is not None else {}),
        )
    )
    await db_session.commit()


async def _insert_placeholder_change(db_session, ws_id, key) -> None:
    """模拟 platform_sync 首推占位建行的 ux_changes 行（无任何 change_documents）。"""
    import uuid
    from datetime import UTC, datetime

    from app.modules.change.model import Change

    db_session.add(
        Change(
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
    )
    await db_session.commit()


async def test_full_reparse_keeps_placeholder_when_progress_active(db_session, db_engine, tmp_path):
    """ql-20260815-002：占位行（无文档）+ progress 仍报 active → 全量 reparse 不删。

    镜像 tar 滞后场景：CLI 已推 progress、spec tar 未跟上，镜像无目录。
    删除环须保住占位行，否则变更中心「先出现后消失」。
    """
    from sqlalchemy import select

    from app.modules.change.model import Change
    from app.modules.change.service import ChangeService

    ws = await _make_guard_ws(db_session)
    spec_root = tmp_path / "spec-root"
    spec_root.mkdir()
    await _make_guard_spec_ws(db_session, ws, spec_root)
    await _insert_placeholder_change(db_session, ws.id, "2026-08-15-ghost")
    await _seed_progress_row(db_session, db_engine, ws.id, "2026-08-15-ghost", "active")

    stats, _ = await ChangeService(db_session).reparse(ws.id)  # 全量，镜像无该目录

    assert stats["deleted"] == 0
    kept = (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws.id,
                    Change.change_key == "2026-08-15-ghost",
                )
            )
        )
        .scalars()
        .first()
    )
    assert kept is not None


async def test_full_reparse_deletes_placeholder_when_progress_not_active(
    db_session, db_engine, tmp_path
):
    """ql-20260815-002：progress 不再报 active（本地已删/归档后 stale payload）→ 删除恢复。

    保护只覆盖「CLI 最近一次上行仍报 active」的 key，防 stale progress 行让
    已删变更永生。
    """
    from sqlalchemy import select

    from app.modules.change.model import Change
    from app.modules.change.service import ChangeService

    ws = await _make_guard_ws(db_session)
    spec_root = tmp_path / "spec-root"
    spec_root.mkdir()
    await _make_guard_spec_ws(db_session, ws, spec_root)
    await _insert_placeholder_change(db_session, ws.id, "2026-08-15-stale")
    await _seed_progress_row(db_session, db_engine, ws.id, "2026-08-15-stale", "archived")

    stats, _ = await ChangeService(db_session).reparse(ws.id)

    assert stats["deleted"] == 1
    gone = (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws.id,
                    Change.change_key == "2026-08-15-stale",
                )
            )
        )
        .scalars()
        .first()
    )
    assert gone is None


async def test_full_reparse_deletes_docked_change_despite_progress_active(
    db_session, db_engine, tmp_path
):
    """ql-20260815-002：有文档的行不享受保护（磁盘权威）——镜像目录消失即删。

    刻意的取舍：保护只覆盖「从未同步过文档」的占位行；曾有文档的变更以镜像
    为准，避免 stale progress 行让真删变更永生。
    """
    from app.modules.change.service import ChangeService

    ws = await _make_guard_ws(db_session)
    spec_root = tmp_path / "spec-root"
    d = spec_root / "changes" / "2026-08-15-docked"
    d.mkdir(parents=True)
    (d / "proposal.md").write_text("# Docked\n", encoding="utf-8")
    await _make_guard_spec_ws(db_session, ws, spec_root)

    stats, _ = await ChangeService(db_session).reparse(ws.id)  # 建行 + 文档
    assert stats["created"] == 1

    import shutil

    shutil.rmtree(d)  # 镜像目录消失
    await _seed_progress_row(db_session, db_engine, ws.id, "2026-08-15-docked", "active")

    stats, _ = await ChangeService(db_session).reparse(ws.id)
    assert stats["deleted"] == 1


# ===========================================================================
# 2026-08-19-spec-mirror-tombstone-sync FR-03：占位行保护 7 天时效窗
# ===========================================================================


async def test_placeholder_protected_within_7_days(db_session, db_engine, tmp_path):
    """FR-03：progress 上行距今 6 天（窗内）→ 占位行仍受保护。"""
    from datetime import timedelta

    from sqlalchemy import select

    from app.modules.change.model import Change
    from app.modules.change.service import ChangeService

    ws = await _make_guard_ws(db_session)
    spec_root = tmp_path / "spec-root"
    spec_root.mkdir()
    await _make_guard_spec_ws(db_session, ws, spec_root)
    await _insert_placeholder_change(db_session, ws.id, "2026-08-19-window")
    await _seed_progress_row(
        db_session,
        db_engine,
        ws.id,
        "2026-08-19-window",
        "active",
        updated_at=datetime.now(UTC) - timedelta(days=6),
    )

    stats, _ = await ChangeService(db_session).reparse(ws.id)

    assert stats["deleted"] == 0
    kept = (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws.id,
                    Change.change_key == "2026-08-19-window",
                )
            )
        )
        .scalars()
        .first()
    )
    assert kept is not None


async def test_placeholder_unprotected_after_7_days(db_session, db_engine, tmp_path):
    """FR-03：progress 上行距今 8 天（窗外）→ 占位行不再受保护，reparse 删除。

    一次性上行后停滞的测试残留行不再永久滞留「进行中」（生产实例 6 条根因）。
    """
    from datetime import timedelta

    from sqlalchemy import select

    from app.modules.change.model import Change
    from app.modules.change.service import ChangeService

    ws = await _make_guard_ws(db_session)
    spec_root = tmp_path / "spec-root"
    spec_root.mkdir()
    await _make_guard_spec_ws(db_session, ws, spec_root)
    await _insert_placeholder_change(db_session, ws.id, "2026-08-19-stale-window")
    await _seed_progress_row(
        db_session,
        db_engine,
        ws.id,
        "2026-08-19-stale-window",
        "active",
        updated_at=datetime.now(UTC) - timedelta(days=8),
    )

    stats, _ = await ChangeService(db_session).reparse(ws.id)

    assert stats["deleted"] == 1
    gone = (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws.id,
                    Change.change_key == "2026-08-19-stale-window",
                )
            )
        )
        .scalars()
        .first()
    )
    assert gone is None
