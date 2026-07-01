"""Tests for FSM — state machine validation."""

from __future__ import annotations

import pytest

from app.modules.workflow.fsm import (
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
