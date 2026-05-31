---
id: task-01
title: 废弃 start_sillyspec_run 子进程路径
priority: P0
estimated_hours: 1
depends_on: []
blocks: [task-08]
allowed_paths:
  - backend/app/modules/agent/coordinator.py
author: qinyi
created_at: 2026-06-01
---

# task-01: 废弃 start_sillyspec_run 子进程路径

## 修改文件（必填）

- `backend/app/modules/agent/coordinator.py` — 标记 `start_sillyspec_run()` 和 `_run_sillyspec_background()` 为 deprecated，添加 `warnings.warn(DeprecationWarning)` + 结构化日志

## 实现要求

1. 在 `start_sillyspec_run()` 方法（当前 line 427）的 docstring 顶部添加 `.. deprecated::` 标记，说明废弃原因及替代方案
2. 在 `start_sillyspec_run()` 方法体开头（line 449 之前）插入 `warnings.warn(...)` 调用，发出 `DeprecationWarning`
3. 在 `start_sillyspec_run()` 方法体开头插入 `log.warning(...)` 结构化日志，包含 `change_key`、`scope`、`method="start_sillyspec_run"`
4. 在 `_run_sillyspec_background()` 方法（当前 line 475）的 docstring 顶部添加 `.. deprecated::` 标记
5. 在 `_run_sillyspec_background()` 方法体开头插入 `log.warning(...)` 结构化日志，包含 `run_id`、`method="_run_sillyspec_background"`
6. 在文件顶部 `import` 区域添加 `import warnings`（紧跟现有的 `import hashlib` 等标准库之后）
7. **保留方法体不变**，仅添加废弃标记和日志，不做任何功能删除或逻辑修改
8. **不修改 `_run_sillyspec_background` 中任何子进程执行逻辑**

## 接口定义（代码类任务必填）

### start_sillyspec_run — 修改后伪代码

```python
async def start_sillyspec_run(
    self,
    *,
    change_key: str,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    scope: str = "full",
    repo_dir: "Path",
) -> AgentRun:
    """Create and launch a SillySpec AgentRun in the background.

    .. deprecated::
        ``start_sillyspec_run`` 绕过 Agent 适配器层，直接运行子进程，
        无法收集日志/状态/进度。请改用
        ``SillySpecStageDispatchService.dispatch_next_step()``。

    Args:
        change_key: Change key (e.g. "2026-05-31-my-feature").
        workspace_id: Workspace UUID.
        user_id: User who triggered the run.
        scope: ``"full"`` or ``"quick"``.
        repo_dir: Repository root directory.

    Returns:
        The newly created AgentRun record (status=pending).
    """
    # ── deprecated warning ──
    warnings.warn(
        "start_sillyspec_run is deprecated. "
        "Use SillySpecStageDispatchService.dispatch_next_step() instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    log.warning(
        "deprecated_method_called",
        method="start_sillyspec_run",
        change_key=change_key,
        scope=scope,
    )

    # 原有方法体保持不变（import asyncio ... return run）
    ...
```

### _run_sillyspec_background — 修改后伪代码

```python
async def _run_sillyspec_background(
    self,
    *,
    run_id: uuid.UUID,
    change_key: str,
    scope: str,
    repo_dir: "Path",
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Execute a sillyspec command in the background and persist results.

    .. deprecated::
        此方法由 ``start_sillyspec_run`` 内部调用，同样已废弃。
    """
    log.warning(
        "deprecated_method_called",
        method="_run_sillyspec_background",
        run_id=str(run_id),
    )

    # 原有方法体保持不变
    ...
```

## 边界处理（必填，至少5条）

1. **null/空值行为**：`warnings.warn()` 和 `log.warning()` 不依赖任何可能为 None 的参数。`change_key`、`run_id` 在调用时一定已由调用方提供（从签名看无默认值），不会触发空值问题。
2. **兼容旧行为（brownfield）**：方法体完全保留，现有调用方（`change_writer/router.py:153`）行为不变。`warnings.warn` 默认在 Python 中仅打印到 stderr（默认 `-Wd` 或 pytest 会捕获），不会抛异常中断流程。`log.warning` 仅写日志，不影响返回值或异常传播。
3. **异常不静默吞掉**：`warnings.warn` 和 `log.warning` 均不会抛异常。原有方法体中的 `try/except` 逻辑完全保留，异常路径不受影响。
4. **不修改传入参数**：本任务仅添加 `warnings.warn` + `log.warning` 两行语句，不读取、修改或重新赋值任何传入参数。
5. **warnings 过滤器冲突**：如果调用方或测试已设置 `warnings.simplefilter("ignore", DeprecationWarning)`，`warnings.warn` 不会中断。这与项目已有的废弃模式一致（参考 `workflow/fsm.py`）。
6. **日志级别选择**：使用 `log.warning` 而非 `log.error`，因为这是预期的废弃过渡行为而非系统错误；不使用 `log.info` 以确保在日志中足够显眼。
7. **多次调用场景**：每次调用 `start_sillyspec_run` 都会触发一次 `DeprecationWarning`，这是预期行为，帮助发现所有调用点。

## 非目标（本任务不做的事）

- **不删除** `start_sillyspec_run` 或 `_run_sillyspec_background` 的方法体
- **不修改** `change_writer/router.py` 中的调用（那是 task-08 的职责）
- **不新增** `SillySpecStageDispatchService` 类（那是 task-07 的职责）
- **不修改** 方法的参数签名或返回类型
- **不修改** `_run_sillyspec_background` 中的子进程命令构建逻辑
- **不修改** 任何测试文件（废弃标记的验证在 task-17~22 的集成测试中覆盖）

## 参考

- **本项目已有的废弃模式**：`backend/app/modules/workflow/fsm.py` 中 `ChangeFSM` 的 `warnings.warn(DeprecationWarning)` + docstring `.. deprecated::` 标记
- **结构化日志模式**：`coordinator.py` 文件中已有的 `log.info(...)` 和 `log.error(...)` 调用，使用 `get_logger(__name__)` 的 structlog 风格
- **design.md Phase 1 废弃说明**：`start_sillyspec_run()` 标记 `@deprecated`，保留方法体以避免 breaking change
- **requirements.md FR-02**：`start_sillyspec_run` 有 `@deprecated` 标记

## TDD 步骤

由于本任务是"标记废弃"，TDD 侧重于验证废弃标记的可见性而非功能行为：

1. **写测试**：在 `backend/tests/modules/agent/test_coordinator.py` 新增测试：
   - `test_start_sillyspec_run_emits_deprecation_warning`：使用 `pytest.warns(DeprecationWarning)` 断言调用 `start_sillyspec_run` 时发出 `DeprecationWarning`
   - `test_start_sillyspec_run_still_returns_agent_run`：验证废弃后方法仍正常返回 `AgentRun` 对象
2. **确认失败**：运行测试，因当前无 `warnings.warn` 调用，`pytest.warns` 断言失败
3. **写代码**：在 `coordinator.py` 中添加 `import warnings` + 两个方法的废弃标记和日志
4. **确认通过**：运行测试，全部通过
5. **回归**：运行现有 `test_coordinator.py` 全部 22 个测试确认无破坏

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 在 `coordinator.py` 中检查 `start_sillyspec_run` 的 docstring | 包含 `.. deprecated::` 指令，说明替代方案为 `SillySpecStageDispatchService.dispatch_next_step()` |
| AC-02 | 在 `coordinator.py` 中检查 `_run_sillyspec_background` 的 docstring | 包含 `.. deprecated::` 指令 |
| AC-03 | 在 `coordinator.py` 中检查 `start_sillyspec_run` 方法体 | 方法体开头有 `warnings.warn(..., DeprecationWarning)` 调用 |
| AC-04 | 在 `coordinator.py` 中检查 `start_sillyspec_run` 方法体 | 方法体开头有 `log.warning("deprecated_method_called", ...)` 结构化日志 |
| AC-05 | 在 `coordinator.py` 中检查 `_run_sillyspec_background` 方法体 | 方法体开头有 `log.warning("deprecated_method_called", ...)` 结构化日志 |
| AC-06 | 运行 `pytest backend/tests/modules/agent/test_coordinator.py` | 所有现有测试通过（不破坏已有功能） |
| AC-07 | 新增测试 `test_start_sillyspec_run_emits_deprecation_warning` 运行通过 | 调用 `start_sillyspec_run` 时 `pytest.warns(DeprecationWarning)` 捕获到警告 |
| AC-08 | 新增测试 `test_start_sillyspec_run_still_returns_agent_run` 运行通过 | 废弃后方法仍返回有效的 `AgentRun` 对象（status=pending） |
| AC-09 | `coordinator.py` 文件顶部有 `import warnings` | import 区域包含 `warnings` 模块 |
| AC-10 | 全局搜索 `start_sillyspec_run` 在 Python 源文件中的调用 | 除 `coordinator.py` 方法定义和 `change_writer/router.py` 已有调用外，无新增调用 |
