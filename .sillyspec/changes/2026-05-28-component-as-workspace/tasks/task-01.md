---
author: qinyi
created_at: 2026-05-29T17:40:00+08:00
id: task-01
title: "数据模型重构 — Workspace 吸收 Component 元数据"
priority: P0
estimated_hours: 4
depends_on: []
blocks: [task-02, task-03, task-04, task-07]
allowed_paths:
  - backend/app/modules/workspace/model.py
  - backend/app/modules/workspace/schema.py
  - backend/migrations/versions/202606130900_workspace_graph.py
  - backend/app/modules/workspace/tests/test_model.py
---

# task-01: 数据模型重构 — Workspace 吸收 Component 元数据

本任务是 Wave 1 关键路径起点。目标：Workspace 模型吸收旧 `ProjectComponent` 的全部元数据字段，新增 `WorkspaceRelation`、`ChangeWorkspace`、`TaskWorkspace`、`AgentRunWorkspace` 四个模型，删除 `sillyspec_path` 列，并通过 Alembic 迁移完成数据库结构变更（含删除旧 `project_components` / `component_relations` 表）。

## 修改文件

| # | 文件路径 | 操作 | 说明 |
|---|---|---|---|
| 1 | `backend/app/modules/workspace/model.py` | 修改 | Workspace 新增 9 个 component 元数据字段，删除 `sillyspec_path`；新增 `WorkspaceRelation`、`ChangeWorkspace`、`TaskWorkspace`、`AgentRunWorkspace` 四个模型 |
| 2 | `backend/app/modules/workspace/schema.py` | 修改 | `WorkspaceCreate`/`WorkspaceRead` 新增对应字段，删除 `sillyspec_path`；新增 `WorkspaceRelationCreate`/`WorkspaceRelationRead` schema；`ScanResponse` 删除 `sillyspec_path` |
| 3 | `backend/migrations/versions/202606130900_workspace_graph.py` | 新增 | Alembic 迁移：workspaces 加列/删列；建 4 张新表；删 2 张旧表；迁移 worktree_leases 和 scan_documents 的 FK 引用 |
| 4 | `backend/app/modules/workspace/tests/test_model.py` | 修改 | 新增模型字段存在性、默认值、约束、schema 等测试用例 |

## 实现要求

### R1: Workspace 模型吸收 Component 元数据字段

在 `Workspace` 类的 `status` 字段之后、`created_by` 字段之前，新增以下 9 个字段：

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|---|---|---|---|---|
| `component_key` | `String(100)` | True | `None` | 旧组件标识，nullable 兼容旧 workspace |
| `type` | `String(50)` | True | `None` | service / library / frontend 等 |
| `role` | `String(100)` | True | `None` | 功能角色 |
| `repo_url` | `String` (TEXT) | True | `None` | 源码仓库 URL |
| `default_branch` | `String(100)` | True | `"main"` | 默认分支 |
| `tech_stack` | `JSON` | False | `[]` | 技术栈列表 |
| `build_command` | `String` (TEXT) | True | `None` | 构建命令 |
| `test_command` | `String` (TEXT) | True | `None` | 测试命令 |
| `source_yaml_path` | `String` (TEXT) | True | `None` | 来源 projects yaml 路径 |

同时**删除** `sillyspec_path` 字段（已被 `SpecWorkspace.spec_root` 替代）。

### R2: 新增 WorkspaceRelation 模型

- 表名：`workspace_relations`
- 字段：`id`(UUID PK), `source_id`(UUID FK -> workspaces.id CASCADE), `target_id`(UUID FK -> workspaces.id CASCADE), `relation_type`(String(50)), `description`(String nullable), `created_at`(DateTime)
- UQ 约束：`(source_id, target_id, relation_type)` — 命名 `ux_workspace_relations_triplet`
- 索引：`ix_workspace_relations_source` on `source_id`，`ix_workspace_relations_target` on `target_id`
- 自环 CHECK：在 Alembic 迁移中用 `CheckConstraint("source_id != target_id", name="ck_workspace_relations_no_self_loop")` 实现，不在 SQLModel `__table_args__` 中声明
- 关系类型由 `parser.py` 的 `ALLOWED_RELATION_TYPES` 定义：`depends_on`, `consumes_api_from`, `tests`, `publishes_to`, `documents`

### R3: 新增 M:N 关联模型

**ChangeWorkspace** (`change_workspaces`)：
- 复合 PK：`(change_id, workspace_id)`
- FK：`change_id` -> `changes.id` CASCADE, `workspace_id` -> `workspaces.id` CASCADE
- `role`(String(30) nullable): `"primary"` / `"affected"` / `"referenced"`
- 索引：`ix_change_workspaces_workspace` on `workspace_id`

**TaskWorkspace** (`task_workspaces`)：
- 复合 PK：`(task_id, workspace_id)`
- FK：`task_id` -> `tasks.id` CASCADE, `workspace_id` -> `workspaces.id` CASCADE
- `role`(String(30) nullable)
- 索引：`ix_task_workspaces_workspace` on `workspace_id`

**AgentRunWorkspace** (`agent_run_workspaces`)：
- 复合 PK：`(agent_run_id, workspace_id)`
- FK：`agent_run_id` -> `agent_runs.id` CASCADE, `workspace_id` -> `workspaces.id` CASCADE
- 索引：`ix_agent_run_workspaces_workspace` on `workspace_id`

### R4: Schema 变更

**WorkspaceCreate**：新增全部 9 个 component 字段（均 optional，带默认值），确保仅传 `name` + `root_path` 即可创建普通 workspace。删除 `spec_strategy` 字段。

**WorkspaceRead**：新增 9 个 component 字段（全部返回），删除 `sillyspec_path`。

**ScanResponse**：删除 `sillyspec_path` 字段。Scanner 运行时 `ScanResult.sillyspec_path` 保留不变（不落库）。

**新增 WorkspaceRelationCreate**：`target_id`(UUID), `relation_type`(str), `description`(str|None)

**新增 WorkspaceRelationRead**：`id`, `source_id`, `target_id`, `relation_type`, `description`, `created_at`，`from_attributes=True`

### R5: Alembic 迁移

迁移文件 `202606130900_workspace_graph.py`，`down_revision = "202606120900"`。

**upgrade 按以下顺序执行：**

1. workspaces 表新增 9 列（全部 nullable 或有 server_default）
2. workspaces 表删除 `sillyspec_path` 列
3. 创建 `workspace_relations` 表（含 CHECK 自环约束、UQ triplet、索引）
4. 创建 `change_workspaces` 表（含复合 PK、FK、索引）
5. 创建 `task_workspaces` 表
6. 创建 `agent_run_workspaces` 表
7. 迁移 FK 引用：
   - `scan_documents.component_id`：删除 FK 约束 `scan_documents_component_id_fkey`、删除相关索引和列
   - `worktree_leases.component_id`：将 FK 从 `project_components` 改为 `workspaces`
8. 删除 `component_relations` 表（先删索引再删表）
9. 删除 `project_components` 表

**downgrade 按逆序执行：**
- 重建旧表（数据丢失，标注 WARN 注释）
- 删新表
- 恢复 `sillyspec_path`
- 删新增列

### R6: 测试

在 `test_model.py` 中补充以下测试（按 TDD 顺序）：
- Workspace 字段存在性（AC-01）
- Workspace 不含 `sillyspec_path`（AC-02）
- Workspace 新字段默认值（AC-03）
- WorkspaceRelation 字段和约束（AC-04）
- M:N 模型复合 PK（AC-05/06/07）
- Schema 变更（AC-08/09/10/11/12）
- 迁移文件存在性
- DB 级别约束（AC-17/18，需 db_session fixture）

## 接口定义

### Workspace 模型新增字段

```python
# backend/app/modules/workspace/model.py — Workspace 类内部
# 插入位置：status 字段之后，created_by 字段之前

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

# 删除字段：
# sillyspec_path: str = Field(sa_column=Column(String, nullable=False))
```

### WorkspaceRelation 模型

```python
# backend/app/modules/workspace/model.py — Workspace 类之后

class WorkspaceRelation(BaseModel, table=True):
    """Directed relation between two workspaces."""

    __tablename__ = "workspace_relations"
    __table_args__ = (
        Index(
            "ux_workspace_relations_triplet",
            "source_id", "target_id", "relation_type",
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

### ChangeWorkspace 模型

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
            primary_key=True, nullable=False,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True, nullable=False,
        ),
    )
    role: str | None = Field(
        default=None,
        sa_column=Column(String(30), nullable=True),
    )
```

### TaskWorkspace 模型

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
            primary_key=True, nullable=False,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True, nullable=False,
        ),
    )
    role: str | None = Field(
        default=None,
        sa_column=Column(String(30), nullable=True),
    )
```

### AgentRunWorkspace 模型

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
            primary_key=True, nullable=False,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True, nullable=False,
        ),
    )
```

### Schema 变更

```python
# backend/app/modules/workspace/schema.py

# === WorkspaceCreate（修改）===
class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str | None = Field(default=None, max_length=100)
    root_path: str = Field(min_length=1, max_length=4096)
    # 新增：全部 optional
    component_key: str | None = Field(default=None, max_length=100)
    type: str | None = Field(default=None, max_length=50)
    role: str | None = Field(default=None, max_length=100)
    repo_url: str | None = Field(default=None)
    default_branch: str | None = Field(default="main", max_length=100)
    tech_stack: list[str] = Field(default_factory=list)
    build_command: str | None = Field(default=None)
    test_command: str | None = Field(default=None)
    source_yaml_path: str | None = Field(default=None)
    # 删除：spec_strategy
    # _validate_slug 不变


# === WorkspaceRead（修改）===
class WorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    slug: str
    root_path: str
    # 删除：sillyspec_path
    status: WorkspaceStatusLiteral
    # 新增
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


# === ScanResponse（修改）===
class ScanResponse(BaseModel):
    root_path: str
    is_sillyspec: bool
    structure: WorkspaceStructureDTO
    warnings: list[str] = Field(default_factory=list)
    # 删除：sillyspec_path


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

### Alembic 迁移伪代码

```python
# backend/migrations/versions/202606130900_workspace_graph.py
# revision = "202606130900", down_revision = "202606120900"

def upgrade() -> None:
    # Step 1: workspaces 加 9 列
    op.add_column("workspaces", sa.Column("component_key", sa.String(100), nullable=True))
    op.add_column("workspaces", sa.Column("type", sa.String(50), nullable=True))
    op.add_column("workspaces", sa.Column("role", sa.String(100), nullable=True))
    op.add_column("workspaces", sa.Column("repo_url", sa.Text(), nullable=True))
    op.add_column("workspaces", sa.Column("default_branch", sa.String(100), nullable=True, server_default=sa.text("'main'")))
    op.add_column("workspaces", sa.Column("tech_stack", postgresql.JSONB(astext_type=sa.Text()), nullable=True, server_default=sa.text("'[]'::jsonb")))
    op.add_column("workspaces", sa.Column("build_command", sa.Text(), nullable=True))
    op.add_column("workspaces", sa.Column("test_command", sa.Text(), nullable=True))
    op.add_column("workspaces", sa.Column("source_yaml_path", sa.Text(), nullable=True))

    # Step 2: 删 sillyspec_path
    op.drop_column("workspaces", "sillyspec_path")

    # Step 3: 创建 workspace_relations（含 CHECK, UQ, 索引）
    op.create_table("workspace_relations", ...)
    # CHECK: source_id != target_id
    # UQ: (source_id, target_id, relation_type)
    # Index: ix_workspace_relations_source, ix_workspace_relations_target

    # Step 4: 创建 change_workspaces（复合 PK, FK, 索引）
    op.create_table("change_workspaces", ...)

    # Step 5: 创建 task_workspaces
    op.create_table("task_workspaces", ...)

    # Step 6: 创建 agent_run_workspaces
    op.create_table("agent_run_workspaces", ...)

    # Step 7a: scan_documents — 删 component_id FK + 索引 + 列
    op.drop_constraint("scan_documents_component_id_fkey", "scan_documents", type_="foreignkey")
    op.drop_index("ux_scan_docs_component_type", table_name="scan_documents")
    op.drop_index("ix_scan_docs_component", table_name="scan_documents")
    op.drop_column("scan_documents", "component_id")

    # Step 7b: worktree_leases — FK 从 project_components 改为 workspaces
    op.drop_constraint("worktree_leases_component_id_fkey", "worktree_leases", type_="foreignkey")
    op.create_foreign_key("worktree_leases_component_id_fkey", "worktree_leases", "workspaces", ["component_id"], ["id"], ondelete="CASCADE")

    # Step 8: 删 component_relations（先索引后表）
    op.drop_index("ix_relations_workspace", table_name="component_relations")
    op.drop_index("ux_relations_triplet", table_name="component_relations")
    op.drop_table("component_relations")

    # Step 9: 删 project_components
    op.drop_index("ix_components_workspace", table_name="project_components")
    op.drop_index("ux_components_workspace_key", table_name="project_components")
    op.drop_table("project_components")


def downgrade() -> None:
    # WARN: data loss — component metadata in workspaces will be dropped

    # Step 9 reverse: 重建 project_components（空表）
    # Step 8 reverse: 重建 component_relations（空表）
    # Step 7b reverse: worktree_leases FK 恢复为 -> project_components
    # Step 7a reverse: scan_documents 恢复 component_id 列 + FK + 索引
    # Step 6 reverse: 删 agent_run_workspaces
    # Step 5 reverse: 删 task_workspaces
    # Step 4 reverse: 删 change_workspaces
    # Step 3 reverse: 删 workspace_relations
    # Step 2 reverse: 恢复 sillyspec_path 列
    # Step 1 reverse: 删 9 个新增列
```

## 边界处理

### B1: 旧数据兼容 — workspaces 表加列时已有行的新字段

所有新增的 component 元数据字段均设为 `nullable=True` 或有 `server_default`：
- 已有 workspace 行自动获得 `NULL`（字符串字段）或 `'[]'::jsonb`（tech_stack）或 `'main'`（default_branch）
- 迁移中不回填数据。回填逻辑属于 task-04（解析器迁移）

### B2: `sillyspec_path` 列删除后已有代码引用

- `schema.py` 中 `WorkspaceRead.sillyspec_path` 和 `ScanResponse.sillyspec_path` 必须同步删除
- `scanner.py` 中 `ScanResult.sillyspec_path` 是运行时字段，不落库，**保留不变**
- `service.py` 中如果有引用 `workspace.sillyspec_path` 的代码，需改为从 `root_path` 推导（`root_path + "/.sillyspec"`）
- 本 task 只负责模型和迁移层，service/router 层适配在 task-04 中完成

### B3: 自环检查 — `source_id == target_id`

- 数据库层：迁移中加 `CHECK (source_id != target_id)` 约束，命名为 `ck_workspace_relations_no_self_loop`
- 应用层：模型定义中不加 CHECK（SQLModel/SQLite 兼容性），由 task-02 的 `RelationService.create()` 做应用层校验
- 即使数据库 CHECK 被绕过（如 SQLite 不强制），查询逻辑也不应崩溃

### B4: 循环依赖 — 允许 A -> B -> A

- UQ 约束只限制 `(source_id, target_id, relation_type)`，不阻止反向边
- `A -> B (depends_on)` 和 `B -> A (consumes_api_from)` 是合法的不同 relation_type
- `A -> B (depends_on)` 和 `B -> A (depends_on)` 也是合法的（双向依赖）
- 不做 DAG 校验，design.md ADR-03 明确允许

### B5: M:N 关联表复合 PK 冲突

- `change_workspaces` 等表的 PK 是 `(change_id, workspace_id)` 复合主键
- 同一 change 重复关联同一 workspace 会被 PK 约束拒绝（SQL INSERT 报错）
- service 层（task-03）应捕获 `IntegrityError` 并转换为 409 Conflict
- `role` 字段更新需要先 DELETE 再 INSERT（复合 PK 表没有单独的 UPDATE 场景）

### B6: 空值 / 缺失字段处理

- `component_key` 为 `None` 时表示该 workspace 不是从组件解析而来（纯 workspace）
- `tech_stack` 为空列表 `[]` 而非 `None`（`default_factory=list`，`server_default='[]'::jsonb`）
- `default_branch` 为 `None` 时前端应显示 "main"（逻辑默认值）
- `source_yaml_path` 为 `None` 时表示非 YAML 解析来源
- 不修改传入参数：`WorkspaceCreate` DTO 是 immutable Pydantic model，service 层不对其进行原地修改

### B7: 删除 Workspace 时的级联

- `workspace_relations` 的 `source_id` 和 `target_id` 都有 `CASCADE` 删除
- 删除一个 workspace 会自动删除所有以它为 source 或 target 的 relation
- `change_workspaces` / `task_workspaces` / `agent_run_workspaces` 也有 CASCADE
- 但不会删除关联的 change/task/agent_run 本身（只删除关联行）

### B8: 迁移 downgrade 的数据丢失

- downgrade 时 `project_components` 和 `component_relations` 表会被重建但数据为空
- workspaces 表新增的 component 字段会被删除，已有数据丢失
- design.md 明确 "本项目未正式上线，不需要考虑版本迭代兼容问题"，因此这是可接受的
- 在 downgrade 函数开头标注注释：`# WARN: data loss — component metadata in workspaces will be dropped`

## 非目标

- **不修改 service.py / router.py**：业务逻辑适配在 task-02（WorkspaceRelation CRUD）、task-04（解析器迁移）中完成
- **不删除 component/ 模块目录**：在 task-06 中完成，本 task 只做模型层准备
- **不做数据回填**：已有 workspace 行的 component 元数据字段保持 NULL/默认值，回填在 task-04 中随解析器一起做
- **不修改 Change/Task/AgentRun 模型**：它们的 `workspace_id` FK 保留不变，M:N 关联表是补充而非替代
- **不修改前端**：前端适配在独立的前端任务中完成
- **不修改 parser.py**：parser 的输出类型（`ParsedWorkspace`）不变，迁移在 task-04 中做
- **不实现 topology API**：`GET /api/workspaces/topology` 在 task-02 中实现
- **不实现 relation CRUD API**：`POST/GET/DELETE` relation 端点在 task-02 中实现

## 参考

### 现有模型模式

- `backend/app/modules/workspace/model.py` — `Workspace` 基础结构、partial unique index 模式
- `backend/app/models/base.py` — `BaseModel` 基类（所有模型都继承它）
- `backend/app/modules/change/model.py` — `Change.workspace_id` FK 定义
- `backend/app/modules/task/model.py` — `Task.workspace_id` FK 定义
- `backend/app/modules/agent/model.py` — `AgentRun` 表结构

### 现有迁移模式

- `backend/migrations/versions/202605270900_create_components_and_relations.py` — 创建组件表的标准模式（列定义、FK、index、server_default）
- `backend/migrations/versions/202605260900_create_workspaces.py` — workspace 表初始结构（含 `sillyspec_path` 列）

### 字段来源映射

| Workspace 新字段 | ProjectComponent 原字段 | 类型映射 | 注意事项 |
|---|---|---|---|
| `component_key` | `component_key: str` (NOT NULL) | `str -> str \| None` | 改为 nullable 兼容旧 workspace |
| `type` | `type: str \| None` | 不变 | |
| `role` | `role: str \| None` | 不变 | |
| `repo_url` | `repo_url: str \| None` | `String -> String`(TEXT) | |
| `default_branch` | `default_branch: str \| None` | 不变 | 保持 server_default "main" |
| `tech_stack` | `tech_stack: list[str]` | 不变 | JSON 列 + default_factory=list |
| `build_command` | `build_command: str \| None` | 不变 | |
| `test_command` | `test_command: str \| None` | 不变 | |
| `source_yaml_path` | `source_yaml_path: str` (NOT NULL) | `str -> str \| None` | 改为 nullable 兼容旧 workspace |

## TDD 步骤

### Step 1: 测试 Workspace 模型字段存在性（AC-01, AC-02）

```python
def test_workspace_has_component_metadata_fields():
    from app.modules.workspace.model import Workspace
    field_names = set(Workspace.model_fields.keys())
    required = {
        "component_key", "type", "role", "repo_url", "default_branch",
        "tech_stack", "build_command", "test_command", "source_yaml_path",
    }
    assert required.issubset(field_names), f"Missing fields: {required - field_names}"

def test_workspace_no_sillyspec_path():
    from app.modules.workspace.model import Workspace
    field_names = set(Workspace.model_fields.keys())
    assert "sillyspec_path" not in field_names
```

### Step 2: 确认失败 -> 实现 model.py -> 确认通过

### Step 3: 测试 Workspace 字段默认值（AC-03）

```python
def test_workspace_component_fields_default_to_none_or_empty():
    from app.modules.workspace.model import Workspace
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

### Step 4: 测试 WorkspaceRelation 模型（AC-04）

```python
def test_workspace_relation_model_fields():
    from app.modules.workspace.model import WorkspaceRelation
    field_names = set(WorkspaceRelation.model_fields.keys())
    for name in ("source_id", "target_id", "relation_type", "description", "created_at"):
        assert name in field_names

def test_workspace_relation_table_constraints():
    from app.modules.workspace.model import WorkspaceRelation
    index_names = {idx.name for idx in WorkspaceRelation.__table_args__ if hasattr(idx, 'name')}
    assert "ux_workspace_relations_triplet" in index_names
    assert "ix_workspace_relations_source" in index_names
    assert "ix_workspace_relations_target" in index_names
```

### Step 5: 测试 M:N 模型复合 PK（AC-05/06/07）

```python
def test_change_workspace_composite_pk():
    from app.modules.workspace.model import ChangeWorkspace
    pk_cols = [c.name for c in ChangeWorkspace.__table__.primary_key.columns]
    assert set(pk_cols) == {"change_id", "workspace_id"}

def test_task_workspace_composite_pk():
    from app.modules.workspace.model import TaskWorkspace
    pk_cols = [c.name for c in TaskWorkspace.__table__.primary_key.columns]
    assert set(pk_cols) == {"task_id", "workspace_id"}

def test_agent_run_workspace_composite_pk():
    from app.modules.workspace.model import AgentRunWorkspace
    pk_cols = [c.name for c in AgentRunWorkspace.__table__.primary_key.columns]
    assert set(pk_cols) == {"agent_run_id", "workspace_id"}
```

### Step 6: 测试 Schema 变更（AC-08 ~ AC-12）

```python
def test_workspace_create_accepts_component_fields():
    from app.modules.workspace.schema import WorkspaceCreate
    dto = WorkspaceCreate(**{
        "name": "test-ws", "root_path": "/tmp/test",
        "component_key": "api-gateway", "type": "service",
        "role": "backend", "repo_url": "https://github.com/org/api",
        "default_branch": "develop", "tech_stack": ["python", "fastapi"],
        "build_command": "make build", "test_command": "make test",
        "source_yaml_path": ".sillyspec/projects/api.yaml",
    })
    assert dto.component_key == "api-gateway"
    assert dto.tech_stack == ["python", "fastapi"]

def test_workspace_create_component_fields_optional():
    from app.modules.workspace.schema import WorkspaceCreate
    dto = WorkspaceCreate(name="plain-ws", root_path="/tmp/plain")
    assert dto.component_key is None
    assert dto.tech_stack == []

def test_workspace_read_has_no_sillyspec_path():
    from app.modules.workspace.schema import WorkspaceRead
    assert "sillyspec_path" not in WorkspaceRead.model_fields

def test_workspace_read_has_component_metadata_fields():
    from app.modules.workspace.schema import WorkspaceRead
    field_names = set(WorkspaceRead.model_fields.keys())
    required = {
        "component_key", "type", "role", "repo_url", "default_branch",
        "tech_stack", "build_command", "test_command", "source_yaml_path",
    }
    assert required.issubset(field_names)

def test_workspace_relation_create_schema():
    import uuid
    from app.modules.workspace.schema import WorkspaceRelationCreate
    dto = WorkspaceRelationCreate(target_id=uuid.uuid4(), relation_type="depends_on")
    assert dto.relation_type == "depends_on"
    assert dto.description is None

def test_workspace_relation_read_schema():
    from app.modules.workspace.schema import WorkspaceRelationRead
    field_names = set(WorkspaceRelationRead.model_fields.keys())
    expected = {"id", "source_id", "target_id", "relation_type", "description", "created_at"}
    assert expected.issubset(field_names)

def test_scan_response_has_no_sillyspec_path():
    from app.modules.workspace.schema import ScanResponse
    assert "sillyspec_path" not in ScanResponse.model_fields
```

### Step 7: 测试迁移文件存在性

```python
def test_migration_file_exists():
    from pathlib import Path
    migration_dir = Path(__file__).resolve().parents[4] / "migrations" / "versions"
    files = list(migration_dir.glob("*workspace_graph*"))
    assert len(files) == 1
```

### Step 8: DB 级别约束测试（需 db_session fixture，AC-17, AC-18）

```python
@pytest.mark.asyncio
async def test_workspace_relation_unique_triplet(db_session):
    from app.modules.workspace.model import Workspace, WorkspaceRelation
    ws1 = Workspace(name="ws1", slug="ws1", root_path="/tmp/ws1")
    ws2 = Workspace(name="ws2", slug="ws2", root_path="/tmp/ws2")
    db_session.add_all([ws1, ws2])
    await db_session.flush()
    rel1 = WorkspaceRelation(source_id=ws1.id, target_id=ws2.id, relation_type="depends_on")
    db_session.add(rel1)
    await db_session.flush()
    rel2 = WorkspaceRelation(source_id=ws1.id, target_id=ws2.id, relation_type="depends_on")
    db_session.add(rel2)
    with pytest.raises(Exception):  # IntegrityError
        await db_session.flush()

@pytest.mark.asyncio
async def test_change_workspace_composite_pk_unique(db_session):
    from app.modules.workspace.model import Workspace, ChangeWorkspace
    from app.modules.change.model import Change
    ws = Workspace(name="cw-test", slug="cw-test", root_path="/tmp/cw")
    db_session.add(ws)
    await db_session.flush()
    ch = Change(workspace_id=ws.id, change_key="tc", location="change", path="/tmp/tc")
    db_session.add(ch)
    await db_session.flush()
    assoc1 = ChangeWorkspace(change_id=ch.id, workspace_id=ws.id)
    db_session.add(assoc1)
    await db_session.flush()
    assoc2 = ChangeWorkspace(change_id=ch.id, workspace_id=ws.id)
    db_session.add(assoc2)
    with pytest.raises(Exception):  # IntegrityError
        await db_session.flush()
```

### Step 9: 全量回归 — `pytest backend/` 无失败

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 检查 `Workspace.model_fields` 是否包含 9 个 component 元数据字段 | `component_key`, `type`, `role`, `repo_url`, `default_branch`, `tech_stack`, `build_command`, `test_command`, `source_yaml_path` 全部存在于 `model_fields` |
| AC-02 | 检查 `Workspace.model_fields` 是否不含 `sillyspec_path` | `"sillyspec_path" not in Workspace.model_fields` |
| AC-03 | 创建 `Workspace(name="t", slug="t", root_path="/t")` 实例，检查默认值 | `component_key=None`, `type=None`, `role=None`, `repo_url=None`, `default_branch="main"`, `tech_stack=[]`, `build_command=None`, `test_command=None`, `source_yaml_path=None` |
| AC-04 | 检查 `WorkspaceRelation` 模型字段和索引 | `source_id`, `target_id`, `relation_type`, `description`, `created_at` 存在；`ux_workspace_relations_triplet` UQ index 存在；`ix_workspace_relations_source` 和 `ix_workspace_relations_target` 索引存在 |
| AC-05 | 检查 `ChangeWorkspace` 复合主键列名 | `set(pk_col_names) == {"change_id", "workspace_id"}` |
| AC-06 | 检查 `TaskWorkspace` 复合主键列名 | `set(pk_col_names) == {"task_id", "workspace_id"}` |
| AC-07 | 检查 `AgentRunWorkspace` 复合主键列名 | `set(pk_col_names) == {"agent_run_id", "workspace_id"}` |
| AC-08 | 用含全部 component 字段的数据构造 `WorkspaceCreate` | 不报错，`dto.component_key == "api-gateway"`, `dto.tech_stack == ["python", "fastapi"]` |
| AC-09 | 用仅 `name`+`root_path` 构造 `WorkspaceCreate` | 不报错，`dto.component_key is None`, `dto.tech_stack == []` |
| AC-10 | 检查 `WorkspaceRead.model_fields` 是否不含 `sillyspec_path` | `"sillyspec_path" not in WorkspaceRead.model_fields` |
| AC-11 | 检查 `WorkspaceRead.model_fields` 是否包含 9 个 component 字段 | 全部 9 个字段名存在于 `model_fields` |
| AC-12 | 构造 `WorkspaceRelationCreate` 和 `WorkspaceRelationRead` 实例 | `WorkspaceRelationCreate(target_id=uuid4(), relation_type="depends_on")` 成功；`WorkspaceRelationRead` 包含 `id`, `source_id`, `target_id`, `relation_type`, `description`, `created_at` |
| AC-13 | 检查迁移文件内容 | 文件 `202606130900_workspace_graph.py` 存在；包含 `add_column` 9 次（workspaces 加列）、`drop_column` 1 次（sillyspec_path）、`create_table` 4 次（workspace_relations, change_workspaces, task_workspaces, agent_run_workspaces）、`drop_table` 2 次（component_relations, project_components） |
| AC-14 | 执行 `alembic upgrade head` | 无错误退出，数据库表结构包含所有新表和新列 |
| AC-15 | 执行 `alembic downgrade -1` 再 `alembic upgrade head` | 无错误退出，round-trip 成功 |
| AC-16 | 在 Postgres 中插入 `source_id == target_id` 的 relation | 抛出 `IntegrityError`（CHECK 约束生效） |
| AC-17 | 插入重复 `(source_id, target_id, relation_type)` 的 relation | 抛出 `IntegrityError`（UQ triplet 约束生效） |
| AC-18 | 插入重复 `(change_id, workspace_id)` 的 ChangeWorkspace | 抛出 `IntegrityError`（复合 PK 约束生效） |
| AC-19 | 运行 `pytest backend/app/modules/workspace/tests/` | 所有测试通过 |
| AC-20 | 运行 `pytest backend/` | 无回归失败（允许因 schema 变更导致的已知失败，需在 PR 中说明） |
