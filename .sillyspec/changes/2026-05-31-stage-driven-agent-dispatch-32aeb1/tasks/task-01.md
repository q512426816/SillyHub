---
author: hermes
created_at: "2026-05-31T16:20:00Z"
---

# Task 01: 创建 StageAgentConfig 数据类和阶段配置表

## 目标

创建阶段→Agent 派发配置的数据结构和常量表。

## 实现细节

1. 创建文件 `backend/app/modules/change/dispatch.py`
2. 定义 `StageAgentConfig` dataclass:
   ```python
   @dataclass
   class StageAgentConfig:
       enabled: bool
       prompt_template: str    # prompts/ 下的模板名（不含扩展名）
       phase: str               # agent 工作阶段标识
       requires_worktree: bool  # 是否需要创建 worktree lease
       description: str         # 人类可读描述
   ```
3. 定义 `STAGE_AGENT_CONFIG` 字典，映射 6 个需要 agent 的阶段:
   - clarifying: enabled=True, prompt="clarifying", phase="clarify", requires_worktree=False
   - design_review: enabled=True, prompt="design_review", phase="design", requires_worktree=False
   - ready_for_dev: enabled=True, prompt="plan_tasks", phase="plan", requires_worktree=False
   - in_dev: enabled=True, prompt="execute_task", phase="execute", requires_worktree=True
   - technical_verification: enabled=True, prompt="verify", phase="verify", requires_worktree=True
   - business_review: enabled=True, prompt="review", phase="review", requires_worktree=False

## 验证

- 文件存在且无语法错误
- `STAGE_AGENT_CONFIG` 包含 6 个阶段配置
- 每个 config 的字段类型正确
