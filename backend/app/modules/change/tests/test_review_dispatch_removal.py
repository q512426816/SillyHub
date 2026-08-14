"""Tests for review methods dispatch removal + projection convergence (task-03).

D-004（2026-08-14-change-center-conversation-driven design §5 P2）：审批四方法
（proposal_review / plan_review / human_test / archive_confirm）通过/打回只落审批
记录 + 阶段状态，**不再自动派发 agent**；审批推进阶段时同步 upsert
``platform_change_progress``（source=platform，stage=新阶段），使读时投影
（``enrich_*`` latest_progress 覆盖）立即收敛，消除「回显旧阶段/重复审批」窗口。

覆盖（acceptance task-03）：
- 审批通过不派发：proposal approve / plan approve / human_test pass 推进阶段
  但 ``dispatch.dispatch`` 零调用，返回 ``agent_dispatch is None``。
- 投影收敛：approve 后 ``platform_change_progress`` 行 latest_progress 的
  ``changes[0].current_stage`` 为新阶段，读侧 ``enrich_with_workspace_ids``
  立即投影出新阶段（R-09）。
- 打回不派发：revise / replan / bug 等打回类 decision 保持既有回退语义
  （review_history rerun 条目 + last_review），且 ``dispatch.dispatch`` 零调用。
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
from app.modules.change.tests.test_dispatch import (
    _create_test_change,
    _create_test_workspace,
)
from app.modules.platform_sync.model import PlatformChangeProgressORM


def _patch_projection(pending: PendingReview):
    """Patch StageProjectionService.compute_pending_review to return ``pending``."""
    return patch(
        "app.modules.change.service.StageProjectionService.compute_pending_review",
        new=AsyncMock(return_value=pending),
    )


async def _setup(session: AsyncSession, tmp_path: Path, *, stage: str):
    ws = await _create_test_workspace(session, root_path=str(tmp_path))
    change = await _create_test_change(
        session,
        workspace_id=ws.id,
        current_stage=stage,
        path=str(tmp_path / ".sillyspec" / "changes" / "c" / "t"),
    )
    return ws.id, change.id


async def _get_progress_row(
    session: AsyncSession, workspace_id: uuid.UUID, change_key: str
) -> PlatformChangeProgressORM | None:
    stmt = select(PlatformChangeProgressORM).where(
        PlatformChangeProgressORM.workspace_id == workspace_id,
        PlatformChangeProgressORM.change_name == change_key,
    )
    return (await session.execute(stmt)).scalar_one_or_none()


@pytest.mark.asyncio
class TestReviewApproveNoDispatch:
    """审批通过只推进阶段，不派发 agent（D-004 / acceptance ①）。"""

    async def test_proposal_approve_no_dispatch(self, db_session: AsyncSession, tmp_path: Path):
        ws_id, change_id = await _setup(db_session, tmp_path, stage="brainstorm")
        svc = ChangeService(db_session)
        dispatch_mock = AsyncMock(return_value={"dispatched": True, "stage": "plan"})
        with (
            _patch_projection(PendingReview.PROPOSAL_REVIEW),
            patch("app.modules.change.dispatch.dispatch", new=dispatch_mock),
        ):
            result = await svc.proposal_review(ws_id, change_id, "approve", "ok", uuid.uuid4())

        # 只推进阶段：current_stage == plan
        assert result["change"].current_stage == "plan"
        # 返回 agent_dispatch 置空（null/空，不携带任何派发信息）
        assert result["agent_dispatch"] is None
        # 零 dispatch：dispatch 函数从未被 await
        dispatch_mock.assert_not_awaited()

    async def test_plan_approve_no_dispatch(self, db_session: AsyncSession, tmp_path: Path):
        ws_id, change_id = await _setup(db_session, tmp_path, stage="plan")
        svc = ChangeService(db_session)
        dispatch_mock = AsyncMock(return_value={"dispatched": True, "stage": "execute"})
        with (
            _patch_projection(PendingReview.PLAN_REVIEW),
            patch("app.modules.change.dispatch.dispatch", new=dispatch_mock),
        ):
            result = await svc.plan_review(ws_id, change_id, "approve", None, uuid.uuid4())

        assert result["change"].current_stage == "execute"
        assert result["agent_dispatch"] is None
        dispatch_mock.assert_not_awaited()

    async def test_human_test_pass_no_dispatch(self, db_session: AsyncSession, tmp_path: Path):
        ws_id, change_id = await _setup(db_session, tmp_path, stage="verify")
        svc = ChangeService(db_session)
        dispatch_mock = AsyncMock(return_value={"dispatched": True, "stage": "archive"})
        with (
            _patch_projection(PendingReview.HUMAN_TEST),
            patch("app.modules.change.dispatch.dispatch", new=dispatch_mock),
        ):
            result = await svc.human_test(ws_id, change_id, "pass", None, uuid.uuid4())

        assert result["change"].current_stage == "archive"
        assert result["agent_dispatch"] is None
        dispatch_mock.assert_not_awaited()


@pytest.mark.asyncio
class TestReviewRejectNoDispatch:
    """打回类 decision 只回退/记录，不派发 agent（D-004 / acceptance ③）。"""

    async def test_proposal_revise_no_dispatch(self, db_session: AsyncSession, tmp_path: Path):
        ws_id, change_id = await _setup(db_session, tmp_path, stage="brainstorm")
        svc = ChangeService(db_session)
        dispatch_mock = AsyncMock(return_value={"dispatched": True, "stage": "brainstorm"})
        with (
            _patch_projection(PendingReview.PROPOSAL_REVIEW),
            patch("app.modules.change.dispatch.dispatch", new=dispatch_mock),
        ):
            result = await svc.proposal_review(ws_id, change_id, "revise", "改一下", uuid.uuid4())

        # 打回语义与现状一致：保持 brainstorm 阶段，记录 rework（rerun 条目）
        assert result["change"].current_stage == "brainstorm"
        stages = result["change"].stages or {}
        history = stages.get("review_history", [])
        assert any(r.get("decision") == "revise" for r in history)
        assert any(r.get("action") == "rerun" and r.get("stage") == "brainstorm" for r in history)
        assert (stages.get("last_review") or {}).get("action") == "rerun"
        assert result["agent_dispatch"] is None
        dispatch_mock.assert_not_awaited()

    async def test_plan_replan_no_dispatch(self, db_session: AsyncSession, tmp_path: Path):
        ws_id, change_id = await _setup(db_session, tmp_path, stage="plan")
        svc = ChangeService(db_session)
        dispatch_mock = AsyncMock(return_value={"dispatched": True, "stage": "plan"})
        with (
            _patch_projection(PendingReview.PLAN_REVIEW),
            patch("app.modules.change.dispatch.dispatch", new=dispatch_mock),
        ):
            result = await svc.plan_review(ws_id, change_id, "replan", "重做计划", uuid.uuid4())

        assert result["change"].current_stage == "plan"
        stages = result["change"].stages or {}
        history = stages.get("review_history", [])
        assert any(r.get("decision") == "replan" for r in history)
        assert any(r.get("action") == "rerun" and r.get("stage") == "plan" for r in history)
        assert result["agent_dispatch"] is None
        dispatch_mock.assert_not_awaited()

    async def test_plan_back_to_brainstorm_no_dispatch(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        ws_id, change_id = await _setup(db_session, tmp_path, stage="plan")
        svc = ChangeService(db_session)
        dispatch_mock = AsyncMock(return_value={"dispatched": True, "stage": "brainstorm"})
        with (
            _patch_projection(PendingReview.PLAN_REVIEW),
            patch("app.modules.change.dispatch.dispatch", new=dispatch_mock),
        ):
            result = await svc.plan_review(
                ws_id, change_id, "back_to_brainstorm", "回炉", uuid.uuid4()
            )

        assert result["change"].current_stage == "plan"
        stages = result["change"].stages or {}
        history = stages.get("review_history", [])
        assert any(r.get("action") == "rerun" and r.get("stage") == "brainstorm" for r in history)
        assert result["agent_dispatch"] is None
        dispatch_mock.assert_not_awaited()

    async def test_human_test_bug_no_dispatch(self, db_session: AsyncSession, tmp_path: Path):
        ws_id, change_id = await _setup(db_session, tmp_path, stage="verify")
        svc = ChangeService(db_session)
        dispatch_mock = AsyncMock(return_value={"dispatched": True, "stage": "execute"})
        with (
            _patch_projection(PendingReview.HUMAN_TEST),
            patch("app.modules.change.dispatch.dispatch", new=dispatch_mock),
        ):
            result = await svc.human_test(ws_id, change_id, "bug", "验收不过", uuid.uuid4())

        assert result["change"].current_stage == "verify"
        stages = result["change"].stages or {}
        history = stages.get("review_history", [])
        assert any(r.get("decision") == "bug" for r in history)
        assert any(r.get("action") == "rerun" and r.get("stage") == "execute" for r in history)
        assert result["agent_dispatch"] is None
        dispatch_mock.assert_not_awaited()


@pytest.mark.asyncio
class TestReviewProjectionConvergence:
    """审批推进阶段后同步 upsert platform_change_progress，读侧立即收敛（R-09）。"""

    async def test_proposal_approve_upserts_latest_progress(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        ws_id, change_id = await _setup(db_session, tmp_path, stage="brainstorm")
        svc = ChangeService(db_session)
        with _patch_projection(PendingReview.PROPOSAL_REVIEW):
            result = await svc.proposal_review(ws_id, change_id, "approve", "ok", uuid.uuid4())

        row = await _get_progress_row(db_session, ws_id, result["change"].change_key)
        assert row is not None, "approve 后应 upsert platform_change_progress 行"
        assert row.last_pusher == "platform"  # source=platform
        assert row.latest_progress is not None
        assert row.latest_progress["changes"][0]["current_stage"] == "plan"

        # 读侧 enrich 立即投影到新阶段（latest_progress 覆盖，change/service.py:1259-1271）
        read = await svc.enrich_with_workspace_ids(result["change"])
        assert read.current_stage == "plan"

    async def test_plan_approve_upserts_latest_progress(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        ws_id, change_id = await _setup(db_session, tmp_path, stage="plan")
        svc = ChangeService(db_session)
        with _patch_projection(PendingReview.PLAN_REVIEW):
            result = await svc.plan_review(ws_id, change_id, "approve", None, uuid.uuid4())

        row = await _get_progress_row(db_session, ws_id, result["change"].change_key)
        assert row is not None
        assert row.latest_progress is not None
        assert row.latest_progress["changes"][0]["current_stage"] == "execute"

        read = await svc.enrich_with_workspace_ids(result["change"])
        assert read.current_stage == "execute"

    async def test_human_test_pass_upserts_latest_progress(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        ws_id, change_id = await _setup(db_session, tmp_path, stage="verify")
        svc = ChangeService(db_session)
        with _patch_projection(PendingReview.HUMAN_TEST):
            result = await svc.human_test(ws_id, change_id, "pass", None, uuid.uuid4())

        row = await _get_progress_row(db_session, ws_id, result["change"].change_key)
        assert row is not None
        assert row.latest_progress is not None
        assert row.latest_progress["changes"][0]["current_stage"] == "archive"

        read = await svc.enrich_with_workspace_ids(result["change"])
        assert read.current_stage == "archive"

    async def test_upsert_preserves_existing_latest_progress(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """已有 agent 上行的镜像行 → 只更新 current_stage，其余结构保留（不覆盖丢失）。"""
        ws_id, change_id = await _setup(db_session, tmp_path, stage="brainstorm")
        change = await ChangeService(db_session).get(ws_id, change_id)
        db_session.add(
            PlatformChangeProgressORM(
                workspace_id=ws_id,
                change_name=change.change_key,
                latest_progress={
                    "project": {"name": "keep-me"},
                    "changes": [
                        {
                            "name": change.change_key,
                            "current_stage": "brainstorm",
                            "status": "in_progress",
                        }
                    ],
                    "stages": [{"stage": "brainstorm", "status": "completed"}],
                    "steps": [],
                    "batch_progress": [],
                    "approvals": [],
                },
                last_pushed_at="2026-08-14T00:00:00Z",
                last_pusher="agent",
            )
        )
        await db_session.commit()

        svc = ChangeService(db_session)
        with _patch_projection(PendingReview.PROPOSAL_REVIEW):
            result = await svc.proposal_review(ws_id, change_id, "approve", "ok", uuid.uuid4())

        row = await _get_progress_row(db_session, ws_id, result["change"].change_key)
        assert row is not None
        assert row.latest_progress is not None
        assert row.latest_progress["project"]["name"] == "keep-me"  # 未丢失既有结构
        assert row.latest_progress["changes"][0]["current_stage"] == "plan"  # 只更新 stage
        assert row.latest_progress["stages"][0]["status"] == "completed"  # completed 保留

    async def test_workspace_isolation(self, db_session: AsyncSession, tmp_path: Path):
        """upsert 按 (workspace_id, change_name) 隔离：异 workspace 同名不互相污染。"""
        from app.modules.workspace.model import Workspace

        ws_a_id, change_a_id = await _setup(db_session, tmp_path, stage="brainstorm")
        # 第二个 workspace 用同名 change_key（workspaces.slug 唯一约束，需独立 slug）
        change_a = await ChangeService(db_session).get(ws_a_id, change_a_id)
        ws_b = Workspace(
            id=uuid.uuid4(),
            name=f"ws-b-{uuid.uuid4().hex[:6]}",
            slug=f"ws-b-{uuid.uuid4().hex[:6]}",
            root_path=str(tmp_path / "ws-b"),
        )
        db_session.add(ws_b)
        await db_session.commit()
        await db_session.refresh(ws_b)
        await _create_test_change(
            db_session,
            workspace_id=ws_b.id,
            change_key=change_a.change_key,
            current_stage="brainstorm",
            path=str(tmp_path / "ws-b" / ".sillyspec" / "changes" / "c" / "t"),
        )

        svc = ChangeService(db_session)
        with _patch_projection(PendingReview.PROPOSAL_REVIEW):
            result = await svc.proposal_review(ws_a_id, change_a_id, "approve", "ok", uuid.uuid4())

        row_a = await _get_progress_row(db_session, ws_a_id, result["change"].change_key)
        row_b = await _get_progress_row(db_session, ws_b.id, change_a.change_key)
        assert row_a is not None
        assert row_a.latest_progress is not None
        assert row_a.latest_progress["changes"][0]["current_stage"] == "plan"
        assert row_b is None  # 异 workspace 不建行（隔离）

    async def test_archive_confirm_still_no_dispatch(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """archive_confirm 本就 Hub 侧记录不派发；task-03 收敛其返回 agent_dispatch 为空。"""
        ws_id, change_id = await _setup(db_session, tmp_path, stage="archive")
        svc = ChangeService(db_session)
        dispatch_mock = AsyncMock()
        with (
            _patch_projection(PendingReview.ARCHIVE_CONFIRM),
            patch("app.modules.change.dispatch.dispatch", new=dispatch_mock),
        ):
            result = await svc.archive_confirm(ws_id, change_id, "确认归档", uuid.uuid4())

        assert result["change"].current_stage == "archive"
        assert result["agent_dispatch"] is None
        dispatch_mock.assert_not_awaited()
        stages = result["change"].stages or {}
        assert stages.get("archive_confirmed", {}).get("confirmed") is True
