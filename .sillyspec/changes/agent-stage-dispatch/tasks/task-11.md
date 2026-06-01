---
id: task-11
title: 修复只读路径判断（拼接 workspace root）
priority: P1
estimated_hours: 1
depends_on: [task-04]
blocks: [task-12]
allowed_paths:
  - backend/app/modules/agent/service.py
author: qinyi
created_at: 2026-06-01 19:30:00
---

## 修改文件
- backend/app/modules/agent/service.py

## 问题描述

`start_stage_dispatch()` 方法中（第 544-549 行），当 `requires_worktree=False` 时，代码直接用 `Path(change.path).is_dir()` 判断路径是否为目录：

```python
# 当前代码（第 544-549 行）
else:
    # Read-only: use workspace root or change path
    change_path = Path(change.path)
    if change_path.is_dir():
        work_dir = change_path
    else:
        work_dir = Path(workspace_root)
```

**问题**：`change.path` 存储的是相对路径（如 `.sillyspec/changes/agent-stage-dispatch`），直接调用 `Path(change.path).is_dir()` 会在 Python 进程的当前工作目录下判断，而不是在 workspace root 下判断。进程 cwd 未必是 workspace root，导致 `is_dir()` 始终返回 `False`，所有只读阶段都 fallback 到 `workspace_root`。

## 实现要求

根据 design.md Phase 5"修复只读路径判断"：

1. 在 `start_stage_dispatch()` 方法的 `else` 分支（第 544 行）中，将路径判断修正为拼接 workspace root 后再判断
2. 拼接逻辑：先判断 `change.path` 是否已是绝对路径，如果是则直接使用；否则拼接 `workspace_root`
3. `workspace_root` 已在第 518 行通过 `self._get_workspace_root(workspace_id)` 获取，无需额外查询
4. 确保 `is_dir()` 和后续 `work_dir` 赋值都使用正确的完整路径

## 接口定义

### 修改前

```python
# service.py 第 544-549 行
else:
    # Read-only: use workspace root or change path
    change_path = Path(change.path)
    if change_path.is_dir():
        work_dir = change_path
    else:
        work_dir = Path(workspace_root)
```

### 修改后

```python
else:
    # Read-only: use workspace root or change path
    change_path = Path(change.path)
    if change_path.is_absolute():
        work_dir = change_path
    else:
        work_dir = Path(workspace_root) / change_path
    if not work_dir.is_dir():
        work_dir = Path(workspace_root)
```

### 逻辑说明

1. 先构造 `change_path = Path(change.path)`
2. 如果 `change.path` 已经是绝对路径，直接用作 `work_dir`
3. 否则拼接 `Path(workspace_root) / change.path` 作为 `work_dir`
4. 最终判断 `work_dir.is_dir()`，如果不存在则 fallback 到 `workspace_root`

## 边界处理

1. **`workspace_root` 为 None**：当前 `_get_workspace_root()` 在 workspace 不存在时抛出 `AgentRunError`，调用处在第 518 行已处理，此处 `workspace_root` 保证非 None。无需额外处理。
2. **`change.path` 为 None 或空**：`change.path` 在 Change model 中定义为 `Column(Text, nullable=False)`，数据库层面不允许 NULL。但如果为空字符串，`Path("")` 会解析为当前目录，拼接后仍为 `workspace_root`，行为安全。无需额外处理。
3. **拼接后的路径不存在**：`is_dir()` 返回 `False`，fallback 到 `workspace_root`，不报错。符合预期。
4. **`change.path` 已是绝对路径**：通过 `Path.is_absolute()` 判断，不再重复拼接，直接使用原路径。如果该绝对路径不是目录，仍然 fallback 到 `workspace_root`。
5. **符号链接**：`Path.is_dir()` 默认跟随符号链接（调用底层 `os.path.isdir`），无需特殊处理。
6. **路径含 `..` 穿越**：拼接后的路径可能通过 `..` 穿越 workspace root 边界。此任务不负责路径安全校验（属于安全审计范畴），但建议后续 task 考虑 `Path.resolve()` 后校验是否仍在 workspace root 内。

## 非目标

- 不修改工作目录策略（task-12 负责）
- 不修改 worktree 路径获取逻辑（`_try_acquire_lease` 不涉及）
- 不修改 `_execute_stage_run` 中的 CLAUDE.md 覆盖问题（task-04 负责）
- 不添加路径安全校验（穿越防护等），留给后续安全增强
- 不修改 Change model 的 `path` 字段定义

## 参考

- design.md Phase 5"修复只读路径判断"
- plan.md Wave 4 task-11 说明
- agent.md 模块文档
- `Workspace.root_path`：`workspace/model.py` 第 57 行，`Column(String, nullable=False)`

## TDD 步骤

1. **写测试**：在 `backend/tests/modules/agent/` 下新增或扩展测试，验证以下场景：
   - `change.path` 为相对路径 + 路径存在于 workspace root 下 → `work_dir` 指向拼接路径
   - `change.path` 为相对路径 + 路径不存在于 workspace root 下 → `work_dir` fallback 到 `workspace_root`
   - `change.path` 为绝对路径 + 路径存在 → `work_dir` 直接使用绝对路径
   - `change.path` 为绝对路径 + 路径不存在 → `work_dir` fallback 到 `workspace_root`
2. **确认失败**：运行测试，确认当前代码（未拼接 workspace root）导致前两个场景失败
3. **修正拼接逻辑**：按"接口定义"中的"修改后"代码修改 `service.py`
4. **确认通过**：运行测试，全部通过
5. **回归**：运行 `pytest backend/tests/` 确保无回归

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|----------|----------|
| AC-01 | `change.path` 为相对路径 `.sillyspec/changes/xxx`，workspace root 下该目录存在 | `work_dir` = `Path(workspace_root) / ".sillyspec/changes/xxx"`，`is_dir()` 返回 True |
| AC-02 | `change.path` 为相对路径 `.sillyspec/changes/xxx`，workspace root 下该目录不存在 | `work_dir` fallback 到 `Path(workspace_root)` |
| AC-03 | `change.path` 为绝对路径 `/tmp/abs/path`，该目录存在 | `work_dir` = `Path("/tmp/abs/path")`，不重复拼接 workspace root |
| AC-04 | `change.path` 为绝对路径 `/tmp/abs/path`，该目录不存在 | `work_dir` fallback 到 `Path(workspace_root)` |
| AC-05 | 原代码中 `Path(change.path).is_dir()` 直接判断处 | 已改为先拼接 workspace root（相对路径时），再判断 |
| AC-06 | 现有测试（`pytest backend/tests/`） | 全部通过，无回归 |
