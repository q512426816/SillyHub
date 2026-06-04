"""Tests for review API schema validation."""

import pytest
from pydantic import ValidationError

from app.modules.change.schema import (
    ChangeRead,
    ChangeSummary,
    HumanTestRequest,
    PlanReviewRequest,
    ProposalReviewRequest,
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
    def test_default_human_gate(self):
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
            human_gate="none",
            archived_at=None,
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
        )
        assert r.human_gate == "none"


class TestChangeSummaryHumanGate:
    def test_default_human_gate(self):
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
            human_gate="need_proposal_review",
            updated_at="2026-01-01T00:00:00Z",
        )
        assert r.human_gate == "need_proposal_review"
