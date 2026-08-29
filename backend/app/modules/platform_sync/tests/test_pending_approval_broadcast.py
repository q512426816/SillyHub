"""upsert_progress 待办产生钩子测试（task-04 / design §7.3① 触发点①）。

覆盖四类语义（D-011@v1 / D-009@v2 / D-006@v1）：

1. pending 命中 → notify_broadcast 被调且参数正确（type/ref_type/ref_id/
   dedupe_key/permission，in-hand latest_progress 判定）；
2. 重复推同 body → 触发点每次都调 service（幂等由 service 内未消解检查兜底）；
3. 非 pending body → 不调；
4. 通知抛异常 → upsert_progress 正常返回且进度已落库（best-effort）。

monkeypatch ``NotificationService.notify_broadcast``（类级 AsyncMock）截获调用
断言 kwargs——不 mock 被测 ``upsert_progress`` 本体（真实断言惯例）。
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change.model import Change
from app.modules.notification.service import NotificationService
from app.modules.platform_sync.model import PlatformChangeProgressORM
from app.modules.platform_sync.service import PlatformSyncService
from app.modules.workspace.model import Workspace

T2 = "2026-08-10T13:45:00.000Z"


async def _make_workspace(session: AsyncSession) -> Workspace:
    """建 Workspace 行（镜像 test_pk_semantics.py::_make_workspace 模式）。"""
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


def _progress(name: str, stage: str, completed: tuple[str, ...] = ()) -> dict[str, Any]:
    """serializeForSync 六表 body；``stages`` 顶层 completed 数组按需注入。"""
    return {
        "project": {"name": name},
        "changes": [{"name": name, "current_stage": stage, "status": "in_progress"}],
        "stages": [{"stage": s, "status": "completed"} for s in completed],
        "steps": [],
        "batch_progress": [],
        "approvals": [],
    }


async def _find_change(session: AsyncSession, workspace_id: uuid.UUID, key: str) -> Change:
    """取 ``_ensure_change_row`` 落的占位 Change 行（id/title 断言用）。"""
    row = (
        await session.execute(
            select(Change).where(
                Change.workspace_id == workspace_id,
                Change.change_key == key,
            )
        )
    ).scalar_one()
    return row


# ── 1. pending 命中 → 广播参数正确 ──────────────────────────────────────────────


async def test_pending_body_broadcasts_approval_pending(
    db_session: AsyncSession, monkeypatch: Any
) -> None:
    """plan completed + current_stage=plan → PLAN_REVIEW 命中，notify_broadcast
    收到 type=approval_pending / ref_type=change / ref_id=str(change_id) /
    dedupe_key={change_id}:{review_kind} / permission=CHANGE_CREATE（in-hand 判定）。"""
    recorder = AsyncMock(return_value=0)
    monkeypatch.setattr(NotificationService, "notify_broadcast", recorder)

    from app.modules.auth.permissions import Permission

    ws = await _make_workspace(db_session)
    svc = PlatformSyncService(db_session)
    res = await svc.upsert_progress(
        ws.id, "demo", _progress("demo", "plan", completed=("plan",)), None, T2, "alice"
    )
    assert res.conflict is False

    recorder.assert_awaited_once()
    kwargs = recorder.await_args.kwargs
    assert kwargs["type"] == "approval_pending"
    assert kwargs["ref_type"] == "change"
    assert kwargs["permission"] == Permission.CHANGE_CREATE
    assert kwargs["workspace_id"] == ws.id
    change = await _find_change(db_session, ws.id, "demo")
    assert kwargs["ref_id"] == str(change.id)
    assert kwargs["dedupe_key"] == f"{change.id}:plan_review"
    assert kwargs["link"] == f"/workspaces/{ws.id}/changes/{change.id}"
    assert "等待计划审核" in kwargs["title"]


# ── 2. 重复推送 → 触发点每次都调 service（幂等由 service 兜底） ─────────────────


async def test_duplicate_push_still_calls_service(
    db_session: AsyncSession, monkeypatch: Any
) -> None:
    """重复推同 pending body：触发点不做存在性检查（D-009@v2 service 唯一检查方），
    每次接受都调 notify_broadcast——去重是 service 内未消解检查的职责。"""
    recorder = AsyncMock(return_value=0)
    monkeypatch.setattr(NotificationService, "notify_broadcast", recorder)

    ws = await _make_workspace(db_session)
    svc = PlatformSyncService(db_session)
    body = _progress("demo", "verify", completed=("verify",))
    for _ in range(2):
        res = await svc.upsert_progress(ws.id, "demo", body, T2, T2, "alice")
        assert res.conflict is False
    assert recorder.await_count == 2
    # 两次调用同门 dedupe_key（审计键稳定）。
    change = await _find_change(db_session, ws.id, "demo")
    for call in recorder.await_args_list:
        assert call.kwargs["dedupe_key"] == f"{change.id}:human_test"


# ── 3. 非 pending body → 不调 ──────────────────────────────────────────────────


async def test_non_pending_body_no_broadcast(db_session: AsyncSession, monkeypatch: Any) -> None:
    """execute 进行中（无门命中）→ notify_broadcast 不被调。"""
    recorder = AsyncMock(return_value=0)
    monkeypatch.setattr(NotificationService, "notify_broadcast", recorder)

    ws = await _make_workspace(db_session)
    svc = PlatformSyncService(db_session)
    res = await svc.upsert_progress(
        ws.id, "demo", _progress("demo", "execute", completed=("brainstorm", "plan")), None, T2, "a"
    )
    assert res.conflict is False
    recorder.assert_not_awaited()


# ── 4. 通知异常 → 进度落库不受影响（D-006@v1 best-effort） ──────────────────────


async def test_broadcast_failure_does_not_break_upsert(
    db_session: AsyncSession, monkeypatch: Any
) -> None:
    """notify_broadcast 抛错 → upsert_progress 正常返回（不抛）、进度行已落库。"""
    monkeypatch.setattr(
        NotificationService,
        "notify_broadcast",
        AsyncMock(side_effect=RuntimeError("redis down")),
    )

    ws = await _make_workspace(db_session)
    svc = PlatformSyncService(db_session)
    body = _progress("demo", "plan", completed=("plan",))
    res = await svc.upsert_progress(ws.id, "demo", body, None, T2, "alice")
    assert res.conflict is False

    row = (
        await db_session.execute(
            select(PlatformChangeProgressORM).where(
                PlatformChangeProgressORM.workspace_id == ws.id,
                PlatformChangeProgressORM.change_name == "demo",
            )
        )
    ).scalar_one()
    assert row.latest_progress == body
