---
id: task-01
title: "数据模型重构 — Workspace 吸收 Component 元数据"
author: qinyi
created_at: "2026-05-28 16:25:00"
priority: P0
estimated_hours: 4
depends_on: []
blocks: [task-02, task-03, task-04, task-07]
allowed_paths:
  - backend/app/modules/workspace/model.py
  - backend/app/modules/workspace/schema.py
  - backend/migrations/versions/
---

# Task-01: 数据模型重构 — Workspace 吸收 Component 元数据

## 1. 修改文件

| # | 文件路径 | 操作 | 说明 |
|---|---|---|---|
| 1 | `backend/app/modules/workspace/model.py` | 修改 | Workspace 模型新增 8 个 component 元数据字段，删除 `sillyspec_path` 字段，新增 `WorkspaceRelation`、`ChangeWorkspace`、`TaskWorkspace`、`AgentRunWorkspace` 四个关联模型 |
| 2 | `backend/app/modules/workspace/schema.py` | 修改 | `WorkspaceCreate` / `WorkspaceRead` 新增 component 元数据字段，删除 `sillyspec_path`，新增 `WorkspaceRelationCreate` / `WorkspaceRelationRead` schema |
| 3 | `backend/migrations/versions/202606130900_workspace_graph.py` | 新增 | Alembic 迁移：workspaces 表加列、删列；新建 workspace_relations / change_workspaces / task_workspaces / agent_run_workspaces 四张表；删 project_components / component_relations 两张表 |

## 2. 实现要求

### 2.1 Workspace 模型吸收 Component 元数据字段

在 `Workspace` 类中新增以下 8 个字段（来源：`ProjectComponent` 模型的对应字段）：

| 字段名 | 类型 | 可空 | 默认值 | 来源 |
|---|---|---|---|---|
| `component_key` | `String(100)` | True | `None` | `ProjectComponent.component_key`，nullable 因为旧 workspace 无此字段 |
| `type` | `String(50)` | True | `None` | `ProjectComponent.type` |
| `role` | `String(100)` | True | `None` | `ProjectComponent.role` |
| `repo_url` | `String` | True | `None` | `ProjectComponent.repo_url` |
| `default_branch` | `String(100)` | True | `"main"` | `ProjectComponent.default_branch` |
| `tech_stack` | `JSON` (list) | False | `[]` | `ProjectComponent.tech_stack` |
| `build_command` | `String` | True | `None` | `ProjectComponent.build_command` |
| `test_command` | `String` | True | `None` | `ProjectComponent.test_command` |
| `source_yaml_path` | `String` | True | `None` | `ProjectComponent.source_yaml_path`，nullable 因为非组件 workspace 无此字段 |

同时**删除** `sillyspec_path` 字段（已被 `SpecWorkspace.spec_root` 替代，见 design.md ADR-07）。

注意：`WorkspaceStatus` literal 不变（`"active" | "archived" | "deleted"`）。`Workspace` 的 `path` 字段不新增，因为 `root_path` 已经表达了路径语义。

### 2.2 新增 WorkspaceRelation 模型

在同一 `model.py` 文件中新增 `WorkspaceRelation` 类：

- 表名：`workspace_relations`
- 字段：`id`(UUID PK), `source_id`(UUID FK -> workspaces.id CASCADE), `target_id`(UUID FK -> workspaces.id CASCADE), `relation_type`(String(50)), `description`(String nullable), `created_at`(DateTime)
- UQ 约束：`(source_id, target_id, relation_type)` — 同一对节点同类型只允许一条
- CHECK 约束：`source_id != target_id`（禁止自环，数据库层面强制）
- Index：`ix_workspace_relations_source` on `source_id`，`ix_workspace_relations_target` on `target_id`
- 关系类型沿用 parser.py 中 `ALLOWED_RELATION_TYPES` 的定义：`depends_on`, `consumes_api_from`, `tests`, `publishes_to`, `documents`

### 2.3 新增 M:N 关联模型

在同一 `model.py` 文件中新增三个关联表模型：

**ChangeWorkspace：**
- 表名：`change_workspaces`
- 复合 PK：`(change_id, workspace_id)`
- 字段：`change_id`(UUID FK -> changes.id CASCADE), `workspace_id`(UUID FK -> workspaces.id CASCADE), `role`(String(30) nullable, 取值 `"primary" | "affected" | "referenced"`)
- Index：`ix_change_workspaces_workspace` on `workspace_id`

**TaskWorkspace：**
- 表名：`task_workspaces`
- 复合 PK：`(task_id, workspace_id)`
- 字段：`task_id`(UUID FK -> tasks.id CASCADE), `workspace_id`(UUID FK -> workspaces.id CASCADE), `role`(String(30) nullable)
- Index：`ix_task_workspaces_workspace` on `workspace_id`

**AgentRunWorkspace：**
- 表名：`agent_run_workspaces`
- 复合 PK：`(agent_run_id, workspace_id)`
- 字段：`agent_run_id`(UUID FK -> agent_runs.id CASCADE), `workspace_id`(UUID FK -> workspaces.id CASCADE)
- Index：`ix_agent_run_workspaces_workspace` on `workspace_id`

### 2.4 Schema 修改

**WorkspaceCreate：**
- 新增字段：`component_key`(str|None), `type`(str|None), `role`(str|None), `repo_url`(str|None), `default_branch`(str|None, default="main"), `tech_stack`(list[str], default=[]), `build_command`(str|None), `test_command`(str|None), `source_yaml_path`(str|None)
- 删除字段：`spec_strategy`（被 `sillyspec_path` 删除连带清理）
- 所有新字段都是 optional，带默认值，确保创建普通 workspace 时不需要传

**WorkspaceRead：**
- 新增与 WorkspaceCreate 对应的 8 个 component 元数据字段（全部返回）
- 删除 `sillyspec_path` 字段

**新增 WorkspaceRelationCreate：**
- `target_id`: uuid.UUID (required)
- `relation_type`: str (required, 必须在 ALLOWED_RELATION_TYPES 中)
- `description`: str | None (optional)

**新增 WorkspaceRelationRead：**
- `id`: uuid.UUID
- `source_id`: uuid.UUID
- `target_id`: uuid.UUID
- `relation_type`: str
- `description`: str | None
- `created_at`: datetime
- `from_attributes=True`

### 2.5 Alembic 迁移

新增迁移文件 `202606130900_workspace_graph.py`，down_revision 为 `"202606120900"`。

**upgrade 步骤（按顺序）：**

```
1. workspaces 表新增列（全部 nullable 或有 server_default）:
   - component_key  VARCHAR(100)  nullable
   - type           VARCHAR(50)   nullable
   - role           VARCHAR(100)  nullable
   - repo_url       TEXT          nullable
   - default_branch VARCHAR(100)  nullable  server_default='main'
   - tech_stack     JSONB         nullable  server_default='[]'
   - build_command  TEXT          nullable
   - test_command   TEXT          nullable
   - source_yaml_path TEXT        nullable

2. workspaces 表删除列:
   - sillyspec_path

3. 创建 workspace_relations 表:
   - id (UUID PK, gen_random_uuid)
   - source_id (UUID FK -> workspaces.id, CASCADE)
   - target_id (UUID FK -> workspaces.id, CASCADE)
   - relation_type (VARCHAR(50), NOT NULL)
   - description (TEXT, nullable)
   - created_at (TIMESTAMP WITH TZ, NOT NULL, NOW())
   - PK: id
   - UQ: (source_id, target_id, relation_type)
   - CHECK: source_id != target_id
   - Index: ix_workspace_relations_source(source_id)
   - Index: ix_workspace_relations_target(target_id)

4. 创建 change_workspaces 表:
   - change_id (UUID FK -> changes.id, CASCADE)
   - workspace_id (UUID FK -> workspaces.id, CASCADE)
   - role (VARCHAR(30), nullable)
   - PK: (change_id, workspace_id)
   - Index: ix_change_workspaces_workspace(workspace_id)

5. 创建 task_workspaces 表:
   - task_id (UUID FK -> tasks.id, CASCADE)
   - workspace_id (UUID FK -> workspaces.id, CASCADE)
   - role (VARCHAR(30), nullable)
   - PK: (task_id, workspace_id)
   - Index: ix_task_workspaces_workspace(workspace_id)

6. 创建 agent_run_workspaces 表:
   - agent_run_id (UUID FK -> agent_runs.id, CASCADE)
   - workspace_id (UUID FK -> workspaces.id, CASCADE)
   - PK: (agent_run_id, workspace_id)
   - Index: ix_agent_run_workspaces_workspace(workspace_id)

7. 删除 project_components 表:
   - drop index ux_components_workspace_key
   - drop index ix_components_workspace
   - drop table project_components

8. 删除 component_relations 表:
   - drop index ux_relations_triplet
   - drop index ix_relations_workspace
   - drop table component_relations
```

**downgrade 步骤（逆序）：**
1. 重建 component_relations 表
2. 重建 project_components 表
3. drop agent_run_workspaces
4. drop task_workspaces
5. drop change_workspaces
6. drop workspace_relations
7. workspaces 表重新加回 sillyspec_path 列
8. workspaces 表删除新增的 9 个列

## 3. 接口定义

### 3.1 Workspace 模型 (model.py)

```python
# === 新增字段（插入到 Workspace 类中，放在 status 之后、created_by 之前）===

component_key: str | None = Field(
    default=None,
    sa_column=Column(String(100), nullable=True),
)
type: str | None = Field(
    default=None,
    sa_column=Column(String(50), nullable=True),
)
role: str | None = Field(
    default=None,
    sa_column=Column(String(100), nullable=True),
)
repo_url: str | None = Field(
    default=None,
    sa_column=Column(String, nullable=True),
)
default_branch: str | None = Field(
    default="main",
    sa_column=Column(String(100), nullable=True),
)
tech_stack: list[str] = Field(
    default_factory=list,
    sa_column=Column(JSON, nullable=False, default=list),
)
build_command: str | None = Field(
    default=None,
    sa_column=Column(String, nullable=True),
)
test_command: str | None = Field(
    default=None,
    sa_column=Column(String, nullable=True),
)
source_yaml_path: str | None = Field(
    default=None,
    sa_column=Column(String, nullable=True),
)

# === 删除字段 ===
# 删除: sillyspec_path: str = Field(sa_column=Column(String, nullable=False))
```

### 3.2 WorkspaceRelation 模型 (model.py)

```python
class WorkspaceRelation(BaseModel, table=True):
    """Directed relation between two workspaces."""

    __tablename__ = "workspace_relations"
    __table_args__ = (
        Index(
            "ux_workspace_relations_triplet",
            "source_id",
            "target_id",
            "relation_type",
            unique=True,
        ),
        Index("ix_workspace_relations_source", "source_id"),
        Index("ix_workspace_relations_target", "target_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    source_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    target_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    relation_type: str = Field(sa_column=Column(String(50), nullable=False))
    description: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    created_at: datetime = Field(
        default_factory=lambda: datetime.utcnow(),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
```

注意：自环 CHECK 约束在 Alembic 迁移中用 `sa.CheckConstraint` 实现，不在 SQLModel `__table_args__` 中声明，因为 SQLite 不支持 CHECK constraint on FK 列的跨行比较。迁移中用 `sa.CheckConstraint("source_id != target_id", name="ck_workspace_relations_no_self_loop")` 添加。

### 3.3 ChangeWorkspace 模型 (model.py)

```python
class ChangeWorkspace(BaseModel, table=True):
    """M:N association between changes and workspaces."""

    __tablename__ = "change_workspaces"
    __table_args__ = (
        Index("ix_change_workspaces_workspace", "workspace_id"),
    )

    change_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("changes.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    role: str | None = Field(
        default=None,
        sa_column=Column(String(30), nullable=True),
    )
```

### 3.4 TaskWorkspace 模型 (model.py)

```python
class TaskWorkspace(BaseModel, table=True):
    """M:N association between tasks and workspaces."""

    __tablename__ = "task_workspaces"
    __table_args__ = (
        Index("ix_task_workspaces_workspace", "workspace_id"),
    )

    task_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("tasks.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    role: str | None = Field(
        default=None,
        sa_column=Column(String(30), nullable=True),
    )
```

### 3.5 AgentRunWorkspace 模型 (model.py)

```python
class AgentRunWorkspace(BaseModel, table=True):
    """M:N association between agent runs and workspaces."""

    __tablename__ = "agent_run_workspaces"
    __table_args__ = (
        Index("ix_agent_run_workspaces_workspace", "workspace_id"),
    )

    agent_run_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_runs.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
```

### 3.6 Schema 变更 (schema.py)

```python
# === WorkspaceCreate 修改 ===
class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str | None = Field(default=None, max_length=100)
    root_path: str = Field(min_length=1, max_length=4096)
    # 新增 component 元数据字段（全部 optional）
    component_key: str | None = Field(default=None, max_length=100)
    type: str | None = Field(default=None, max_length=50)
    role: str | None = Field(default=None, max_length=100)
    repo_url: str | None = Field(default=None)
    default_branch: str | None = Field(default="main", max_length=100)
    tech_stack: list[str] = Field(default_factory=list)
    build_command: str | None = Field(default=None)
    test_command: str | None = Field(default=None)
    source_yaml_path: str | None = Field(default=None)
    # 删除: spec_strategy

    # _validate_slug 不变


# === WorkspaceRead 修改 ===
class WorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    root_path: str
    # 删除: sillyspec_path: str
    status: WorkspaceStatusLiteral
    # 新增 component 元数据字段
    component_key: str | None
    type: str | None
    role: str | None
    repo_url: str | None
    default_branch: str | None
    tech_stack: list[str]
    build_command: str | None
    test_command: str | None
    source_yaml_path: str | None
    # 原有字段不变
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    last_scanned_at: datetime | None
    deleted_at: datetime | None


# === 新增 WorkspaceRelationCreate ===
class WorkspaceRelationCreate(BaseModel):
    target_id: uuid.UUID
    relation_type: str = Field(min_length=1, max_length=50)
    description: str | None = Field(default=None)


# === 新增 WorkspaceRelationRead ===
class WorkspaceRelationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_id: uuid.UUID
    target_id: uuid.UUID
    relation_type: str
    description: str | None
    created_at: datetime
```

### 3.7 import 变更 (model.py 头部)

```python
# 新增 JSON import（如未有）
from sqlalchemy import JSON, Column, DateTime, Index, String, Uuid, text
from sqlalchemy import CheckConstraint  # 迁移用，model.py 不需要
```

### 3.8 ScanResponse Schema 变更 (schema.py)

`ScanResponse` 中删除 `sillyspec_path` 字段（因为 `sillyspec_path` 列从 Workspace 模型中移除了）。Scanner 的 `ScanResult` 运行时仍可计算 `sillyspec_path` 用于展示，但不再作为持久化字段。

```python
class ScanResponse(BaseModel):
    root_path: str
    is_sillyspec: bool
    sillyspec_strategy_hint: str
    structure: WorkspaceStructureDTO
    warnings: list[str] = Field(default_factory=list)
    # 删除: sillyspec_path: str
```

注意：`ScanResponse` 是扫描结果的即时返回，不落库。`sillyspec_path` 的计算逻辑（`root / ".sillyspec"`）仍在 `WorkspaceScanner.scan()` 中保留，只是不再持久化到 Workspace 记录。如果后续 API 调用者需要这个路径，可以从 `root_path + "/.sillyspec"` 推导。

## 4. 边界处理

### 4.1 旧数据兼容：workspaces 表加列时已有行的新字段

- 所有新增的 component 元数据字段均设为 `nullable=True` 或有 `server_default`
- 已有的 workspace 行自动获得 `NULL`（字符串字段）或 `[]`（tech_stack）或 `"main"`（default_branch）
- 迁移中不回填数据（回填逻辑属于 task-04 解析器迁移）

### 4.2 sillyspec_path 列删除后已有代码引用

- `schema.py` 中 `WorkspaceRead.sillyspec_path` 和 `ScanResponse.sillyspec_path` 必须同步删除
- `scanner.py` 中 `ScanResult.sillyspec_path` 是运行时字段，不落库，**保留不变**
- `service.py` 中如果有引用 `workspace.sillyspec_path` 的代码，需要改为从 `root_path` 推导（`root_path + "/.sillyspec"`）
- 本 task 只负责模型和迁移层的变更，service/router 层的适配在 task-04 中完成

### 4.3 自环检查：WorkspaceRelation 的 source_id == target_id

- 数据库层：迁移中加 `CHECK (source_id != target_id)` 约束
- 应用层：模型定义不加 CHECK（SQLModel/SQLite 兼容性），由 task-02 的 service 层做校验
- 即使数据库 CHECK 被绕过，查询逻辑也不应崩溃（拓扑图构建在 task-02 中会跳过自环）

### 4.4 循环依赖：WorkspaceRelation 允许 A -> B -> A

- UQ 约束只限制 `(source_id, target_id, relation_type)`，不阻止反向边
- A -> B (depends_on) 和 B -> A (consumes_api_from) 是合法的不同 relation_type
- A -> B (depends_on) 和 B -> A (depends_on) 也是合法的（双向依赖）
- 不做 DAG 校验，设计文档 ADR-08 明确允许

### 4.5 M:N 关联表复合 PK 冲突

- `change_workspaces` 等表的 PK 是 `(change_id, workspace_id)` 复合主键
- 同一 change 重复关联同一 workspace 会被 PK 约束拒绝（SQL INSERT 报错）
- service 层（task-03）应捕获 `IntegrityError` 并转换为 409 Conflict
- `role` 字段更新需要先 DELETE 再 INSERT（复合 PK 表没有单独的 UPDATE 场景）

### 4.6 空值 / 缺失字段处理

- `component_key` 为 `None` 时表示该 workspace 不是从组件解析而来（纯 workspace）
- `tech_stack` 为空列表 `[]` 而非 `None`（`default_factory=list`，`server_default='[]'`）
- `default_branch` 为 `None` 时前端应显示 "main"（逻辑默认值）
- `source_yaml_path` 为 `None` 时表示非 YAML 解析来源

### 4.7 删除 Workspace 时的级联

- `workspace_relations` 的 `source_id` 和 `target_id` 都有 `CASCADE` 删除
- 删除一个 workspace 会自动删除所有以它为 source 或 target 的 relation
- `change_workspaces` / `task_workspaces` / `agent_run_workspaces` 也有 CASCADE
- 但不会删除关联的 change/task/agent_run 本身（只删除关联行）

### 4.8 迁移 downgrade 的数据丢失

- downgrade 时 `project_components` 和 `component_relations` 表会被重建但数据为空
- workspaces 表新增的 component 字段会被删除，已有数据丢失
- 设计文档明确 "本项目未正式上线，不需要考虑版本迭代兼容问题"，因此这是可接受的
- 在 downgrade 注释中标注 `# WARN: data loss — component metadata in workspaces will be dropped`

## 5. 非目标

- **不修改 service.py / router.py**：业务逻辑适配在 task-02（WorkspaceRelation CRUD）、task-04（解析器迁移）中完成
- **不删除 component/ 模块目录**：在 task-06 中完成，本 task 只做模型层准备
- **不做数据回填**：已有 workspace 行的 component 元数据字段保持 NULL/默认值，回填在 task-04 中随解析器一起做
- **不修改 Change/Task/AgentRun 模型**：它们的 `workspace_id` FK 保留不变，M:N 关联表是补充而非替代
- **不修改前端**：前端适配在独立的前端任务中完成
- **不修改 parser.py**：parser 的输出类型（`ParsedComponent`）不变，迁移在 task-04 中做
- **不实现 topology API**：`GET /api/workspaces/topology` 在 task-02 中实现
- **不实现 relation CRUD API**：`POST/GET/DELETE` relation 端点在 task-02 中实现

## 6. 参考

### 6.1 现有模型模式

- `backend/app/modules/component/model.py` — `ProjectComponent` 字段定义和类型选择（直接复制字段类型）
- `backend/app/modules/component/model.py` — `ComponentRelation` 的 UQ 约束模式（triplet index）
- `backend/app/modules/workspace/model.py` — `Workspace` 的基础结构和 partial unique index 模式
- `backend/app/models/base.py` — `BaseModel` 基类，所有模型都继承它

### 6.2 现有迁移模式

- `backend/migrations/versions/202605270900_create_components_and_relations.py` — 创建组件表的标准模式（列定义、FK、index、server_default）
- `backend/migrations/versions/202605260900_create_workspaces.py` — workspace 表结构

### 6.3 字段来源映射

| Workspace 新字段 | ProjectComponent 原字段 | 类型映射 | 注意事项 |
|---|---|---|---|
| `component_key` | `component_key: str` | `str -> str \| None` | 原 NOT NULL，现 nullable（兼容旧 workspace） |
| `type` | `type: str \| None` | 不变 | |
| `role` | `role: str \| None` | 不变 | |
| `repo_url` | `repo_url: str \| None` | `String -> String`（Text 也可以） | |
| `default_branch` | `default_branch: str \| None` | 不变 | 保持 server_default "main" |
| `tech_stack` | `tech_stack: list[str]` | 不变 | 保持 JSON 列 + default_factory=list |
| `build_command` | `build_command: str \| None` | 不变 | |
| `test_command` | `test_command: str \| None` | 不变 | |
| `source_yaml_path` | `source_yaml_path: str` | `str -> str \| None` | 原 NOT NULL，现 nullable |

## 7. TDD 步骤

### Step 1: 测试 Workspace 模型字段存在性

```python
# backend/app/modules/workspace/tests/test_model.py (新建或在现有测试文件中追加)

def test_workspace_has_component_metadata_fields():
    """Workspace 模型应包含所有 component 元数据字段。"""
    from backend.app.modules.workspace.model import Workspace
    field_names = {f.name for f in Workspace.model_fields.values()}
    required = {
        "component_key", "type", "role", "repo_url", "default_branch",
        "tech_stack", "build_command", "test_command", "source_yaml_path",
    }
    assert required.issubset(field_names), f"Missing fields: {required - field_names}"

def test_workspace_no_sillyspec_path():
    """Workspace 模型不应再包含 sillyspec_path 字段。"""
    from backend.app.modules.workspace.model import Workspace
    field_names = {f.name for f in Workspace.model_fields.values()}
    assert "sillyspec_path" not in field_names
```

### Step 2: 测试 Workspace 模型字段默认值

```python
def test_workspace_component_fields_default_to_none_or_empty():
    """新 Workspace 实例的 component 元数据字段应有正确默认值。"""
    from backend.app.modules.workspace.model import Workspace
    ws = Workspace(name="test", slug="test", root_path="/tmp/test")
    assert ws.component_key is None
    assert ws.type is None
    assert ws.role is None
    assert ws.repo_url is None
    assert ws.default_branch == "main"
    assert ws.tech_stack == []
    assert ws.build_command is None
    assert ws.test_command is None
    assert ws.source_yaml_path is None
```

### Step 3: 测试 WorkspaceRelation 模型

```python
def test_workspace_relation_model_fields():
    """WorkspaceRelation 模型应包含正确的字段。"""
    from backend.app.modules.workspace.model import WorkspaceRelation
    field_names = {f.name for f in WorkspaceRelation.model_fields.values()}
    assert "source_id" in field_names
    assert "target_id" in field_names
    assert "relation_type" in field_names
    assert "description" in field_names
    assert "created_at" in field_names

def test_workspace_relation_table_constraints():
    """WorkspaceRelation 表应有正确的 UQ 和索引。"""
    from backend.app.modules.workspace.model import WorkspaceRelation
    index_names = {idx.name for idx in WorkspaceRelation.__table_args__ if hasattr(idx, 'name')}
    assert "ux_workspace_relations_triplet" in index_names
    assert "ix_workspace_relations_source" in index_names
    assert "ix_workspace_relations_target" in index_names
```

### Step 4: 测试 M:N 关联模型

```python
def test_change_workspace_composite_pk():
    """ChangeWorkspace 应使用复合主键。"""
    from backend.app.modules.workspace.model import ChangeWorkspace
    pk_cols = [c.name for c in ChangeWorkspace.__table__.primary_key.columns]
    assert set(pk_cols) == {"change_id", "workspace_id"}

def test_task_workspace_composite_pk():
    """TaskWorkspace 应使用复合主键。"""
    from backend.app.modules.workspace.model import TaskWorkspace
    pk_cols = [c.name for c in TaskWorkspace.__table__.primary_key.columns]
    assert set(pk_cols) == {"task_id", "workspace_id"}

def test_agent_run_workspace_composite_pk():
    """AgentRunWorkspace 应使用复合主键。"""
    from backend.app.modules.workspace.model import AgentRunWorkspace
    pk_cols = [c.name for c in AgentRunWorkspace.__table__.primary_key.columns]
    assert set(pk_cols) == {"agent_run_id", "workspace_id"}
```

### Step 5: 测试 Schema 变更

```python
def test_workspace_create_accepts_component_fields():
    """WorkspaceCreate 应接受所有 component 元数据字段。"""
    from backend.app.modules.workspace.schema import WorkspaceCreate
    data = {
        "name": "test-ws",
        "root_path": "/tmp/test",
        "component_key": "api-gateway",
        "type": "service",
        "role": "backend",
        "repo_url": "https://github.com/org/api",
        "default_branch": "develop",
        "tech_stack": ["python", "fastapi"],
        "build_command": "make build",
        "test_command": "make test",
        "source_yaml_path": ".sillyspec/projects/api.yaml",
    }
    dto = WorkspaceCreate(**data)
    assert dto.component_key == "api-gateway"
    assert dto.tech_stack == ["python", "fastapi"]

def test_workspace_create_component_fields_optional():
    """WorkspaceCreate 的 component 字段应全部 optional。"""
    from backend.app.modules.workspace.schema import WorkspaceCreate
    dto = WorkspaceCreate(name="plain-ws", root_path="/tmp/plain")
    assert dto.component_key is None
    assert dto.tech_stack == []

def test_workspace_read_has_no_sillyspec_path():
    """WorkspaceRead 不应包含 sillyspec_path 字段。"""
    from backend.app.modules.workspace.schema import WorkspaceRead
    field_names = set(WorkspaceRead.model_fields.keys())
    assert "sillyspec_path" not in field_names

def test_workspace_relation_create_schema():
    """WorkspaceRelationCreate 应包含必要字段。"""
    import uuid
    from backend.app.modules.workspace.schema import WorkspaceRelationCreate
    data = {
        "target_id": str(uuid.uuid4()),
        "relation_type": "depends_on",
    }
    dto = WorkspaceRelationCreate(**data)
    assert dto.relation_type == "depends_on"
    assert dto.description is None
```

### Step 6: 测试迁移文件存在性和基本结构

```python
def test_migration_file_exists():
    """workspace_graph 迁移文件应存在。"""
    from pathlib import Path
    migration_dir = Path("backend/migrations/versions")
    files = list(migration_dir.glob("*workspace_graph*"))
    assert len(files) == 1, f"Expected 1 migration file, found {len(files)}"

def test_migration_upgrade_creates_tables():
    """迁移的 upgrade 应创建 4 张新表。"""
    # 这通过 Alembic 的 upgrade head 测试来覆盖
    # 确保迁移文件中包含 create_table("workspace_relations", ...) 等 4 个调用
```

### Step 7: 集成测试 — DB 级别约束

```python
# 以下测试需要数据库 fixture（使用测试 SQLite 或 Postgres）

@pytest.mark.asyncio
async def test_workspace_relation_self_loop_rejected(db_session):
    """自环 relation 应被 CHECK 约束拒绝（Postgres）或在 service 层被拒绝。"""
    from backend.app.modules.workspace.model import Workspace, WorkspaceRelation
    ws = Workspace(name="loop-test", slug="loop-test", root_path="/tmp/loop")
    db_session.add(ws)
    await db_session.flush()
    relation = WorkspaceRelation(
        source_id=ws.id, target_id=ws.id,
        relation_type="depends_on"
    )
    db_session.add(relation)
    with pytest.raises(IntegrityError):
        await db_session.flush()

@pytest.mark.asyncio
async def test_workspace_relation_unique_triplet(db_session):
    """同一对 (source, target, type) 不应重复。"""
    from backend.app.modules.workspace.model import Workspace, WorkspaceRelation
    ws1 = Workspace(name="ws1", slug="ws1", root_path="/tmp/ws1")
    ws2 = Workspace(name="ws2", slug="ws2", root_path="/tmp/ws2")
    db_session.add_all([ws1, ws2])
    await db_session.flush()
    rel1 = WorkspaceRelation(
        source_id=ws1.id, target_id=ws2.id, relation_type="depends_on"
    )
    rel2 = WorkspaceRelation(
        source_id=ws1.id, target_id=ws2.id, relation_type="depends_on"
    )
    db_session.add(rel1)
    await db_session.flush()
    db_session.add(rel2)
    with pytest.raises(IntegrityError):
        await db_session.flush()

@pytest.mark.asyncio
async def test_change_workspace_composite_pk_unique(db_session):
    """同一 (change_id, workspace_id) 不应重复。"""
    from backend.app.modules.workspace.model import Workspace, ChangeWorkspace
    from backend.app.modules.change.model import Change
    ws = Workspace(name="cw-test", slug="cw-test", root_path="/tmp/cw")
    db_session.add(ws)
    await db_session.flush()
    ch = Change(
        workspace_id=ws.id, change_key="test-change",
        location="change", path="/tmp/test-change"
    )
    db_session.add(ch)
    await db_session.flush()
    assoc1 = ChangeWorkspace(change_id=ch.id, workspace_id=ws.id)
    assoc2 = ChangeWorkspace(change_id=ch.id, workspace_id=ws.id)
    db_session.add(assoc1)
    await db_session.flush()
    db_session.add(assoc2)
    with pytest.raises(IntegrityError):
        await db_session.flush()
```

### TDD 执行顺序

1. 先写 Step 1 ~ Step 5（纯模型/schema 测试，不需要 DB）
2. 实现 model.py 和 schema.py
3. 运行 Step 1 ~ Step 5 确认通过
4. 写 Step 6（迁移文件存在性测试）
5. 创建迁移文件 `202606130900_workspace_graph.py`
6. 运行 `alembic upgrade head` 确认迁移成功
7. 写 Step 7（DB 级别约束测试）
8. 运行 Step 7 确认约束生效
9. 全量 `pytest` 确认无回归

## 8. 验收标准

| # | 验收项 | 验证方法 | 通过条件 |
|---|---|---|---|
| AC-01 | Workspace 模型包含 9 个 component 元数据字段 | `Workspace.model_fields` 检查 | `component_key`, `type`, `role`, `repo_url`, `default_branch`, `tech_stack`, `build_command`, `test_command`, `source_yaml_path` 全部存在 |
| AC-02 | Workspace 模型不包含 sillyspec_path 字段 | `Workspace.model_fields` 检查 | `"sillyspec_path" not in field_names` |
| AC-03 | Workspace 新字段默认值正确 | 创建无参数 Workspace 实例 | `component_key=None`, `tech_stack=[]`, `default_branch="main"` 等 |
| AC-04 | WorkspaceRelation 模型包含正确字段和约束 | 模型检查 | `source_id`, `target_id`, `relation_type`, `description`, `created_at` 存在；UQ triplet index 存在 |
| AC-05 | ChangeWorkspace 复合主键正确 | 检查 PK columns | `{"change_id", "workspace_id"}` |
| AC-06 | TaskWorkspace 复合主键正确 | 检查 PK columns | `{"task_id", "workspace_id"}` |
| AC-07 | AgentRunWorkspace 复合主键正确 | 检查 PK columns | `{"agent_run_id", "workspace_id"}` |
| AC-08 | WorkspaceCreate schema 接受 component 字段 | 构造含 component 字段的 DTO | 不报错，字段值正确 |
| AC-09 | WorkspaceCreate schema 的 component 字段全部 optional | 构造仅 name+root_path 的 DTO | 不报错，默认值正确 |
| AC-10 | WorkspaceRead schema 不含 sillyspec_path | 检查 model_fields | `"sillyspec_path" not in field_names` |
| AC-11 | WorkspaceRead schema 包含所有 component 字段 | 检查 model_fields | 9 个字段全部存在 |
| AC-12 | WorkspaceRelationCreate/Read schema 定义正确 | 构造 DTO 实例 | 字段存在，类型正确 |
| AC-13 | 迁移文件存在且结构正确 | 检查文件内容 | 包含 4 个 create_table + 9 个 add_column + 1 个 drop_column + 2 个 drop_table |
| AC-14 | 迁移 upgrade 成功 | `alembic upgrade head` | 无错误，数据库表结构正确 |
| AC-15 | 迁移 downgrade 成功 | `alembic downgrade -1` 后再 `upgrade` | 无错误，round-trip 成功 |
| AC-16 | workspace_relations 自环 CHECK 约束生效 | 插入自环 relation（Postgres） | IntegrityError 被抛出 |
| AC-17 | workspace_relations UQ triplet 约束生效 | 插入重复 relation | IntegrityError 被抛出 |
| AC-18 | M:N 关联表复合 PK 约束生效 | 插入重复关联 | IntegrityError 被抛出 |
| AC-19 | 现有 workspace 测试通过 | `pytest backend/app/modules/workspace/tests/` | 全绿 |
| AC-20 | 全量测试通过 | `pytest backend/` | 无回归（允许因 schema 变更导致的已知失败，需在 PR 中说明） |
