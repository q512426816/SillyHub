---
id: task-21
title: backend submit_messages 用 INSERT ON CONFLICT DO NOTHING（部分索引）+ 统一 segment 去重
priority: P0
wave: W3
depends_on: [task-19, task-20]
blocks: [task-22, task-23]
requirement_ids: [FR-08]
decision_ids: [D-001@v2, D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-21: backend submit_messages ON CONFLICT 去重

> 来源：design.md §5 Phase3 backend / §7 去重伪码 / §10 R-08；plan.md Wave3 task-21。D-001@v2 + D-002@v1。
> 本质：run_sync/service.py submit_messages 写 AgentRunLog 改用 PG `INSERT ... ON CONFLICT (run_id, dedup_key) DO NOTHING`（部分索引 index_where），统一现有 thinking segment 去重。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/daemon/run_sync/service.py` | submit_messages 写入改 ON CONFLICT；segment 去重统一到 dedup_key |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-08 | 重复 (run_id,dedup_key) 仅落库一行 | ON CONFLICT DO NOTHING |
| D-001@v2 | dedup_key 根治 | ON CONFLICT |
| D-002@v1 | 跨调用非幂等→根治 | ON CONFLICT 跨调用去重 |

## 实现要求

1. **读 submit_messages（run_sync/service.py:48-...）**：现有循环逐条 `session.add(AgentRunLog(...))`。改为收集 rows（含 run_id, dedup_key, channel, content, timestamp），用 `pg_insert(AgentRunLog).values(rows).on_conflict_do_nothing(index_elements=["run_id","dedup_key"], index_where=text("dedup_key IS NOT NULL"))`。
2. **dedup_key 来源**：`msg.get('dedup_key')`（daemon task-19 透传）。无 dedup_key → None（不受约束，照常 append）。
3. **统一 segment 去重**：现有 thinking segment 去重（completed_segments set / flushed_partials，98-150）可保留调用内逻辑，或简化为：thinking 行的 dedup_key 用 segmentId，ON CONFLICT 跨调用去重。**保守做法**：保留现有调用内 segment 去重（不破坏现有测试），新增 dedup_key 跨调用去重层（ON CONFLICT）。两者叠加，segmentId 既作调用内去重又作 dedup_key。
4. **usage/session_id 提取**：现有逻辑（73-80/152-...）保留，不受 ON CONFLICT 影响（usage 是更新 AgentRun，不是 AgentRunLog）。
5. **count 返回**：ON CONFLICT 后实际插入数（用 `result.rowcount` 或手动算）。
6. **PG vs SQLite**：测试若 SQLite，`on_conflict_do_nothing` + 部分索引 unique 在 SQLite 可能不支持——读 conftest 确认测试 DB。若 SQLite，需 fallback：先 SELECT 去重或 try/except IntegrityError。**优先确认测试用 PG**。

## 接口定义

```python
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy import text

rows = [
    {"run_id": run_id, "dedup_key": msg.get("dedup_key"), "channel": channel,
     "content_redacted": content, "timestamp": now}
    for msg in flat_messages  # 跳过 override 信号等
]
stmt = pg_insert(AgentRunLog).values(rows)
stmt = stmt.on_conflict_do_nothing(
    index_elements=["run_id", "dedup_key"],
    index_where=text("dedup_key IS NOT NULL"),
)
result = await self._session.execute(stmt)
count = result.rowcount  # 实际插入数
```

## 边界处理

1. **dedup_key None**：不受约束，照常 append（兼容旧路径）。
2. **重复 (run_id, dedup_key)**：ON CONFLICT DO NOTHING，仅落库一行。
3. **segment 去重叠加**：保留调用内 segment 去重 + 新增 dedup_key 跨调用去重（不冲突）。
4. **PG/SQLite 兼容**：确认测试 DB；SQLite 需 fallback。
5. **count 准确**：返回实际插入数（ON CONFLICT 跳过的不计）。
6. **usage 提取不变**：ON CONFLICT 只影响 AgentRunLog 写入，AgentRun usage 更新独立。
7. **参数不可变**。
8. **publish 日志**：published_logs 仅含实际插入的（ON CONFLICT 跳过的不 publish，避免 SSE 重复）。

## 非目标

- 不改 AgentRun usage 逻辑。
- 不改 SSE publish 结构（仅过滤跳过项）。
- 不改 router。
- 不实现 daemon 侧（task-16/19）。

## 参考

- run_sync/service.py:48-210（submit_messages）
- sqlalchemy.dialects.postgresql.insert on_conflict_do_nothing
- task-19 protocol / task-20 model+migration
- design.md §5 Phase3 / §7 / §10 R-08 / D-001@v2 / D-002@v1

## TDD 步骤

1. 写测试：重复 (run_id, dedup_key) → 仅一行；无 dedup_key → 多行照常；segment 去重叠加生效；count 准确；SSE 不重复 publish。
2. 确认失败。
3. 实现 ON CONFLICT。
4. `cd backend && uv run pytest` 通过（含 test_wave5_integration / test_run_sync_cache_parse）。
5. 回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | ON CONFLICT 去重 | 重复 (run_id,dedup_key) → 1 行 |
| AC-02 | NULL 兼容 | 无 dedup_key → 多行 |
| AC-03 | segment 去重不破坏 | 现有 thinking 测试绿 |
| AC-04 | count 准确 | 返回实际插入数 |
| AC-05 | SSE 不重复 | published_logs 仅实际插入 |
| AC-06 | 测试全绿 | `cd backend && uv run pytest` 通过 |
| AC-07 | lint | ruff + mypy |
