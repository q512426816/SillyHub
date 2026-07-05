---
id: task-20
title: backend AgentRunLog 加 dedup_key 列 + migration（部分唯一索引）
priority: P0
wave: W3
depends_on: []
blocks: [task-21, task-22, task-23]
requirement_ids: [FR-08]
decision_ids: [D-001@v2]
decision_ids_extra: [R-12]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/2026xxxx_add_agent_run_log_dedup_key.py
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-20: backend AgentRunLog 加 dedup_key + migration

> 来源：design.md §5 Phase3 backend / §8 数据模型 / §10 R-12；plan.md Wave3 task-20。D-001@v2。
> 本质：AgentRunLog 加 `dedup_key` 列 + 部分唯一索引 `(run_id, dedup_key) WHERE dedup_key IS NOT NULL`。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/agent/model.py` | AgentRunLog（285）加 dedup_key 列 |
| 新增 | `backend/migrations/versions/2026xxxx_add_agent_run_log_dedup_key.py` | 加列 + 部分唯一索引 |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-08 | dedup_key 列 + 唯一索引 | model + migration |
| R-12 | 部分索引 conflict target | index_where |

## 实现要求

1. **model.py AgentRunLog（285-312）加列**：
   ```python
   dedup_key: str | None = Field(
       default=None,
       sa_column=Column(String(200), nullable=True),
   )
   ```
   - 列宽 String(200) 容纳 msg.id（task-16 不截断）。
2. **__table_args__ 加部分唯一索引**：
   ```python
   __table_args__ = (
       Index("ix_agent_run_logs_run", "run_id"),
       # 部分唯一索引：dedup_key 非空时 (run_id, dedup_key) 唯一
       Index(
           "ix_agent_run_logs_run_dedup",
           "run_id", "dedup_key",
           unique=True,
           postgresql_where=text("dedup_key IS NOT NULL"),
       ),
   )
   ```
3. **migration**：alembic 加列 + 建部分唯一索引。本项目可清空数据（CLAUDE.md 规则7），但采用向后兼容部分索引。
   ```python
   op.add_column("agent_run_logs", sa.Column("dedup_key", sa.String(200), nullable=True))
   op.create_index(
       "ix_agent_run_logs_run_dedup", "agent_run_logs", ["run_id", "dedup_key"],
       unique=True, postgresql_where=sa.text("dedup_key IS NOT NULL"),
   )
   ```
4. **文件命名**：`2026xxxx` 用实际日期 revision id（参考现有 migrations/versions/202606280900_*.py 格式）。

## 接口定义

见实现要求。列 + 索引 DDL。

## 边界处理

1. **NULL 不约束**：部分索引 `WHERE dedup_key IS NOT NULL`，无 dedup_key 的行（旧 daemon/batch 未改）照常 append（兼容）。
2. **String(200)**：容纳 msg.id；超长理论上不会（UUID/短串）。
3. **migration 幂等**：alembic revision 一次性。
4. **本项目可清空**：若 migration 冲突，可清表重建（CLAUDE.md 规则7）。
5. **部分索引 PG 特性**：postgresql_where，SQLite 不支持部分索引 unique（测试若用 SQLite 需注意——backend 测试用 PG 还是 SQLite？读 conftest 确认，若 SQLite 需条件跳过 unique 或用应用层去重兜底）。
6. **参数不可变**。

## 非目标

- 不实现 submit_messages ON CONFLICT 去重（task-21）。
- 不改其他表。
- 不做数据回填（旧数据 dedup_key NULL）。

## 参考

- backend/app/modules/agent/model.py:285-312（AgentRunLog）
- backend/migrations/versions/ 现有 migration 格式
- design.md §8 数据模型 / §10 R-12
- D-001@v2

## TDD 步骤

1. 写测试：model 加列后 AgentRunLog.dedup_key 可读写；migration upgrade head 成功；部分唯一索引存在（查 pg_indexes）。
2. 确认失败。
3. 实现 model + migration。
4. `cd backend && uv run alembic upgrade head` 成功 + `uv run pytest` 通过。
5. 回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | model 加 dedup_key 列 | AgentRunLog.dedup_key 存在 |
| AC-02 | migration 成功 | alembic upgrade head 通过 |
| AC-03 | 部分唯一索引 | ix_agent_run_logs_run_dedup unique + WHERE dedup_key IS NOT NULL |
| AC-04 | NULL 不约束 | 无 dedup_key 行可多条 |
| AC-05 | 测试全绿 | `cd backend && uv run pytest` 通过 |
| AC-06 | lint 通过 | ruff + mypy |
