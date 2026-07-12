"""Tests for render_worker_prompt worktree 协作约束（task-04）。

设计依据：2026-07-12-worker-worktree-isolation design §5.1 步骤4 +
D-002@v1（worker 只写代码不跑测试，验证留 converge 后）+ D-003@v1
（converge 走分支合并，worker 必 git commit 为合并提供 commit）。

render_worker_prompt 是纯函数（只读 run.role / run.objective），
无需 DB session，直接构造 AgentRun 实例即可。
"""

from __future__ import annotations

from app.modules.agent.execution import render_worker_prompt
from app.modules.agent.model import AgentRun


def _make_run(*, role: str | None = "worker", objective: str | None = "实现登录接口") -> AgentRun:
    """构造一个不入库的 AgentRun（render_worker_prompt 只读 role/objective）。"""
    return AgentRun(
        agent_type="claude_code",
        provider="claude",
        status="pending",
        role=role,
        objective=objective,
        spec_strategy="oneshot",
    )


class TestRenderWorkerPromptConstraints:
    """task-04：worker prompt 末尾追加三条 worktree 协作约束。"""

    def test_prompt_contains_no_test_build_constraint(self) -> None:
        """约束①：只写代码，不跑测试/构建（副本缺 node_modules/.venv，D-002@v1）。"""
        prompt = render_worker_prompt(_make_run())
        assert "不跑测试" in prompt
        # 明确"验证留 converge 后统一跑"的语义在场（R-01 兜底）
        assert "converge" in prompt or "合并后" in prompt or "主" in prompt

    def test_prompt_contains_git_add_and_commit_constraint(self) -> None:
        """约束②：完成后必须 git add -A && git commit（D-003@v1 分支合并需要 commit）。"""
        prompt = render_worker_prompt(_make_run())
        assert "git add" in prompt
        assert "git commit" in prompt

    def test_prompt_contains_file_division_constraint(self) -> None:
        """约束③：按文件分工减少 converge 冲突（主 agent 派发时已指示分工）。"""
        prompt = render_worker_prompt(_make_run())
        assert "分工" in prompt

    def test_prompt_preserves_role_and_objective(self) -> None:
        """既有 prompt 内容不丢：role + objective 渲染仍在。"""
        prompt = render_worker_prompt(_make_run(role="impl", objective="写后端 /login 路由"))
        assert "impl" in prompt
        assert "写后端 /login 路由" in prompt
        # 原结构化摘要要求仍在（不是被约束段整个替换）
        assert "结构化摘要" in prompt

    def test_prompt_handles_missing_role_objective(self) -> None:
        """role/objective 缺省时不崩，约束段照常追加（既有兜底逻辑保留）。"""
        prompt = render_worker_prompt(_make_run(role=None, objective=None))
        # 既有兜底
        assert "worker" in prompt
        assert "未指定目标" in prompt
        # 约束三件套仍在
        assert "不跑测试" in prompt
        assert "git add" in prompt
        assert "git commit" in prompt
        assert "分工" in prompt
