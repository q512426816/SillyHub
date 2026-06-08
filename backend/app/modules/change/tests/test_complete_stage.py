"""Tests for complete_stage, _resolve_stage_completion, and rerun_stage."""

import pytest

from app.modules.change.model import HumanGate
from app.modules.change.service import ChangeService


class TestResolveStageCompletion:
    """_resolve_stage_completion static method mapping tests."""

    @pytest.mark.parametrize(
        "stage,result,expected_stage,expected_gate,expected_dispatch",
        [
            ("brainstorm", "clear", "propose", HumanGate.NEED_PROPOSAL_REVIEW, None),
            ("brainstorm", "ambiguous", "brainstorm", HumanGate.NEED_REQUIREMENT_INPUT, None),
            ("brainstorm", None, "propose", HumanGate.NEED_PROPOSAL_REVIEW, None),
            ("propose", None, "propose", HumanGate.NEED_PROPOSAL_REVIEW, None),
            ("plan", None, "plan", HumanGate.NEED_PLAN_REVIEW, None),
            ("execute", None, "verify", HumanGate.NONE, "verify"),
            ("verify", "passed", "verify", HumanGate.NEED_HUMAN_TEST, None),
            ("verify", "failed", "quick", HumanGate.NONE, "quick"),
            ("verify", None, "quick", HumanGate.NONE, "quick"),
            ("quick", None, "verify", HumanGate.NONE, "verify"),
            ("archive", None, "archived", HumanGate.NONE, None),
            ("scan", None, "scan", HumanGate.NONE, None),
        ],
    )
    def test_mapping(self, stage, result, expected_stage, expected_gate, expected_dispatch):
        new_stage, new_gate, dispatch_target = ChangeService._resolve_stage_completion(
            stage, result
        )
        assert new_stage == expected_stage
        assert new_gate == expected_gate
        assert dispatch_target == expected_dispatch
