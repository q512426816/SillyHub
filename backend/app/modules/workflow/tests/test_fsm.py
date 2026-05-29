"""Tests for FSM — state machine validation."""

from __future__ import annotations

import pytest

from app.modules.workflow.fsm import (
    CHANGE_TRANSITIONS,
    FSM,
    ChangeFSM,
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
    def test_happy_path(self):
        path = ["draft", "proposed", "reviewed", "approved", "in_progress", "completed", "merged"]
        for i in range(len(path) - 1):
            assert ChangeFSM.can_transition(path[i], path[i + 1]), f"{path[i]} -> {path[i + 1]}"

    def test_rejected_returns_to_draft(self):
        assert ChangeFSM.can_transition("rejected", "draft")

    def test_rejection_from_reviewed(self):
        assert ChangeFSM.can_transition("reviewed", "rejected")

    def test_rejection_from_approved(self):
        assert ChangeFSM.can_transition("approved", "rejected")

    def test_rejection_from_in_progress(self):
        assert ChangeFSM.can_transition("in_progress", "rejected")

    def test_cannot_skip_states(self):
        assert not ChangeFSM.can_transition("draft", "approved")
        assert not ChangeFSM.can_transition("draft", "in_progress")
        assert not ChangeFSM.can_transition("proposed", "in_progress")

    def test_merged_is_terminal(self):
        assert ChangeFSM.allowed_transitions("merged") == set()

    def test_all_states_have_entries(self):
        for state in ChangeFSM.valid_states:
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
