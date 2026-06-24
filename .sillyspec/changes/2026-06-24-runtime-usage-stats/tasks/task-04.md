---
id: task-04
title: agent_runs 加 cache_read_tokens/cache_creation_tokens 迁移(nullable int)
priority: P1
estimated_hours: 1
depends_on: []
blocks: [task-05, task-06, task-07, task-08]
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - backend/migrations/versions/202606280900_add_agent_cache_token_fields.py
author: qinyi
created_at: 2026-06-24 10:55:18
---
# task-04: agent_runs 加 cache_read_tokens/cache_creation_tokens 迁移(nullable int)

## 修改文件（必填）

- 新增 `backend/migrations/versions/202606280900_add_agent_cache_token_fields.py`

> 注意:执行时必须先 `cd backend && uv run alembic heads` 取实际 head,若 head 已变化(如其他变更先行 merge),用实时值替换 `down_revision`,不能写死。当前 alembic head = `202607240900`(`202607240900_add_user_username.py`)。

## 覆盖来源

- Requirements: FR-02(cache 词元数据采集到 DB,聚合接口消费)
- design.md §8 数据模型、§9 兼容策略
- plan.md Wave 2 task-04

## 实现要求

1. 新建 alembic 迁移文件,文件名形如 `<时间戳>_add_agent_cache_token_fields.py`,revision id 用文件名前缀(如 `202606280900`)。
2. `down_revision` = 执行时实时 `alembic heads` 返回值(当前 `202607240900`)。
3. `upgrade()` 给 `agent_runs` 表加两列:
   - `cache_read_tokens` `sa.Column(sa.Integer, nullable=True)`
   - `cache_creation_tokens` `sa.Column(sa.Integer, nullable=True)`
4. `downgrade()` 按相反顺序 `op.drop_column` 两列,迁移可回退。
5. 完全对齐 `202606250900_add_agent_token_fields.py`(input_tokens/output_tokens) 的写法:`from __future__ import annotations`、`revision`/`down_revision`/`branch_labels = None`/`depends_on = None`、纯 `op.add_column` 无 backfill。
6. 数据可清空(CLAUDE.md 规则 8),直接 add column,不做数据迁移/回填。老数据两列为 NULL。

## 接口定义（代码类必填）

```python
# backend/migrations/versions/202606280900_add_agent_cache_token_fields.py
"""add agent cache token count fields

Revision ID: 202606280900
Revises: 202607240900   # 执行时取实时 alembic heads
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606280900"
down_revision = "202607240900"   # 实时值
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_runs",
        sa.Column("cache_read_tokens", sa.Integer, nullable=True),
    )
    op.add_column(
        "agent_runs",
        sa.Column("cache_creation_tokens", sa.Integer, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_runs", "cache_creation_tokens")
    op.drop_column("agent_runs", "cache_read_tokens")
```

SQL 等价:
```sql
ALTER TABLE agent_runs ADD COLUMN cache_read_tokens INTEGER NULL;
ALTER TABLE agent_runs ADD COLUMN cache_creation_tokens INTEGER NULL;
```

## 边界处理（必填,至少5条）

1. **老数据 NULL 行为**:新列 nullable=True,`upgrade` 后历史 `agent_runs` 行 cache 列为 NULL。聚合 SQL 必须 `SUM(COALESCE(r.cache_read_tokens, 0))` 兜底,不能依赖非空(task-08 处理)。本任务只保证列存在 + nullable。
2. **brownfield 兼容(老 daemon 不传 cache)**:不强制 daemon 上报 cache。迁移只加列,不约束 NOT NULL;老版本 daemon 提交的 run 该两列保持 NULL,不影响 submit_messages / close_interactive_run / _apply_run_metadata 既有逻辑(task-06/07 处理"取不到则不写")。
3. **异常不静默**:`alembic upgrade head` 若列已存在(重复执行)会抛 `DuplicateColumn`,直接报错让调用方看到,不吞异常。
4. **不改入参**:不修改任何已有列定义(input_tokens/output_tokens/total_cost_usd 等),不动 `ix_agent_runs_*` 索引。
5. **迁移可回退**:`downgrade()` 完整实现,`alembic downgrade -1` 能干净 drop 两列,不留残留。
6. **down_revision 实时取值**:不能写死本次文档里的 `202607240900`,执行前必须 `alembic heads` 确认。若期间有其他变更 merge(merge head 节点),按 alembic 多 head 规则填 down_revision。
7. **跨平台**:迁移是标准 SQL DDL,PG 通用,无 windows/macos 差异(CLAUDE.md 规则 12)。

## 非目标

- 不写 model 层(`AgentRun` 字段,task-05 负责)。
- 不写 service 层(`_METADATA_FIELDS`,task-06 负责)。
- 不写 run_sync 解析(task-07 负责)。
- 不做 backfill(数据可清空,CLAUDE.md 规则 8)。
- 不给 cache 列加索引(本次只聚合 SUM,无按 cache 过滞性能需求,R-04 关注 created_at 过滤)。
- 不改 ndjson/cache 字段语义(本任务纯 DB DDL)。

## 参考

- `backend/migrations/versions/202606250900_add_agent_token_fields.py`(input/output_tokens 模式,1:1 复制格式)
- `backend/migrations/versions/202606240900_add_agent_usage_fields.py`(total_cost_usd 等批次加列范例)
- design.md §8 数据模型(DDL 等价 SQL)
- design.md §9 兼容策略(nullable + SUM 忽略 NULL)

## TDD 步骤

1. 迁移 DDL 类任务,无单测,以 `alembic upgrade head` / `alembic downgrade -1` 两条命令作为验证手段。
2. 执行前记录 `alembic heads`(确认 down_revision 基线)。
3. 跑 `uv run alembic upgrade head` 看是否成功(应从 202607240900 升到 202606280900)。
4. 连 PG 确认 `\d agent_runs` 有 cache_read_tokens / cache_creation_tokens 两列且 nullable。
5. 跑 `uv run alembic downgrade -1` 确认能干净回退(两列消失,head 回到 202607240900)。
6. 再 `uv run alembic upgrade head` 恢复终态。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `cd backend && uv run alembic heads`(执行前) | 返回单个 head,作为 down_revision 基线(当前 202607240900) |
| 2 | `cd backend && uv run alembic upgrade head` | 退出码 0,输出 `Running upgrade 202607240900 -> 202606280900`,无报错 |
| 3 | 连 PG 跑 `\d agent_runs` | 表中有 `cache_read_tokens`、`cache_creation_tokens` 两列,均 `integer / nullable` |
| 4 | `cd backend && uv run alembic downgrade -1` | 退出码 0,两列被 drop,head 回到 202607240900 |
| 5 | 再次 `cd backend && uv run alembic upgrade head` | 恢复到 202606280900,迁移可重复应用 |
| 6 | 检查迁移文件语法 `uv run python -c "import importlib.util; spec=importlib.util.spec_from_file_location('m','backend/migrations/versions/202606280900_add_agent_cache_token_fields.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); assert m.down_revision=='202607240900'"` | down_revision 与实时 head 一致(执行时取实时值) |
