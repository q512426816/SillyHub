"""plan 子域里程碑明细状态机单测 (task-04 验收)。

覆盖 task-04.md 验收:
- 草稿→审核→审批→完成 全主流程
- 驳回 (review→rejected / approve→rejected)
- 返工 (rejected→draft)
- 非法迁移抛 InvalidTransition (422)
- 终态 done/archived 不再迁移
"""

from __future__ import annotations

import pytest

from app.core.errors import InvalidTransition
from app.modules.ppm.common.fsm import StateMachine
from app.modules.ppm.plan.fsm import TRANSITIONS, PlanNodeDetailStatus

_S = PlanNodeDetailStatus


class TestForwardFlow:
    def test_full_main_flow(self) -> None:
        sm = StateMachine(_S.DRAFT, TRANSITIONS, entity="ps_plan_node_detail")
        assert sm.current == _S.DRAFT
        sm.transition(_S.REVIEW)
        sm.transition(_S.APPROVE)
        sm.transition(_S.DONE)
        assert sm.current == _S.DONE
        # 终态无可达
        assert sm.next_states() == []

    def test_draft_only_to_review(self) -> None:
        sm = StateMachine(_S.DRAFT, TRANSITIONS)
        assert sm.can_transition(_S.REVIEW)
        assert not sm.can_transition(_S.APPROVE)
        assert not sm.can_transition(_S.DONE)


class TestRejectAndRework:
    def test_review_can_reject(self) -> None:
        sm = StateMachine(_S.REVIEW, TRANSITIONS)
        assert sm.can_transition(_S.REJECTED)
        sm.transition(_S.REJECTED)
        assert sm.current == _S.REJECTED

    def test_approve_can_reject(self) -> None:
        sm = StateMachine(_S.APPROVE, TRANSITIONS)
        assert sm.can_transition(_S.REJECTED)

    def test_rejected_can_back_to_draft(self) -> None:
        sm = StateMachine(_S.REJECTED, TRANSITIONS)
        assert sm.can_transition(_S.DRAFT)
        sm.transition(_S.DRAFT)
        assert sm.current == _S.DRAFT

    def test_reject_then_rework_then_complete(self) -> None:
        sm = StateMachine(_S.DRAFT, TRANSITIONS)
        sm.transition(_S.REVIEW)
        sm.transition(_S.REJECTED)
        sm.transition(_S.DRAFT)  # 返工
        sm.transition(_S.REVIEW)
        sm.transition(_S.APPROVE)
        sm.transition(_S.DONE)
        assert sm.current == _S.DONE


class TestIllegalTransition:
    def test_done_to_anything_raises(self) -> None:
        sm = StateMachine(_S.DONE, TRANSITIONS)
        for target in (_S.DRAFT, _S.REVIEW, _S.APPROVE, _S.REJECTED):
            with pytest.raises(InvalidTransition):
                sm.transition(target)

    def test_archived_is_terminal(self) -> None:
        sm = StateMachine(_S.ARCHIVED, TRANSITIONS)
        assert sm.next_states() == []
        with pytest.raises(InvalidTransition):
            sm.transition(_S.DRAFT)

    def test_illegal_transition_http_status(self) -> None:
        sm = StateMachine(_S.DRAFT, TRANSITIONS, entity="ps_plan_node_detail", entity_id="x")
        with pytest.raises(InvalidTransition) as exc:
            sm.transition(_S.DONE)
        assert exc.value.http_status == 422

    def test_illegal_transition_keeps_state(self) -> None:
        sm = StateMachine(_S.REVIEW, TRANSITIONS)
        with pytest.raises(InvalidTransition):
            sm.transition(_S.DONE)  # review 不能直接跳 done
        assert sm.current == _S.REVIEW


class TestStatusValues:
    def test_status_string_values(self) -> None:
        # 确保字符串值与 model.status 列约定一致
        assert _S.DRAFT.value == "draft"
        assert _S.REVIEW.value == "review"
        assert _S.APPROVE.value == "approve"
        assert _S.DONE.value == "done"
        assert _S.REJECTED.value == "rejected"
        assert _S.ARCHIVED.value == "archived"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
