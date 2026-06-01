---
author: qinyi
created_at: 2026-06-01 06:55:37
---

# task-06: 修正 adapter 生成明确的 sillyspec 阶段命令 prompt

- **priority**: P0
- **estimated_hours**: 2
- **depends_on**: [task-02]
- **blocks**: [task-07, task-19]
- **allowed_paths**:
  - backend/app/modules/agent/adapters/claude_code.py

## 修改文件

- `backend/app/modules/agent/adapters/agent/adapters/claude_code.py` — `run_with_bundle()` 方法中的 prompt 生成逻辑

## 实现要求

根据 design.md Phase 2 "Adapter 明确 sillyspec 阶段命令"，在 `run_with_bundle()` 方法中，当 `bundle.stage_dispatch == True` 时，生成明确的阶段执行 prompt，替代当前泛化的 task-level prompt。

### 要求清单

1. 在 `run_with_bundle()` 中，当 `bundle.stage_dispatch == True` 时，生成阶段执行 prompt（替代当前第 141-153 行的通用 prompt）
2. prompt 必须包含 `sillyspec run {bundle.stage} --change {bundle.change_key}` 格式命令
3. prompt 包含执行步骤：运行 → 阅读 → 完成 → done → 重复
4. prompt 包含规则：文档目录、禁止改代码、头部格式、每步 done
5. 如果 `bundle.read_only` 为 `True`，追加 READ-ONLY 模式说明
6. 如果 `bundle.step_prompt` 不为 `None`，追加当前步骤 Prompt 内容
7. 非 stage_dispatch 模式（`bundle.stage_dispatch == False`）保持原行为不变

## 接口定义

### Prompt 模板

```python
def _build_stage_dispatch_prompt(bundle: AgentSpecBundle) -> str:
    """为 stage_dispatch 模式生成明确的 SillySpec 阶段执行 prompt。

    Args:
        bundle: 已包含 stage_dispatch=True 的 AgentSpecBundle，
                必须包含 stage 和 change_key 字段。

    Returns:
        完整的阶段执行 prompt 字符串。
    """
    stage = bundle.stage or "unknown"
    change_key = bundle.change_key or "unknown"

    prompt = (
        f"你是 SillySpec {stage} 阶段的执行者。\n\n"
        f"## 任务\n"
        f"为变更 {change_key} 完成 SillySpec {stage} 阶段。\n\n"
        f"## 执行步骤\n"
        f"1. 运行 `sillyspec run {stage} --change {change_key}`\n"
        f"2. 阅读当前 step 的 prompt\n"
        f"3. 按 prompt 完成工作\n"
        f"4. `sillyspec run {stage} --done --change {change_key} --input '...' --output '...'`\n"
        f"5. 重复直到所有步骤完成\n\n"
        f"## 规则\n"
        f"- 所有文档写入 `.sillyspec/changes/{change_key}/`\n"
        f"- 只产出文档，禁止改代码\n"
        f"- 文档头部 author + created_at\n"
        f"- 每步完成立即 --done\n"
    )

    if bundle.read_only:
        prompt += "\n## 模式: READ-ONLY\nDo NOT modify any files. Only analyze and report.\n"

    if bundle.step_prompt is not None:
        prompt += f"\n## 当前步骤 Prompt\n{bundle.step_prompt}\n"

    return prompt
```

### 控制流伪代码

```
run_with_bundle(run_id, bundle, lease_path, timeout):
    # 1. 渲染 CLAUDE.md（不变）
    claude_md = render_bundle_to_claude_md(bundle)
    write CLAUDE.md to lease_path

    # 2. 根据 stage_dispatch 选择 prompt 生成路径
    if bundle.stage_dispatch:
        prompt = _build_stage_dispatch_prompt(bundle)
        log.info("stage_dispatch_prompt", stage=bundle.stage, change_key=bundle.change_key)
    else:
        # 原有逻辑（第 141-153 行），保持不变
        prompt = f"Implement task {bundle.task_key}: {bundle.task_title}.\n..."
        if "sillyspec" in bundle.available_tools:
            prompt += "\n\nYou have access to the `sillyspec` CLI tool. ..."

    # 3. 构建 CLI 命令并执行（不变）
    cmd = [...]
    env_vars = {...}
    return _exec_stream(run_id, cmd, prompt, lease_path, env_vars, timeout)
```

### 需要修改的代码位置

文件：`backend/app/modules/agent/adapters/claude_code.py`

**位置 1**：在 class 外部（如 `_build_stream_input` 之后）新增模块级私有函数 `_build_stage_dispatch_prompt(bundle: AgentSpecBundle) -> str`

**位置 2**：`run_with_bundle()` 方法第 141-153 行，将当前的 prompt 构建逻辑替换为 stage_dispatch 分支判断：

```python
# 替换第 141-153 行
if bundle.stage_dispatch:
    prompt = _build_stage_dispatch_prompt(bundle)
else:
    prompt = (
        f"Implement task {bundle.task_key}: {bundle.task_title}.\n"
        f"Change: {bundle.change_summary}.\n"
        "Read CLAUDE.md for full spec context before starting."
    )
    if "sillyspec" in bundle.available_tools:
        prompt += (
            "\n\nYou have access to the `sillyspec` CLI tool. "
            "Use it to generate spec files instead of writing them directly. "
            "Commands: `sillyspec init --dir <path>`, `sillyspec run scan --dir <path>`. "
            "The spec root directory is where .sillyspec/ structure should be created."
        )
```

## 边界处理

1. **stage_dispatch=False**：走原有 prompt 逻辑（第 141-153 行原样保留），完全不受影响
2. **stage 为 None 但 stage_dispatch=True**：`_build_stage_dispatch_prompt` 中使用 `"unknown"` 作为 fallback，同时记录 warning 日志（`log.warning("stage_dispatch_missing_stage", change_key=bundle.change_key)`）
3. **change_key 为 None**：使用 `"unknown"` 作为占位符，记录 warning 日志（`log.warning("stage_dispatch_missing_change_key", stage=bundle.stage)`）
4. **read_only=True**：在 prompt 末尾追加 `## 模式: READ-ONLY` 段落，包含 "Do NOT modify any files" 指令
5. **step_prompt 为 None**：不追加 `## 当前步骤 Prompt` 段落，仅当 `step_prompt is not None` 时追加
6. **AgentSpecBundle 未扩展（task-02 未完成）**：依赖 task-02 先完成。若 bundle 无 `stage_dispatch` 属性，`getattr(bundle, 'stage_dispatch', False)` 防御性取默认值 `False`，走原有逻辑

## 非目标

- 不修改 `render_bundle_to_claude_md` 的 CLAUDE.md 渲染逻辑（`context_builder.py`）
- 不修改 `run()` 方法的子进程管理逻辑
- 不修改 `_exec_stream` 方法
- 不修改 `AgentSpecBundle` 数据结构（由 task-02 负责）
- 不修改 `service.py` 中调用 `run_with_bundle` 的逻辑（由 task-04 负责）

## 参考

- design.md Phase 2 "Adapter 明确 sillyspec 阶段命令"（包含完整 prompt 模板代码）
- requirements.md FR-01: 统一调度入口 — prompt 中必须包含 `sillyspec run <stage> --change <change_key>` 格式

## TDD 步骤

1. **写测试**：验证 stage_dispatch=True 时 prompt 包含 `sillyspec run propose --change test-change` 命令
2. **确认失败**：运行测试，确认当前代码不生成该 prompt
3. **实现**：新增 `_build_stage_dispatch_prompt()` + 修改 `run_with_bundle()` 分支
4. **确认通过**：运行测试，全部通过
5. **回归验证**：验证 stage_dispatch=False 时原有行为不变

### 测试用例设计

```
test_stage_dispatch_prompt_contains_sillyspec_run_command:
  bundle = AgentSpecBundle(stage_dispatch=True, stage="propose", change_key="my-change", ...)
  result = _build_stage_dispatch_prompt(bundle)
  assert "sillyspec run propose --change my-change" in result

test_stage_dispatch_prompt_contains_execution_steps:
  bundle = AgentSpecBundle(stage_dispatch=True, stage="plan", change_key="x", ...)
  result = _build_stage_dispatch_prompt(bundle)
  assert "--done" in result
  assert "执行步骤" in result

test_stage_dispatch_prompt_read_only_mode:
  bundle = AgentSpecBundle(stage_dispatch=True, stage="scan", change_key="x", read_only=True, ...)
  result = _build_stage_dispatch_prompt(bundle)
  assert "READ-ONLY" in result
  assert "Do NOT modify any files" in result

test_stage_dispatch_prompt_with_step_prompt:
  bundle = AgentSpecBundle(stage_dispatch=True, stage="propose", change_key="x",
                           step_prompt="请完成需求分析", ...)
  result = _build_stage_dispatch_prompt(bundle)
  assert "当前步骤 Prompt" in result
  assert "请完成需求分析" in result

test_non_stage_dispatch_unchanged:
  bundle = AgentSpecBundle(stage_dispatch=False, ...)
  # 调用 run_with_bundle 或直接检查 prompt 构建分支
  # 确认走原有逻辑，prompt 包含 "Implement task" 开头
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | stage_dispatch=True, stage="propose", change_key="my-change" 时生成 prompt | 包含字符串 `sillyspec run propose --change my-change` |
| AC-02 | stage_dispatch=False 时生成 prompt | 与修改前完全相同（以 "Implement task" 开头） |
| AC-03 | stage_dispatch=True 且 read_only=True 时生成 prompt | 包含字符串 `READ-ONLY` |
| AC-04 | stage_dispatch=True 且 step_prompt 不为 None 时生成 prompt | prompt 末尾包含 step_prompt 的内容 |
| AC-05 | stage_dispatch=True 时生成的 prompt | 包含 `--done` 字符串 |
| AC-06 | stage=None 但 stage_dispatch=True 时 | 使用 "unknown" fallback，记录 warning 日志，不抛异常 |
