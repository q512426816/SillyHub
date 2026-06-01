"""Tests for FSM — state machine validation."""

from __future__ import annotations

import warnings

import pytest

from app.modules.workflow.fsm import (
    CHANGE_TRANSITIONS,
    FSM,
    TaskFSM,
    TransitionError,
)


class TestFSM:
    def test_can_transition_valid(self):
        fsm = FSM("test", {"a": {"b"}, "b": {"c"}})
        assert fsm.can_transition("a", "b")
        assert fsm.can_transition("b", "c")

    def test_cannot_transition_invalid(self):
        fsm = FSM("test", {"a": {"b"}})
        assert not fsm.can_transition("a", "c")

    def test_validate_transition_success(self):
        fsm = FSM("test", {"a": {"b"}})
        fsm.validate_transition("a", "b")  # no error

    def test_validate_transition_raises(self):
        fsm = FSM("test", {"a": {"b"}})
        with pytest.raises(TransitionError) as exc_info:
            fsm.validate_transition("a", "c")
        assert exc_info.value.details["current"] == "a"
        assert exc_info.value.details["target"] == "c"

    def test_valid_states(self):
        fsm = FSM("test", {"a": {"b"}, "b": {"c"}})
        assert fsm.valid_states == {"a", "b", "c"}

    def test_allowed_transitions(self):
        fsm = FSM("test", {"a": {"b", "c"}})
        assert fsm.allowed_transitions("a") == {"b", "c"}
        assert fsm.allowed_transitions("b") == set()


class TestChangeFSM:
    """ChangeFSM is deprecated — kept for backward compat, tested under deprecation warning."""

    @pytest.fixture(autouse=True)
    def _import_deprecated(self):
        """Import ChangeFSM which triggers a DeprecationWarning."""
        from app.modules.workflow.fsm import ChangeFSM as _ChangeFSM
        self.ChangeFSM = _ChangeFSM

    def test_happy_path(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            path = ["draft", "proposed", "reviewed", "approved", "in_progress", "completed", "merged"]
            for i in range(len(path) - 1):
                assert self.ChangeFSM.can_transition(path[i], path[i + 1]), f"{path[i]} -> {path[i + 1]}"

    def test_rejected_returns_to_draft(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            assert self.ChangeFSM.can_transition("rejected", "draft")

    def test_rejection_from_reviewed(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            assert self.ChangeFSM.can_transition("reviewed", "rejected")

    def test_rejection_from_approved(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            assert self.ChangeFSM.can_transition("approved", "rejected")

    def test_rejection_from_in_progress(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            assert self.ChangeFSM.can_transition("in_progress", "rejected")

    def test_cannot_skip_states(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            assert not self.ChangeFSM.can_transition("draft", "approved")
            assert not self.ChangeFSM.can_transition("draft", "in_progress")
            assert not self.ChangeFSM.can_transition("proposed", "in_progress")

    def test_merged_is_terminal(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            assert self.ChangeFSM.allowed_transitions("merged") == set()

    def test_all_states_have_entries(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            for state in self.ChangeFSM.valid_states:
                assert state in CHANGE_TRANSITIONS or state in {
                    dst for dsts in CHANGE_TRANSITIONS.values() for dst in dsts
                }


class TestTaskFSM:
    def test_happy_path(self):
        path = ["draft", "ready", "in_progress", "review", "done"]
        for i in range(len(path) - 1):
            assert TaskFSM.can_transition(path[i], path[i + 1]), f"{path[i]} -> {path[i + 1]}"

    def test_blocked_loop(self):
        assert TaskFSM.can_transition("in_progress", "blocked")
        assert TaskFSM.can_transition("blocked", "in_progress")

    def test_cancel_from_multiple_states(self):
        for state in ("ready", "in_progress", "blocked"):
            assert TaskFSM.can_transition(state, "cancelled"), f"{state} -> cancelled"

    def test_review_can_go_back(self):
        assert TaskFSM.can_transition("review", "in_progress")

    def test_done_is_terminal(self):
        assert TaskFSM.allowed_transitions("done") == set()

    def test_cancelled_is_terminal(self):
        assert TaskFSM.allowed_transitions("cancelled") == set()
