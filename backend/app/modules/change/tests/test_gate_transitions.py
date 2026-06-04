"""Tests for human_gate transitions and resolve_human_gate."""

from app.modules.change.model import TRANSITIONS, HumanGate, StageEnum
from app.modules.change.service import resolve_human_gate


class TestHumanGateEnum:
    def test_all_values(self):
        expected = {
            "none",
            "need_requirement_input",
            "need_proposal_review",
            "need_plan_review",
            "need_human_test",
            "need_archive_confirm",
            "blocked",
        }
        assert {g.value for g in HumanGate} == expected


class TestResolveHumanGate:
    def test_brainstorm(self):
        assert resolve_human_gate("brainstorm") == "need_requirement_input"

    def test_propose(self):
        assert resolve_human_gate("propose") == "need_proposal_review"

    def test_plan(self):
        assert resolve_human_gate("plan") == "need_plan_review"

    def test_verify(self):
        assert resolve_human_gate("verify") == "need_human_test"

    def test_archive(self):
        assert resolve_human_gate("archive") == "need_archive_confirm"

    def test_execute_returns_none(self):
        assert resolve_human_gate("execute") == "none"

    def test_draft_returns_none(self):
        assert resolve_human_gate("draft") == "none"

    def test_quick_returns_none(self):
        assert resolve_human_gate("quick") == "none"

    def test_unknown_returns_none(self):
        assert resolve_human_gate("unknown_stage") == "none"


class TestTransitionsTable:
    def test_no_legacy_enum_members(self):
        member_names = {m.name for m in StageEnum}
        assert "REWORK_REQUIRED" not in member_names
        assert "ACCEPTED" not in member_names

    def test_verify_exits(self):
        verify_targets = set(TRANSITIONS[StageEnum.VERIFY].keys())
        assert verify_targets == {StageEnum.QUICK, StageEnum.ARCHIVE, StageEnum.BLOCKED}

    def test_quick_exits(self):
        quick_targets = set(TRANSITIONS[StageEnum.QUICK].keys())
        assert quick_targets == {StageEnum.VERIFY, StageEnum.BLOCKED}

    def test_blocked_exits(self):
        blocked_targets = set(TRANSITIONS[StageEnum.BLOCKED].keys())
        assert blocked_targets == {StageEnum.PROPOSE, StageEnum.PLAN, StageEnum.EXECUTE}

    def test_archived_is_terminal(self):
        assert TRANSITIONS[StageEnum.ARCHIVED] == {}

    def test_draft_exits(self):
        draft_targets = set(TRANSITIONS[StageEnum.DRAFT].keys())
        assert draft_targets == {StageEnum.BRAINSTORM, StageEnum.SCAN}
