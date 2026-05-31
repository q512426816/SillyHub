"""Tests for AgentSpecBundle stage_dispatch extension."""

from app.modules.agent.base import AgentSpecBundle


def test_stage_dispatch_default_values():
    """AgentSpecBundle 不传 stage 字段时，全部使用默认值。"""
    bundle = AgentSpecBundle(
        change_summary="test change",
        task_key="task-01",
        task_title="test task",
    )
    assert bundle.stage_dispatch is False
    assert bundle.change_key is None
    assert bundle.stage is None
    assert bundle.spec_root is None
    assert bundle.step_prompt is None
    assert bundle.read_only is False


def test_stage_dispatch_fields_explicitly_set():
    """AgentSpecBundle 传入 stage 字段时，值正确存储。"""
    bundle = AgentSpecBundle(
        change_summary="test change",
        task_key="task-01",
        task_title="test task",
        stage_dispatch=True,
        change_key="agent-stage-dispatch",
        stage="propose",
        spec_root="/workspace/.sillyspec",
        step_prompt="Write a proposal for this change",
        read_only=True,
    )
    assert bundle.stage_dispatch is True
    assert bundle.change_key == "agent-stage-dispatch"
    assert bundle.stage == "propose"
    assert bundle.spec_root == "/workspace/.sillyspec"
    assert bundle.step_prompt == "Write a proposal for this change"
    assert bundle.read_only is True


def test_stage_dispatch_false_with_stage_fields():
    """stage_dispatch=False 但 stage 字段有值时，对象正常创建（忽略由 adapter 层负责）。"""
    bundle = AgentSpecBundle(
        change_summary="test change",
        task_key="task-01",
        task_title="test task",
        stage_dispatch=False,
        change_key="some-change",
        stage="plan",
    )
    assert bundle.stage_dispatch is False
    assert bundle.change_key == "some-change"  # 值被存储，但不生效
    assert bundle.stage == "plan"


def test_existing_bundle_construction_unchanged():
    """现有代码中 AgentSpecBundle 的最小构造方式不受影响。"""
    # 对应 service.py:695 的调用方式
    bundle = AgentSpecBundle(
        change_summary="Change stage: propose",
        task_key="stage:propose",
        task_title="Stage dispatch: propose",
    )
    assert bundle.stage_dispatch is False
    assert bundle.proposal is None
    assert bundle.allowed_paths == []
