---
id: task-01
title: ToolPolicy 数据模型 + Alembic 迁移
priority: P0
estimated_hours: 2
depends_on: []
blocks: [task-03, task-04]
allowed_paths:
  - backend/app/modules/tool_gateway/tool_policy.py
  - backend/migrations/versions/
---

# task-01: ToolPolicy 数据模型 + Alembic 迁移

## 修改文件（必填）

| 操作 | 文件路径 |
|------|----------|
| 新增 | `backend/app/modules/tool_gateway/tool_policy.py` |
| 新增 | `backend/migrations/versions/202605301000_add_tool_policies.py` |

## 实现要求

### 1. 新建 `backend/app/modules/tool_gateway/tool_policy.py`

定义 `ToolPolicy` SQLModel 模型，对应 `tool_policies` 表。

**参考现有模式**：`backend/app/modules/tool_gateway/model.py`（ToolOperationLog）和 `backend/app/modules/task/model.py`（JSON 列写法）。

**表结构**（来自 design.md 数据模型）：

```
tool_policies
├── id              UUID PK
├── workspace_id    UUID FK→workspaces(id) ON DELETE CASCADE, NOT NULL
├── name            VARCHAR(50), NOT NULL
├── allowed_tools   JSON, NOT NULL, DEFAULT 全部 7 种工具
├── blocked_commands JSON, DEFAULT []
├── allowed_paths   JSON, DEFAULT ["."]
├── allowed_domains JSON, DEFAULT []
├── max_timeout     INTEGER, NOT NULL, DEFAULT 30
├── max_output_size INTEGER, NOT NULL, DEFAULT 64000
├── created_at      TIMESTAMP WITH TIME ZONE, NOT NULL
├── updated_at      TIMESTAMP WITH TIME ZONE, NOT NULL
└── UNIQUE(workspace_id, name)
```

### 2. 新建 Alembic 迁移文件

文件名格式遵循项目约定：`YYYYMMDDHHMM_description.py`。最新迁移为 `202606140900`，使用 `202605301000` 作为 revision ID（时间戳早于现有迁移以保持线性历史，或使用当前日期之后的时间戳如 `202606150900`）。

**关键**：`down_revision` 应设为当前最新迁移 `"202606140900"`。

## 接口定义（代码类任务必填）

### ToolPolicy 模型

```python
# backend/app/modules/tool_gateway/tool_policy.py

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer, String, Uuid
from sqlmodel import Field

from app.models.base import BaseModel

# 默认允许的全部 7 种工具
ALL_TOOLS: list[str] = [
    "file_read", "file_write", "file_list", "file_search",
    "shell_exec", "run_tests", "http_get",
]

class ToolPolicy(BaseModel, table=True):
    """Workspace-level tool execution policy.
    
    Controls which tools an agent can use and their constraints.
    """
    __tablename__ = "tool_policies"
    __table_args__ = (
        Index("ux_tool_policy_workspace_name", "workspace_id", "name", unique=True),
        Index("ix_tool_policy_workspace", "workspace_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    name: str = Field(
        max_length=50,
        sa_column=Column(String(50), nullable=False),
    )
    allowed_tools: list[str] = Field(
        default_factory=lambda: list(ALL_TOOLS),
        sa_column=Column(JSON, nullable=False, default=lambda: list(ALL_TOOLS)),
    )
    blocked_commands: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    allowed_paths: list[str] = Field(
        default_factory=lambda: ["."],
        sa_column=Column(JSON, nullable=False, default=lambda: ["."]),
    )
    allowed_domains: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    max_timeout: int = Field(
        default=30,
        sa_column=Column(Integer, nullable=False, default=30),
    )
    max_output_size: int = Field(
        default=64000,
        sa_column=Column(Integer, nullable=False, default=64000),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            default=lambda: datetime.now(timezone.utc),
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            default=lambda: datetime.now(timezone.utc),
            onupdate=lambda: datetime.now(timezone.utc),
        ),
    )
```

### Alembic 迁移文件

```python
# backend/migrations/versions/202606150900_add_tool_policies.py

"""Create tool_policies table.

Revision ID: 202606150900
Revises: 202606140900
Create Date: 2026-06-15 09:00:00.000000
"""
from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202606150900"
down_revision: str | None = "202606140900"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tool_policies",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column(
            "allowed_tools",
            sa.JSON,
            nullable=False,
            server_default='["file_read","file_write","file_list","file_search","shell_exec","run_tests","http_get"]',
        ),
        sa.Column(
            "blocked_commands",
            sa.JSON,
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "allowed_paths",
            sa.JSON,
            nullable=False,
            server_default='["."]',
        ),
        sa.Column(
            "allowed_domains",
            sa.JSON,
            nullable=False,
            server_default="[]",
        ),
        sa.Column("max_timeout", sa.Integer, nullable=False, server_default="30"),
        sa.Column("max_output_size", sa.Integer, nullable=False, server_default="64000"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ux_tool_policy_workspace_name",
        "tool_policies",
        ["workspace_id", "name"],
        unique=True,
    )
    op.create_index(
        "ix_tool_policy_workspace",
        "tool_policies",
        ["workspace_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_tool_policy_workspace", table_name="tool_policies")
    op.drop_index("ux_tool_policy_workspace_name", table_name="tool_policies")
    op.drop_table("tool_policies")
```

### default_policy 工厂函数

在同一个 `tool_policy.py` 文件中提供一个创建默认策略运行时对象的工厂函数（不写 DB）：

```python
def default_policy() -> ToolPolicy:
    """Create a non-persisted ToolPolicy with permissive defaults.
    
    Used when an AgentRun has no tool_policy_id set.
    The returned object is NOT added to any session.
    """
    return ToolPolicy(
        id=uuid.uuid4(),
        workspace_id=uuid.UUID("00000000-0000-0000-0000-000000000000"),  # placeholder
        name="__default__",
        allowed_tools=list(ALL_TOOLS),
        blocked_commands=[],
        allowed_paths=["."],
        allowed_domains=[],
        max_timeout=30,
        max_output_size=64000,
    )
```

## 边界处理（必填）

1. **workspace_id 必须非空**：ToolPolicy 必须关联一个 workspace，不允许 `workspace_id=NULL`。创建时缺少 workspace_id 应由 API 层返回 422，模型层由 `nullable=False` 约束。

2. **name 长度限制 50 字符**：超过 50 字符的 name 由 `String(50)` 约束，写入时数据库报错。模型不做截断，直接由 DB 约束拒绝。

3. **workspace + name 唯一约束**：同一 workspace 下不允许两个同名 policy（`ux_tool_policy_workspace_name` unique index）。违反时抛出 `IntegrityError`，由调用方捕获转为 409 响应。

4. **JSON 列默认值安全**：`allowed_tools`、`blocked_commands`、`allowed_paths`、`allowed_domains` 使用 `default_factory` 而非可变默认值，避免 Python 可变默认参数陷阱。每行数据独立拥有自己的列表实例。

5. **max_timeout / max_output_size 边界**：模型层仅定义列类型和默认值。校验逻辑（如 `max_timeout > 0`、`max_output_size > 0`）由 task-03 的 ToolPolicyService 负责，本任务不做业务校验。但字段不允许为 NULL。

6. **default_policy() 的 workspace_id**：使用全零 UUID 占位，调用方（task-03）应在实际使用时替换为真实 workspace_id，或者仅读取 allowed_tools/blocked_commands 等策略字段而不依赖 workspace_id。

7. **datetime 时区一致性**：`created_at` 和 `updated_at` 使用 `timezone.utc` 而非 `datetime.utcnow()`（后者在 Python 3.12+ 已弃用），确保时区明确。

## 非目标（本任务不做的事）

- **不修改** `backend/app/modules/agent/model.py`（AgentRun FK 关联由 task-02 负责）
- **不实现** ToolPolicyService 校验逻辑（由 task-03 负责）
- **不实现** Policy CRUD API（由 task-04 负责）
- **不修改** `backend/conftest.py` 的 model import 列表（由后续 task 按需添加，或 task-02 一并处理）
- **不修改** `backend/app/modules/tool_gateway/model.py` 中 ToolOperationLog.tool_type 列宽（由 task-08 负责）
- **不实现** `__init__.py` 的模型注册（本次文件是独立的 `tool_policy.py`，不改动现有 `__init__.py`）

## 参考

- **模型写法**：`backend/app/modules/tool_gateway/model.py` — ToolOperationLog 模型（同模块，同目录）
- **JSON 列写法**：`backend/app/modules/task/model.py` — `affected_components`, `allowed_paths` 等 JSON 列
- **迁移写法**：`backend/migrations/versions/202606140900_create_missing_tables.py` — 最新迁移文件，`op.create_table` + `op.create_index` + downgrade 的标准格式
- **BaseModel**：`backend/app/models/base.py` — 继承 SQLModel 的 BaseModel
- **design.md 数据模型章节**：`tool_policies` 表 SQL DDL

## TDD 步骤

### 测试文件：`backend/tests/modules/tool_gateway/test_tool_policy.py`

1. **写测试**（先写以下测试用例，确认全部失败）：

   - `test_create_tool_policy_with_defaults` — 创建 ToolPolicy 并 commit，验证 `allowed_tools` 默认包含全部 7 种工具
   - `test_create_tool_policy_custom_values` — 指定自定义 allowed_tools / blocked_commands / allowed_paths / allowed_domains，验证持久化
   - `test_unique_name_per_workspace` — 同一 workspace 创建同名 policy，验证抛出 `IntegrityError`
   - `test_different_workspace_same_name` — 不同 workspace 允许同名 policy
   - `test_default_policy_factory` — 调用 `default_policy()`，验证返回对象 allowed_tools 包含全部工具，且 `id` 非空
   - `test_max_timeout_default` — 验证默认 max_timeout=30, max_output_size=64000

2. **确认失败** — `pytest tests/modules/tool_gateway/test_tool_policy.py` 全红（因为 `tool_policy.py` 还不存在）

3. **写代码** — 按上述接口定义创建 `tool_policy.py` 和迁移文件

4. **确认通过** — `pytest tests/modules/tool_gateway/test_tool_policy.py` 全绿

5. **回归** — `pytest` 全套无回归（当前 648+ tests passed）

### 测试 conftest 补充

由于 `backend/tests/modules/tool_gateway/` 目录不存在，需要创建。测试文件中应包含一个 fixture 用于创建测试所需的 workspace 记录（因为 ToolPolicy 有 FK 指向 workspaces 表）。

测试 fixture 模式参考：

```python
# backend/tests/modules/tool_gateway/conftest.py
import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

@pytest.fixture()
async def test_workspace_id(db_session: AsyncSession) -> uuid.UUID:
    """Insert a minimal workspace row and return its id."""
    from app.modules.workspace.model import Workspace
    
    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="test-ws",
        slug="test-ws",
        path="/tmp/test-ws",
        owner_id=uuid.uuid4(),
    )
    db_session.add(ws)
    await db_session.commit()
    return ws_id
```

注意：如果 SQLite 测试环境不支持 JSON 列类型（SQLite 无原生 JSON），SQLAlchemy 会自动 fallback 为 TEXT 存储，但 JSON 默认值 `server_default` 中使用 JSON 字符串可能有问题。在 SQLite 测试中，`server_default` 中的 JSON 字符串可能不被正确解析。此时测试应通过 Python 侧的 `default_factory` 提供默认值而非依赖 `server_default`。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | 文件 `backend/app/modules/tool_gateway/tool_policy.py` 存在且包含 `ToolPolicy` 类继承 `BaseModel, table=True` | 类定义正确，`__tablename__ = "tool_policies"`，包含所有 11 个字段 |
| AC-02 | 文件 `backend/migrations/versions/202606150900_add_tool_policies.py` 存在 | `revision="202606150900"`，`down_revision="202606140900"`，upgrade() 创建表 + 2 个索引，downgrade() 反向操作 |
| AC-03 | `ToolPolicy` 模型有 `ux_tool_policy_workspace_name` unique index | `(workspace_id, name)` 唯一约束存在 |
| AC-04 | `ToolPolicy` 模型有 `ix_tool_policy_workspace` index | `workspace_id` 索引存在 |
| AC-05 | `ALL_TOOLS` 列表包含全部 7 种工具 | `["file_read", "file_write", "file_list", "file_search", "shell_exec", "run_tests", "http_get"]` |
| AC-06 | `default_policy()` 函数存在且返回非持久化对象 | 返回的 ToolPolicy 实例 `id` 非空，`allowed_tools` 包含全部 7 种工具，`name="__default__"` |
| AC-07 | JSON 列使用 `default_factory` 而非可变默认值 | `allowed_tools`、`blocked_commands`、`allowed_paths`、`allowed_domains` 均使用 `default_factory=lambda: ...` |
| AC-08 | `created_at` / `updated_at` 使用 `timezone.utc` | 不使用 `datetime.utcnow()`（已弃用） |
| AC-09 | 迁移文件 `upgrade()` 的 `server_default` 与 design.md DDL 一致 | `allowed_tools` 默认 7 种工具 JSON，`blocked_commands` 默认 `[]`，`allowed_paths` 默认 `["."]`，`max_timeout` 默认 30，`max_output_size` 默认 64000 |
| AC-10 | 迁移文件 `downgrade()` 正确反向操作 | 先 drop index，再 drop table |
| AC-11 | 测试文件 `backend/tests/modules/tool_gateway/test_tool_policy.py` 存在且包含 ≥6 个测试 | 所有测试通过 |
| AC-12 | 全量回归无失败 | `pytest` 全套通过，无新增失败/错误 |
