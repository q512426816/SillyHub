---
author: qinyi
created_at: 2026-06-18 11:44:49
change: 2026-06-18-workspace-client-path
id: task-01
title: "workspaces 加 path_source + daemon_runtime_id（model/schema/migration）"
priority: P0
depends_on: []
blocks: [task-03, task-04, task-07, task-08, task-10]
requirement_ids: [FR-01]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/workspace/model.py
  - backend/app/modules/workspace/schema.py
  - backend/migrations/versions/202607030900_add_workspace_path_source.py
  - backend/tests/modules/workspace/test_model_path_source.py
  - backend/tests/modules/workspace/test_schema_path_source.py
  - backend/tests/modules/workspace/test_migration_path_source.py
---

# task-01 — workspaces 加 path_source + daemon_runtime_id

> Wave 1 / 基础层 / 无依赖。本任务是整个变更的数据模型基石，task-03/04/07/08/10 全部依赖本任务产出的字段。

## 1. 修改文件

| 操作 | 精确路径 | 改动概述 |
|---|---|---|
| 修改 | `backend/app/modules/workspace/model.py` | `Workspace` 模型加 `path_source`（String(20)，默认 `server-local`）与 `daemon_runtime_id`（Uuid?，FK→`daemon_runtimes.id`）两列；同时为 `daemon_runtime_id` 加普通索引 |
| 修改 | `backend/app/modules/workspace/schema.py` | `WorkspaceCreate` / `WorkspaceUpdate` / `WorkspaceRead` 加字段；新增 `PathSourceLiteral = Literal["server-local", "daemon-client"]`；新增 model_validator：`path_source='daemon-client'` 时 `daemon_runtime_id` 必填（422） |
| 新增 | `backend/migrations/versions/202607030900_add_workspace_path_source.py` | alembic 迁移：`workspaces` 加两列 + 索引；`down_revision = "202607020900"`（当前 head） |
| 新增 | `backend/tests/modules/workspace/test_model_path_source.py` | 模型字段默认值/类型测试 |
| 新增 | `backend/tests/modules/workspace/test_schema_path_source.py` | DTO 字段 + validator 测试（含 daemon-client 必填、枚举非法值、server-local 默认） |
| 新增 | `backend/tests/modules/workspace/test_migration_path_source.py` | 迁移 upgrade/downgrade 冒烟（SQLite in-memory 或 alembic utils） |

> `service.py`（create 跳过 `_ensure_spec_workspace`）、`placement.py`（强绑路由）、`router.py`（scan 派发）属于 task-03/04/08，**本任务不动**。本任务只交付「数据模型 + DTO + 迁移」三件套，且保证 server-local 全链路零行为变化。

## 2. 覆盖来源

- **FR-01**（workspace 路径来源字段）：覆盖 FR-01 的全部三段 Given/When/Then（迁移加列、daemon-client 必填校验、server-local 默认兼容）。
- **D-004@v1**（新增 path_source 字段 + daemon_runtime_id 绑定）：`normalized_requirement` 要求「workspaces 加 path_source(default server-local) + daemon_runtime_id(FK)；daemon-client 时 daemon_runtime_id 必填」——本任务 1:1 实现，字段名、类型、默认值、FK 目标均与决策一致。
- design.md §5 Phase 1 / §6（model.py & schema.py & migration 行）/ §7.3 数据结构 / §8 数据模型 / §9 兼容策略。

## 3. 实现要求（编号步骤）

> 按「文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收」执行。下述步骤必须在指定顺序完成。

1. **读现有代码**：精读 `backend/app/modules/workspace/model.py`（关注 `root_path` / `default_agent` 的 `sa_column` 写法）、`schema.py`（关注 `WorkspaceCreate._sanitize_root_path` 与 `_validate_slug` 的 field_validator 模式、`WorkspaceRead` 的 `from_attributes`）、`backend/migrations/versions/202606280900_add_workspace_default_agent.py`（add_column 迁移模板）、`202606270900_create_daemon_tables.py`（`daemon_runtimes.id` 的真实列定义，确认 FK 目标合法）。

2. **写测试（先于实现，TDD）**：见 §8 TDD 步骤。三份测试文件先建好并预期失败（字段尚未存在）。

3. **改 model.py（实现）**：
   - 在 `Workspace` 类内，紧邻 `root_path` 字段之后，新增两个字段（完整字段定义见 §4）。
   - 在 `__table_args__` 中追加一个普通索引：`Index("ix_workspaces_daemon_runtime_id", "daemon_runtime_id")`（用于 task-03 路由查询性能；FK 不自动建索引，需显式声明）。
   - **不要**给 `daemon_runtime_id` 加 `ondelete` 行为——daemon 删除时如何处理 workspace 属于 R-06（本次非目标，FK 保持默认 RESTRICT 即可，DB 层拒绝删除即可满足「阻止」语义）。

4. **改 schema.py（实现）**：
   - 文件顶部新增 `PathSourceLiteral = Literal["server-local", "daemon-client"]`（与 `WorkspaceStatusLiteral` 并列）。
   - `WorkspaceCreate`：加 `path_source: PathSourceLiteral = "server-local"` 与 `daemon_runtime_id: uuid.UUID | None = None`；新增 `model_validator(mode="after")`（伪代码见 §4）校验 daemon-client 必填。
   - `WorkspaceUpdate`：加 `path_source: PathSourceLiteral | None = None` 与 `daemon_runtime_id: uuid.UUID | None = None`；同样加 model_validator。注意：**path_source 切换是 design §3 非目标**，但 DTO 层不做「禁止切换」校验——切换拦截留给 task 之外的 service 层或后续 task（本任务 DTO 只保证「daemon-client 必有 daemon_runtime_id」这一不变式）。若 service 层未拦截，validator 仅保证「最终态合法」，不阻止从 daemon-client 改回 server-local（此时 service 应自行把 daemon_runtime_id 置 None，属 task-08 范畴）。
   - `WorkspaceRead`：加 `path_source: PathSourceLiteral` 与 `daemon_runtime_id: uuid.UUID | None`（`from_attributes=True` 自动映射）。
   - import 补充：`from pydantic import model_validator`（注意现有只 import 了 `field_validator`）。

5. **写迁移**：新建 `backend/migrations/versions/202607030900_add_workspace_path_source.py`（完整模板见 §4）。关键参数：
   - `revision = "202607030900"`（日期递增，紧接当前 head `202607020900`）。
   - `down_revision = "202607020900"`（**必须**，当前唯一 head；已用 alembic heads 逻辑验证）。
   - `path_source`：`sa.Column("path_source", sa.String(length=20), nullable=False, server_default="server-local")`。
   - `daemon_runtime_id`：`sa.Column("daemon_runtime_id", sa.Uuid(as_uuid=True), sa.ForeignKey("daemon_runtimes.id"), nullable=True)`（FK 用默认 ondelete=RESTRICT，不显式声明）。
   - 追加索引：`op.create_index("ix_workspaces_daemon_runtime_id", "workspaces", ["daemon_runtime_id"])`。
   - `downgrade()` 反向：drop index → drop 2 columns。
   - 迁移文件头 docstring 写清本次变更目的 + 引用 change id。

6. **跑迁移 + 测试**（见 §8 第 4-5 步）。

7. **（不要做）**：不改 service.py / router.py / placement.py / 前端任何文件。这些归 task-03/04/07/08/10。本任务完成后 server-local workspace 创建链路与现状字节级一致。

## 4. 接口定义

### 4.1 model.py 字段（精确写法）

```python
# backend/app/modules/workspace/model.py —— Workspace 类内，紧跟 root_path 之后
root_path: str = Field(sa_column=Column(String, nullable=False))

# 新增 ↓
path_source: str = Field(
    default="server-local",
    sa_column=Column(String(20), nullable=False, server_default="server-local"),
)
daemon_runtime_id: uuid.UUID | None = Field(
    default=None,
    sa_column=Column(
        Uuid(as_uuid=True),
        ForeignKey("daemon_runtimes.id"),
        nullable=True,
    ),
)
# 现有 status 字段 ...
```

`__table_args__` 内追加（与现有 Index 并列）：
```python
Index("ix_workspaces_daemon_runtime_id", "daemon_runtime_id"),
```

> 注：`server_default="server-local"` 让迁移加列时已有行自动填充，避免 alembic 在 NOT NULL 加列时报错（SQLite/Postgres 均依赖此）。

### 4.2 schema.py 字段 + validator

```python
# 文件顶部，与 WorkspaceStatusLiteral 并列
PathSourceLiteral = Literal["server-local", "daemon-client"]

# import 补充
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class WorkspaceCreate(BaseModel):
    # ...现有字段不变...
    path_source: PathSourceLiteral = "server-local"
    daemon_runtime_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _validate_daemon_binding(self) -> "WorkspaceCreate":
        if self.path_source == "daemon-client" and self.daemon_runtime_id is None:
            raise ValueError(
                "daemon_runtime_id is required when path_source='daemon-client'"
            )
        return self


class WorkspaceUpdate(BaseModel):
    # ...现有字段不变...
    path_source: PathSourceLiteral | None = None
    daemon_runtime_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _validate_daemon_binding(self) -> "WorkspaceUpdate":
        # path_source 未提供时（None=omit），不做校验，交给 service exclude_unset 语义
        if self.path_source is None:
            return self
        if self.path_source == "daemon-client" and self.daemon_runtime_id is None:
            raise ValueError(
                "daemon_runtime_id is required when path_source='daemon-client'"
            )
        return self


class WorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    # ...现有字段不变...
    path_source: PathSourceLiteral
    daemon_runtime_id: uuid.UUID | None
```

> validator 抛 `ValueError` → Pydantic 返 **422**（FR-01 第二段写「400」，但项目其它 validator 如 `_validate_slug` 同样走 Pydantic 默认 422；统一用 422，与现有约定一致。requirements.md 写的 400 是表述泛指，以项目实际约定 422 为准——已在 §7 边界 E-04 注明）。

### 4.3 迁移 op（完整文件骨架）

```python
"""add path_source and daemon_runtime_id to workspaces

Revision ID: 202607030900
Revises: 202607020900

Adds two columns to ``workspaces``:
- ``path_source`` VARCHAR(20) NOT NULL DEFAULT 'server-local'
  (枚举: server-local | daemon-client)，区分 workspace 的 root_path 是
  backend 进程本地可达路径，还是 daemon 客户端机器上的路径。
- ``daemon_runtime_id`` UUID NULL, FK → daemon_runtimes.id
  当 path_source='daemon-client' 时，强绑定的 daemon runtime（D-001@v1 /
  D-004@v1）。server-local workspace 该列为 NULL。

覆盖 change 2026-06-18-workspace-client-path 的 FR-01 / D-004@v1。
server-local workspace 行为零变化（兼容，design §9）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607030900"
down_revision = "202607020900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspaces",
        sa.Column(
            "path_source",
            sa.String(length=20),
            nullable=False,
            server_default="server-local",
        ),
    )
    op.add_column(
        "workspaces",
        sa.Column(
            "daemon_runtime_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("daemon_runtimes.id"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_workspaces_daemon_runtime_id",
        "workspaces",
        ["daemon_runtime_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_workspaces_daemon_runtime_id", table_name="workspaces")
    op.drop_column("workspaces", "daemon_runtime_id")
    op.drop_column("workspaces", "path_source")
```

## 5. 边界处理（≥5 条）

| 编号 | 边界 | 处理 |
|---|---|---|
| E-01 | **NULL daemon_runtime_id + server-local** | 合法。`daemon_runtime_id` 列 `nullable=True`；现有数据迁移后 `path_source='server-local'` 且 `daemon_runtime_id=NULL`，与现状完全一致。 |
| E-02 | **兼容旧数据（brownfield）** | 迁移用 `server_default="server-local"` 让 NOT NULL 加列自动回填，Postgres/SQLite 均不需先加 NULL 列再 UPDATE；现有 workspace 行为零变化（design §9）。 |
| E-03 | **path_source 默认值** | DB 层 `server_default="server-local"`；model 层 `default="server-local"`；schema 层 `WorkspaceCreate.path_source: PathSourceLiteral = "server-local"`。三层默认对齐，前端不传时落库为 server-local。 |
| E-04 | **daemon-client 必填 daemon_runtime_id** | DTO `model_validator(mode="after")`：`path_source='daemon-client'` 且 `daemon_runtime_id is None` → 抛 `ValueError` → Pydantic 返 **422**（与项目现有 validator 约定一致；requirements.md 写 400 是泛指，实际 422）。 |
| E-05 | **枚举非法值** | schema 用 `Literal["server-local", "daemon-client"]`，Pydantic 对非法字符串（如 `"local"`、`"Daemon"` 大小写错、`""`）返 422；model 层 DB String(20) 无约束（靠应用层保证），故「数据正确性」责任在 schema 层，model 不重复校验。 |
| E-06 | **WorkspaceUpdate 部分更新** | `path_source` 为 `None`（未提供）时跳过 validator，遵循 service `exclude_unset=True` 语义；仅当显式传 `path_source='daemon-client'` 才触发必填校验。 |
| E-07 | **daemon_runtime_id 指向不存在的 runtime** | 本任务**不**在 validator 层查 DB 存在性（DTO 应无 DB 依赖）；FK 约束在 DB 层兜底（插入时违反 FK 抛 IntegrityError → service 层转 400/409）。运行时存在性/在线性校验属 task-03（dispatch 时校验）。 |
| E-08 | **path_source 切换（daemon-client ↔ server-local）** | design §3 明确「不支持切换」为非目标，本任务 DTO 不拦截切换本身，只保证「最终态合法」（daemon-client 必有 runtime_id）。切换的业务拦截留给后续 task/service 层。 |

## 6. 非目标（本任务不做）

- ❌ 不改 `service.py`（`create` / `_ensure_spec_workspace` 跳过逻辑属 task-03/08）。
- ❌ 不改 `router.py`（scan 派发属 task-08）。
- ❌ 不改 `placement.py`（强绑路由属 task-03）。
- ❌ 不改 `agent/router.py`（execution-context spec_root 属 task-07）。
- ❌ 不改任何前端文件（task-10/11）。
- ❌ 不改 daemon 任何文件（task-02/05/09）。
- ❌ 不做 path_source 切换的 service 层拦截（非目标）。
- ❌ 不做 daemon_runtime_id 指向 runtime 在线性的校验（task-03 dispatch 时做）。
- ❌ 不做「daemon 被删除时级联处理 workspace」（R-06，本次非目标，FK 默认 RESTRICT 即「阻止删除」的兜底）。

## 7. 参考

- design.md §5 Phase 1、§6（第 1/2 行 + migration 行）、§7.3、§8、§9
- requirements.md FR-01（三段 GWT 全覆盖）
- decisions.md D-004@v1（字段定义 1:1 对应）
- plan.md Wave 1 task-01 行
- 现有代码：
  - `backend/app/modules/workspace/model.py:22-127`（Workspace 模型，`root_path` / `default_agent` 为字段写法模板）
  - `backend/app/modules/workspace/schema.py:78-119`（WorkspaceCreate + field_validator 模式）
  - `backend/migrations/versions/202606280900_add_workspace_default_agent.py`（add_column 迁移模板）
  - `backend/migrations/versions/202606270900_create_daemon_tables.py:18-51`（`daemon_runtimes` 表定义，确认 FK 目标 `daemon_runtimes.id` 存在且类型为 `sa.Uuid(as_uuid=True)`）

## 8. TDD 步骤

1. **写 `test_schema_path_source.py`**（先写，预期失败）：
   - `test_create_defaults_to_server_local`：`WorkspaceCreate(name=..., root_path=...)` → `path_source=='server-local'`、`daemon_runtime_id is None`。
   - `test_create_daemon_client_requires_runtime_id`：`WorkspaceCreate(name=..., root_path=..., path_source='daemon-client')` → `pytest.raises(ValidationError)`。
   - `test_create_daemon_client_with_runtime_ok`：带 `daemon_runtime_id=uuid4()` → 通过。
   - `test_create_invalid_path_source`：`path_source='local'` → ValidationError。
   - `test_update_daemon_client_requires_runtime_id`：`WorkspaceUpdate(path_source='daemon-client')` → ValidationError。
   - `test_update_none_path_source_skips_validation`：`WorkspaceUpdate(name='x')` → 通过（不触发校验）。
   - `test_read_includes_fields`：构造 Workspace 实例（或 mock）→ `WorkspaceRead.model_validate` 含两字段。

2. **写 `test_model_path_source.py`**：
   - `test_model_defaults`：`Workspace(name=..., slug=..., root_path=...)` → `path_source=='server-local'`、`daemon_runtime_id is None`。
   - `test_model_accepts_daemon_client`：显式传 `path_source='daemon-client', daemon_runtime_id=uuid4()` → 落字段。
   - `test_column_types`：反射检查 `Workspace.__table__.c.path_source.type` 是 `String(20)`、`daemon_runtime_id.type` 是 `Uuid`、`daemon_runtime_id.foreign_keys` 含 `daemon_runtimes.id`。

3. **写 `test_migration_path_source.py`**（冒烟）：
   - 用 alembic `op` 在 SQLite in-memory 上跑 `upgrade()` → 断言 `workspaces` 表有 `path_source`（NOT NULL, default 'server-local'）和 `daemon_runtime_id`（NULL, FK）列 + 索引存在。
   - `downgrade()` → 两列 + 索引消失。
   - （若项目无迁移冒烟测试基建，至少保证 `uv run alembic upgrade head` 在本地 dev DB 成功，作为人工验收项。）

4. **实现**：按 §3 步骤 3-5 改 model / schema / 写迁移文件。

5. **跑测试**：
   - `cd backend && uv run pytest tests/modules/workspace/test_schema_path_source.py tests/modules/workspace/test_model_path_source.py tests/modules/workspace/test_migration_path_source.py -v` —— 全绿。
   - `cd backend && uv run pytest tests/modules/workspace/` —— 现有 workspace 测试不回归（关键：server-local 创建流程零变化）。
   - `cd backend && uv run ruff check app/modules/workspace/ migrations/versions/202607030900_add_workspace_path_source.py` —— 无 lint 错。
   - `cd backend && uv run alembic upgrade head` —— 迁移成功（dev DB）。
   - `cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head` —— downgrade/upgrade 往返成功。

## 9. 验收标准

| AC | 验收点 | 验证方式 | 通过条件 |
|---|---|---|---|
| AC-01 | model.py 新增两字段类型正确 | `test_column_types` 反射断言 | `path_source` 是 `String(20)` NOT NULL；`daemon_runtime_id` 是 `Uuid` nullable，FK 指向 `daemon_runtimes.id` |
| AC-02 | model 默认值正确 | `test_model_defaults` | 不传时 `path_source=='server-local'`、`daemon_runtime_id is None` |
| AC-03 | WorkspaceCreate daemon-client 必填 | `test_create_daemon_client_requires_runtime_id` | 抛 ValidationError（422 路径） |
| AC-04 | WorkspaceCreate daemon-client 带值通过 | `test_create_daemon_client_with_runtime_ok` | 无异常，`daemon_runtime_id` 落字段 |
| AC-05 | WorkspaceCreate 非法枚举值拒绝 | `test_create_invalid_path_source` | ValidationError |
| AC-06 | WorkspaceCreate 默认 server-local | `test_create_defaults_to_server_local` | 不传 path_source → `'server-local'` + `daemon_runtime_id is None` |
| AC-07 | WorkspaceUpdate daemon-client 必填 | `test_update_daemon_client_requires_runtime_id` | ValidationError |
| AC-08 | WorkspaceUpdate path_source=None 不触发校验 | `test_update_none_path_source_skips_validation` | 通过（兼容 exclude_unset 语义） |
| AC-09 | WorkspaceRead 含两字段 | `test_read_includes_fields` | `model_validate` 后 `path_source` 与 `daemon_runtime_id` 字段存在且类型正确 |
| AC-10 | 迁移 upgrade 加列 + 索引 | `test_migration_path_source.py` upgrade 段 / 人工 `alembic upgrade head` | `workspaces` 表含两列；`ix_workspaces_daemon_runtime_id` 索引存在；现有行 `path_source` 自动为 `server-local` |
| AC-11 | 迁移 downgrade 可逆 | `test_migration_path_source.py` downgrade 段 / 人工 `alembic downgrade -1` | 两列 + 索引均消失，无残留 |
| AC-12 | server-local 兼容回归 | `cd backend && uv run pytest tests/modules/workspace/` | 现有 workspace 测试全部通过（零行为变化） |
| AC-13 | lint 通过 | `uv run ruff check .` | 无新增 lint 错 |
| AC-14 | FR-01 三段 GWT 全覆盖 | 人工对照 requirements.md FR-01 | 加列（AC-10）、daemon-client 必填（AC-03）、server-local 默认兼容（AC-06 + AC-12）三段均有对应 AC |
| AC-15 | D-004@v1 normalized_requirement 落地 | 人工对照 decisions.md D-004@v1 | `path_source(default server-local) + daemon_runtime_id(FK daemon_runtimes.id)` 字段、类型、默认、FK 目标与决策文字 1:1 一致；`daemon-client 时 daemon_runtime_id 必填` 由 AC-03 保证 |

## 10. 完成定义（DoD）

- §1 全部文件改动落地（含 3 份测试文件）。
- §9 AC-01 ~ AC-15 全部通过。
- `uv run alembic upgrade head` 在干净 dev DB 上成功。
- git diff 仅触及 `allowed_paths` 内文件（frontmatter 声明），未越界改 service/router/placement/前端/daemon。
- 本任务报告回执包含：迁移 revision 号、新增测试用例数、跑通的 pytest 命令输出尾部。
