---
id: task-17
title: submitWithRetry 用尽入 outbox + 成功 markDelivered
priority: P0
wave: W3
depends_on: [task-08, task-15, task-16]
blocks: [task-23]
requirement_ids: [FR-06]
decision_ids: [D-001@v2]
allowed_paths:
  - sillyhub-daemon/src/resilience/service.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-17: submitWithRetry 接通 outbox

> 来源：design.md §5 Phase3；plan.md Wave3 task-17。依赖 task-08（ResilienceService）+ task-15（Outbox）+ task-16（dedupKeyFor）。
> 本质：把 task-08 ResilienceService 的占位 outbox 逻辑接通真实 Outbox——用尽 enqueue，成功 markDelivered。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/resilience/service.ts` | submitWithRetry 用尽→outbox.enqueue；成功→markDelivered（接通 task-15） |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-06 | 用尽入 outbox + markDelivered | enqueue/markDelivered 接通 |

## 实现要求

1. **task-08 已有占位**：submitWithRetry 用尽 `if (this._outbox) enqueue else warn`。本 task 确认接通真实 Outbox（task-15 注入）。
2. **成功 markDelivered**：submit 成功后 `await this._outbox.markDelivered(runId, envelopes.map(e=>e.dedup_key))`（移除该 run 待补发的同 dedup_key entry，避免补发重复）。
3. **envelopes 带 dedup_key**：调用方（task-10/11）用 dedupKeyFor（task-16）生成。
4. **用尽 enqueue**：`outbox.enqueue({ leaseId, claimToken, runId, envelopes, ts })`。

## 接口定义

task-08 伪码已含，本 task 确认 outbox 非 null 时调真实方法。

## 边界处理

1. **outbox null**（未注入）：用尽 warn 丢（W2 行为保留，cli 注入后非 null）。
2. **markDelivered 无匹配**：no-op。
3. **enqueue 容量超限**：Outbox 内部丢最旧（task-15）。
4. **参数不可变**。
5. **不重复补发**：成功后 markDelivered 移除待补发，drain（task-18）不再补该条。

## 非目标

- 不实现 drain（task-18）。
- 不实现 outbox（task-15）。
- 不实现 dedupKeyFor（task-16）。

## 参考

- task-08 submitWithRetry / task-15 Outbox / task-16 dedupKeyFor
- design.md §5 Phase3

## TDD 步骤

1. 写测试：注入真实 Outbox（mock fs）→ 用尽 enqueue 被调；成功 markDelivered 被调；outbox null 用尽 warn。
2. 确认失败/接通。
3. 实现。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 用尽 enqueue | outbox 注入 → enqueue 被调 |
| AC-02 | 成功 markDelivered | submit 成功 → markDelivered 被调 |
| AC-03 | outbox null 用尽 warn | 未注入 → warn 不崩 |
| AC-04 | 测试全绿 | `pnpm test` 通过 |
