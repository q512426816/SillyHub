---
id: task-12
title: 实现写阶段运行目录策略与 worktree 检查
priority: P1
estimated_hours: 2
depends_on: [task-11]
blocks: []
allowed_paths:
  - backend/app/modules/agent/service.py
  - backend/app/modules/change/dispatch.py
author: qinyi
created_at: 2026-06-01 19:30:00
---

## 修改文件

- `backend/app/modules/agent/service.py` — 修改 `start_stage_dispatch` 中工作目录确定逻辑，新增 `resolve_work_dir` 函数和 `_ensure_change_dir_in_worktree` 方法
- `backend/app/modules/change/dispatch.py` — 在 `dispatch` 中传递 `STAGE_AGENT_CONFIG` 的 `read_only` 和 `requires_worktree` 字段到 AgentService

## 实现要求

根据 design.md Phase 5 "写阶段运行目录策略" 和 "worktree 内 change 目录" 章节，修正工作目录确定逻辑，确保写阶段使用正确的 worktree 路径，只读阶段使用 workspace root，并在 worktree 内确保 `.sillyspec/changes/<change_key>/` 目录存在。

### 1. 新增 resolve_work_dir 函数

在 `backend/app/modules/agent/service.py` 中（模块级别，不在类内），新增独立的目录策略函数：

```python
def resolve_work_dir(
    *,
    workspace_root: str,
    change_path: str | None,
    change_key: str | None,
    lease: WorktreeLease | None,
    requires_worktree: bool,
    read_only: bool,
) -> Path:
    """根据阶段配置和 worktree 可用性确定工作目录。

    策略：
      - 有 lease（workspace 有 git identity + 写阶段） → worktree repo
      - 无 lease + 写阶段（无 git identity）→ workspace root
      - 只读阶段 → workspace root

    Args:
        workspace_root: workspace 的根路径（来自 Workspace.root_path）。
        change_path: change.path 字段值，可能为 None。
        change_key: change.change_key，用于拼接 worktree 内 .sillyspec 路径。
        lease: 已获取的 WorktreeLease，无 git identity 时为 None。
        requires_worktree: 阶段配置是否要求 worktree。
        read_only: 阶段是否只读。

    Returns:
        确定的工作目录 Path。

    Raises:
        AgentRunError: workspace_root 路径不存在时。
    """
```

**实现逻辑**：

```python
def resolve_work_dir(
    *,
    workspace_root: str,
    change_path: str | None,
    change_key: str | None,
    lease: WorktreeLease | None,
    requires_worktree: bool,
    read_only: bool,
) -> Path:
    ws_root = Path(workspace_root)
    if not ws_root.exists():
        raise AgentRunError(
            f"Workspace root does not exist: {workspace_root}",
            details={"workspace_root": workspace_root},
        )

    # 只读阶段 → workspace root（拼接 change.path）
    if read_only:
        if change_path:
            candidate = ws_root / change_path
            if candidate.is_dir():
                return candidate
        return ws_root

    # 写阶段 + 有 lease → worktree repo
    if lease is not None:
        return Path(lease.path) / "repo"

    # 写阶段 + 无 lease → workspace root（审计日志由调用方记录）
    return ws_root
```

### 2. 修改 start_stage_dispatch 的工作目录确定逻辑

**文件**：`backend/app/modules/agent/service.py`
**位置**：`start_stage_dispatch` 方法 Step 2（line 520-549 附近）

将现有的工作目录确定逻辑替换为调用 `resolve_work_dir`：

```python
# -- 2. Resolve worktree or working directory -------------------------
lease: WorktreeLease | None = None

if requires_worktree:
    lease = await self._try_acquire_lease(
        workspace_id=workspace_id,
        change_id=change_id,
        user_id=user_id,
    )
    # 不再在 lease=None 时抛异常，改为 fallback 到 workspace root

work_dir = resolve_work_dir(
    workspace_root=workspace_root,
    change_path=change.path,
    change_key=change.change_key,
    lease=lease,
    requires_worktree=requires_worktree,
    read_only=read_only,
)

# 审计日志：写阶段 + 无 lease → 记录 warning
if not read_only and lease is None:
    log.warning(
        "stage_dispatch_no_worktree_fallback",
        stage=stage,
        change_id=str(change_id),
        workspace_id=str(workspace_id),
        work_dir=str(work_dir),
    )
```

**关键变化**：
- 移除 `if lease is None: raise AgentRunError(...)` — 改为 fallback 到 workspace root
- 使用 `resolve_work_dir` 统一处理三种场景
- 无 worktree 的写阶段记录审计日志（`log.warning`）

### 3. 新增 _ensure_change_dir_in_worktree 方法

在 `AgentService` 类中新增方法：

```python
async def _ensure_change_dir_in_worktree(
    self,
    work_dir: Path,
    change_key: str,
    workspace_root: str,
) -> None:
    """确保 worktree 内 .sillyspec/changes/<change_key>/ 目录存在。

    如果目录不存在，从主 repo 复制。如果复制失败，记录 warning
    并继续（agent 启动后可通过 sillyspec init 创建）。
    """
    change_dir = work_dir / ".sillyspec" / "changes" / change_key
    if change_dir.exists():
        return

    log.info(
        "ensuring_change_dir_in_worktree",
        change_key=change_key,
        work_dir=str(work_dir),
    )

    # 尝试从主 repo 复制
    source_dir = Path(workspace_root) / ".sillyspec" / "changes" / change_key
    if source_dir.exists():
        try:
            import shutil
            change_dir.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(str(source_dir), str(change_dir))
            log.info("change_dir_copied_from_main_repo", dest=str(change_dir))
        except Exception as exc:
            log.warning(
                "change_dir_copy_failed",
                source=str(source_dir),
                dest=str(change_dir),
                error=str(exc),
            )
    else:
        log.warning(
            "change_dir_not_in_main_repo",
            change_key=change_key,
            source=str(source_dir),
        )
```

### 4. 在 start_stage_dispatch 中调用 _ensure_change_dir_in_worktree

在 `start_stage_dispatch` 方法中，Step 2 之后、Step 3（Build prompt）之前，插入目录检查：

```python
# -- 2b. Ensure .sillyspec/changes/<key>/ exists in worktree -----------
if change.change_key and not read_only:
    await self._ensure_change_dir_in_worktree(
        work_dir=work_dir,
        change_key=change.change_key,
        workspace_root=workspace_root,
    )
```

注意：只在写阶段 + 有 change_key 时才检查，只读阶段不需要。

### 5. 修改 dispatch.py 传递 read_only 和 requires_worktree

**文件**：`backend/app/modules/change/dispatch.py`
**位置**：`dispatch()` 函数（line 160-173），调用 `agent_service.start_stage_dispatch` 的地方

当前代码已经传递了 `requires_worktree` 和 `read_only`，无需修改参数传递。但需确认 `STAGE_AGENT_CONFIG` 的 `read_only` 字段已由 task-03 修正（propose/plan/archive/quick 的 read_from 改为 False）。

**依赖说明**：task-03 已修正 STAGE_AGENT_CONFIG 配置，task-11 已修正只读路径拼接。本任务在此基础上实现目录策略函数和 worktree 检查。

## 接口定义

### resolve_work_dir 函数签名

```python
def resolve_work_dir(
    *,
    workspace_root: str,
    change_path: str | None,
    change_key: str | None,
    lease: WorktreeLease | None,
    requires_worktree: bool,
    read_only: bool,
) -> Path:
    """根据阶段配置和 worktree 可用性确定工作目录。

    纯函数，无 IO 副作用，仅根据输入参数计算路径。

    Args:
        workspace_root: workspace 的根路径。
        change_path: change.path 字段值。
        change_key: change.change_key。
        lease: WorktreeLease 实例或 None。
        requires_worktree: 阶段配置是否要求 worktree。
        read_only: 阶段是否只读。

    Returns:
        工作目录 Path 对象。

    Raises:
        AgentRunError: workspace_root 路径不存在。

    决策表：
        | read_only | lease   | 结果              |
        |-----------|---------|-------------------|
        | True      | *       | workspace root    |
        | False     | 非 None | lease.path / repo |
        | False     | None    | workspace root    |
    """
```

### _ensure_change_dir_in_worktree 方法签名

```python
async def _ensure_change_dir_in_worktree(
    self,
    work_dir: Path,
    change_key: str,
    workspace_root: str,
) -> None:
    """确保 worktree 内 .sillyspec/changes/<change_key>/ 目录存在。

    检查 work_dir/.sillyspec/changes/<change_key>/ 是否存在：
      - 存在 → 直接返回
      - 不存在 + 主 repo 有对应目录 → shutil.copytree 复制
      - 不存在 + 主 repo 也没有 → 记录 warning，不中断

    Args:
        work_dir: 当前工作目录（worktree repo 或 workspace root）。
        change_key: 变更 key（如 "agent-stage-dispatch"）。
        workspace_root: workspace 根路径（主 repo 位置）。
    """
```

### 控制流伪代码

```
start_stage_dispatch(workspace_id, change_id, user_id, stage, prompt_template,
                     requires_worktree, read_only):

    # Step 1: 加载 Change
    change = session.get(Change, change_id)
    workspace_root = _get_workspace_root(workspace_id)

    # Step 2: 尝试获取 worktree lease
    lease = None
    if requires_worktree:
        lease = _try_acquire_lease(workspace_id, change_id, user_id)
        # 注意：lease=None 不再抛异常

    # Step 3: 确定工作目录（新逻辑）
    work_dir = resolve_work_dir(
        workspace_root=workspace_root,
        change_path=change.path,
        change_key=change.change_key,
        lease=lease,
        requires_worktree=requires_worktree,
        read_only=read_only,
    )

    # Step 3b: 审计日志 — 写阶段无 worktree
    if not read_only and lease is None:
        log.warning("stage_dispatch_no_worktree_fallback", ...)

    # Step 3c: 确保 .sillyspec/changes/<key>/ 存在
    if change.change_key and not read_only:
        _ensure_change_dir_in_worktree(work_dir, change.change_key, workspace_root)

    # Step 4-6: 构建 prompt、创建 AgentRun、执行（与现有逻辑相同）
    ...
```

## 边界处理（8 条）

1. **worktree lease 获取失败（无 git identity）+ 写阶段**：不再抛出 `AgentRunError`，改为 fallback 到 `workspace_root`，并记录 `log.warning("stage_dispatch_no_worktree_fallback", ...)` 审计日志。Agent 仍可工作，只是写入 workspace root 而非隔离的 worktree。

2. **workspace root 路径不存在**：`resolve_work_dir` 中检查 `ws_root.exists()`，不存在则抛出 `AgentRunError`（details 含 workspace_root 路径），阻止继续调度。

3. **只读阶段误判为写阶段**：依赖 `STAGE_AGENT_CONFIG` 的 `read_only` 字段判断（task-03 已补齐所有 8 个阶段的配置），不依赖其他条件。`resolve_work_dir` 首先检查 `read_only`，确保只读阶段始终走 workspace root 路径。

4. **worktree 内 `.sillyspec/changes/<change_key>/` 不存在**：`_ensure_change_dir_in_worktree` 检查后尝试从主 repo 复制。复制成功则继续；复制失败（权限不足、磁盘满等）记录 warning，不中断。Agent 启动后可通过 `sillyspec init` 自行创建。

5. **主 repo 中也无 `.sillyspec/changes/<change_key>/` 目录**：说明变更尚未在该 workspace 初始化过。`_ensure_change_dir_in_worktree` 记录 warning（`change_dir_not_in_main_repo`），不中断流程。Agent 执行 `sillyspec run <stage> --change <key>` 时 CLI 会自动创建。

6. **change_path 为 None 或空字符串**：`resolve_work_dir` 中 `change_path` 参数为 `None` 时，跳过拼接逻辑，直接使用 `workspace_root`。对应场景：新创建的 change 尚未设置 path 字段。

7. **change_key 为 None**：跳过 `_ensure_change_dir_in_worktree` 检查（`if change.change_key and not read_only` 条件不满足）。对应场景：数据不完整的旧 change 记录。

8. **shutil.copytree 目标目录已存在**：`_ensure_change_dir_in_worktree` 首先检查 `change_dir.exists()`，已存在时直接返回，不会触发 copytree。避免 `shutil.copytree` 的 "目标已存在" 异常。

## 非目标

- **不实现 worktree 自动创建**：worktree 的创建和 lease 管理由现有 `WorktreeService.acquire()` 负责，本任务只使用返回的 lease
- **不修改 WorktreeLease 模型**：模型字段不变，本任务只读取 `lease.path`
- **不修改 STAGE_AGENT_CONFIG 配置值**：由 task-03 负责
- **不修改 `_execute_stage_run` 的 CLAUDE.md 渲染逻辑**：由 task-04 负责
- **不实现 sillyspec init 触发**：目录不存在时只记录日志，不主动调用 `sillyspec init --dir`，agent 启动后自行处理

## 参考

- design.md Phase 5 "写阶段运行目录策略"（三种场景决策表）
- design.md Phase 5 "worktree 内 change 目录"（检查与复制逻辑）
- design.md Phase 5 "修复只读路径判断"（task-11 修正 change.path 拼接）
- requirements.md FR-08 "工作目录正确"
- 现有 `start_stage_dispatch` Step 2（`backend/app/modules/agent/service.py:520-549`）— 本任务修改此段
- 现有 `_try_acquire_lease`（`backend/app/modules/agent/service.py:604-648`）— 本任务复用，但不修改
- 现有 `WorktreeLease.path` 字段（`backend/app/modules/worktree/model.py:68-70`）— lease path 指向 worktree 根，实际 repo 在 `path / "repo"`
- 现有 `GitIdentity` 模型（`backend/app/modules/git_identity/model.py`）— `_try_acquire_lease` 查询此表

## TDD 步骤

1. **写测试：有 git identity + 写阶段 → worktree repo**
   - 测试文件：`backend/tests/modules/agent/test_work_dir_strategy.py`
   - 准备：创建 mock WorktreeLease（path="/tmp/worktree-1"）
   - 调用 `resolve_work_dir(lease=mock_lease, read_only=False, requires_worktree=True, ...)`
   - 断言返回 `Path("/tmp/worktree-1/repo")`
   - **预期：测试失败**（函数尚未实现）

2. **写测试：无 git identity + 写阶段 → workspace root**
   - 调用 `resolve_work_dir(lease=None, read_only=False, requires_worktree=True, workspace_root="/tmp/ws", ...)`
   - 断言返回 `Path("/tmp/ws")`
   - **预期：测试失败**

3. **写测试：只读阶段 → workspace root**
   - 调用 `resolve_work_dir(lease=mock_lease, read_only=True, ...)`
   - 断言忽略 lease，返回 workspace root（或 workspace_root / change_path）
   - **预期：测试失败**

4. **写测试：workspace root 不存在 → 抛异常**
   - 调用 `resolve_work_dir(workspace_root="/nonexistent/path", ...)`
   - 断言抛出 `AgentRunError`
   - **预期：测试失败**

5. **写测试：_ensure_change_dir_in_worktree 复制成功**
   - Mock：主 repo 中存在 `.sillyspec/changes/test-change/` 目录
   - 调用 `_ensure_change_dir_in_worktree(work_dir, "test-change", workspace_root)`
   - 断言 `work_dir/.sillyspec/changes/test-change/` 存在
   - **预期：测试失败**

6. **写测试：_ensure_change_dir_in_worktree 目录已存在**
   - 预先创建 `work_dir/.sillyspec/changes/test-change/`
   - 调用方法
   - 断言不报错，不执行复制（shutil.copytree 不被调用）
   - **预期：测试失败**

7. **实现 resolve_work_dir + _ensure_change_dir_in_worktree**
   - 在 service.py 中实现两个函数/方法
   - 修改 start_stage_dispatch 的工作目录确定逻辑
   - **预期：测试 1-6 全部通过**

8. **写测试：start_stage_dispatch 写阶段无 worktree 时记录审计**
   - Mock `_try_acquire_lease` 返回 None
   - 调用 `start_stage_dispatch(read_only=False, requires_worktree=True, ...)`
   - 断言 log.warning 被调用（含 "stage_dispatch_no_worktree_fallback"）
   - 断言 work_dir 为 workspace root
   - **预期：通过**

9. **写测试：start_stage_dispatch 只读阶段跳过目录检查**
   - Mock `_ensure_change_dir_in_worktree`
   - 调用 `start_stage_dispatch(read_only=True, ...)`
   - 断言 `_ensure_change_dir_in_worktree` 未被调用
   - **预期：通过**

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | 有 git identity + 写阶段（lease 非 None） | `resolve_work_dir` 返回 `lease.path / "repo"`，即 worktree repo 目录 |
| AC-02 | 无 git identity + 写阶段（lease 为 None） | `resolve_work_dir` 返回 workspace root；`start_stage_dispatch` 记录 `log.warning("stage_dispatch_no_worktree_fallback")` 审计日志 |
| AC-03 | 只读阶段（read_only=True） | `resolve_work_dir` 忽略 lease，返回 workspace root（优先使用 `workspace_root / change.path` 如果 change.path 是有效目录） |
| AC-04 | workspace root 路径不存在 | `resolve_work_dir` 抛出 `AgentRunError`，details 含 workspace_root 值 |
| AC-05 | worktree 内 `.sillyspec/changes/<key>/` 不存在 | `_ensure_change_dir_in_worktree` 从主 repo 复制；主 repo 也没有则记录 warning，不中断 |
| AC-06 | worktree 内 `.sillyspec/changes/<key>/` 已存在 | `_ensure_change_dir_in_worktree` 直接返回，不执行复制 |
| AC-07 | 只读阶段不触发目录检查 | `start_stage_dispatch(read_only=True)` 不调用 `_ensure_change_dir_in_worktree` |
| AC-08 | propose 阶段工作目录可写 | propose 的 `read_only=False`（task-03 修正后），work_dir 为 worktree repo 或 workspace root，均可写入 |
