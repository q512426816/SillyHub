---
id: task-03
title: 补齐 STAGE_AGENT_CONFIG 阶段配置
priority: P0
estimated_hours: 2
depends_on: []
blocks: [task-05, task-17]
allowed_paths:
  - backend/app/modules/change/dispatch.py
author: qinyi
created_at: 2026-06-01 18:30:00
---

# task-03: 补齐 STAGE_AGENT_CONFIG 阶段配置

## 修改文件
- `backend/app/modules/change/dispatch.py`

## 当前状态分析

### 现有 STAGE_AGENT_CONFIG（6 个条目，字符串键）

```python
STAGE_AGENT_CONFIG: dict[str, StageAgentConfig] = {
    "propose": StageAgentConfig(enabled=True, prompt_template="clarifying.md", phase="Proposal / Clarification", requires_worktree=False, read_only=True, description="Review change proposal and identify ambiguities; produce clarifying questions."),
    "plan": StageAgentConfig(enabled=True, prompt_template="plan_tasks.md", phase="Task Planning", requires_worktree=False, read_only=True, description="Break down the change into concrete implementation tasks."),
    "execute": StageAgentConfig(enabled=True, prompt_template="execute_task.md", phase="Task Execution", requires_worktree=True, read_only=False, description="Implement the assigned task within the change worktree."),
    "verify": StageAgentConfig(enabled=True, prompt_template="verify.md", phase="Technical Verification", requires_worktree=True, read_only=False, description="Run verification checks against the implementation in the worktree."),
    "brainstorm": StageAgentConfig(enabled=True, prompt_template="design_review.md", phase="Brainstorm / Design Review", requires_worktree=False, read_only=True, description="Analyze change design docs for completeness, consistency, and risk."),
    "scan": StageAgentConfig(enabled=True, prompt_template="review.md", phase="Scan / Review", requires_worktree=False, read_only=True, description="Summarize the change for review, highlighting risks and impact."),
}
```

### 问题清单

| # | 问题 | 修复 |
|---|------|------|
| 1 | 缺少 `archive` 阶段配置 | 新增条目 |
| 2 | 缺少 `quick` 阶段配置 | 新增条目 |
| 3 | `propose` 的 `read_only=True` 错误 | 改为 `read_only=False` |
| 4 | `plan` 的 `read_only=True` 错误 | 改为 `read_only=False` |
| 5 | `scan` 的 `read_only=True` 错误（需写扫描文档） | 改为 `read_only=False` |
| 6 | `brainstorm` 的 `requires_worktree=False` 错误 | 改为 `requires_worktree=True` |
| 7 | `verify` 的 `requires_worktree=True` 正确但需确认 | 保持 |
| 8 | 键为字符串字面量 | 改为 `StageEnum.XXX.value` |
| 9 | 需在文件顶部 import StageEnum | 新增 import |

## 实现要求

根据 design.md Phase 3 配置表，修改 `STAGE_AGENT_CONFIG` 为以下完整版本：

### Step 1: 新增 import

在 `dispatch.py` 文件顶部的 import 区域，添加：

```python
from app.modules.change.model import Change, StageEnum
```

注意：`Change` 已在 `dispatch()` 函数内部通过局部 import 引入。本步骤将其提升为模块级 import（与 `StageEnum` 一并），同时删除 `dispatch()` 函数内的 `from app.modules.change.model import Change` 局部 import。

### Step 2: 替换整个 STAGE_AGENT_CONFIG

将现有的 `STAGE_AGENT_CONFIG` 字典（第 42-91 行）替换为以下内容：

```python
STAGE_AGENT_CONFIG: dict[str, StageAgentConfig] = {
    StageEnum.SCAN.value: StageAgentConfig(
        enabled=True,
        prompt_template="scan.md",
        phase="Scan",
        requires_worktree=False,
        read_only=False,
        description="Write scan documents to .sillyspec/docs/.",
    ),
    StageEnum.BRAINSTORM.value: StageAgentConfig(
        enabled=True,
        prompt_template="brainstorm.md",
        phase="Brainstorm",
        requires_worktree=True,
        read_only=False,
        description="Write question lists and decision records to change directory.",
    ),
    StageEnum.PROPOSE.value: StageAgentConfig(
        enabled=True,
        prompt_template="propose.md",
        phase="Propose",
        requires_worktree=True,
        read_only=False,
        description="Write the four-piece proposal set to change directory.",
    ),
    StageEnum.PLAN.value: StageAgentConfig(
        enabled=True,
        prompt_template="plan.md",
        phase="Plan",
        requires_worktree=True,
        read_only=False,
        description="Write plan.md and task blueprints.",
    ),
    StageEnum.EXECUTE.value: StageAgentConfig(
        enabled=True,
        prompt_template="execute.md",
        phase="Execute",
        requires_worktree=True,
        read_only=False,
        description="Implement tasks; must use worktree.",
    ),
    StageEnum.VERIFY.value: StageAgentConfig(
        enabled=True,
        prompt_template="verify.md",
        phase="Verify",
        requires_worktree=True,
        read_only=False,
        description="Write verify-result.md and run verification checks.",
    ),
    StageEnum.ARCHIVE.value: StageAgentConfig(
        enabled=True,
        prompt_template="archive.md",
        phase="Archive",
        requires_worktree=True,
        read_only=False,
        description="Write module-impact analysis and move change directory to archive.",
    ),
    StageEnum.QUICK.value: StageAgentConfig(
        enabled=True,
        prompt_template="quick.md",
        phase="Quick",
        requires_worktree=True,
        read_only=False,
        description="Write quicklog and may modify code directly.",
    ),
}
```

### Step 3: 清理 dispatch() 函数内的局部 import

删除 `dispatch()` 函数内部（约第 139 行）的：

```python
from app.modules.change.model import Change
```

因为已在文件顶部 import。

## 接口定义

### 完整的 STAGE_AGENT_CONFIG — 8 个条目详细配置值

| # | 阶段键（StageEnum.XXX.value） | enabled | prompt_template | phase | requires_worktree | read_only | description |
|---|------|---------|-----------------|-------|-------------------|-----------|-------------|
| 1 | `StageEnum.SCAN.value` → `"scan"` | `True` | `"scan.md"` | `"Scan"` | `False` | `False` | Write scan documents to .sillyspec/docs/. |
| 2 | `StageEnum.BRAINSTORM.value` → `"brainstorm"` | `True` | `"brainstorm.md"` | `"Brainstorm"` | `True` | `False` | Write question lists and decision records to change directory. |
| 3 | `StageEnum.PROPOSE.value` → `"propose"` | `True` | `"propose.md"` | `"Propose"` | `True` | `False` | Write the four-piece proposal set to change directory. |
| 4 | `StageEnum.PLAN.value` → `"plan"` | `True` | `"plan.md"` | `"Plan"` | `True` | `False` | Write plan.md and task blueprints. |
| 5 | `StageEnum.EXECUTE.value` → `"execute"` | `True` | `"execute.md"` | `"Execute"` | `True` | `False` | Implement tasks; must use worktree. |
| 6 | `StageEnum.VERIFY.value` → `"verify"` | `True` | `"verify.md"` | `"Verify"` | `True` | `False` | Write verify-result.md and run verification checks. |
| 7 | `StageEnum.ARCHIVE.value` → `"archive"` | `True` | `"archive.md"` | `"Archive"` | `True` | `False` | Write module-impact analysis and move change directory to archive. |
| 8 | `StageEnum.QUICK.value` → `"quick"` | `True` | `"quick.md"` | `"Quick"` | `True` | `False` | Write quicklog and may modify code directly. |

### 与现有值的对比（仅列出有变化的字段）

| 阶段 | 字段 | 旧值 | 新值 | 原因 |
|------|------|------|------|------|
| scan | read_only | True | **False** | FR-04: scan 需写扫描文档 |
| scan | prompt_template | "review.md" | **"scan.md"** | 对应 sillyspec scan 命令 |
| scan | phase | "Scan / Review" | **"Scan"** | 阶段名称简化 |
| scan | description | "Summarize the change..." | **"Write scan documents to .sillyspec/docs/."** | 匹配实际行为 |
| brainstorm | requires_worktree | False | **True** | design.md Phase 3: 写入 change 目录 |
| brainstorm | read_only | True | **False** | design.md Phase 3 |
| brainstorm | prompt_template | "design_review.md" | **"brainstorm.md"** | 对应 sillyspec brainstorm 命令 |
| brainstorm | phase | "Brainstorm / Design Review" | **"Brainstorm"** | 阶段名称简化 |
| brainstorm | description | "Analyze change design docs..." | **"Write question lists and decision records to change directory."** | 匹配实际行为 |
| propose | read_only | True | **False** | FR-04 修正 |
| propose | prompt_template | "clarifying.md" | **"propose.md"** | 对应 sillyspec propose 命令 |
| propose | phase | "Proposal / Clarification" | **"Propose"** | 阶段名称简化 |
| propose | requires_worktree | False | **True** | design.md Phase 3 |
| propose | description | "Review change proposal..." | **"Write the four-piece proposal set to change directory."** | 匹配实际行为 |
| plan | read_only | True | **False** | FR-04 修正 |
| plan | prompt_template | "plan_tasks.md" | **"plan.md"** | 对应 sillyspec plan 命令 |
| plan | phase | "Task Planning" | **"Plan"** | 阶段名称简化 |
| plan | description | "Break down the change..." | **"Write plan.md and task blueprints."** | 匹配实际行为 |
| execute | prompt_template | "execute_task.md" | **"execute.md"** | 命名统一 |
| execute | phase | "Task Execution" | **"Execute"** | 阶段名称简化 |
| execute | description | "Implement the assigned task..." | **"Implement tasks; must use worktree."** | 匹配实际行为 |
| verify | phase | "Technical Verification" | **"Verify"** | 阶段名称简化 |
| verify | description | "Run verification checks..." | **"Write verify-result.md and run verification checks."** | 匹配实际行为 |
| archive | — | **不存在** | 新增 | design.md Phase 3 |
| quick | — | **不存在** | 新增 | design.md Phase 3 |

## 边界处理

1. **StageEnum 中不存在的阶段值**：不应出现在配置中。`STAGE_AGENT_CONFIG` 只包含 `StageEnum` 的 8 个 SillySpec 主阶段（SCAN/BRAINSTORM/PROPOSE/PLAN/EXECUTE/VERIFY/ARCHIVE/QUICK），不包含 Hub 扩展阶段（DRAFT/REWORK_REQUIRED/ACCEPTED）。
2. **兼容旧代码读取 STAGE_AGENT_CONFIG**：键值不变（仍为字符串，如 `"scan"`），只是用 `StageEnum.SCAN.value` 常量引用而非硬编码字符串。`dict` 的类型注解仍为 `dict[str, StageAgentConfig]`，外部通过字符串键读取的行为不受影响。
3. **未配置阶段的 dispatch 请求**：`get_config_for_stage()` 返回 `None`，`dispatch()` 函数返回 `{"dispatched": False, "reason": "no_config_for_stage:<stage>"}`。此行为已在现有代码中实现，无需修改。
4. **read_only 标记与实际阶段行为一致**：所有 8 个阶段均标记为 `read_only=False`，因为每个阶段都需要写入文件（扫描文档、变更目录、代码等）。这与 design.md Phase 3 配置表一致。
5. **enabled=False 的阶段不应 dispatch**：`dispatch()` 函数中 `if config is None or not config.enabled` 已处理此情况。当前所有 8 个阶段均为 `enabled=True`。
6. **prompt_template 文件不存在时的 fallback**：`load_prompt_template()` 已有 `FileNotFoundError` 处理，返回空字符串并记录 warning。新增的 template 文件名（如 `scan.md`）如果不存在不会导致崩溃。

## 非目标

- 不修改 `StageEnum` 枚举值（已在其他变更中统一）
- 不修改 `TRANSITIONS` 流转图
- 不修改 `StageAgentConfig` dataclass 的字段定义
- 不创建 prompt template 文件（由其他任务负责）
- 不修改 `dispatch()` 函数的业务逻辑
- 不修改 `get_config_for_stage()`、`has_active_run()` 等辅助函数

## 参考

- design.md Phase 3 的配置表（第 200-210 行）
- requirements.md FR-04（第 54-68 行）
- `backend/app/modules/change/model.py` 第 19-30 行：StageEnum 定义
- `backend/app/modules/change/dispatch.py` 第 42-91 行：现有 STAGE_AGENT_CONFIG

## TDD 步骤

1. **写测试**：在 `backend/tests/modules/change/test_dispatch.py` 中编写测试，验证：
   - `len(STAGE_AGENT_CONFIG) == 8`
   - 所有 8 个阶段键存在（scan/brainstorm/propose/plan/execute/verify/archive/quick）
   - 每个键 == `StageEnum.XXX.value`
   - propose 的 `read_only == False`
   - plan 的 `read_only == False`
   - archive 的 `requires_worktree == True`
   - quick 的 `requires_worktree == True`
   - scan 的 `read_only == False`
2. **确认失败**：运行测试，确认因缺少 archive/quick、read_only 错误等而失败
3. **补齐配置**：按上述 Step 1-3 修改 dispatch.py
4. **确认通过**：运行测试，全部通过
5. **验证 read_only 标记**：确认所有 8 个阶段的 `read_only == False`（与 design.md Phase 3 一致）

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | `len(STAGE_AGENT_CONFIG)` | == 8 |
| AC-02 | `STAGE_AGENT_CONFIG[StageEnum.PROPOSE.value].read_only` | == False |
| AC-03 | `STAGE_AGENT_CONFIG[StageEnum.PLAN.value].read_only` | == False |
| AC-04 | `STAGE_AGENT_CONFIG[StageEnum.ARCHIVE.value].requires_worktree` | == True |
| AC-05 | `STAGE_AGENT_CONFIG[StageEnum.QUICK.value].requires_worktree` | == True |
| AC-06 | `STAGE_AGENT_CONFIG[StageEnum.SCAN.value].read_only` | == False |
| AC-07 | 所有键 == `StageEnum.XXX.value` | `set(STAGE_AGENT_CONFIG.keys()) == {e.value for e in StageEnum.spec_stages()}` 通过 |
| AC-08 | 所有 8 个阶段的 `enabled` | == True |
| AC-09 | 所有 8 个阶段的 `read_only` | == False |
| AC-10 | dispatch.py 文件语法正确 | `python -c "from app.modules.change.dispatch import STAGE_AGENT_CONFIG"` 无报错 |
