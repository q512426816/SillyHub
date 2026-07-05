---
id: task-04
title: 修复 _execute_stage_run 中 CLAUDE.md 覆盖问题
priority: P0
estimated_hours: 2
depends_on: [task-02]
blocks: [task-11]
allowed_paths:
  - backend/app/modules/agent/service.py
author: qinyi
created_at: 2026-06-01 08:30:00
---

# task-04: 修复 _execute_stage_run 中 CLAUDE.md 覆盖问题

## 修改文件（必填）

- `backend/app/modules/agent/service.py` — 修改 `_execute_stage_run()` 方法，移除 line 703-717 的直接 CLAUDE.md 写入逻辑，改为将 stage prompt 信息嵌入 `AgentSpecBundle`，由 adapter 的 `run_with_bundle()` 统一渲染和写入

## 实现要求

根据 design.md Phase 2 "修复 CLAUDE.md 覆盖问题" 和 requirements.md FR-03：

1. **移除 `_execute_stage_run()` 中直接写 CLAUDE.md 的代码**（当前 line 703-717），包括：
   - 移除 `if read_only:` 分支中的 `claude_md = ...` 赋值（line 704-709）
   - 移除 `else:` 分支中的 `claude_md = ...` 赋值（line 711-716）
   - 移除 `(work_dir / "CLAUDE.md").write_text(claude_md, encoding="utf-8")` 调用（line 717）

2. **扩展 `_execute_stage_run()` 中构造的 `AgentSpecBundle`**（当前 line 695-699），将阶段 prompt 信息通过 bundle 传递给 adapter：
   - 如果 task-02 已完成（`AgentSpecBundle` 已有 `stage_dispatch`/`change_key`/`stage`/`step_prompt`/`read_only`/`spec_root` 字段）：直接使用这些新字段
   - 如果 task-02 未完成（本任务独立完成）：通过 `platform_metadata` 字典传递 `stage`、`read_only`、`prompt` 信息，adapter 侧的 `render_bundle_to_claude_md` 可从 `platform_metadata` 读取

3. **确保 adapter 写入的 CLAUDE.md 包含完整的阶段指令**：移除 `_execute_stage_run` 的直接写入后，`claude_code.py:138-139` 的 `render_bundle_to_claude_md(bundle)` + `(lease_path / "CLAUDE.md").write_text(...)` 成为唯一的 CLAUDE.md 写入点。需要确保 bundle 中携带的信息足以让 `render_bundle_to_claude_md` 输出完整的阶段 prompt 内容。

4. **不修改 adapter 的 CLAUDE.md 渲染逻辑**（task-06 负责）。但需要确保 `render_bundle_to_claude_md` 现有逻辑不会丢失 `platform_metadata` 中的关键信息——当前 `render_bundle_to_claude_md` 不渲染 `platform_metadata`，因此阶段 prompt 需要通过 bundle 的文档内容字段传递。

## 接口定义（代码类任务必填）

### 修改前 — _execute_stage_run 控制流（当前代码）

```
_execute_stage_run():
    1. 获取独立 DB session
    2. 加载 AgentRun 记录
    3. 解析 adapter
    4. 标记 running
    5. 构建最小 bundle（只有 change_summary, task_key, task_title）
    6. 确保 work_dir 存在
    7. ★ 直接写 CLAUDE.md 到 work_dir（包含 stage prompt + read_only 模式标记）★
    8. 调用 adapter.run_with_bundle(run_id, bundle, work_dir)
       → adapter 内部再次写 CLAUDE.md（覆盖了第 7 步的内容）
    9. 更新 run 记录
    10. 写日志
    11. 写审计日志
    12. 更新 change.stages.last_dispatch
```

### 修改后 — _execute_stage_run 控制流

```
_execute_stage_run():
    1. 获取独立 DB session
    2. 加载 AgentRun 记录
    3. 解析 adapter
    4. 标记 running
    5. 构建完整 bundle：
       - change_summary, task_key, task_title（保留）
       - ★ 将 stage prompt 内容嵌入 bundle.task_markdown ★
       - ★ 将 stage 信息写入 bundle.platform_metadata ★
         { "stage": stage, "read_only": read_only, "change_id": str(change_id) }
       - ★ 将 read_only 模式标记写入 bundle.denied_paths（空列表 = 可写）★
    6. 确保 work_dir 存在
    7. ~~（已移除）直接写 CLAUDE.md~~
    8. 调用 adapter.run_with_bundle(run_id, bundle, work_dir)
       → adapter 调用 render_bundle_to_claude_md(bundle) 生成 CLAUDE.md
       → adapter 写入 CLAUDE.md（唯一的写入点）
       → bundle.task_markdown 中的阶段 prompt 被 inlined 到 CLAUDE.md
    9. 更新 run 记录
    10. 写日志
    11. 写审计日志
    12. 更新 change.stages.last_dispatch
```

### 修改后伪代码 — _execute_stage_run 核心改动区域

```python
async def _execute_stage_run(
    self,
    *,
    run_id: uuid.UUID,
    prompt: str,
    work_dir: Path,
    read_only: bool,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    user_id: uuid.UUID,
    stage: str,
) -> None:
    """Execute a stage-level agent run (runs in background task)."""
    from app.core.db import get_session_factory
    from app.modules.agent.base import AgentSpecBundle

    factory = get_session_factory()
    async with factory() as session:
        run = await session.get(AgentRun, run_id)
        if run is None:
            log.error("stage_run_missing", run_id=str(run_id))
            return

        adapter_cls = ADAPTERS.get("claude_code")
        if adapter_cls is None:
            run.status = "failed"
            run.finished_at = datetime.utcnow()
            run.exit_code = 1
            run.output_redacted = "Unknown agent type."
            session.add(run)
            await session.commit()
            return

        # Mark running
        run.status = "running"
        run.started_at = datetime.utcnow()
        session.add(run)
        await session.commit()

        # ── 构建包含阶段 prompt 的完整 bundle ──
        # 将阶段 prompt 嵌入 task_markdown，让 render_bundle_to_claude_md
        # 将其作为 "Task" section inline 到 CLAUDE.md 中
        mode_suffix = (
            "\n\n## Mode: READ-ONLY\n"
            "Do NOT modify any files. Only analyze and report.\n"
            if read_only
            else "\n\n## Mode: WRITE\n"
            "You may modify files in the worktree as needed.\n"
        )

        bundle = AgentSpecBundle(
            change_summary=f"Change stage: {stage}",
            task_key=f"stage:{stage}",
            task_title=f"Stage dispatch: {stage}",
            # ★ 关键：将阶段 prompt + 模式标记嵌入 task_markdown
            # render_bundle_to_claude_md 会将其作为 ## Task section 输出
            task_markdown=prompt + mode_suffix,
            # 通过 platform_metadata 传递 stage 上下文（供 adapter / 未来 task-06 使用）
            platform_metadata={
                "stage_dispatch": True,
                "stage": stage,
                "read_only": read_only,
                "change_id": str(change_id),
                "workspace_id": str(workspace_id),
            },
            available_tools=["sillyspec"],
        )

        # Ensure work directory exists
        work_dir.mkdir(parents=True, exist_ok=True)

        # ──（已移除）直接写 CLAUDE.md ──
        # CLAUDE.md 现在由 adapter.run_with_bundle() 内部统一渲染和写入

        adapter = adapter_cls()
        result = await adapter.run_with_bundle(run_id, bundle, work_dir)

        # ... 后续更新 run 记录、写日志、写审计日志、更新 change.stages 不变 ...
```

### 关键说明：为什么用 task_markdown 传递 prompt

当前 `render_bundle_to_claude_md()`（`context_builder.py:354-445`）在 line 368-379 中会 inlined 输出 `bundle.task_markdown`：

```python
for label, content in [
    ("Proposal", bundle.proposal),
    ("Requirements", bundle.requirements),
    ("Design", bundle.design),
    ("Plan", bundle.plan),
    ("Task", bundle.task_markdown),  # ← 这里会输出 task_markdown 内容
]:
    if content:
        lines.append(f"## {label}")
        lines.append(content)
```

因此将 `prompt + mode_suffix` 放入 `bundle.task_markdown`，`render_bundle_to_claude_md` 会自动输出：

```markdown
## Task
<用户传入的 stage prompt 内容>

## Mode: READ-ONLY
Do NOT modify any files. Only analyze and report.
```

这与原始直接写入的效果一致，且不需要修改 `render_bundle_to_claude_md`（符合非目标约束）。

当 task-06 完成后，adapter 会改为从 `bundle.stage_dispatch`/`bundle.step_prompt` 等新字段生成专门的阶段 prompt，`task_markdown` 方案届时可平滑过渡。

## 边界处理（必填，至少5条）

1. **bundle 为 None 时的处理**：不会发生。`AgentSpecBundle` 在 `_execute_stage_run` 内部构造（line 695-699），不依赖外部传入，构造时必填字段 `change_summary`/`task_key`/`task_title` 均使用 f-string 赋值，不会为 None。但如果未来重构导致 bundle 为 None，adapter 侧 `render_bundle_to_claude_md(bundle)` 会抛 `AttributeError`，应被 `_execute_stage_run` 的外层调用捕获（`asyncio.create_task` 的异常会由 asyncio 事件循环记录）。本任务不额外添加 None 检查。

2. **非 stage dispatch 模式（现有 task 级调用）保持原行为**：`_execute_stage_run` 是 stage dispatch 专用方法，由 `start_stage_dispatch` 通过 `asyncio.create_task` 调用。现有 task 级调用走 `start_run` → `_execute_run_background` 路径，该方法在 line 166-169 有自己的 CLAUDE.md 写入逻辑（`start_run` 的 step 6），不受本任务影响。两条路径完全独立。

3. **CLAUDE.md 写入失败时的日志记录**：`render_bundle_to_claude_md` 是纯字符串拼接，不会失败。`(lease_path / "CLAUDE.md").write_text(...)` 在 adapter 侧执行（`claude_code.py:139`），如果写入失败（磁盘满/权限不足），会抛 `OSError`，导致 `adapter.run_with_bundle` 返回异常。当前 adapter 的 `_exec_stream` 方法没有 try/except 包裹 CLAUDE.md 写入，所以异常会向上传播到 `_execute_stage_run`。由于 `_execute_stage_run` 在 `asyncio.create_task` 中运行，未捕获异常会被 asyncio 记录到日志。本任务不改变这一行为。

4. **adapter 未写入 CLAUDE.md 时的 fallback**：如果 adapter 实现被替换（如 mock adapter 用于测试），且该 adapter 不写 CLAUDE.md，agent 将没有 CLAUDE.md 可读。这是 adapter 的实现责任。本任务确保了标准 `ClaudeCodeAdapter` 通过 `render_bundle_to_claude_md` + `write_text` 统一写入，不存在"adapter 未写入"的场景。测试中如需 mock adapter，应确保 mock 也执行 CLAUDE.md 写入，或验证 bundle 内容正确即可。

5. **并发执行时 CLAUDE.md 不被覆盖**：本任务将写入点从 2 个（service.py + adapter）减少为 1 个（adapter only），降低了并发覆盖风险。但 `_execute_stage_run` 本身通过 `asyncio.create_task` 启动，如果同一 change 的同一 stage 被多次 dispatch，可能出现两个 task 竞争写同一个 work_dir 的 CLAUDE.md。这是上层调度器的职责（通过 `has_active_run` 检查防止重复 dispatch，见 design.md Phase 3 risk-3），本任务不负责解决。

6. **prompt 为空字符串时的处理**：`prompt` 参数由 `start_stage_dispatch` 的 step 3（line 552-566）从模板渲染而来。如果模板返回空字符串，`start_stage_dispatch` 会抛 `AgentRunError`（line 563-566），不会到达 `_execute_stage_run`。因此 `_execute_stage_run` 接收到的 `prompt` 一定非空。

7. **task_markdown 中的特殊字符**：`prompt` 可能包含 markdown 格式、代码块、特殊符号等。`render_bundle_to_claude_md` 直接拼接字符串，不做转义，这是正确行为——CLAUDE.md 本身就是 markdown 文件。`write_text(..., encoding="utf-8")` 确保 UTF-8 编码正确。

## 非目标（本任务不做的事）

- **不修改** adapter 的 CLAUDE.md 渲染逻辑（`claude_code.py` 和 `context_builder.py` 的 `render_bundle_to_claude_md`）。task-06 负责扩展 adapter 使其生成明确的 `sillyspec run <stage>` 阶段命令 prompt
- **不修改** `AgentSpecBundle` 结构（task-02 负责添加 `stage_dispatch`/`change_key`/`stage`/`spec_root`/`step_prompt`/`read_only` 字段）
- **不修改** `start_run` → `_execute_run_background` 路径的 CLAUDE.md 写入逻辑（line 166-169），那是 task 级调用，与 stage dispatch 无关
- **不新增** `build_stage_bundle()` 函数（task-05 负责）
- **不修改** `_execute_stage_run` 中 CLAUDE.md 写入之后的逻辑（更新 run 记录、写日志、写审计日志、更新 change.stages）
- **不新增** 测试文件。本任务的测试将在 task-17~22 的测试任务中覆盖。但本任务的 TDD 步骤中会描述如何验证

## 参考

- **design.md Phase 2**："修复 CLAUDE.md 覆盖问题" — 移除 `_execute_stage_run()` 中直接写 CLAUDE.md 的代码，改为由 adapter 统一渲染
- **requirements.md FR-03**："_execute_stage_run 不直接写 CLAUDE.md"、"adapter.run_with_bundle 写入的 CLAUDE.md 包含阶段调度内容"
- **claude_code.py:138-139**：`render_bundle_to_claude_md(bundle)` + `(lease_path / "CLAUDE.md").write_text(...)` — adapter 的 CLAUDE.md 写入点
- **context_builder.py:354-445**：`render_bundle_to_claude_md` — 当前的渲染逻辑，会 inlined 输出 `bundle.task_markdown`
- **service.py:650-780**：`_execute_stage_run` — 当前完整实现

## TDD 步骤

由于本任务不新增测试文件（测试在 task-17~22 统一覆盖），TDD 通过以下方式验证：

1. **写临时测试验证 _execute_stage_run 不直接写 CLAUDE.md**：
   ```python
   # 在测试中 mock ClaudeCodeAdapter.run_with_bundle，记录传入的 bundle
   # 验证 bundle.task_markdown 包含阶段 prompt + 模式标记
   # 验证 _execute_stage_run 中没有 Path.write_text 或 open().write 调用
   ```
2. **确认失败**：在修改前运行测试，当前代码在 line 717 有 `(work_dir / "CLAUDE.md").write_text(...)` 调用，测试断言"无直接写入"会失败
3. **移除写入逻辑**：删除 line 703-717，将 prompt 嵌入 bundle.task_markdown
4. **确认通过**：运行测试，断言通过：
   - `_execute_stage_run` 中无 `Path.write_text` / `open().write` 调用
   - `bundle.task_markdown` 包含原始 prompt 内容
   - `bundle.platform_metadata` 包含 `stage_dispatch=True`
5. **回归**：运行现有 `pytest backend/tests/` 全部测试，确认 `_execute_run_background` 路径（`start_run`）不受影响

### 具体验证命令

```bash
# AC-01: grep 确认 _execute_stage_run 中无直接写 CLAUDE.md
grep -n "write_text\|open().write" backend/app/modules/agent/service.py
# 只应在 start_run 的 step 6（line 169）出现，不应在 _execute_stage_run 中出现

# AC-02: 验证 bundle 构造包含 task_markdown
# 通过代码审查确认 bundle = AgentSpecBundle(...) 中有 task_markdown=prompt + mode_suffix
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 在 `service.py` 的 `_execute_stage_run` 方法中 grep `write_text` | 无匹配结果（该方法内不存在 `Path.write_text` 或 `open().write` 调用） |
| AC-02 | 在 `service.py` 的 `_execute_stage_run` 方法中检查 `AgentSpecBundle` 构造 | `task_markdown` 参数值为 `prompt + mode_suffix`，其中 `mode_suffix` 根据 `read_only` 条件生成 READ-ONLY 或 WRITE 模式标记 |
| AC-03 | 在 `service.py` 的 `_execute_stage_run` 方法中检查 `AgentSpecBundle` 构造 | `platform_metadata` 包含 `stage_dispatch=True`、`stage`、`read_only`、`change_id` |
| AC-04 | 检查 `claude_code.py:138-139` | adapter 仍然调用 `render_bundle_to_claude_md(bundle)` 并写入 CLAUDE.md，未被修改 |
| AC-05 | 检查 `start_run` 方法的 CLAUDE.md 写入（line 166-169） | 该路径的 `render_bundle_to_claude_md(bundle)` + `write_text` 不受影响 |
| AC-06 | 运行 `pytest backend/tests/` | 所有现有测试通过（不破坏已有功能） |
| AC-07 | 对比修改前后 CLAUDE.md 最终内容 | 修改后 adapter 生成的 CLAUDE.md 中包含 `## Task` section，内容为阶段 prompt + 模式标记，与修改前直接写入的内容等价 |
| AC-08 | 检查 `_execute_stage_run` 中 CLAUDE.md 相关代码行数 | 原 line 703-717 共 15 行代码全部移除，替换为 bundle 构造中的 `task_markdown` 和 `platform_metadata` 参数 |
