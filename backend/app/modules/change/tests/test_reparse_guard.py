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
