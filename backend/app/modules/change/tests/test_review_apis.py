"""Tests for review API schema validation + service-level review gate.

D-004@v2: review 端点改为基于 stage 完成事件投影推进 —— 校验
StageProjectionService.compute_pending_review 匹配 + 复用
transition_with_dispatch / rerun_stage 推进，不再读写 change.human_gate。
"""

from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidTransition
from app.modules.change.schema import (
    ChangeRead,
    ChangeSummary,
    HumanTestRequest,
    PlanReviewRequest,
    ProposalReviewRequest,
)
from app.modules.change.service import ChangeService
from app.modules.change.tests.test_dispatch import (
    _create_test_change,
    _create_test_workspace,
)


class TestProposalReviewRequest:
    def test_approve(self):
        r = ProposalReviewRequest(decision="approve")
        assert r.decision == "approve"

    def test_revise(self):
        r = ProposalReviewRequest(decision="revise", comment="fix it")
        assert r.decision == "revise"
        assert r.comment == "fix it"

    def test_unclear(self):
        r = ProposalReviewRequest(decision="unclear")
        assert r.decision == "unclear"

    def test_invalid_decision(self):
        with pytest.raises(ValidationError):
            ProposalReviewRequest(decision="invalid")


class TestPlanReviewRequest:
    @pytest.mark.parametrize(
        "decision", ["approve", "replan", "back_to_propose", "back_to_brainstorm"]
    )
    def test_valid_decisions(self, decision):
        r = PlanReviewRequest(decision=decision)
        assert r.decision == decision

    def test_invalid_decision(self):
        with pytest.raises(ValidationError):
            PlanReviewRequest(decision="approve_and_execute")


class TestHumanTestRequest:
    @pytest.mark.parametrize("result", ["pass", "bug", "doc_mismatch"])
    def test_valid_results(self, result):
        r = HumanTestRequest(result=result)
        assert r.result == result

    def test_invalid_result(self):
        with pytest.raises(ValidationError):
            HumanTestRequest(result="failed")


class TestChangeReadHumanGate:
    def test_default_pending_review(self):
        r = ChangeRead(
            id="00000000-0000-0000-0000-000000000000",
            workspace_id="00000000-0000-0000-0000-000000000000",
            change_key="test",
            title="test",
            status="active",
            location="active",
            path=".sillyspec/changes/test",
            affected_components=[],
            change_type=None,
            owner_id=None,
            current_stage="draft",
            archived_at=None,
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
        )
        assert r.pending_review is None


class TestChangeSummaryNoHumanGate:
    def test_construction(self):
        r = ChangeSummary(
            id="00000000-0000-0000-0000-000000000000",
            change_key="test",
            title="test",
            status="active",
            location="active",
            change_type=None,
            affected_components=[],
            owner_id=None,
            current_stage="draft",
            updated_at="2026-01-01T00:00:00Z",
        )
        assert r.current_stage == "draft"


# ── Service-level review gate tests (D-004@v2) ──────────────────────────


def _patch_projection(pending):
    """Patch StageProjectionService.compute_pending_review to return ``pending``.

    Returns an AsyncMock so tests can assert it was awaited.
    """
    mock = AsyncMock(return_value=pending)
    return patch(
        "app.modules.change.service.StageProjectionService.compute_pending_review",
        new=mock,
    ), mock


@pytest.mark.asyncio
class TestReviewGateProjectionGuard:
    """4 端点提交前必须通过 StageProjectionService 校验对应 pending_review。"""

    async def _setup_change(self, session: AsyncSession, tmp_path: Path, *, stage: str):
        ws = await _create_test_workspace(session, root_path=str(tmp_path))
        change = await _create_test_change(
            session,
            workspace_id=ws.id,
            current_stage=stage,
            path=str(tmp_path / ".sillyspec" / "changes" / "c" / "t"),
        )
        return ws.id, change.id

    async def test_proposal_review_mismatch_raises(self, db_session: AsyncSession, tmp_path: Path):
        ws_id, change_id = await self._setup_change(db_session, tmp_path, stage="brainstorm")
        svc = ChangeService(db_session)
        # 投影返回 None（降级 / 无 brainstorm 完成）→ 不匹配 PROPOSAL_REVIEW
        with _patch_projection(None)[0]:
            with pytest.raises(InvalidTransition):
                await svc.proposal_review(ws_id, change_id, "approve", None, uuid.uuid4())

    async def test_plan_review_mismatch_raises(self, db_session: AsyncSession, tmp_path: Path):
        ws_id, change_id = await self._setup_change(db_session, tmp_path, stage="plan")
        svc = ChangeService(db_session)
        with _patch_projection(None)[0]:
            with pytest.raises(InvalidTransition):
                await svc.plan_review(ws_id, change_id, "approve", None, uuid.uuid4())

    async def test_human_test_mismatch_raises(self, db_session: AsyncSession, tmp_path: Path):
        ws_id, change_id = await self._setup_change(db_session, tmp_path, stage="verify")
        svc = ChangeService(db_session)
        with _patch_projection(None)[0]:
            with pytest.raises(InvalidTransition):
                await svc.human_test(ws_id, change_id, "pass", None, uuid.uuid4())

    async def test_archive_confirm_mismatch_raises(self, db_session: AsyncSession, tmp_path: Path):
        ws_id, change_id = await self._setup_change(db_session, tmp_path, stage="archive")
        svc = ChangeService(db_session)
        with _patch_projection(None)[0]:
            with pytest.raises(InvalidTransition):
                await svc.archive_confirm(ws_id, change_id, None, uuid.uuid4())


@pytest.mark.asyncio
class TestReviewGateAdvance:
    """happy path：4 端点提交触发对应 stage 推进 / 归档确认记录。"""

    async def _setup(self, session: AsyncSession, tmp_path: Path, *, stage: str):
        ws = await _create_test_workspace(session, root_path=str(tmp_path))
        change = await _create_test_change(
            session,
            workspace_id=ws.id,
            current_stage=stage,
            path=str(tmp_path / ".sillyspec" / "changes" / "c" / "t"),
        )
        return ws.id, change.id

    async def test_proposal_review_approve_advances_to_plan(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        from app.modules.change.schema import PendingReview

        ws_id, change_id = await self._setup(db_session, tmp_path, stage="brainstorm")
        svc = ChangeService(db_session)
        with (
            _patch_projection(PendingReview.PROPOSAL_REVIEW)[0],
            patch("app.core.db.get_session_factory") as factory_mock,
            patch(
                "app.modules.change.dispatch.dispatch",
                new=AsyncMock(return_value={"dispatched": True, "stage": "plan"}),
            ),
        ):
            # dispatch uses an independent session from the factory.
            factory_mock.return_value.return_value.__aenter__ = AsyncMock(return_value=db_session)
            factory_mock.return_value.return_value.__aexit__ = AsyncMock(return_value=None)
            result = await svc.proposal_review(ws_id, change_id, "approve", "ok", uuid.uuid4())
        assert result["change"].current_stage == "plan"
        assert result["agent_dispatch"].get("dispatched") is True

    async def test_plan_review_approve_advances_to_execute(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        from app.modules.change.schema import PendingReview

        ws_id, change_id = await self._setup(db_session, tmp_path, stage="plan")
        svc = ChangeService(db_session)
        with (
            _patch_projection(PendingReview.PLAN_REVIEW)[0],
            patch("app.core.db.get_session_factory") as factory_mock,
            patch(
                "app.modules.change.dispatch.dispatch",
                new=AsyncMock(return_value={"dispatched": True, "stage": "execute"}),
            ),
        ):
            factory_mock.return_value.return_value.__aenter__ = AsyncMock(return_value=db_session)
            factory_mock.return_value.return_value.__aexit__ = AsyncMock(return_value=None)
            result = await svc.plan_review(ws_id, change_id, "approve", None, uuid.uuid4())
        assert result["change"].current_stage == "execute"

    async def test_human_test_pass_advances_to_archive(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        from app.modules.change.schema import PendingReview

        ws_id, change_id = await self._setup(db_session, tmp_path, stage="verify")
        svc = ChangeService(db_session)
        with (
            _patch_projection(PendingReview.HUMAN_TEST)[0],
            patch("app.core.db.get_session_factory") as factory_mock,
            patch(
                "app.modules.change.dispatch.dispatch",
                new=AsyncMock(return_value={"dispatched": True, "stage": "archive"}),
            ),
        ):
            factory_mock.return_value.return_value.__aenter__ = AsyncMock(return_value=db_session)
            factory_mock.return_value.return_value.__aexit__ = AsyncMock(return_value=None)
            result = await svc.human_test(ws_id, change_id, "pass", None, uuid.uuid4())
        assert result["change"].current_stage == "archive"

    async def test_archive_confirm_records_hub_side(self, db_session: AsyncSession, tmp_path: Path):
        from app.modules.change.schema import PendingReview

        ws_id, change_id = await self._setup(db_session, tmp_path, stage="archive")
        svc = ChangeService(db_session)
        with _patch_projection(PendingReview.ARCHIVE_CONFIRM)[0]:
            result = await svc.archive_confirm(ws_id, change_id, "confirmed", uuid.uuid4())
        # Hub 侧仅记录，不 dispatch、不改 current_stage
        assert result["agent_dispatch"]["dispatched"] is False
        assert result["change"].current_stage == "archive"
        stages = result["change"].stages or {}
        assert stages.get("archive_confirmed", {}).get("confirmed") is True
        # review_history 记录
        assert any(r.get("decision") == "archive_confirm" for r in stages.get("review_history", []))


@pytest.mark.asyncio
class TestReviewMethodsNoHumanGate:
    """grep 守卫：4 review 方法不再读写 change.human_gate（DB 行保持默认）。"""

    async def test_no_human_gate_write_on_proposal_review(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        from app.modules.change.schema import PendingReview

        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="brainstorm",
            path=str(tmp_path / ".sillyspec" / "changes" / "c" / "t"),
        )
        original_gate = getattr(change, "human_gate", None)
        svc = ChangeService(db_session)
        with (
            _patch_projection(PendingReview.PROPOSAL_REVIEW)[0],
            patch("app.core.db.get_session_factory") as factory_mock,
            patch(
                "app.modules.change.dispatch.dispatch",
                new=AsyncMock(return_value={"dispatched": False, "reason": "test"}),
            ),
        ):
            factory_mock.return_value.return_value.__aenter__ = AsyncMock(return_value=db_session)
            factory_mock.return_value.return_value.__aexit__ = AsyncMock(return_value=None)
            await svc.proposal_review(ws.id, change.id, "approve", None, uuid.uuid4())
        await db_session.refresh(change)
        # SC-3 守卫：human_gate 列已删（D-001），review 方法不应创建/写它
        assert getattr(change, "human_gate", None) == original_gate
