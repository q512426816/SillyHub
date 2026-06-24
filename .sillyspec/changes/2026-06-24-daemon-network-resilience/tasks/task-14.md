---
id: task-14
title: W2 测试——error-classify / submitWithRetry / retryTerminal / batch 路径
priority: P0
wave: W2
depends_on: [task-07, task-08, task-09, task-10, task-11, task-12, task-13]
blocks: []
requirement_ids: [FR-04, FR-05, FR-10]
decision_ids: [D-005@v1]
allowed_paths:
  - sillyhub-daemon/tests/w2-resilience.test.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-14: W2 测试

> 来源：design.md §5 Phase2；plan.md Wave2 task-14。汇总 W2 集成测试。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/tests/w2-resilience.test.ts` | W2 集成测试 |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-04 | submitWithRetry 重试退避错误分类 | 场景测试 |
| FR-05 | retryTerminal 轻量重试 | 场景测试 |
| FR-10 | batch 路径走 submitWithRetry | 场景测试 |

## 实现要求

1. **测试用例**：
   - error-classify 分类（task-07 已单测，本处集成复核）。
   - submitWithRetry：成功 1 次 / 可重试失败重试 3 次入 outbox（mock outbox）/ 4xx fail-fast / 退避递增（fake timers）。
   - retryTerminal：成功 / 重试 / 4xx 抛 / 不暂存（不调 outbox）。
   - onTurnMessage（interactive）：注入 resilience → 调 submitWithRetry + dedup_key；未注入回退。
   - batch task-runner：注入 resilience → 非阻塞调 submitWithRetry + dedup_key；未注入回退。
   - 终态三端点：包 retryTerminal。
2. **mock**：mock HubClient（submitMessages/notifyRunResult/completeLease/notifySessionEnd）、mock Outbox、fake timers、spy logger。

## 接口定义

vitest describe 组织用例。

## 边界处理

1. **非阻塞断言**：batch 调用立即返回（不 await）。
2. **fake timers**：退避 1/2/4s。
3. **outbox mock**：enqueue/markDelivered spy。
4. **未注入回退**：resilience=null 路径。
5. **dedup_key**：断言非空。
6. **回归**：不破坏 W1 测试与现有测试。

## 非目标

- 不测 W3（outbox 落盘/drain/幂等，task-23）。
- 不连真实 backend。

## 参考

- task-07~13 蓝图
- design.md §5 Phase2

## TDD 步骤

1. 写用例。
2. 确认失败（task-07~13 未全完成时）。
3. 各 task 完成后本测试转绿。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 测试文件存在 | w2-resilience.test.ts 非空 |
| AC-02 | 全绿 | `pnpm test w2-resilience` 通过 |
| AC-03 | 覆盖 FR-04/05/10 | 含 submitWithRetry/retryTerminal/batch 场景 |
| AC-04 | 全套绿 | `pnpm test` 通过 |
| AC-05 | typecheck | `pnpm typecheck` 通过 |
