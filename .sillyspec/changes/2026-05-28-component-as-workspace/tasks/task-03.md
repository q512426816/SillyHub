---
author: qinyi
created_at: 2026-05-29T17:40:00+08:00
id: task-03
title: "Change/Task/AgentRun M:N 关联 — 关联表 + 查询逻辑"
priority: P0
estimated_hours: 4
depends_on: [task-01]
blocks: [task-08]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/router.py
  - backend/app/modules/task/service.py
  - backend/app/modules/task/router.py
  - backend/app/modules/agent/service.py
  - backend/app/modules/agent/router.py
  - backend/app/modules/change/tests/test_router.py
  - backend/app/modules/task/tests/test_router.py
  - backend/app/modules/agent/tests/test_router.py
---

# task-03: Change/Task/AgentRun M:N 关联 — 关联表 + 查询逻辑

## 上下文

**文档依据：**
- 设计文档：`.sillyspec/changes/2026-05-28-component-as-workspace/design.md` (ADR-04)
- 实现计划：`.sillyspec/changes/2026-05-28-component-as-workspace/plan.md` (Wave 2)

**目标：** 为 Change、Task、AgentRun 三个实体实现 M:N 关联查询逻辑，使 API 响应中包含 `workspace_ids` 列表，并支持通过 M:N 表跨 workspace 查询。

**当前状态：**
- M:N 关联表模型（`ChangeWorkspace`、`TaskWorkspace`、`AgentRunWorkspace`）已由 task-01 在 `backend/app/modules/workspace/model.py` 中定义
- Schema 已包含 `workspace_ids` 字段（`ChangeRead`、`ChangeSummary`、`TaskSummary`、`TaskRead`、`AgentRunResponse`）
- Agent 模块的 enrich 方法（`enrich_with_workspace_ids`、`enrich_list`）和 M:N 查询已实现
- Change 和 Task 模块的 service/router 尚未适配 M:N 逻辑——这是本任务的主要工作

**核心原则：** 一个变更可能影响多个组件（如修改 shared library 的接口会影响所有依赖方），绑定到单个 workspace 无法表达这种场景。M:N 关联解决了这个问题。保留 `workspace_id` FK 作为"主 workspace"保证向后兼容。

## 修改文件（必填）

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/change/service.py` | 修改 | 新增 enrich 方法 + M:N 查询 + reparse 同步关联表 |
| `backend/app/modules/change/router.py` | 修改 | 适配 enrich 调用 |
| `backend/app/modules/task/service.py` | 修改 | 新增 enrich 方法 + M:N 查询 + reparse 同步关联表 |
| `backend/app/modules/task/router.py` | 修改 | 适配 enrich 调用 |
| `backend/app/modules/change/tests/test_router.py` | 修改 | 新增 M:N 相关测试用例 |
| `backend/app/modules/task/tests/test_router.py` | 修改 | 新增 M:N 相关测试用例 |

以下文件**已经实现**，本任务只需验证/确认：
- `backend/app/modules/workspace/model.py` — `ChangeWorkspace`、`TaskWorkspace`、`AgentRunWorkspace` 模型已存在
- `backend/app/modules/change/schema.py` — `workspace_ids` 字段已存在
- `backend/app/modules/task/schema.py` — `workspace_ids` 字段已存在
- `backend/app/modules/agent/schema.py` — `workspace_ids` 字段已存在
- `backend/app/modules/agent/service.py` — enrich + M:N 查询已实现
- `backend/app/modules/agent/router.py` — enrich 调用已实现

## 实现要求

### 1. change/service.py — 新增 M:N 逻辑

#### 1.1 新增 import

在文件顶部 import 区域新增：

```python
from app.modules.workspace.model import ChangeWorkspace, Workspace
```

#### 1.2 新增 `enrich_with_workspace_ids` 方法

```python
async def enrich_with_workspace_ids(self, change: Change) -> ChangeRead:
    """Build ChangeRead with workspace_ids populated from M:N table.

    workspace_ids 列表以主 workspace_id 开头，后接 M:N 表中的
    secondary workspace IDs。列表不重复。
    """
    stmt = select(ChangeWorkspace.workspace_id).where(
        col(ChangeWorkspace.change_id) == change.id,
    )
    secondary = [row[0] for row in (await self._session.execute(stmt)).all()]
    data = ChangeRead.model_validate(change)
    data.workspace_ids = [change.workspace_id] + secondary
    return data
```

#### 1.3 新增 `enrich_summaries` 方法

```python
async def enrich_summaries(self, changes: list[Change]) -> list[ChangeSummary]:
    """Build ChangeSummary list with workspace_ids populated.

    对每个 change 查询 M:N 表获取关联 workspace IDs。
    如果 changes 数量大（>50），建议改为批量查询一次——
    但当前 MVP 阶段逐条查询足够。
    """
    result: list[ChangeSummary] = []
    for c in changes:
        stmt = select(ChangeWorkspace.workspace_id).where(
            col(ChangeWorkspace.change_id) == c.id,
        )
        secondary = [row[0] for row in (await self._session.execute(stmt)).all()]
        data = ChangeSummary.model_validate(c)
        data.workspace_ids = [c.workspace_id] + secondary
        result.append(data)
    return result
```

#### 1.4 修改 `list_` 方法 — 支持 M:N 查询

将现有 `list_` 方法中的查询改为同时查主 FK 和 M:N 表：

```python
async def list_(
    self,
    workspace_id: uuid.UUID,
    *,
    location: str | None = None,
    status: str | None = None,
    owner: str | None = None,
) -> tuple[list[Change], int]:
    await self._workspace_service.get(workspace_id)

    # 通过主 workspace FK 或 M:N 关联表查询
    mn_subq = select(ChangeWorkspace.change_id).where(
        col(ChangeWorkspace.workspace_id) == workspace_id,
    )
    stmt = select(Change).where(
        (col(Change.workspace_id) == workspace_id)
        | (col(Change.id).in_(mn_subq))
    )

    if location:
        stmt = stmt.where(col(Change.location) == location)
    if status:
        stmt = stmt.where(col(Change.status) == status)
    if owner:
        try:
            owner_uuid = uuid.UUID(owner)
            stmt = stmt.where(col(Change.owner_id) == owner_uuid)
        except ValueError:
            pass
    stmt = stmt.order_by(col(Change.change_key).asc())
    items = list((await self._session.execute(stmt)).scalars().all())
    # 去重（主 workspace 和 M:N 可能重复）
    seen: set[uuid.UUID] = set()
    unique_items: list[Change] = []
    for item in items:
        if item.id not in seen:
            seen.add(item.id)
            unique_items.append(item)
    return unique_items, len(unique_items)
```

#### 1.5 修改 `get` 方法 — 支持 M:N 查询

```python
async def get(self, workspace_id: uuid.UUID, change_id: uuid.UUID) -> Change:
    await self._workspace_service.get(workspace_id)

    # 先尝试主 workspace 匹配
    stmt = select(Change).where(
        col(Change.id) == change_id,
        col(Change.workspace_id) == workspace_id,
    )
    change = (await self._session.execute(stmt)).scalars().first()

    # 如果主 workspace 不匹配，检查 M:N 表
    if change is None:
        mn_stmt = select(ChangeWorkspace).where(
            col(ChangeWorkspace.change_id) == change_id,
            col(ChangeWorkspace.workspace_id) == workspace_id,
        )
        mn = (await self._session.execute(mn_stmt)).scalars().first()
        if mn is not None:
            change = await self._session.get(Change, change_id)

    if change is None:
        raise ChangeNotFound(
            f"Change '{change_id}' not found.",
            details={
                "workspace_id": str(workspace_id),
                "change_id": str(change_id),
            },
        )
    return change
```

#### 1.6 新增 `_sync_change_workspaces` 方法

在 reparse 流程中调用，根据 `affected_components` 同步 M:N 关联：

```python
async def _sync_change_workspaces(
    self,
    change_id: uuid.UUID,
    workspace_id: uuid.UUID,
    parsed: ParsedChange,
) -> None:
    """Sync M:N associations for a change based on affected_components.

    策略：
    1. 主 workspace 始终作为 role="primary" 写入
    2. affected_components 中的 component_key 匹配到的 workspace 作为 role="affected" 写入
    3. 已存在但不在新列表中的关联被删除
    """
    ws_ids: set[uuid.UUID] = {workspace_id}
    if parsed.affected_components:
        stmt = select(Workspace.id).where(
            col(Workspace.component_key).in_(parsed.affected_components),
            col(Workspace.deleted_at).is_(None),
        )
        extra = [row[0] for row in (await self._session.execute(stmt)).all()]
        ws_ids.update(extra)

    # 获取已存在的关联
    existing_stmt = select(ChangeWorkspace).where(
        col(ChangeWorkspace.change_id) == change_id,
    )
    existing = list(
        (await self._session.execute(existing_stmt)).scalars().all()
    )
    existing_ws_ids = {cw.workspace_id for cw in existing}

    # 删除不再需要的关联
    for cw in existing:
        if cw.workspace_id not in ws_ids:
            await self._session.delete(cw)

    # 新增关联
    for wid in ws_ids - existing_ws_ids:
        role = "primary" if wid == workspace_id else "affected"
        self._session.add(
            ChangeWorkspace(
                change_id=change_id,
                workspace_id=wid,
                role=role,
            )
        )
```

#### 1.7 修改 `reparse` 方法 — 添加 sync 调用

在 reparse 主循环中，处理完每个 parsed change 后调用 `_sync_change_workspaces`：

```python
# 在 reparse 方法中，处理 seen_keys 的 for 循环内：
for parsed in result.changes:
    seen_keys.add(parsed.change_key)
    stats["parsed"] += 1

    if parsed.change_key in existing_by_key:
        row = existing_by_key[parsed.change_key]
        self._apply_parsed(row, parsed, workspace_id=workspace_id)
        stats["updated"] += 1
    else:
        row = self._build_change(parsed, workspace_id=workspace_id)
        self._session.add(row)
        stats["created"] += 1

    # Sync documents for this change
    await self._sync_docs(
        change=parsed,
        workspace_id=workspace_id,
        existing_change=(
            existing_by_key.get(parsed.change_key)
            if parsed.change_key in existing_by_key
            else row
        ),
        stats=stats,
    )

    # ★ 新增：Sync M:N workspace associations
    target_id = (
        existing_by_key[parsed.change_key].id
        if parsed.change_key in existing_by_key
        else row.id
    )
    await self._sync_change_workspaces(
        change_id=target_id,
        workspace_id=workspace_id,
        parsed=parsed,
    )
```

### 2. change/router.py — 适配 enrich

#### 2.1 修改 `list_changes` 端点

```python
@router.get(
    "/changes",
    response_model=ChangeList,
)
async def list_changes(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
    location: str | None = Query(None),
    status: str | None = Query(None),
    owner: str | None = Query(None),
) -> ChangeList:
    service = ChangeService(session)
    items, total = await service.list_(
        workspace_id,
        location=location,
        status=status,
        owner=owner,
    )
    enriched = await service.enrich_summaries(items)
    return ChangeList(items=enriched, total=total)
```

**变更点：** 将 `ChangeSummary.model_validate(c) for c in items` 替换为 `service.enrich_summaries(items)`。

#### 2.2 修改 `get_change` 端点

```python
@router.get(
    "/changes/{change_id}",
    response_model=ChangeRead,
)
async def get_change(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> ChangeRead:
    service = ChangeService(session)
    change = await service.get(workspace_id, change_id)
    return await service.enrich_with_workspace_ids(change)
```

**变更点：** 将 `ChangeRead.model_validate(change)` 替换为 `service.enrich_with_workspace_ids(change)`。

### 3. task/service.py — 新增 M:N 逻辑

#### 3.1 新增 import

```python
from app.modules.workspace.model import TaskWorkspace, Workspace
```

#### 3.2 新增 `enrich_with_workspace_ids` 方法

```python
async def enrich_with_workspace_ids(self, task: Task) -> TaskRead:
    """Build TaskRead with workspace_ids populated from M:N table."""
    stmt = select(TaskWorkspace.workspace_id).where(
        col(TaskWorkspace.task_id) == task.id,
    )
    secondary = [row[0] for row in (await self._session.execute(stmt)).all()]
    data = TaskRead.model_validate(task)
    data.workspace_ids = [task.workspace_id] + secondary
    return data
```

#### 3.3 新增 `enrich_summaries` 方法

```python
async def enrich_summaries(self, tasks: list[Task]) -> list[TaskSummary]:
    """Build TaskSummary list with workspace_ids populated."""
    result: list[TaskSummary] = []
    for t in tasks:
        stmt = select(TaskWorkspace.workspace_id).where(
            col(TaskWorkspace.task_id) == t.id,
        )
        secondary = [row[0] for row in (await self._session.execute(stmt)).all()]
        data = TaskSummary.model_validate(t)
        data.workspace_ids = [t.workspace_id] + secondary
        result.append(data)
    return result
```

#### 3.4 修改 `list_` 方法 — 支持 M:N 查询

```python
async def list_(
    self,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    *,
    status: str | None = None,
    owner: str | None = None,
    priority: str | None = None,
    phase: str | None = None,
) -> tuple[list[Task], int]:
    await self._change_service.get(workspace_id, change_id)

    mn_subq = select(TaskWorkspace.task_id).where(
        col(TaskWorkspace.workspace_id) == workspace_id,
    )
    stmt = select(Task).where(
        (col(Task.workspace_id) == workspace_id)
        | (col(Task.id).in_(mn_subq)),
        col(Task.change_id) == change_id,
    )
    if status:
        stmt = stmt.where(col(Task.status) == status)
    if owner:
        stmt = stmt.where(col(Task.owner_key) == owner)
    if priority:
        stmt = stmt.where(col(Task.priority) == priority)
    if phase:
        stmt = stmt.where(col(Task.phase) == phase)
    stmt = stmt.order_by(col(Task.task_key).asc())
    items = list((await self._session.execute(stmt)).scalars().all())
    # 去重
    seen: set[uuid.UUID] = set()
    unique_items: list[Task] = []
    for item in items:
        if item.id not in seen:
            seen.add(item.id)
            unique_items.append(item)
    return unique_items, len(unique_items)
```

#### 3.5 修改 `get` 方法 — 支持 M:N 查询

```python
async def get(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task:
    stmt = select(Task).where(
        col(Task.id) == task_id,
        col(Task.workspace_id) == workspace_id,
    )
    task = (await self._session.execute(stmt)).scalars().first()

    if task is None:
        mn_stmt = select(TaskWorkspace).where(
            col(TaskWorkspace.task_id) == task_id,
            col(TaskWorkspace.workspace_id) == workspace_id,
        )
        mn = (await self._session.execute(mn_stmt)).scalars().first()
        if mn is not None:
            task = await self._session.get(Task, task_id)

    if task is None:
        raise TaskNotFound(
            f"Task '{task_id}' not found.",
            details={
                "workspace_id": str(workspace_id),
                "task_id": str(task_id),
            },
        )
    return task
```

#### 3.6 新增 `_sync_task_workspaces` 方法

```python
async def _sync_task_workspaces(
    self,
    task_id: uuid.UUID,
    workspace_id: uuid.UUID,
    parsed: Any,
) -> None:
    """Sync M:N associations for a task based on affected_components."""
    ws_ids: set[uuid.UUID] = {workspace_id}
    if parsed.affected_components:
        stmt = select(Workspace.id).where(
            col(Workspace.component_key).in_(parsed.affected_components),
            col(Workspace.deleted_at).is_(None),
        )
        extra = [row[0] for row in (await self._session.execute(stmt)).all()]
        ws_ids.update(extra)

    existing_stmt = select(TaskWorkspace).where(
        col(TaskWorkspace.task_id) == task_id,
    )
    existing = list(
        (await self._session.execute(existing_stmt)).scalars().all()
    )
    existing_ws_ids = {tw.workspace_id for tw in existing}

    for tw in existing:
        if tw.workspace_id not in ws_ids:
            await self._session.delete(tw)

    for wid in ws_ids - existing_ws_ids:
        role = "primary" if wid == workspace_id else "affected"
        self._session.add(
            TaskWorkspace(
                task_id=task_id,
                workspace_id=wid,
                role=role,
            )
        )
```

#### 3.7 修改 `reparse` 方法 — 添加 sync 调用

```python
# 在 reparse 方法中，处理 seen_keys 的 for 循环内：
for parsed in result.tasks:
    seen_keys.add(parsed.task_key)
    stats["parsed"] += 1

    if parsed.task_key in existing_by_key:
        row = existing_by_key[parsed.task_key]
        self._apply_parsed(row, parsed, workspace_id=workspace_id, change_id=change_id)
        stats["updated"] += 1
    else:
        row = self._build_task(parsed, workspace_id=workspace_id, change_id=change_id)
        self._session.add(row)
        stats["created"] += 1

    # ★ 新增：Sync M:N workspace associations
    target_id = (
        existing_by_key[parsed.task_key].id
        if parsed.task_key in existing_by_key
        else row.id
    )
    await self._sync_task_workspaces(
        task_id=target_id,
        workspace_id=workspace_id,
        parsed=parsed,
    )
```

### 4. task/router.py — 适配 enrich

#### 4.1 修改 `list_tasks` 端点

```python
@router.get(
    "/changes/{change_id}/tasks",
    response_model=TaskList,
)
async def list_tasks(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
    task_status: str | None = Query(None, alias="status"),
    owner: str | None = Query(None),
    priority: str | None = Query(None),
    phase: str | None = Query(None),
) -> TaskList:
    service = TaskService(session)
    items, total = await service.list_(
        workspace_id,
        change_id,
        status=task_status,
        owner=owner,
        priority=priority,
        phase=phase,
    )
    enriched = await service.enrich_summaries(items)
    return TaskList(items=enriched, total=total)
```

**变更点：** 将 `TaskSummary.model_validate(t) for t in items` 替换为 `service.enrich_summaries(items)`。

#### 4.2 修改 `get_task` 端点

```python
@router.get(
    "/tasks/{task_id}",
    response_model=TaskRead,
)
async def get_task(
    workspace_id: uuid.UUID,
    task_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
) -> TaskRead:
    service = TaskService(session)
    task = await service.get(workspace_id, task_id)
    return await service.enrich_with_workspace_ids(task)
```

**变更点：** 将 `TaskRead.model_validate(task)` 替换为 `service.enrich_with_workspace_ids(task)`。

#### 4.3 修改 `get_task_board` 端点

```python
@router.get(
    "/changes/{change_id}/tasks/board",
    response_model=TaskBoard,
)
async def get_task_board(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
) -> TaskBoard:
    service = TaskService(session)
    columns = await service.get_board(workspace_id, change_id)
    enriched_columns = []
    for c in columns:
        enriched_items = await service.enrich_summaries(c["items"])
        enriched_columns.append(
            TaskBoardColumn(
                status=c["status"],
                count=c["count"],
                items=enriched_items,
            )
        )
    return TaskBoard(columns=enriched_columns)
```

**变更点：** 将 `TaskSummary.model_validate(t) for t in c["items"]` 替换为 `service.enrich_summaries(c["items"])`。

## 接口定义（代码类任务必填）

### 数据流伪代码

```
API Request
  -> router 调用 service.list_(workspace_id) 或 service.get(workspace_id, id)
  -> service 通过主 FK OR M:N 子查询获取实体列表（去重）
  -> router 调用 service.enrich_summaries(items) 或 service.enrich_with_workspace_ids(item)
     -> enrich 方法查询 ChangeWorkspace/TaskWorkspace 表获取 secondary workspace_ids
     -> 组装 [主 workspace_id] + secondary 为 workspace_ids 列表
     -> 构建 Pydantic DTO 并赋值 workspace_ids
  -> 返回 enriched 响应

Reparse Flow
  -> service.reparse(workspace_id)
  -> 对每个 parsed change/task：
     -> 创建或更新 DB 记录（不变）
     -> 调用 _sync_change_workspaces / _sync_task_workspaces
        -> 根据 affected_components 匹配 Workspace.component_key
        -> 主 workspace 写入 role="primary"
        -> 匹配到的其他 workspace 写入 role="affected"
        -> 删除不在新列表中的旧关联
  -> commit
```

### 方法签名汇总

```python
# ChangeService 新增方法
async def enrich_with_workspace_ids(self, change: Change) -> ChangeRead
async def enrich_summaries(self, changes: list[Change]) -> list[ChangeSummary]
async def _sync_change_workspaces(
    self, change_id: uuid.UUID, workspace_id: uuid.UUID, parsed: ParsedChange
) -> None

# TaskService 新增方法
async def enrich_with_workspace_ids(self, task: Task) -> TaskRead
async def enrich_summaries(self, tasks: list[Task]) -> list[TaskSummary]
async def _sync_task_workspaces(
    self, task_id: uuid.UUID, workspace_id: uuid.UUID, parsed: Any
) -> None
```

### 已有数据模型（由 task-01 落地，本任务直接引用）

**`ChangeWorkspace`** — `workspace/model.py` 第 161-188 行
- 复合主键 `(change_id, workspace_id)`
- `role: str | None` — 取值 "primary" / "affected" / "referenced"
- 索引 `ix_change_workspaces_workspace` 用于按 workspace 反查

**`TaskWorkspace`** — `workspace/model.py` 第 191-218 行
- 复合主键 `(task_id, workspace_id)`
- `role: str | None`
- 索引 `ix_task_workspaces_workspace`

**`AgentRunWorkspace`** — `workspace/model.py` 第 221-244 行
- 复合主键 `(agent_run_id, workspace_id)`
- 无 `role` 字段
- 已在 `agent/service.py` 中实现 enrich 和 M:N 查询

## 边界处理（必填）

1. **M:N 表为空时降级到 `[workspace_id]`：** reparse 未运行或 `affected_components` 为空时，M:N 表无记录。`enrich` 方法中 `secondary` 为空列表，`workspace_ids` 降级为 `[change.workspace_id]`。无需特殊处理，`[主 workspace] + []` 自然正确。

2. **list 去重：** `workspace_id` 既匹配主 FK 又匹配 M:N 记录时，同一条 change/task 会出现两次。`list_` 方法用 `seen: set[uuid.UUID]` 去重后再返回。去重基于实体 `id`，不影响排序（保持 `change_key` / `task_key` 升序）。

3. **`affected_components` 匹配不到 workspace：** 如果 `affected_components` 中的 `component_key` 在 workspace 表中找不到对应记录（外部依赖或 workspace 已删除），SQLAlchemy `IN` 查询返回空，静默跳过。只创建能匹配到的关联，不报错，不中断 reparse。

4. **reparse 幂等性：** `_sync_change_workspaces` / `_sync_task_workspaces` 是幂等的——先查已有关联，对比新旧集合，删除多余、新增缺失。二次 reparse 不会产生重复关联。

5. **FK CASCADE 清理：** M:N 表的 FK 设置了 `ON DELETE CASCADE`（task-01 迁移负责）。Change 或 Task 被删除时关联表行自动清理。代码层无需手动处理关联删除。

6. **向后兼容 — 保留 `workspace_id` FK：** 所有现有代码中读取 `Change.workspace_id` / `Task.workspace_id` 的地方不修改。`get_document_content`、文件系统路径定位等内部逻辑继续使用 `workspace_id`。只有 API 响应层新增 `workspace_ids`。

7. **`role` 字段不做严格枚举校验：** 当前取值为 `primary` / `affected` / `referenced`，但代码不做 Literal 校验。数据库列为 `String(30) nullable`，保持灵活。

8. **跨 workspace reparse 不重复写入：** 当同一个 change 的主 workspace 不是当前 reparse 的 workspace 时，`_sync_change_workspaces` 仍会将当前 workspace 作为关联写入（如果 `affected_components` 匹配）。这不会导致冲突，因为复合主键 `(change_id, workspace_id)` 保证了唯一性，重复写入会得到 IntegrityError，被忽略或更新。当前实现是先查后写（检查 `existing_ws_ids`），不会触发 IntegrityError。

## 非目标（本任务不做的事）

- 不新增独立的 API 端点来管理 M:N 关联（如 `POST /api/changes/{id}/workspaces`）。关联的创建/删除完全由 reparse 流程驱动
- 不修改前端代码（前端适配在后续任务中处理）
- 不做批量 M:N 操作接口
- 不修改 Alembic 迁移脚本（由 task-01 负责）
- 不做 M:N 关联的分页查询
- 不修改 Change/Task/AgentRun 的权限模型（仍然基于 workspace_id scope）
- 不修改 parser 逻辑（parser 输出的 `affected_components` 不变，只是 service 层在存储时多一步关联同步）
- 不修改 `agent/service.py` 和 `agent/router.py`（Agent 模块的 M:N 逻辑已实现）
- 不处理 workspace 软删除后 M:N 关联的可见性过滤

## 参考

| 项目 | 路径 |
|---|---|
| 设计文档 ADR-04 | `.sillyspec/changes/2026-05-28-component-as-workspace/design.md` |
| 实现计划 | `.sillyspec/changes/2026-05-28-component-as-workspace/plan.md` |
| M:N 关联表模型 | `backend/app/modules/workspace/model.py` (ChangeWorkspace, TaskWorkspace, AgentRunWorkspace) |
| Change schema (已有 workspace_ids) | `backend/app/modules/change/schema.py` |
| Task schema (已有 workspace_ids) | `backend/app/modules/task/schema.py` |
| Agent schema (已有 workspace_ids) | `backend/app/modules/agent/schema.py` |
| Agent service (已实现 enrich) | `backend/app/modules/agent/service.py` |
| Agent router (已实现 enrich 调用) | `backend/app/modules/agent/router.py` |
| Change parser | `backend/app/modules/change/parser.py` |
| Task parser | `backend/app/modules/task/parser.py` |
| 错误类 | `backend/app/core/errors.py` |
| 现有 Change 测试 | `backend/app/modules/change/tests/test_router.py` |
| 现有 Task 测试 | `backend/app/modules/task/tests/test_router.py` |
| conftest (DB + auth fixtures) | `backend/conftest.py` |
| 同级任务参考 (task-02) | `.sillyspec/changes/2026-05-28-component-as-workspace/tasks/task-02.md` |

## TDD 步骤

### Red 阶段（先写测试，全部失败）

#### 测试文件

- 修改 `backend/app/modules/change/tests/test_router.py` — 新增 M:N 相关测试
- 修改 `backend/app/modules/task/tests/test_router.py` — 新增 M:N 相关测试

### Change 模块测试

#### Test-01: reparse 后 change 的 workspace_ids 包含主 workspace

```
前置：创建 workspace W1，复制 change fixtures，执行 reparse
1. POST /api/workspaces — 创建 workspace W1（带 component_key="platform-api"）
2. 复制 fixtures 并 reparse：POST /api/workspaces/{W1.id}/changes/reparse
3. GET /api/workspaces/{W1.id}/changes
4. 断言 200
5. 对每个 item，断言 workspace_ids 是非空列表
6. 断言每个 item 的 workspace_ids[0] == W1.id（主 workspace 在首位）
```

#### Test-02: change 的 get detail 包含 workspace_ids

```
前置：workspace with changes fixture，reparse 完成
1. GET /api/workspaces/{W1.id}/changes/{change_id}
2. 断言 200
3. 断言 body.workspace_ids 是 list
4. 断言 W1.id in body.workspace_ids
5. 断言 body.workspace_id == W1.id（旧字段仍存在且相等）
```

#### Test-03: workspace_ids 在无 M:N 时降级为 [workspace_id]

```
前置：创建 workspace W1（无其他 workspace 有匹配的 component_key），reparse
1. GET /api/workspaces/{W1.id}/changes/{change_id}
2. 断言 workspace_ids == [W1.id]（仅含主 workspace）
```

#### Test-04: list 去重 — 同一 change 不重复出现

```
前置：W1 有 change C1，C1 的 affected_components 包含某个不存在的 component_key
   所以 C1 只关联 W1，不关联其他 workspace
1. GET /api/workspaces/{W1.id}/changes
2. 断言 C1 只出现一次
3. 断言 total 等于去重后的数量
```

### Task 模块测试

#### Test-05: reparse 后 task 的 workspace_ids 包含主 workspace

```
前置：workspace with tasks fixture，执行 change reparse + task reparse
1. GET /api/workspaces/{W1.id}/changes/{change_id}/tasks
2. 断言 200
3. 对每个 item，断言 workspace_ids 是非空列表
4. 断言 workspace_ids[0] == W1.id
```

#### Test-06: task get detail 包含 workspace_ids

```
前置：task reparse 完成
1. GET /api/workspaces/{W1.id}/tasks/{task_id}
2. 断言 200
3. 断言 body.workspace_ids 是 list
4. 断言 W1.id in body.workspace_ids
```

#### Test-07: task board 包含 workspace_ids

```
前置：task reparse 完成
1. GET /api/workspaces/{W1.id}/changes/{change_id}/tasks/board
2. 断言 200
3. 遍历所有 columns 的所有 items
4. 断言每个 item 都有 workspace_ids 字段且非空
```

### Green 阶段（写实现，全部通过）

按以下顺序实现：

1. **change/service.py 修改**
   a. 新增 import（ChangeWorkspace, Workspace）
   b. 新增 `enrich_with_workspace_ids` 和 `enrich_summaries` 方法
   c. 修改 `list_` 方法支持 M:N 查询 + 去重
   d. 修改 `get` 方法支持 M:N 查询
   e. 新增 `_sync_change_workspaces` 方法
   f. 在 `reparse` 方法中调用 `_sync_change_workspaces`

2. **change/router.py 修改**
   a. 修改 `list_changes` 使用 `enrich_summaries`
   b. 修改 `get_change` 使用 `enrich_with_workspace_ids`

3. **task/service.py 修改**
   a. 新增 import（TaskWorkspace, Workspace）
   b. 新增 `enrich_with_workspace_ids` 和 `enrich_summaries` 方法
   c. 修改 `list_` 方法支持 M:N 查询 + 去重
   d. 修改 `get` 方法支持 M:N 查询
   e. 新增 `_sync_task_workspaces` 方法
   f. 在 `reparse` 方法中调用 `_sync_task_workspaces`

4. **task/router.py 修改**
   a. 修改 `list_tasks` 使用 `enrich_summaries`
   b. 修改 `get_task` 使用 `enrich_with_workspace_ids`
   c. 修改 `get_task_board` 使用 `enrich_summaries`

5. 运行全部测试，确保通过

### Refactor 阶段

- 提取共用的 enrich 模式为 utility（如果 change/task/agent 三模块逻辑高度相似）
- 检查 list 去重是否有性能问题（N+1 查询）。如果 changes 数量大，改用批量查询
- 确认所有 import 路径正确，无循环依赖
- 确认日志格式与现有模块一致

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `ChangeService.enrich_with_workspace_ids` 方法存在，返回 `ChangeRead` 且 `workspace_ids` 以主 workspace 开头 | 代码审查 + Test-02 |
| AC-02 | `ChangeService.enrich_summaries` 方法存在，返回 `list[ChangeSummary]` 且每个 item 含 `workspace_ids` | 代码审查 + Test-01 |
| AC-03 | `ChangeService.list_` 通过主 FK OR M:N 子查询获取实体，结果去重 | 代码审查 + Test-04 |
| AC-04 | `ChangeService.get` 先查主 FK，不匹配则查 M:N 表，都不匹配则抛 `ChangeNotFound` | 代码审查 |
| AC-05 | `ChangeService._sync_change_workspaces` 根据 `affected_components` 匹配 workspace，写入 M:N 关联 | 代码审查 |
| AC-06 | `TaskService.enrich_with_workspace_ids` 方法存在，返回 `TaskRead` 且 `workspace_ids` 以主 workspace 开头 | 代码审查 + Test-06 |
| AC-07 | `TaskService.enrich_summaries` 方法存在，返回 `list[TaskSummary]` 且每个 item 含 `workspace_ids` | 代码审查 + Test-05 |
| AC-08 | `TaskService.list_` 通过主 FK OR M:N 子查询获取实体，结果去重 | 代码审查 |
| AC-09 | `TaskService.get` 先查主 FK，不匹配则查 M:N 表，都不匹配则抛 `TaskNotFound` | 代码审查 |
| AC-10 | `TaskService._sync_task_workspaces` 根据 `affected_components` 匹配 workspace，写入 M:N 关联 | 代码审查 |
| AC-11 | `GET /api/workspaces/{id}/changes` 返回的每个 item 含 `workspace_ids`，主 workspace 在首位 | Test-01 |
| AC-12 | `GET /api/workspaces/{id}/changes/{cid}` 返回 `workspace_ids` 包含主 workspace | Test-02 |
| AC-13 | `GET /api/workspaces/{id}/changes/{cid}/tasks` 返回的每个 item 含 `workspace_ids` | Test-05 |
| AC-14 | `GET /api/workspaces/{id}/tasks/{tid}` 返回 `workspace_ids` | Test-06 |
| AC-15 | `GET /api/workspaces/{id}/changes/{cid}/tasks/board` 中所有 task item 含 `workspace_ids` | Test-07 |
| AC-16 | M:N 为空时 `workspace_ids` 降级为 `[workspace_id]` | Test-03 |
| AC-17 | `list_` 方法去重，同一实体不重复出现 | Test-04 |
| AC-18 | 现有 `workspace_id` FK 和旧逻辑不变，向后兼容 | 代码审查 + 全部现有测试通过 |
| AC-19 | 所有端点有正确的权限保护（无 auth 返回 401） | 现有测试覆盖 |
| AC-20 | 全部现有 change/task 测试通过，无回归 | `pytest backend/app/modules/change/tests/ backend/app/modules/task/tests/ -v` |
| AC-21 | 全部新增测试通过 | `pytest backend/app/modules/change/tests/ backend/app/modules/task/tests/ -v` |
