"""Tests for human_gate transitions and resolve_human_gate."""

import pytest

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
    """AD-01: resolve_human_gate always returns none after task-01."""

    @pytest.mark.parametrize(
        "stage",
        [
            "brainstorm",
            "propose",
            "plan",
            "verify",
            "archive",
            "execute",
            "quick",
            "scan",
            "draft",
            "unknown_stage",
        ],
    )
    def test_always_returns_none(self, stage):
        assert resolve_human_gate(stage) == HumanGate.NONE


class TestTransitionsTable:
    def test_no_legacy_enum_members(self):
        member_names = {m.name for m in StageEnum}
        assert "REWORK_REQUIRED" not in member_names
        assert "ACCEPTED" not in member_names

    def test_verify_exits(self):
        verify_targets = set(TRANSITIONS[StageEnum.VERIFY].keys())
        assert verify_targets == {
            StageEnum.QUICK,
            StageEnum.ARCHIVE,
            StageEnum.BLOCKED,
            StageEnum.PROPOSE,
        }

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
