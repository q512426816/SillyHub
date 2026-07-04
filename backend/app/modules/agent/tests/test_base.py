"""Tests for agent base classes and context builder."""

from __future__ import annotations

from app.modules.agent.base import AgentAdapter, TaskContext


def test_task_context_defaults():
    ctx = TaskContext(change_title="Test Change", task_title="Test Task", task_key="task-01")
    assert ctx.proposal is None
    assert ctx.allowed_paths == []
    assert ctx.denied_paths == []


def test_validate_context_valid():
    ctx = TaskContext(change_title="Change", task_title="Task", task_key="task-01")
    violations = AgentAdapter.validate_context(None, ctx)
    assert violations == []


def test_validate_context_missing_title():
    ctx = TaskContext(change_title="", task_title="", task_key="task-01")
    violations = AgentAdapter.validate_context(None, ctx)
    assert len(violations) == 2


def test_render_claude_md_basic():
    from app.modules.agent.context_builder import render_claude_md

    ctx = TaskContext(
        change_title="Add Auth",
        task_title="Implement JWT",
        task_key="task-01",
    )
    md = render_claude_md(ctx)
    assert "task-01" in md
    assert "Implement JWT" in md
    assert "Add Auth" in md


def test_render_claude_md_with_docs():
    from app.modules.agent.context_builder import render_claude_md

    ctx = TaskContext(
        change_title="Add Auth",
        task_title="Implement JWT",
        task_key="task-02",
        proposal="proposal.md",
        requirements="requirements.md",
        design="design.md",
        plan="plan.md",
    )
    md = render_claude_md(ctx)
    assert "Proposal" in md
    assert "Requirements" in md
    assert "Design" in md
    assert "Plan" in md


def test_render_claude_md_with_paths():
    from app.modules.agent.context_builder import render_claude_md

    ctx = TaskContext(
        change_title="C",
        task_title="T",
        task_key="t1",
        allowed_paths=["src/", "tests/"],
    )
    md = render_claude_md(ctx)
    assert "src/" in md
    assert "tests/" in md
