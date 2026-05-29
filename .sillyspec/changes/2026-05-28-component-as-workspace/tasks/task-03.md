---
id: task-03
title: "Change/Task/AgentRun M:N 关联 — 关联表 + 查询逻辑"
priority: P0
estimated_hours: 4
depends_on: [task-01]
blocks: [task-08]
allowed_paths:
  - backend/app/modules/change/model.py
  - backend/app/modules/change/schema.py
  - backend/app/modules/change/service.py
  - backend/app/modules/change/router.py
  - backend/app/modules/task/model.py
  - backend/app/modules/task/schema.py
  - backend/app/modules/task/service.py
  - backend/app/modules/task/router.py
  - backend/app/modules/agent/model.py
  - backend/app/modules/agent/schema.py
  - backend/app/modules/agent/service.py
author: qinyi
created_at: 2026-05-28 16:25:00
---

# Task-03: Change/Task/AgentRun M:N 关联 — 关联表 + 查询逻辑

## 1. 上下文

**文档依据：**
- 设计文档：`.sillyspec/changes/2026-05-28-component-as-workspace/design.md` (ADR-09)
- 实现计划：`.sillyspec/changes/2026-05-28-component-as-workspace/plan.md` (Wave 2)
- 现有 Change 模型：`backend/app/modules/change/model.py`
- 现有 Task 模型：`backend/app/modules/task/model.py`
- 现有 AgentRun 模型：`backend/app/modules/agent/model.py`
- 现有 Change schema：`backend/app/modules/change/schema.py`
- 现有 Task schema：`backend/app/modules/task/schema.py`
- 现有 Agent schema：`backend/app/modules/agent/schema.py`

**目标：** 为 Change、Task、AgentRun 三个实体各新增 M:N 关联表（`change_workspaces`、`task_workspaces`、`agent_run_workspaces`），使其能关联多个 Workspace。保留现有的 `workspace_id` FK 作为"主 workspace"以保证向后兼容，M:N 表为补充。API 请求/响应中 `workspace_id` 扩展为 `workspace_ids` 列表。Service 层新增按 workspace 查询关联实体的逻辑，Router 层适配新 schema。

**核心原则：** 一个变更可能影响多个组件（如修改 shared library 的接口会影响所有依赖方），绑定到单个 workspace 无法表达这种场景。M:N 关联解决了这个问题。

## 2. 修改文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/change/model.py` | **修改** | 新增 `ChangeWorkspace` 关联表模型 |
| `backend/app/modules/change/schema.py` | **修改** | `ChangeRead`/`ChangeSummary` 新增 `workspace_ids` 字段；新增 `ChangeWorkspaceRole` 枚举 |
| `backend/app/modules/change/service.py` | **修改** | 查询方法改为通过 M:N 表 JOIN 查询；reparse 时同步关联表 |
| `backend/app/modules/change/router.py` | **修改** | 适配新 schema 响应格式 |
| `backend/app/modules/task/model.py` | **修改** | 新增 `TaskWorkspace` 关联表模型 |
| `backend/app/modules/task/schema.py` | **修改** | `TaskRead`/`TaskSummary` 新增 `workspace_ids` 字段 |
| `backend/app/modules/task/service.py` | **修改** | 查询方法改为通过 M:N 表 JOIN 查询；reparse 时同步关联表 |
| `backend/app/modules/task/router.py` | **修改** | 适配新 schema 响应格式 |
| `backend/app/modules/agent/model.py` | **修改** | 新增 `AgentRunWorkspace` 关联表模型 |
| `backend/app/modules/agent/schema.py` | **修改** | `AgentRunResponse` 新增 `workspace_ids` 字段 |
| `backend/app/modules/agent/service.py` | **修改** | `start_run` / `list_runs` 适配 M:N 查询 |

注意：`change_workspaces`、`task_workspaces`、`agent_run_workspaces` 三张表的 Alembic 迁移脚本由 task-01 负责。本任务只写 ORM 模型和代码逻辑，假设迁移已经落地。

## 3. 实现要求

### 3.1 change/model.py — 新增 ChangeWorkspace 关联表

在文件末尾追加 `ChangeWorkspace` 模型：

```python
class ChangeWorkspace(BaseModel, table=True):
    """M:N junction between changes and workspaces.

    A change can affect multiple workspaces. The primary workspace is
    tracked via Change.workspace_id; this table adds additional
    (secondary) associations.
    """

    __tablename__ = "change_workspaces"
    __table_args__ = (
        Index(
            "ux_change_workspaces_pair",
            "change_id",
            "workspace_id",
            unique=True,
        ),
        Index("ix_change_workspaces_workspace", "workspace_id"),
    )

    change_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=False,
            primary_key=True,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
            primary_key=True,
        ),
    )
    role: str | None = Field(
        default="primary",
        sa_column=Column(String(30), nullable=True, default="primary"),
    )
```

关键设计点：
- 复合主键 `(change_id, workspace_id)`，不需要独立 `id` 列
- `role` 字段取值：`primary` / `affected` / `referenced`，nullable，默认 `primary`
- UQ 索引即复合主键本身，额外加 `ix_change_workspaces_workspace` 用于按 workspace 反查
- `Change` 模型原有的 `workspace_id` FK 保留不动（向后兼容，表示"主 workspace"）

### 3.2 task/model.py — 新增 TaskWorkspace 关联表

在文件末尾追加 `TaskWorkspace` 模型：

```python
class TaskWorkspace(BaseModel, table=True):
    """M:N junction between tasks and workspaces."""

    __tablename__ = "task_workspaces"
    __table_args__ = (
        Index(
            "ux_task_workspaces_pair",
            "task_id",
            "workspace_id",
            unique=True,
        ),
        Index("ix_task_workspaces_workspace", "workspace_id"),
    )

    task_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
            primary_key=True,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
            primary_key=True,
        ),
    )
    role: str | None = Field(
        default="primary",
        sa_column=Column(String(30), nullable=True, default="primary"),
    )
```

### 3.3 agent/model.py — 新增 AgentRunWorkspace 关联表

在文件末尾追加 `AgentRunWorkspace` 模型：

```python
class AgentRunWorkspace(BaseModel, table=True):
    """M:N junction between agent_runs and workspaces."""

    __tablename__ = "agent_run_workspaces"
    __table_args__ = (
        Index(
            "ux_agent_run_workspaces_pair",
            "agent_run_id",
            "workspace_id",
            unique=True,
        ),
        Index("ix_agent_run_workspaces_workspace", "workspace_id"),
    )

    agent_run_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_runs.id", ondelete="CASCADE"),
            nullable=False,
            primary_key=True,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
            primary_key=True,
        ),
    )
```

注意：`AgentRunWorkspace` 没有 `role` 字段（与 design.md 一致）。

### 3.4 change/schema.py — 扩展 DTO

**修改 `ChangeRead`：** 新增 `workspace_ids` 字段。

```python
class ChangeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID          # 保留：主 workspace
    workspace_ids: list[uuid.UUID]   # 新增：所有关联 workspace（含主 workspace）
    change_key: str
    title: str | None
    status: str
    location: str
    path: str
    affected_components: list[str]
    change_type: str | None
    owner_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None
```

**修改 `ChangeSummary`：** 同样新增 `workspace_ids`。

```python
class ChangeSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    change_key: str
    title: str | None
    status: str
    location: str
    change_type: str | None
    affected_components: list[str]
    owner_id: uuid.UUID | None
    updated_at: datetime
    workspace_ids: list[uuid.UUID] = []   # 新增
```

**注意：** `ChangeRead` 和 `ChangeSummary` 的 `workspace_ids` 是运行时填充的，不直接从 ORM model 映射。需要在 router/service 层手动组装。

### 3.5 task/schema.py — 扩展 DTO

**修改 `TaskSummary`：** 新增 `workspace_ids` 字段。

```python
class TaskSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID          # 保留：主 workspace
    change_id: uuid.UUID
    task_key: str
    title: str | None = None
    status: str
    phase: str | None = None
    priority: str | None = None
    owner_key: str | None = None
    estimated_hours: float | None = None
    affected_components: list[str] = []
    depends_on: list[str] = []
    blocks: list[str] = []
    created_at: datetime
    updated_at: datetime
    workspace_ids: list[uuid.UUID] = []   # 新增
```

`TaskRead` 继承 `TaskSummary`，自动获得 `workspace_ids`。

### 3.6 agent/schema.py — 扩展 DTO

**修改 `AgentRunResponse`：** 新增 `workspace_ids` 字段。

```python
class AgentRunResponse(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID | None
    lease_id: uuid.UUID | None
    agent_type: str
    status: str
    started_at: datetime | None
    finished_at: datetime | None
    exit_code: int | None
    output_redacted: str | None
    spec_strategy: str | None = None
    profile_version: str | None = None
    diff_summary: str | None = None
    workspace_ids: list[uuid.UUID] = []   # 新增
    model_config = {"from_attributes": True}
```

### 3.7 change/service.py — M:N 查询 + reparse 同步

#### 3.7.1 新增辅助方法：查询关联 workspace_ids

```python
async def _get_workspace_ids(self, change_id: uuid.UUID) -> list[uuid.UUID]:
    """Get all workspace IDs associated with a change (from M:N table + primary)."""
    stmt = select(ChangeWorkspace.workspace_id).where(
        col(ChangeWorkspace.change_id) == change_id,
    )
    secondary_ids = [
        row[0] for row in (await self._session.execute(stmt)).all()
    ]
    return secondary_ids
```

#### 3.7.2 修改 `_build_change` — reparse 时同步 M:N 表

在 `_build_change` 静态方法中不变（仍设 `workspace_id`）。M:N 表的同步在 reparse 流程中新增一个辅助方法：

```python
async def _sync_change_workspaces(
    self,
    change_id: uuid.UUID,
    workspace_id: uuid.UUID,
    parsed: ParsedChange,
) -> None:
    """Sync M:N associations for a change based on affected_components."""
    # 1. 获取 primary workspace
    primary_ws = await self._workspace_service.get(workspace_id)

    # 2. 查找 affected_components 中提及的其他 workspace
    #    通过 component_key 匹配 workspace
    ws_ids: set[uuid.UUID] = {workspace_id}
    if parsed.affected_components:
        stmt = select(Workspace.id).where(
            col(Workspace.component_key).in_(parsed.affected_components),
            col(Workspace.deleted_at).is_(None),
        )
        extra = [row[0] for row in (await self._session.execute(stmt)).all()]
        ws_ids.update(extra)

    # 3. 删除不再需要的关联
    existing_stmt = select(ChangeWorkspace).where(
        col(ChangeWorkspace.change_id) == change_id,
    )
    existing = list((await self._session.execute(existing_stmt)).scalars().all())
    existing_ws_ids = {cw.workspace_id for cw in existing}

    for cw in existing:
        if cw.workspace_id not in ws_ids:
            await self._session.delete(cw)

    # 4. 新增关联
    for wid in ws_ids - existing_ws_ids:
        role = "primary" if wid == workspace_id else "affected"
        self._session.add(ChangeWorkspace(
            change_id=change_id,
            workspace_id=wid,
            role=role,
        ))
```

**reparse 方法中的调用点：** 在 `_apply_parsed` 或 `_build_change` 之后，调用 `_sync_change_workspaces`：

```python
# 在 reparse 方法的主循环中，处理完每个 parsed change 后：
await self._sync_change_workspaces(
    change_id=row.id if hasattr(row, 'id') else existing_change.id,
    workspace_id=workspace_id,
    parsed=parsed,
)
```

#### 3.7.3 修改 `list_` 方法 — 支持 M:N 查询

现有的 `list_` 方法通过 `Change.workspace_id == workspace_id` 过滤。修改为同时查 M:N 表：

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

    # 通过主 workspace 或 M:N 关联表查询
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
    seen = set()
    unique_items = []
    for item in items:
        if item.id not in seen:
            seen.add(item.id)
            unique_items.append(item)
    return unique_items, len(unique_items)
```

#### 3.7.4 修改 `get` 方法 — 支持 M:N 查询

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

#### 3.7.5 router.py 中的响应组装

在 router 的 `list_changes` 和 `get_change` 中，需要从 ORM 对象 + M:N 数据组装 Pydantic 响应：

```python
async def _enrich_change_response(
    session: AsyncSession, change: Change
) -> dict:
    """Build response dict with workspace_ids populated."""
    # 获取主 workspace_id
    workspace_ids = [change.workspace_id]

    # 获取 M:N 关联
    stmt = select(ChangeWorkspace.workspace_id).where(
        col(ChangeWorkspace.change_id) == change.id,
    )
    secondary = [row[0] for row in (await session.execute(stmt)).all()]
    workspace_ids.extend(secondary)

    data = ChangeRead.model_validate(change).model_dump()
    data["workspace_ids"] = workspace_ids
    return data
```

或者更简洁地在 router 中直接构建：

```python
# list_changes 中：
from app.modules.change.model import ChangeWorkspace

enriched = []
for c in items:
    stmt = select(ChangeWorkspace.workspace_id).where(
        col(ChangeWorkspace.change_id) == c.id,
    )
    secondary = [row[0] for row in (await session.execute(stmt)).all()]
    ws_ids = [c.workspace_id] + secondary
    data = ChangeSummary.model_validate(c)
    data.workspace_ids = ws_ids
    enriched.append(data)
```

**推荐做法：** 在 `ChangeService` 中新增 `enrich_with_workspace_ids` 方法，统一处理 enrich 逻辑，router 调用此方法获取 enriched 数据。这样保持 router 简洁，避免在 router 层直接执行 DB 查询。

```python
# service.py 新增
async def enrich_with_workspace_ids(self, change: Change) -> ChangeRead:
    """Build ChangeRead with workspace_ids populated from M:N table."""
    stmt = select(ChangeWorkspace.workspace_id).where(
        col(ChangeWorkspace.change_id) == change.id,
    )
    secondary = [row[0] for row in (await self._session.execute(stmt)).all()]
    data = ChangeRead.model_validate(change)
    data.workspace_ids = [change.workspace_id] + secondary
    return data

async def enrich_summaries(self, changes: list[Change]) -> list[ChangeSummary]:
    """Build ChangeSummary list with workspace_ids populated."""
    result = []
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

### 3.8 task/service.py — M:N 查询 + reparse 同步

#### 3.8.1 新增辅助方法

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
    existing = list((await self._session.execute(existing_stmt)).scalars().all())
    existing_ws_ids = {tw.workspace_id for tw in existing}

    for tw in existing:
        if tw.workspace_id not in ws_ids:
            await self._session.delete(tw)

    for wid in ws_ids - existing_ws_ids:
        role = "primary" if wid == workspace_id else "affected"
        self._session.add(TaskWorkspace(
            task_id=task_id,
            workspace_id=wid,
            role=role,
        ))
```

#### 3.8.2 修改 `list_` 方法

与 change 相同模式，通过 `TaskWorkspace` M:N 表扩展查询：

```python
mn_subq = select(TaskWorkspace.task_id).where(
    col(TaskWorkspace.workspace_id) == workspace_id,
)
stmt = select(Task).where(
    (col(Task.workspace_id) == workspace_id)
    | (col(Task.id).in_(mn_subq))
)
# ... 后续 filter 不变，最后去重
```

#### 3.8.3 修改 `get` 方法

与 change 相同模式：

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
        raise TaskNotFound(...)
    return task
```

#### 3.8.4 新增 enrich 方法

```python
async def enrich_with_workspace_ids(self, task: Task) -> TaskRead:
    stmt = select(TaskWorkspace.workspace_id).where(
        col(TaskWorkspace.task_id) == task.id,
    )
    secondary = [row[0] for row in (await self._session.execute(stmt)).all()]
    data = TaskRead.model_validate(task)
    data.workspace_ids = [task.workspace_id] + secondary
    return data

async def enrich_summaries(self, tasks: list[Task]) -> list[TaskSummary]:
    result = []
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

### 3.9 agent/service.py — M:N 查询

#### 3.9.1 修改 `start_run`

在创建 `AgentRun` 后，根据 task 的关联 workspace 创建 M:N 关联：

```python
# 在 start_run 中，创建 run 记录之后、commit 之前：
# 获取 task 关联的所有 workspace
task_ws_stmt = select(TaskWorkspace.workspace_id).where(
    col(TaskWorkspace.task_id) == task_id,
)
task_ws_ids = [row[0] for row in (await self._session.execute(task_ws_stmt)).all()]

# 加上主 workspace
all_ws_ids = set(task_ws_ids)
all_ws_ids.add(workspace_id)

for wid in all_ws_ids:
    self._session.add(AgentRunWorkspace(
        agent_run_id=run.id,
        workspace_id=wid,
    ))
```

#### 3.9.2 修改 `list_runs`

现有的 `list_runs` 通过 `Change.workspace_id` 间接匹配 workspace。改为同时查 M:N 表：

```python
async def list_runs(
    self,
    workspace_id: uuid.UUID,
    task_id: uuid.UUID | None = None,
) -> list[AgentRun]:
    # 通过 M:N 表查询关联到该 workspace 的 agent run
    arw_subq = select(AgentRunWorkspace.agent_run_id).where(
        col(AgentRunWorkspace.workspace_id) == workspace_id,
    )

    if task_id:
        stmt = select(AgentRun).where(
            col(AgentRun.task_id) == task_id,
            col(AgentRun.id).in_(arw_subq),
        )
    else:
        stmt = select(AgentRun).where(
            col(AgentRun.id).in_(arw_subq),
        )
    stmt = stmt.order_by(col(AgentRun.started_at).desc())
    return list((await self._session.execute(stmt)).scalars().all())
```

#### 3.9.3 新增 enrich 方法

```python
async def enrich_with_workspace_ids(self, run: AgentRun) -> AgentRunResponse:
    stmt = select(AgentRunWorkspace.workspace_id).where(
        col(AgentRunWorkspace.agent_run_id) == run.id,
    )
    ws_ids = [row[0] for row in (await self._session.execute(stmt)).all()]
    data = AgentRunResponse.model_validate(run)
    data.workspace_ids = ws_ids
    return data

async def enrich_list(self, runs: list[AgentRun]) -> list[AgentRunResponse]:
    result = []
    for r in runs:
        enriched = await self.enrich_with_workspace_ids(r)
        result.append(enriched)
    return result
```

### 3.10 router 层适配

#### 3.10.1 change/router.py

**`list_changes`** 端点修改：

```python
@router.get("/changes", response_model=ChangeList)
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

**`get_change`** 端点修改：

```python
@router.get("/changes/{change_id}", response_model=ChangeRead)
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

#### 3.10.2 task/router.py

**`list_tasks`** 端点修改：

```python
@router.get("/changes/{change_id}/tasks", response_model=TaskList)
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

**`get_task`** 端点修改：

```python
@router.get("/tasks/{task_id}", response_model=TaskRead)
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

**`get_task_board`** 端点修改：

```python
# get_task_board 中同样使用 enrich_summaries
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

#### 3.10.3 agent/router.py

**`list_workspace_agent_runs`** 端点修改：

```python
@router.get("/workspaces/{workspace_id}/agent/runs", response_model=list[AgentRunResponse])
async def list_workspace_agent_runs(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
) -> list[AgentRunResponse]:
    svc = AgentService(session)
    runs = await svc.list_runs(workspace_id, task_id=None)
    return await svc.enrich_list(runs)
```

**`list_task_agent_runs`** 端点修改：

```python
@router.get("/workspaces/{workspace_id}/tasks/{task_id}/agent/runs", response_model=list[AgentRunResponse])
async def list_task_agent_runs(
    workspace_id: uuid.UUID,
    task_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
) -> list[AgentRunResponse]:
    svc = AgentService(session)
    runs = await svc.list_runs(workspace_id, task_id=task_id)
    return await svc.enrich_list(runs)
```

**`create_agent_run`** 和 `get_agent_run` 端点修改：

```python
# create_agent_run 中：
run = await svc.start_run(...)
return await svc.enrich_with_workspace_ids(run)

# get_agent_run 中：
run = await svc.get_run(run_id)
if run is None:
    raise AgentRunNotFound(...)
return await svc.enrich_with_workspace_ids(run)
```

## 4. 接口定义汇总

### API 响应变更

| 端点 | 变更 | 说明 |
|---|---|---|
| `GET /api/workspaces/{id}/changes` | 响应中每个 item 新增 `workspace_ids` | `ChangeSummary.workspace_ids` |
| `GET /api/workspaces/{id}/changes/{cid}` | 响应新增 `workspace_ids` | `ChangeRead.workspace_ids` |
| `GET /api/workspaces/{id}/changes/{cid}/tasks` | 响应中每个 item 新增 `workspace_ids` | `TaskSummary.workspace_ids` |
| `GET /api/workspaces/{id}/tasks/{tid}` | 响应新增 `workspace_ids` | `TaskRead.workspace_ids` |
| `GET /api/workspaces/{id}/changes/{cid}/tasks/board` | 响应中每个 task item 新增 `workspace_ids` | `TaskSummary.workspace_ids` |
| `POST /api/workspaces/{id}/agent/runs` | 响应新增 `workspace_ids` | `AgentRunResponse.workspace_ids` |
| `GET /api/workspaces/{id}/agent/runs/{rid}` | 响应新增 `workspace_ids` | `AgentRunResponse.workspace_ids` |
| `GET /api/workspaces/{id}/agent/runs` | 响应中每个 item 新增 `workspace_ids` | `AgentRunResponse.workspace_ids` |
| `GET /api/workspaces/{id}/tasks/{tid}/agent/runs` | 响应中每个 item 新增 `workspace_ids` | `AgentRunResponse.workspace_ids` |

### 数据结构变更

**ChangeRead 新增字段：**
```json
{
  "id": "uuid",
  "workspace_id": "uuid",          // 保留：主 workspace
  "workspace_ids": ["uuid", ...],  // 新增：所有关联 workspace（含主）
  "change_key": "2026-05-28-demo",
  ...
}
```

**TaskSummary 新增字段：**
```json
{
  "id": "uuid",
  "workspace_id": "uuid",
  "workspace_ids": ["uuid", ...],
  "task_key": "task-01",
  ...
}
```

**AgentRunResponse 新增字段：**
```json
{
  "id": "uuid",
  "workspace_ids": ["uuid", ...],
  "task_id": "uuid",
  ...
}
```

### 新增 ORM 模型

| 模型 | 表名 | 主键 | 说明 |
|---|---|---|---|
| `ChangeWorkspace` | `change_workspaces` | `(change_id, workspace_id)` | Change M:N 关联 |
| `TaskWorkspace` | `task_workspaces` | `(task_id, workspace_id)` | Task M:N 关联 |
| `AgentRunWorkspace` | `agent_run_workspaces` | `(agent_run_id, workspace_id)` | AgentRun M:N 关联 |

## 5. 边界处理

1. **Primary workspace 保证包含在 M:N 中：** reparse 时，主 workspace (`workspace_id`) 始终作为 `role="primary"` 写入关联表。enrich 时，`workspace_ids` 列表以 `workspace_id` 开头（主 workspace 在前），后接 M:N 表中的 secondary workspace。列表不重复。

2. **M:N 表为空时降级到 `workspace_id`：** 如果 reparse 还没运行、或 change/task 的 `affected_components` 为空导致 M:N 表无记录，`workspace_ids` 应降级为 `[workspace_id]`（仅含主 workspace）。enrich 方法必须处理 `secondary` 为空的情况。

3. **list 去重：** 当 `workspace_id` 既匹配主 FK 又匹配 M:N 记录时，同一条 change/task 会出现两次。service 的 `list_` 方法必须用 `set` 去重后再返回。

4. **`affected_components` 匹配不到 workspace：** 如果 `affected_components` 中的 component_key 在 workspace 表中找不到对应记录（可能是外部依赖、或 workspace 已删除），静默跳过，不报错。只创建能匹配到的 workspace 关联。

5. **删除 Change/Task 时关联自动清理：** M:N 表的 FK 设置了 `ON DELETE CASCADE`（由 task-01 迁移负责）。Change 或 Task 被删除时，关联表行自动清理。代码层无需手动处理。

6. **AgentRun 的 workspace 来源：** AgentRun 不直接有 `workspace_id` FK。其关联 workspace 继承自 Task 的关联 workspace（通过 `task_id` 查 `task_workspaces`），加上 API 调用时的 `workspace_id` 参数。`start_run` 方法负责在创建 run 后写入所有关联。

7. **向后兼容 — 保留 `workspace_id`：** 所有现有代码中读取 `Change.workspace_id` / `Task.workspace_id` 的地方不修改。M:N 是补充，不是替代。reparse、get_document_content 等内部逻辑继续使用 `workspace_id` 确定文件系统路径。只有 API 响应层新增 `workspace_ids`。

8. **`role` 字段不做严格校验：** `ChangeWorkspace.role` 和 `TaskWorkspace.role` 当前取值为 `primary` / `affected` / `referenced`，但代码不做枚举校验（保持灵活）。前端或其他消费方如果需要可以自行校验。

9. **多 workspace reparse 场景：** 当同一个 change 出现在多个 workspace 的 reparse 中时，M:N 关联应该只由"主 workspace"的 reparse 写入。其他 workspace 的 reparse 如果发现该 change 的主 FK 不是自己，不应该重复写入关联。这通过 `affected_components` 只在主 workspace reparse 时处理来保证。

## 6. 非目标

- 不修改前端代码（前端适配在后续任务中处理）
- 不新增独立的 API 端点来管理 M:N 关联（如 `POST /api/changes/{id}/workspaces`）。关联的创建/删除完全由 reparse 流程驱动
- 不做批量 M:N 操作接口
- 不修改 Alembic 迁移脚本（由 task-01 负责）
- 不做 M:N 关联的分页查询
- 不修改 Change/Task/AgentRun 的权限模型（仍然基于 workspace_id scope）
- 不修改 parser 逻辑（parser 输出的 `affected_components` 不变，只是 service 层在存储时多一步关联同步）
- 不处理 workspace 软删除后 M:N 关联的可见性（workspace 软删除后，通过 M:N 查到的 change/task 仍然返回，只是 `workspace_ids` 中可能包含已删除的 workspace ID — 这是可接受的行为，后续按需优化）

## 7. 参考

| 项目 | 路径 |
|---|---|
| 设计文档 ADR-09 | `.sillyspec/changes/2026-05-28-component-as-workspace/design.md` |
| 实现计划 | `.sillyspec/changes/2026-05-28-component-as-workspace/plan.md` |
| 现有 Change 模型 | `backend/app/modules/change/model.py` |
| 现有 Change schema | `backend/app/modules/change/schema.py` |
| 现有 Change service | `backend/app/modules/change/service.py` |
| 现有 Change router | `backend/app/modules/change/router.py` |
| 现有 Task 模型 | `backend/app/modules/task/model.py` |
| 现有 Task schema | `backend/app/modules/task/schema.py` |
| 现有 Task service | `backend/app/modules/task/service.py` |
| 现有 Task router | `backend/app/modules/task/router.py` |
| 现有 AgentRun 模型 | `backend/app/modules/agent/model.py` |
| 现有 Agent schema | `backend/app/modules/agent/schema.py` |
| 现有 Agent service | `backend/app/modules/agent/service.py` |
| 现有 Agent router | `backend/app/modules/agent/router.py` |
| Workspace 模型 | `backend/app/modules/workspace/model.py` |
| 错误类 | `backend/app/core/errors.py` |
| BaseModel | `backend/app/models/base.py` |
| Change 测试 | `backend/app/modules/change/tests/test_router.py` |
| Task 测试 | `backend/app/modules/task/tests/test_router.py` |
| 同级任务参考 (task-02) | `.sillyspec/changes/2026-05-28-component-as-workspace/tasks/task-02.md` |

## 8. TDD 步骤

### Red 阶段（先写测试，全部失败）

#### 测试文件：修改现有测试文件
- `backend/app/modules/change/tests/test_router.py` — 新增 M:N 相关测试
- `backend/app/modules/task/tests/test_router.py` — 新增 M:N 相关测试

### Change 模块测试

#### 测试 1: reparse 后 change 的 workspace_ids 包含主 workspace
```
前置：创建 workspace，复制 change fixtures，执行 reparse
1. POST /api/workspaces — 创建 workspace W1
2. 设置 fixtures 并 reparse
3. GET /api/workspaces/{W1.id}/changes
4. 断言 200
5. 对每个 item，断言 workspace_ids 是非空列表
6. 断言每个 item 的 workspace_ids[0] == W1.id（主 workspace 在首位）
```

#### 测试 2: change 的 get detail 包含 workspace_ids
```
前置：workspace with changes fixture，reparse 完成
1. GET /api/workspaces/{W1.id}/changes/{change_id}
2. 断言 200
3. 断言 body.workspace_ids 是 list[UUID]
4. 断言 W1.id in body.workspace_ids
5. 断言 body.workspace_id == W1.id（旧字段仍存在）
```

#### 测试 3: 多 workspace 关联 — 通过 affected_components
```
前置：创建 W1 (component_key="api-gateway"), W2 (component_key="shared-lib")
1. W1 reparse，其 change 的 affected_components 包含 "shared-lib"
2. GET /api/workspaces/{W1.id}/changes
3. 找到 affected_components 包含 "shared-lib" 的 change
4. 断言其 workspace_ids 包含 W2.id
```

#### 测试 4: 通过 M:N 表查询 — W2 能看到 W1 的 change
```
前置：同测试 3
1. GET /api/workspaces/{W2.id}/changes
2. 断言能返回 W1 创建的 change（通过 M:N 关联）
3. 断言返回的 change 的 workspace_ids 包含 W1.id 和 W2.id
```

#### 测试 5: list 去重 — 同一 change 不重复出现
```
前置：W1 有 change C1，C1 同时关联 W1 和 W2
1. GET /api/workspaces/{W1.id}/changes
2. 断言 C1 只出现一次（不重复）
```

#### 测试 6: workspace_ids 在无 M:N 时降级为 [workspace_id]
```
前置：创建 workspace W1，reparse，但 change 的 affected_components 为空
1. GET /api/workspaces/{W1.id}/changes/{change_id}
2. 断言 workspace_ids == [W1.id]
```

### Task 模块测试

#### 测试 7: reparse 后 task 的 workspace_ids 包含主 workspace
```
前置：workspace with tasks fixture，执行 change reparse + task reparse
1. GET /api/workspaces/{W1.id}/changes/{change_id}/tasks
2. 断言 200
3. 对每个 item，断言 workspace_ids 是非空列表
4. 断言 workspace_ids[0] == W1.id
```

#### 测试 8: task get detail 包含 workspace_ids
```
前置：task reparse 完成
1. GET /api/workspaces/{W1.id}/tasks/{task_id}
2. 断言 200
3. 断言 body.workspace_ids 是 list[UUID]
4. 断言 W1.id in body.workspace_ids
```

#### 测试 9: task board 包含 workspace_ids
```
前置：task reparse 完成
1. GET /api/workspaces/{W1.id}/changes/{change_id}/tasks/board
2. 断言 200
3. 遍历所有 columns 的所有 items
4. 断言每个 item 都有 workspace_ids 字段且非空
```

#### 测试 10: 通过 M:N 表查询 task
```
前置：W1 的 task 关联了 W2（通过 affected_components）
1. GET /api/workspaces/{W2.id}/changes/{change_id}/tasks
2. 断言能看到关联到 W2 的 task
```

### Agent 模块测试

#### 测试 11: agent run 创建后包含 workspace_ids
```
前置：workspace with tasks，task reparse 完成，创建 worktree lease
1. POST /api/workspaces/{W1.id}/agent/runs
   body: {task_id, lease_id, agent_type: "claude_code"}
2. 断言 201
3. 断言 body.workspace_ids 是 list[UUID]
4. 断言 W1.id in body.workspace_ids
```

#### 测试 12: agent run list 包含 workspace_ids
```
前置：创建过 agent run
1. GET /api/workspaces/{W1.id}/agent/runs
2. 断言 200
3. 对每个 item，断言 workspace_ids 非空
```

### Green 阶段（写实现，全部通过）

按以下顺序实现：

1. **model.py 修改** — 三个模块各追加关联表模型（`ChangeWorkspace`、`TaskWorkspace`、`AgentRunWorkspace`）
2. **schema.py 修改** — 三个模块各追加 `workspace_ids` 字段
3. **service.py 修改** — 按以下子步骤：
   a. 新增 `enrich_with_workspace_ids` 和 `enrich_summaries` 方法
   b. 修改 `list_` 方法支持 M:N 查询 + 去重
   c. 修改 `get` 方法支持 M:N 查询
   d. 新增 `_sync_*_workspaces` 方法
   e. 在 reparse 中调用 sync 方法
4. **router.py 修改** — 三个模块各适配 enrich 调用
5. **agent/service.py 修改** — `start_run` 中创建 M:N 关联，`list_runs` 改用 M:N 查询
6. 运行全部测试，确保通过

### Refactor 阶段

- 提取共用的 enrich 模式为 base mixin 或 utility（如果三个模块逻辑高度相似）
- 检查 list 去重是否有性能问题（N+1 查询）。如果 changes 数量大，改用批量查询一次获取所有 workspace_ids
- 确认所有 import 路径正确，无循环依赖
- 确认日志格式与现有模块一致

## 9. 验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | `ChangeWorkspace` 关联表模型定义正确，复合主键 `(change_id, workspace_id)`，含 `role` 字段 | 代码审查：字段类型、Index、FK 声明齐全 |
| 2 | `TaskWorkspace` 关联表模型定义正确，复合主键 `(task_id, workspace_id)`，含 `role` 字段 | 代码审查 |
| 3 | `AgentRunWorkspace` 关联表模型定义正确，复合主键 `(agent_run_id, workspace_id)`，无 `role` 字段 | 代码审查 |
| 4 | `ChangeRead` 和 `ChangeSummary` 包含 `workspace_ids: list[UUID]` 字段 | 代码审查 + mypy/pyright 通过 |
| 5 | `TaskSummary` 和 `TaskRead` 包含 `workspace_ids: list[UUID]` 字段 | 代码审查 |
| 6 | `AgentRunResponse` 包含 `workspace_ids: list[UUID]` 字段 | 代码审查 |
| 7 | `GET /api/workspaces/{id}/changes` 返回的每个 item 含 `workspace_ids`，且主 workspace 在首位 | 测试 1 + 测试 3 |
| 8 | `GET /api/workspaces/{id}/changes/{cid}` 返回 `workspace_ids` 包含所有关联 workspace | 测试 2 |
| 9 | `GET /api/workspaces/{id}/changes/{cid}/tasks` 返回的每个 item 含 `workspace_ids` | 测试 7 |
| 10 | `GET /api/workspaces/{id}/tasks/{tid}` 返回 `workspace_ids` | 测试 8 |
| 11 | `GET /api/workspaces/{id}/changes/{cid}/tasks/board` 中所有 task item 含 `workspace_ids` | 测试 9 |
| 12 | `POST /api/workspaces/{id}/agent/runs` 返回 `workspace_ids` | 测试 11 |
| 13 | `GET /api/workspaces/{id}/agent/runs` 返回的每个 item 含 `workspace_ids` | 测试 12 |
| 14 | reparse 后 `affected_components` 匹配到的 workspace 出现在 `workspace_ids` 中 | 测试 3 |
| 15 | 通过 M:N 表能查询到关联的 change/task | 测试 4 + 测试 10 |
| 16 | `list_` 方法去重，同一实体不重复出现 | 测试 5 |
| 17 | M:N 为空时 `workspace_ids` 降级为 `[workspace_id]` | 测试 6 |
| 18 | 现有 `workspace_id` FK 和旧逻辑不变，向后兼容 | 代码审查 + 现有测试全通过 |
| 19 | 所有端点有正确的权限保护（无 auth 返回 401） | 现有测试覆盖 |
| 20 | 所有现有测试通过，无回归 | `pytest backend/app/modules/change/tests/ -v` + `pytest backend/app/modules/task/tests/ -v` |
| 21 | 新增测试全部通过 | `pytest backend/app/modules/change/tests/ backend/app/modules/task/tests/ -v` |
