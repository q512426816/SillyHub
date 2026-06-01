---
id: task-02
title: AgentRun 关联 ToolPolicy FK（迁移）
priority: P0
estimated_hours: 1
depends_on: []
blocks: [task-07, task-08]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/
---

# task-02: AgentRun 关联 ToolPolicy FK（迁移）

## 修改文件（必填）

- `backend/app/modules/agent/model.py` — AgentRun 模型新增 `tool_policy_id` 字段
- `backend/migrations/versions/202606150900_add_agent_run_tool_policy_fk.py` — Alembic 迁移，新增列 + FK 约束

## 实现要求

1. 在 `AgentRun` 模型中新增 `tool_policy_id` 字段，类型 `uuid.UUID | None`，nullable=True
2. FK 指向 `tool_policies.id`，ondelete=`SET NULL`（policy 被删除时 agent_run 保留，FK 置 NULL）
3. 编写 Alembic 迁移，`down_revision` 指向 task-01 的迁移 revision（即 `202606140900_create_missing_tables` 的 revision `202606140900`，如果 task-01 尚未合入则改为 task-01 迁移的 revision；实际执行时 task-01 和 task-02 的迁移必须按顺序链接，**task-02 的 down_revision = task-01 迁移的 revision**）
4. 迁移中给 `tool_policy_id` 列创建索引 `ix_agent_runs_tool_policy`，加速按 policy 查询关联 run

## 接口定义（代码类任务必填）

### 1. AgentRun 模型字段（`backend/app/modules/agent/model.py`）

在 `diff_summary` 字段之后添加：

```python
tool_policy_id: uuid.UUID | None = Field(
    default=None,
    sa_column=Column(
        Uuid(as_uuid=True),
        ForeignKey("tool_policies.id", ondelete="SET NULL"),
        nullable=True,
    ),
)
```

同时在 `__table_args__` 中增加索引：

```python
__table_args__ = (
    Index("ix_agent_runs_task", "task_id"),
    Index("ix_agent_runs_lease", "lease_id"),
    Index("ix_agent_runs_tool_policy", "tool_policy_id"),
)
```

需要确保导入中已有 `ForeignKey`（当前已有）。

### 2. Alembic 迁移文件（`backend/migrations/versions/202606150900_add_agent_run_tool_policy_fk.py`）

```python
"""Add tool_policy_id FK to agent_runs

Revision ID: 202606150900
Revises: <task-01 迁移的 revision>
Create Date: 2026-06-15 09:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202606150900"
down_revision: str | None = "<task-01 迁移的 revision>"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agent_runs",
        sa.Column(
            "tool_policy_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("tool_policies.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_agent_runs_tool_policy",
        "agent_runs",
        ["tool_policy_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_runs_tool_policy", table_name="agent_runs")
    op.drop_column("agent_runs", "tool_policy_id")
```

**关于 down_revision 链**：task-01 创建 `tool_policies` 表，task-02 在 `agent_runs` 上添加 FK 指向 `tool_policies`。所以 task-02 的 `down_revision` **必须**是 task-01 迁移的 revision。如果 task-01 尚未提交迁移文件，则执行本任务时需要先确认 task-01 的 revision 编号并填入。

**降级策略**：如果 task-01 和 task-02 的迁移同时运行，先 down task-02（删 FK 列），再 down task-01（删 tool_policies 表）。

### 控制流伪代码

```
1. 修改 agent/model.py：
   - 在 AgentRun 类 diff_summary 字段后添加 tool_policy_id 字段
   - 在 __table_args__ 中添加 ix_agent_runs_tool_policy 索引

2. 创建迁移文件：
   - upgrade: add_column + create_index
   - downgrade: drop_index + drop_column
   - 确保 down_revision 链接正确
```

## 边界处理（必填）

1. **NULL 行为**：`tool_policy_id` 默认为 `None`（nullable），未关联 policy 的 agent_run 行为不变。运行时由 ToolPolicyService.default_policy() 提供默认策略对象。
2. **兼容旧行为（brownfield）**：现有 agent_run 记录的 `tool_policy_id` 为 NULL，所有已有查询和逻辑不受影响。新增字段是纯加法操作，无破坏性变更。
3. **FK 删除策略**：`ON DELETE SET NULL`，当 tool_policy 被删除时，关联的 agent_run 不会被级联删除，FK 置 NULL 回退到默认策略。不会抛异常。
4. **不修改传入参数**：模型字段定义使用 `default=None`，不修改任何已有字段。
5. **迁移幂等性**：Alembic 迁移是幂等的（每个 revision 只执行一次），downgrade 正确还原（先删索引再删列）。
6. **task-01 未完成的情况**：如果 task-01 的迁移文件尚未存在，本迁移的 `down_revision` 应临时指向当前最新 revision `202606140900`。task-01 完成后通过 rebase 链接。**推荐做法**：与 task-01 协同，确认 task-01 revision 后再定 down_revision。若 task-01 和 task-02 同时开发，可让 task-02 的 down_revision 直接指向 `202606140900`，后续 merge 时调整链条。

## 非目标（本任务不做的事）

- 不创建 `tool_policies` 表（属于 task-01）
- 不实现 ToolPolicyService 策略引擎逻辑（属于 task-03）
- 不修改 ToolOperationLog 模型
- 不修改任何 API 端点或 service 层代码
- 不实现"默认策略"运行时对象（属于 task-03）
- 不修改 agent_run 的创建/查询逻辑来使用 tool_policy_id（属于 task-07 集成）

## 参考

- **现有 FK 模式**：`AgentRun.task_id`（指向 `tasks.id`，`ondelete="CASCADE"`）和 `AgentRun.lease_id`（指向 `worktree_leases.id`，`ondelete="CASCADE"`），见 `backend/app/modules/agent/model.py` 第 27-41 行
- **迁移文件模式**：`202606110900_add_agent_run_audit_fields.py`（向 agent_runs 添加列的迁移范例）
- **FK 模式**：`ToolOperationLog.workspace_id`（`ondelete="CASCADE"`），`incident.resolved_by`（`ondelete="SET NULL"`，与本任务的 SET NULL 一致），见 `202606140900_create_missing_tables.py`
- **design.md 中的 DDL**：`ALTER TABLE agent_runs ADD COLUMN tool_policy_id UUID REFERENCES tool_policies(id) ON DELETE SET NULL;`

## TDD 步骤

1. **写测试**：在 `tests/modules/agent/test_model.py`（如不存在则创建）中编写测试：
   - 测试 `AgentRun` 实例化时 `tool_policy_id` 默认为 `None`
   - 测试 `AgentRun` 可以设置 `tool_policy_id` 为有效 UUID
   - 测试迁移 upgrade 创建了 `tool_policy_id` 列
   - 测试迁移 downgrade 正确删除列
2. **确认失败**：运行 `pytest tests/modules/agent/test_model.py -x`，确认字段不存在导致失败
3. **写代码**：修改 `agent/model.py`，创建迁移文件
4. **确认通过**：运行 `pytest tests/modules/agent/test_model.py -x`，确认全部通过
5. **回归**：运行 `pytest --tb=short -q` 确认无现有测试回归

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|----------|----------|
| AC-01 | 检查 `AgentRun` 模型是否有 `tool_policy_id` 字段 | 字段存在，类型 `uuid.UUID \| None`，nullable=True |
| AC-02 | 检查 FK 定义 | `ForeignKey("tool_policies.id", ondelete="SET NULL")` |
| AC-03 | 检查 `__table_args__` 中是否有索引 | 包含 `Index("ix_agent_runs_tool_policy", "tool_policy_id")` |
| AC-04 | 迁移文件存在且格式正确 | `202606150900_add_agent_run_tool_policy_fk.py` 存在，包含 upgrade/downgrade 函数 |
| AC-05 | `alembic upgrade head` 执行成功 | 无报错，`agent_runs` 表新增 `tool_policy_id` 列 |
| AC-06 | `alembic downgrade -1` 再 `alembic upgrade head` 成功 | 迁移可回滚且可重放，无残留 |
| AC-07 | 迁移 upgrade 创建了索引 | 数据库中存在 `ix_agent_runs_tool_policy` 索引 |
| AC-08 | 迁移 downgrade 删除索引和列 | downgrade 后索引和列均不存在 |
| AC-09 | `AgentRun()` 实例化默认 `tool_policy_id=None` | 不传参时字段值为 None |
| AC-10 | 全量测试无回归 | `pytest --tb=short -q` 全部通过，无新增失败 |
