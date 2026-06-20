"""``app.modules.ppm.common.fsm`` 单测。

覆盖 task-01 验收：
- ``StateMachine`` 对非法迁移抛 :class:`InvalidTransition` (IllegalTransition 别名)
- ``can_transition`` / ``next_states`` / ``assert_transition`` 行为正确
- 白名单支持 set / dict (含 action) 两种形态
"""

from __future__ import annotations

import pytest

from app.core.errors import InvalidTransition
from app.modules.ppm.common.fsm import (
    IllegalTransition,
    StateMachine,
    assert_transition,
    can_transition,
    next_states,
)

# 问题清单 4 节点审批流的简化白名单 (problem 子域 W3 会完整定义)
_TRANSITIONS_SET: dict[str, set[str]] = {
    "draft": {"submitting"},
    "submitting": {"approving", "rejected"},
    "approving": {"approved", "rejected"},
    "approved": set(),
    "rejected": {"draft"},  # 退回可重新提交
}

# 含 action 的 dict 形态 (参照 change.TRANSITIONS)
_TRANSITIONS_DICT: dict[str, dict[str, list[str]]] = {
    "draft": {"submitting": ["owner"]},
    "submitting": {"approving": ["manager"], "rejected": ["manager"]},
    "approving": {"approved": ["manager"], "rejected": ["manager"]},
    "approved": {},
    "rejected": {"draft": ["owner"]},
}


class TestCanTransition:
    def test_set_allowed(self) -> None:
        assert can_transition("draft", "submitting", _TRANSITIONS_SET)
        assert can_transition("rejected", "draft", _TRANSITIONS_SET)

    def test_set_disallowed(self) -> None:
        assert not can_transition("draft", "approved", _TRANSITIONS_SET)
        assert not can_transition("approved", "draft", _TRANSITIONS_SET)  # 终态

    def test_unknown_current(self) -> None:
        assert not can_transition("unknown", "draft", _TRANSITIONS_SET)

    def test_dict_form(self) -> None:
        assert can_transition("draft", "submitting", _TRANSITIONS_DICT)
        assert not can_transition("draft", "approved", _TRANSITIONS_DICT)


class TestNextStates:
    def test_set(self) -> None:
        nxt = next_states("submitting", _TRANSITIONS_SET)
        assert set(nxt) == {"approving", "rejected"}

    def test_terminal(self) -> None:
        assert next_states("approved", _TRANSITIONS_SET) == []

    def test_unknown(self) -> None:
        assert next_states("ghost", _TRANSITIONS_SET) == []


class TestAssertTransition:
    def test_legal_no_raise(self) -> None:
        assert_transition("draft", "submitting", _TRANSITIONS_SET, entity="problem")

    def test_illegal_raises(self) -> None:
        with pytest.raises(InvalidTransition) as exc_info:
            assert_transition(
                "approved", "draft", _TRANSITIONS_SET, entity="problem", entity_id="p1"
            )
        assert exc_info.value.http_status == 422
        det = exc_info.value.details or {}
        assert det["entity"] == "problem"
        assert det["current_state"] == "approved"
        assert det["target_state"] == "draft"

    def test_illegal_transition_alias_same_class(self) -> None:
        # IllegalTransition 是 InvalidTransition 的别名，捕获应互通
        assert IllegalTransition is InvalidTransition
        with pytest.raises(IllegalTransition):
            assert_transition("approved", "submitting", _TRANSITIONS_SET)


class TestStateMachine:
    def test_legal_transition_advances(self) -> None:
        sm = StateMachine("draft", _TRANSITIONS_SET, entity="problem", entity_id="p1")
        assert sm.current == "draft"
        new = sm.transition("submitting")
        assert new == "submitting"
        assert sm.current == "submitting"

    def test_illegal_transition_raises(self) -> None:
        sm = StateMachine("approved", _TRANSITIONS_SET, entity="problem")
        with pytest.raises(InvalidTransition):
            sm.transition("draft")
        # 非法迁移不改状态
        assert sm.current == "approved"

    def test_can_transition_method(self) -> None:
        sm = StateMachine("submitting", _TRANSITIONS_SET)
        assert sm.can_transition("approving")
        assert not sm.can_transition("approved")  # submitting 不能直接到 approved

    def test_next_states_method(self) -> None:
        sm = StateMachine("rejected", _TRANSITIONS_SET)
        assert set(sm.next_states()) == {"draft"}

    def test_full_flow(self) -> None:
        sm = StateMachine("draft", _TRANSITIONS_SET)
        sm.transition("submitting")
        sm.transition("approving")
        sm.transition("approved")
        assert sm.current == "approved"
        # 终态无可达
        assert sm.next_states() == []
        with pytest.raises(InvalidTransition):
            sm.transition("draft")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
