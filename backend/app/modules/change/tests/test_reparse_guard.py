"""task-06（2026-08-01-proxy-create-race-fix）：_apply_parsed owner_id 守卫 +
reparse created 撞键 IntegrityError 转 update 单测。

覆盖 design §5 Phase 2a/2b（D-002@v1 / D-004@v1）+ AC-06/AC-07。弥补 test_router.py
真实文件 fixture（owner_id=None 扫描行）覆盖不到的 owner_id 非空 + 撞键兜底分支。
"""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock


def _make_row(*, owner_id, current_stage="draft"):
    """最小 Change-like（MagicMock）供 _apply_parsed 直接操作，避免建库。"""
    row = MagicMock()
    row.owner_id = owner_id
    row.current_stage = current_stage
    row.change_type = None
    row.title = "Demo"
    row.change_key = "2026-08-02-demo"
    row.location = "active"
    row.path = "changes/2026-08-02-demo"
    row.affected_components = []
    return row


def _make_parsed(*, current_stage="brainstorm", change_key="2026-08-02-demo"):
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
