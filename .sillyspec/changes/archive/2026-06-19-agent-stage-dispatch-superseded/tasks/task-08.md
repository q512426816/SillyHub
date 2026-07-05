---
id: task-08
title: 迁移 change_writer 路由到新调度服务
priority: P0
estimated_hours: 2
depends_on: [task-07]
blocks: []
allowed_paths:
  - backend/app/modules/change_writer/router.py
author: qinyi
created_at: 2026-06-01 06:56:11
---

# task-08: 迁移 change_writer 路由到新调度服务

## 修改文件

- `backend/app/modules/change_writer/router.py`

## 实现要求

根据 design.md Phase 1 "废弃 start_sillyspec_run" 的路由迁移说明：

1. 将 `change_writer/router.py` 第 152-161 行的 `coordinator.start_sillyspec_run()` 调用替换为 `SillySpecStageDispatchService.dispatch_next_step()`
2. 更新 import 语句：移除 `ExecutionCoordinatorService` 的 import，新增 `SillySpecStageDispatchService` 的 import
3. 适配返回值：`dispatch_next_step` 返回 `dict[str, Any]`（包含 `dispatched`、`agent_run_id`、`stage`、`reason` 等字段），与原来 `start_sillyspec_run` 返回 `AgentRun` 对象不同
4. 确保路由端点 `POST /changes/{change_key}/execute` 的功能不变（触发变更执行并返回结果）
5. 清理因迁移不再需要的局部变量和参数（如 `scope`、`repo_dir`、`coordinator` 等）

## 接口定义

### 修改前（当前代码，line 101-161）

```python
@router.post(
    "/changes/{change_key}/execute",
    response_model=dict,
)
async def execute_change(
    workspace_id: uuid.UUID,
    change_key: str,
    session: SessionDep,
    user: CurrentUser,
) -> dict:
    """Trigger change execution — create a SillySpec AgentRun and dispatch in background."""
    from pathlib import Path

    from sqlalchemy import select
    from sqlmodel import col

    from app.core.errors import AppError, WorkspaceNotFound
    from app.modules.agent.coordinator import ExecutionCoordinatorService
    from app.modules.change.model import Change
    from app.modules.workspace.model import Workspace
    from app.modules.workspace.service import _rewrite_path

    # Look up the change record
    stmt = select(Change).where(
        col(Change.workspace_id) == workspace_id,
        col(Change.change_key) == change_key,
    )
    change = (await session.execute(stmt)).scalars().first()
    if change is None:
        raise AppError(f"Change '{change_key}' not found.", http_status=404)

    # Stage guard
    current_stage = getattr(change, "current_stage", None) or "draft"
    if current_stage != "ready_for_dev":
        raise AppError(
            f"Change '{change_key}' 当前阶段为 '{current_stage}'，"
            f"仅当阶段为 'ready_for_dev' 时可执行。"
            f"请先完成设计评审并流转至 ready_for_dev。",
            http_status=409,
        )

    # Resolve repo directory from workspace
    workspace = await session.get(Workspace, workspace_id)
    if workspace is None:
        raise WorkspaceNotFound("Workspace not found.")
    repo_dir = Path(_rewrite_path(workspace.root_path))

    # Determine scope from change_type, default to "full"
    scope = change.change_type if change.change_type in ("full", "quick") else "full"

    coordinator = ExecutionCoordinatorService(session)
    run = await coordinator.start_sillyspec_run(
        change_key=change_key,
        workspace_id=workspace_id,
        user_id=user.id,
        scope=scope,
        repo_dir=repo_dir,
    )

    return {"ok": True, "run_id": str(run.id)}
```

### 修改后（目标代码）

```python
@router.post(
    "/changes/{change_key}/execute",
    response_model=dict,
)
async def execute_change(
    workspace_id: uuid.UUID,
    change_key: str,
    session: SessionDep,
    user: CurrentUser,
) -> dict:
    """Trigger change execution — dispatch via unified stage dispatch service."""
    from sqlalchemy import select
    from sqlmodel import col

    from app.core.errors import AppError
    from app.modules.change.dispatch import SillySpecStageDispatchService
    from app.modules.change.model import Change

    # Look up the change record
    stmt = select(Change).where(
        col(Change.workspace_id) == workspace_id,
        col(Change.change_key) == change_key,
    )
    change = (await session.execute(stmt)).scalars().first()
    if change is None:
        raise AppError(f"Change '{change_key}' not found.", http_status=404)

    # Stage guard (task-04)
    current_stage = getattr(change, "current_stage", None) or "draft"
    if current_stage != "ready_for_dev":
        raise AppError(
            f"Change '{change_key}' 当前阶段为 '{current_stage}'，"
            f"仅当阶段为 'ready_for_dev' 时可执行。"
            f"请先完成设计评审并流转至 ready_for_dev。",
            http_status=409,
        )
    # End stage guard

    # Dispatch via unified service
    service = SillySpecStageDispatchService(session)
    result = await service.dispatch_next_step(
        session=session,
        workspace_id=workspace_id,
        change_id=change.id,
        user_id=user.id,
        target_stage="execute",
    )

    if not result.get("dispatched"):
        return {
            "ok": False,
            "reason": result.get("reason", "dispatch_failed"),
            "stage": result.get("stage"),
        }

    return {
        "ok": True,
        "run_id": result["agent_run_id"],
        "stage": result.get("stage"),
    }
```

### import 变更对照

| 修改前 | 修改后 | 说明 |
|--------|--------|------|
| `from pathlib import Path` | （删除） | 不再需要 Path 构造 repo_dir |
| `from app.core.errors import AppError, WorkspaceNotFound` | `from app.core.errors import AppError` | 不再需要 WorkspaceNotFound（不查 workspace） |
| `from app.modules.agent.coordinator import ExecutionCoordinatorService` | `from app.modules.change.dispatch import SillySpecStageDispatchService` | 核心替换 |
| `from app.modules.change.model import Change` | `from app.modules.change.model import Change` | 保留不变 |
| `from app.modules.workspace.model import Workspace` | （删除） | 不再查 workspace |
| `from app.modules.workspace.service import _rewrite_path` | （删除） | 不再需要路径重写 |

### dispatch_next_step 签名（来自 task-07 / design.md）

```python
class SillySpecStageDispatchService:
    async def dispatch_next_step(
        self,
        session: AsyncSession,
        workspace_id: UUID,
        change_id: UUID,
        user_id: UUID,
        target_stage: str,
    ) -> dict[str, Any]:
        """为指定变更的阶段调度下一个 step。

        返回值示例:
          成功: {"dispatched": True, "agent_run_id": "uuid-str", "stage": "execute"}
          失败: {"dispatched": False, "reason": "active_run_exists", "stage": "execute"}
        """
```

### 返回值对比

| 场景 | 修改前返回 | 修改后返回 |
|------|-----------|-----------|
| 成功调度 | `{"ok": True, "run_id": "<uuid>"}` | `{"ok": True, "run_id": "<uuid>", "stage": "execute"}` |
| 未调度 | 不可能（旧路径无此场景） | `{"ok": False, "reason": "<reason>", "stage": "<stage>"}` |

## 边界处理

1. **dispatched=False 时前端收到合理响应**：当 `dispatch_next_step` 返回 `{"dispatched": False, "reason": "..."}` 时，路由返回 `{"ok": False, "reason": "<reason>", "stage": "<stage>"}`，前端可据此展示失败原因。不抛异常、不返回 500。
2. **dispatch_next_step 抛出异常时**：`AppError` 及其子类正常传播到 FastAPI 全局异常处理器，返回对应的 HTTP 状态码和错误信息。非 AppError 异常由 FastAPI 默认处理为 500。
3. **旧 import 遗留清理**：移除 `from pathlib import Path`、`from app.modules.workspace.model import Workspace`、`from app.modules.workspace.service import _rewrite_path`、`from app.core.errors import WorkspaceNotFound` 等不再使用的 import，确保无 lint 警告。
4. **stage guard 逻辑保留不变**：`current_stage != "ready_for_dev"` 的守卫检查完整保留，不修改判断条件、错误消息或 HTTP 状态码。
5. **路由权限检查不变**：`SessionDep` 和 `CurrentUser` 依赖注入保持原样，`require_permission` 等权限机制（如果上层有中间件）不受影响。
6. **change.id 类型**：`dispatch_next_step` 接收 `change_id: UUID`，`change.id` 已是 UUID 类型，无需类型转换。若 change 为 None（理论上已被前面 `AppError(404)` 守卫拦截），不会到达 dispatch 调用。
7. **target_stage 硬编码为 "execute"**：此路由端点专用于执行阶段，`target_stage` 参数硬编码为 `"execute"`。变更类型（full/quick）的区分由 `SillySpecStageDispatchService` 内部的 `STAGE_AGENT_CONFIG` 处理，路由层不再传递 scope 参数。

## 非目标

- 不修改 `SillySpecStageDispatchService` 的实现（task-07 的职责）
- 不修改其他路由或服务文件
- 不删除 `coordinator.start_sillyspec_run` 方法体（task-01 仅标记 deprecated，保留方法体）
- 不修改 `POST /changes/{change_key}/execute` 的 URL 路径或 HTTP 方法
- 不修改 stage guard 的判断逻辑
- 不新增 schema 或 response model（使用 `response_model=dict` 保持原样）
- 不修改前端代码

## 参考

- design.md Phase 1 "废弃 start_sillyspec_run" 的路由迁移说明（line 56-60）
- requirements.md FR-02 "废弃子进程直跑路径"
- `backend/app/modules/change/dispatch.py` 中现有的 `dispatch()` 函数（line 114-192），作为 `SillySpecStageDispatchService.dispatch_next_step()` 的参照
- `backend/app/modules/agent/coordinator.py` 中 `start_sillyspec_run()` 的签名（line 427-473），理解被替换的旧接口
- task-07 蓝图定义了 `SillySpecStageDispatchService` 类的创建

## TDD 步骤

1. **写测试**：在 `backend/tests/modules/change_writer/test_router.py`（如不存在则新建）新增测试：
   - `test_execute_change_calls_dispatch_next_step`：mock `SillySpecStageDispatchService.dispatch_next_step`，调用 `POST /changes/{change_key}/execute`，验证 `dispatch_next_step` 被正确调用（参数包含正确的 `workspace_id`、`change_id`、`user_id`、`target_stage="execute"`）
   - `test_execute_change_returns_run_id_on_success`：mock `dispatch_next_step` 返回 `{"dispatched": True, "agent_run_id": "test-uuid", "stage": "execute"}`，验证响应为 `{"ok": True, "run_id": "test-uuid", "stage": "execute"}`
   - `test_execute_change_returns_reason_on_dispatch_failure`：mock `dispatch_next_step` 返回 `{"dispatched": False, "reason": "active_run_exists", "stage": "execute"}`，验证响应为 `{"ok": False, "reason": "active_run_exists", "stage": "execute"}`
   - `test_execute_change_does_not_import_coordinator`：检查 `change_writer/router.py` 源码中不含 `ExecutionCoordinatorService` 的 import
2. **确认失败**：运行测试，因当前代码仍使用 `coordinator.start_sillyspec_run`，mock 断言失败
3. **替换调用**：按"接口定义 > 修改后"代码替换 `execute_change` 路由实现
4. **确认通过**：运行测试，全部通过
5. **回归验证**：运行现有 `change_writer` 测试确认无破坏；运行 `grep -r "start_sillyspec_run" backend/app/modules/change_writer/` 确认无旧调用残留

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `grep -n "start_sillyspec_run" backend/app/modules/change_writer/router.py` | 无匹配结果（该文件不再调用旧方法） |
| AC-02 | `grep -n "ExecutionCoordinatorService" backend/app/modules/change_writer/router.py` | 无匹配结果（该文件不再 import 旧 coordinator） |
| AC-03 | `grep -n "dispatch_next_step" backend/app/modules/change_writer/router.py` | 存在匹配，且调用参数包含 `target_stage="execute"` |
| AC-04 | `grep -n "SillySpecStageDispatchService" backend/app/modules/change_writer/router.py` | 存在 import 和实例化 |
| AC-05 | 路由端点 `POST /changes/{change_key}/execute` 功能不变 | stage guard 逻辑完整保留；成功时返回 `{"ok": True, "run_id": "..."}`；失败时返回 `{"ok": False, "reason": "..."}` |
| AC-06 | dispatched=False 时前端收到合理响应 | 返回 `{"ok": False, "reason": "<具体原因>", "stage": "<阶段>"}`，HTTP 200 |
| AC-07 | 新增单测全部通过 | `test_execute_change_calls_dispatch_next_step`、`test_execute_change_returns_run_id_on_success`、`test_execute_change_returns_reason_on_dispatch_failure`、`test_execute_change_does_not_import_coordinator` 四个测试通过 |
| AC-08 | 现有 change_writer 测试通过 | 回归测试无破坏 |
