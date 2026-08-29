"""Tests for approval actions → owner result notification + pending resolve.

2026-08-29-approval-notify-push task-05（D-007@v1 / design §7.3②）：四门 +
旧版 approve/reject 成功提交后旁路：先 ``resolve_pending`` 消解同 ref 未读
``approval_pending`` 待办，再向 change owner 发 ``approval_result`` 定向通知
（通过/驳回/回退 title 区分）；owner 为 None 跳过；整体 best-effort（异常仅
log.warning，不影响审批动作返回）。

覆盖（acceptance task-05）：
- 通过：owner 收 approval_result（title 已通过）+ 同 ref 待办被置已读
- 打回：title 被打回（decision），body 带审批人/意见
- 旧版 reject：title 被驳回，body 带驳回原因
- owner None：不通知不报错
- 通知服务抛异常：审批动作正常返回（best-effort）
"""

from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change.schema import PendingReview
from app.modules.change.service import ChangeService
from app.modules.change.tests.test_approval_notify_session import _patch_projection
from app.modules.change.tests.test_dispatch import (
    _create_test_change,
    _create_test_workspace,
)
from app.modules.notification.model import Notification

# ── Helpers ────────────────────────────────────────────────────────────────


async def _setup_change(
    session: AsyncSession,
    tmp_path: Path,
    *,
    stage: str,
    owner_id: uuid.UUID | None,
) -> tuple[uuid.UUID, uuid.UUID]:
    """Create workspace + change at ``stage`` with optional owner.

    返回 ``(workspace_id, change_id)``。
    """
    ws = await _create_test_workspace(session, root_path=str(tmp_path))
    change = await _create_test_change(
        session,
        workspace_id=ws.id,
        current_stage=stage,
        path=str(tmp_path / ".sillyspec" / "changes" / "c" / "t"),
    )
    change.owner_id = owner_id
    session.add(change)
    await session.commit()
    return ws.id, change.id


async def _seed_pending(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    recipient_user_id: uuid.UUID,
) -> None:
    """插入一条未读 approval_pending 待办（模拟触发点①产生）。"""
    session.add(
        Notification(
            workspace_id=workspace_id,
            recipient_user_id=recipient_user_id,
            type="approval_pending",
            title="变更「Test Dispatch Change」提案审核等待审核",
            body=None,
            link=f"/workspaces/{workspace_id}/changes/{change_id}",
            ref_type="change",
            ref_id=str(change_id),
        )
    )
    await session.commit()


async def _list_notifications(
    session: AsyncSession, *, change_id: uuid.UUID, type: str
) -> list[Notification]:
    return list(
        (
            await session.execute(
                select(Notification).where(
                    Notification.ref_type == "change",
                    Notification.ref_id == str(change_id),
                    Notification.type == type,
                )
            )
        )
        .scalars()
        .all()
    )


# ── 通过：owner 收结果通知 + 待办消解 ──────────────────────────────────────


@pytest.mark.asyncio
class TestApprovalResultNotify:
    async def test_proposal_approve_notifies_owner_and_resolves_pending(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        owner = uuid.uuid4()
        ws_id, change_id = await _setup_change(
            db_session, tmp_path, stage="brainstorm", owner_id=owner
        )
        await _seed_pending(
            db_session,
            workspace_id=ws_id,
            change_id=change_id,
            recipient_user_id=uuid.uuid4(),
        )
        svc = ChangeService(db_session)
        with _patch_projection(PendingReview.PROPOSAL_REVIEW):
            await svc.proposal_review(
                ws_id, change_id, "approve", "写得好", uuid.uuid4(), notify_session=False
            )

        rows = await _list_notifications(db_session, change_id=change_id, type="approval_result")
        assert len(rows) == 1
        row = rows[0]
        assert row.recipient_user_id == owner
        assert row.title == "变更「Test Dispatch Change」提案审核已通过"
        assert "写得好" in (row.body or "")
        assert row.link == f"/workspaces/{ws_id}/changes/{change_id}"

        # 同 ref 未读待办被消解（read_at 置值）
        pending = await _list_notifications(
            db_session, change_id=change_id, type="approval_pending"
        )
        assert len(pending) == 1
        assert pending[0].read_at is not None

    async def test_archive_confirm_notifies_owner(self, db_session: AsyncSession, tmp_path: Path):
        owner = uuid.uuid4()
        ws_id, change_id = await _setup_change(
            db_session, tmp_path, stage="archive", owner_id=owner
        )
        svc = ChangeService(db_session)
        with _patch_projection(PendingReview.ARCHIVE_CONFIRM):
            await svc.archive_confirm(
                ws_id, change_id, "确认归档", uuid.uuid4(), notify_session=False
            )

        rows = await _list_notifications(db_session, change_id=change_id, type="approval_result")
        assert len(rows) == 1
        assert rows[0].title == "变更「Test Dispatch Change」归档确认已通过"
        assert rows[0].recipient_user_id == owner

    async def test_legacy_approve_notifies_owner(self, db_session: AsyncSession, tmp_path: Path):
        owner = uuid.uuid4()
        ws_id, change_id = await _setup_change(db_session, tmp_path, stage="draft", owner_id=owner)
        svc = ChangeService(db_session)
        change = await svc.get(ws_id, change_id)
        await svc.approve(ws_id, change.change_key, approved_by="admin")

        rows = await _list_notifications(db_session, change_id=change_id, type="approval_result")
        assert len(rows) == 1
        assert rows[0].title == "变更「Test Dispatch Change」审批已通过"
        assert rows[0].recipient_user_id == owner
        refreshed = await svc.get(ws_id, change_id)
        assert refreshed.approval_status == "approved"


# ── 驳回 / 打回文案 ────────────────────────────────────────────────────────


@pytest.mark.asyncio
class TestApprovalRejectedWording:
    async def test_legacy_reject_title_and_reason(self, db_session: AsyncSession, tmp_path: Path):
        owner = uuid.uuid4()
        ws_id, change_id = await _setup_change(db_session, tmp_path, stage="draft", owner_id=owner)
        svc = ChangeService(db_session)
        change = await svc.get(ws_id, change_id)
        await svc.reject(ws_id, change.change_key, reason="方向不对")

        rows = await _list_notifications(db_session, change_id=change_id, type="approval_result")
        assert len(rows) == 1
        assert rows[0].title == "变更「Test Dispatch Change」审批被驳回"
        assert "方向不对" in (rows[0].body or "")

    async def test_plan_replan_returned_wording(self, db_session: AsyncSession, tmp_path: Path):
        owner = uuid.uuid4()
        ws_id, change_id = await _setup_change(db_session, tmp_path, stage="plan", owner_id=owner)
        svc = ChangeService(db_session)
        with _patch_projection(PendingReview.PLAN_REVIEW):
            await svc.plan_review(
                ws_id, change_id, "replan", "计划要重做", uuid.uuid4(), notify_session=False
            )

        rows = await _list_notifications(db_session, change_id=change_id, type="approval_result")
        assert len(rows) == 1
        assert rows[0].title == "变更「Test Dispatch Change」计划审核被打回（replan）"
        assert "计划要重做" in (rows[0].body or "")
        assert rows[0].recipient_user_id == owner

    async def test_human_test_bug_returned_wording(self, db_session: AsyncSession, tmp_path: Path):
        owner = uuid.uuid4()
        ws_id, change_id = await _setup_change(db_session, tmp_path, stage="verify", owner_id=owner)
        svc = ChangeService(db_session)
        with _patch_projection(PendingReview.HUMAN_TEST):
            await svc.human_test(
                ws_id, change_id, "bug", "有缺陷", uuid.uuid4(), notify_session=False
            )

        rows = await _list_notifications(db_session, change_id=change_id, type="approval_result")
        assert len(rows) == 1
        assert rows[0].title == "变更「Test Dispatch Change」人工测试被打回（bug）"


# ── owner None 与通知异常（best-effort） ──────────────────────────────────


@pytest.mark.asyncio
class TestApprovalNotifyBestEffort:
    async def test_owner_none_skips_notify_without_error(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        ws_id, change_id = await _setup_change(
            db_session, tmp_path, stage="brainstorm", owner_id=None
        )
        await _seed_pending(
            db_session,
            workspace_id=ws_id,
            change_id=change_id,
            recipient_user_id=uuid.uuid4(),
        )
        svc = ChangeService(db_session)
        with _patch_projection(PendingReview.PROPOSAL_REVIEW):
            result = await svc.proposal_review(
                ws_id, change_id, "approve", None, uuid.uuid4(), notify_session=False
            )

        # 动作正常完成 + 阶段推进；无 approval_result 行；待办仍被消解
        assert result["change"].current_stage == "plan"
        assert (
            await _list_notifications(db_session, change_id=change_id, type="approval_result") == []
        )
        pending = await _list_notifications(
            db_session, change_id=change_id, type="approval_pending"
        )
        assert pending[0].read_at is not None

    async def test_notify_failure_does_not_break_approval(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        owner = uuid.uuid4()
        ws_id, change_id = await _setup_change(
            db_session, tmp_path, stage="brainstorm", owner_id=owner
        )
        svc = ChangeService(db_session)
        broken = AsyncMock(side_effect=RuntimeError("notify down"))
        with (
            _patch_projection(PendingReview.PROPOSAL_REVIEW),
            patch(
                "app.modules.notification.service.NotificationService.resolve_pending",
                broken,
            ),
        ):
            result = await svc.proposal_review(
                ws_id, change_id, "approve", None, uuid.uuid4(), notify_session=False
            )

        # 审批动作仍成功（阶段推进 + 返回正常）
        assert result["change"].current_stage == "plan"
        assert (
            await _list_notifications(db_session, change_id=change_id, type="approval_result") == []
        )
