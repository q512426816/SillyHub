"""Tests for complete_stage + _resolve_stage_completion after W2 remap.

After task-01 removed HumanGate and task-04 remapped, _resolve_stage_completion
returns a 2-tuple (new_stage, dispatch_target). propose/quick/blocked/draft are
no longer part of the mainline mapping.
"""

from __future__ import annotations

import pytest

from app.modules.change.service import ChangeService


class TestResolveStageCompletion:
    """_resolve_stage_completion returns (new_stage, dispatch_target) 2-tuple."""

    @pytest.mark.parametrize(
        "stage, result, expected_stage, expected_dispatch",
        [
            # brainstorm mainline: clear → dispatch plan
            ("brainstorm", "clear", "plan", "plan"),
            ("brainstorm", None, "plan", "plan"),
            # brainstorm ambiguous → stay (no dispatch)
            ("brainstorm", "ambiguous", "brainstorm", None),
            # plan → dispatch execute
            ("plan", None, "execute", "execute"),
            # execute → dispatch verify
            ("execute", None, "verify", "verify"),
            # verify passed → dispatch archive
            ("verify", "passed", "archive", "archive"),
            # verify not passed → stay verify (no dispatch, await human)
            ("verify", None, "verify", None),
            ("verify", "failed", "verify", None),
            # archive → terminal archived (no dispatch)
            ("archive", None, "archived", None),
        ],
    )
    def test_mapping(self, stage, result, expected_stage, expected_dispatch):
        new_stage, dispatch_target = ChangeService._resolve_stage_completion(stage, result)
        assert new_stage == expected_stage
        assert dispatch_target == expected_dispatch

    def test_unknown_stage_no_change(self):
        # Unknown stage returns identity (no change)
        new_stage, dispatch_target = ChangeService._resolve_stage_completion("unknown", None)
        assert new_stage == "unknown"
        assert dispatch_target is None

    def test_scan_stays(self):
        # scan is auxiliary — completion stays scan
        new_stage, _dispatch_target = ChangeService._resolve_stage_completion("scan", None)
        assert new_stage == "scan"
