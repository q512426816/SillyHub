---
id: task-23
title: W3 测试——outbox 落盘/恢复/drain/token 422/容量 + backend 幂等集成
priority: P0
wave: W3
depends_on: [task-15, task-16, task-17, task-18, task-19, task-20, task-21, task-22]
blocks: []
requirement_ids: [FR-06, FR-07, FR-08, FR-09]
decision_ids: [D-001@v2, D-004@v1]
allowed_paths:
  - sillyhub-daemon/tests/w3-resilience.test.ts
  - backend/app/modules/daemon/tests/test_outbox_dedup_integration.py
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-23: W3 测试

> 来源：design.md §5 Phase3；plan.md Wave3 task-23。汇总 W3 daemon outbox + backend 幂等集成测试。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/tests/w3-resilience.test.ts` | daemon outbox/drain/422/容量/恢复 |
| 新增 | `backend/app/modules/daemon/tests/test_outbox_dedup_integration.py` | backend 幂等集成 |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-06 | outbox 落盘 | daemon 测试 |
| FR-07 | drain + 422 + 终态 | daemon 测试 |
| FR-08 | 幂等一行 | backend 集成 |
| FR-09 | 重启恢复 | daemon 测试 |

## 实现要求

1. **daemon w3-resilience.test.ts**：
   - outbox 落盘：submit 用尽 → 文件有 entry。
   - 重启恢复：load 后 pendingByRun 返回。
   - drain：onConnected/heartbeat healthy → 补发 + markDelivered。
   - drain 422：claim_token 失效 → 丢弃该条。
   - drain 终态：session ended / lease 过期 → 丢弃该 run。
   - 容量上限：超限丢最旧。
   - dedup_key：生成稳定（task-16）。
2. **backend test_outbox_dedup_integration.py**：
   - 重复 (run_id, dedup_key) → AgentRunLog 1 行。
   - daemon 模拟补发（重复 submit）→ 幂等。
   - 无 dedup_key → 多行。
   - 与 segment 去重叠加。

## 接口定义

vitest（daemon）+ pytest（backend）。

## 边界处理

1. **daemon 测试 mock fs**：outbox 落盘用 tmpdir 或 mock fs。
2. **backend 测试 DB**：确认 PG（部分索引 ON CONFLICT）。
3. **drain 防重入**：并发 drain 断言。
4. **422 模拟**：mock client 抛 HubHttpError 422。
5. **终态模拟**：mock sessionManager/lease 校验返回 ended/过期。
6. **回归**：不破坏 W1/W2 与现有测试。

## 非目标

- 不连真实远程 backend。
- 不测 W1/W2（已有）。

## 参考

- task-15~22 蓝图
- design.md §5 Phase3

## TDD 步骤

1. 写用例。
2. 各 task 完成后转绿。
3. `cd sillyhub-daemon && pnpm test` + `cd backend && uv run pytest` 通过。
4. 回归全套。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | daemon w3 测试存在 | w3-resilience.test.ts 非空 |
| AC-02 | backend 集成存在 | test_outbox_dedup_integration.py 非空 |
| AC-03 | outbox 落盘/恢复 | 用例绿 |
| AC-04 | drain + 422 + 终态 | 用例绿 |
| AC-05 | 幂等一行 | 重复 (run_id,dedup_key) → 1 行 |
| AC-06 | 全套绿 | daemon pnpm test + backend pytest 通过 |
| AC-07 | typecheck/lint | daemon typecheck + backend ruff/mypy |
