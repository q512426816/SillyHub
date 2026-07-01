"""Tests for stage model alignment — StageEnum, TRANSITIONS, new status enums."""

from app.modules.change.model import (
    TRANSITIONS,
    ChangeStatus,
    StageEnum,
    StageStatus,
    StepStatus,
    can_transition,
)


class TestStageEnumAligned:
    """StageEnum now matches sillyspec STAGE_ORDER exactly."""

    def test_spec_stages_order(self):
        assert [s.value for s in StageEnum.spec_stages()] == [
            "scan",
            "brainstorm",
            "plan",
            "execute",
            "verify",
            "archive",
        ]

    def test_no_hub_stages(self):
        assert not hasattr(StageEnum, "hub_stages")

    def test_no_all_stages(self):
        assert not hasattr(StageEnum, "all_stages")


class TestNewStatusEnums:
    def test_change_status_values(self):
        assert ChangeStatus.ACTIVE.value == "active"
        assert ChangeStatus.ARCHIVED.value == "archived"

    def test_stage_status_values(self):
        assert StageStatus.PENDING.value == "pending"
        assert StageStatus.IN_PROGRESS.value == "in-progress"
        assert StageStatus.COMPLETED.value == "completed"
        assert StageStatus.BLOCKED.value == "blocked"

    def test_step_status_has_waiting(self):
        assert StepStatus.WAITING.value == "waiting"


class TestTransitionsMainline:
    """TRANSITIONS now only contains the 5 mainline edges from stage-contract."""

    def test_mainline(self):
        assert StageEnum.BRAINSTORM in dict(TRANSITIONS[StageEnum.SCAN])
        assert StageEnum.PLAN in dict(TRANSITIONS[StageEnum.BRAINSTORM])
        assert StageEnum.EXECUTE in dict(TRANSITIONS[StageEnum.PLAN])
        assert StageEnum.VERIFY in dict(TRANSITIONS[StageEnum.EXECUTE])
        assert StageEnum.ARCHIVE in dict(TRANSITIONS[StageEnum.VERIFY])

    def test_no_deprecated_stages(self):
        for src in TRANSITIONS:
            assert src.value not in ("propose", "quick", "draft")

    def test_verify_only_archive(self):
        assert set(TRANSITIONS[StageEnum.VERIFY].keys()) == {StageEnum.ARCHIVE}

    def test_can_transition_works(self):
        assert can_transition(StageEnum.SCAN, StageEnum.BRAINSTORM)
        assert can_transition(StageEnum.BRAINSTORM, StageEnum.PLAN)
        assert not can_transition(StageEnum.BRAINSTORM, StageEnum.EXECUTE)
        assert not can_transition(StageEnum.SCAN, StageEnum.ARCHIVE)
