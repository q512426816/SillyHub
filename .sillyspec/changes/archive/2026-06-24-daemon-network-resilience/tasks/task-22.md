---
id: task-22
title: backend submit_messages 测试更新（dedup_key 去重 / NULL 兼容 / segment 统一）
priority: P0
wave: W3
depends_on: [task-21]
blocks: [task-23]
requirement_ids: [FR-08]
decision_ids: [D-001@v2, D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/tests/test_wave5_integration.py
  - backend/app/modules/daemon/tests/test_run_sync_cache_parse.py
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-22: backend submit_messages 测试更新

> 来源：design.md §5 Phase3 / §10 R-08；plan.md Wave3 task-22。
> 本质：更新现有 submit_messages 测试（test_wave5_integration / test_run_sync_cache_parse）补 dedup_key 去重用例，确认 segment 去重与 ON CONFLICT 叠加不冲突。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/daemon/tests/test_wave5_integration.py` | 补 dedup_key 去重/NULL 兼容用例 |
| 修改 | `backend/app/modules/daemon/tests/test_run_sync_cache_parse.py` | 确认 cache token 解析不受影响 + 补 dedup_key |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-08 | 去重测试覆盖 | 新用例 |

## 实现要求

1. **新增用例**：
   - 重复 submit 同一 (run_id, dedup_key) → AgentRunLog 仅一行（ON CONFLICT）。
   - 无 dedup_key 的 message → 多行照常（NULL 兼容）。
   - segment 去重 + dedup_key 叠加：thinking segmentId 作 dedup_key，重复 submit 跳过。
   - count 返回实际插入数。
2. **现有用例回归**：test_wave5_integration 现有 submit_messages 用例（254-1260）多数不带 dedup_key（None），应照常通过（NULL 不约束）。若现有用例因 ON CONFLICT 改动失败，定位是 count 断言还是 publish 断言，修正断言（非逻辑绕过）。
3. **test_run_sync_cache_parse**：cache token 解析（usage）不受 ON CONFLICT 影响，确认绿；补 dedup_key 透传用例。
4. **遵循 TDD**：测试逻辑调整只改断言对齐新行为，不为通过而改测试逻辑（CLAUDE.md 规则7）。

## 接口定义

无新接口。测试用 svc.submit_messages(lease_id, token, run_id, messages) 带/不带 dedup_key。

## 边界处理

1. **现有用例无 dedup_key**：NULL 路径照常，不断言变化。
2. **count 断言**：ON CONFLICT 后 count 可能小于 messages 数（去重），修正断言。
3. **publish 断言**：published_logs 仅实际插入。
4. **PG/SQLite**：确认测试 DB 支持部分索引 ON CONFLICT。
5. **不绕过逻辑**：失败时定位根因而非改测试通过。

## 非目标

- 不改 submit_messages 实现（task-21）。
- 不改其他测试。

## 参考

- test_wave5_integration.py:251-1260（submit_messages 用例集）
- test_run_sync_cache_parse.py
- task-21 实现
- design.md §5 / §10 R-08

## TDD 步骤

1. 写新用例（重复去重/NULL/segment 叠加）。
2. task-21 实现后跑 → 新用例绿，现有用例可能需修正 count/publish 断言。
3. 修正断言对齐新行为（非逻辑绕过）。
4. `cd backend && uv run pytest` 全绿。
5. 回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 重复去重用例 | 同 (run_id,dedup_key) → 1 行 |
| AC-02 | NULL 兼容用例 | 无 dedup_key → 多行 |
| AC-03 | segment 叠加 | thinking dedup_key 去重 |
| AC-04 | count 断言对齐 | 反映实际插入数 |
| AC-05 | 现有用例绿 | test_wave5/test_run_sync_cache_parse 全绿 |
| AC-06 | 全套绿 | `cd backend && uv run pytest` 通过 |
