---
id: task-12
title: notifyRunResult/completeLease/notifySessionEnd 包 retryTerminal 轻量重试
priority: P1
wave: W2
depends_on: [task-08]
blocks: [task-14]
requirement_ids: [FR-05]
decision_ids: [D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/task-runner.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-12: 终态上报包 retryTerminal

> 来源：design.md §5 Phase2（终态轻量重试）/ §10 R-09；plan.md Wave2 task-12。D-005 范围 B。
> 本质：notifyRunResult/completeLease/notifySessionEnd 三个终态上报端点包 `retryTerminal` 轻量重试（不暂存补发）。终态可由 backend lease 超时 + daemon recover 兜底。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/daemon.ts` | onTurnResult→notifyRunResult / onSessionEnd→notifySessionEnd 包 retryTerminal |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | completeLease 包 retryTerminal |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-05 | 终态轻量重试 | 三端点包 retryTerminal |
| D-005@v1 | 范围 B（终态轻量重试） | 终态不暂存 |

## 实现要求

1. **定位三处调用**：
   - daemon.ts onTurnResult → `_client.notifyRunResult(...)`（搜 notifyRunResult）
   - daemon.ts onSessionEnd → `_client.notifySessionEnd(...)`（1344）
   - task-runner.ts completeLease → `_client.completeLease(...)`
2. **包 retryTerminal**：
   ```ts
   // 修改前
   await this._client.notifyRunResult(runId, status, result);
   // 修改后
   await this._resilience?.retryTerminal(() => this._client.notifyRunResult(runId, status, result))
     ?? this._client.notifyRunResult(runId, status, result); // 未注入回退
   ```
   - 未注入 _resilience → 回退直接调（行为同今）。
3. **不暂存**：retryTerminal 用尽抛（不调 outbox），catch 处 warn（现有 catch 保留，如 onSessionEnd 1345-1348）。
4. **保持现有 catch 语义**：终态上报失败仅 warn 不阻塞（onSessionEnd 边界），retryTerminal 抛被现有 catch 兜住。

## 接口定义

见实现要求伪码。retryTerminal(call)：isRetryable 才重试，4xx 直接抛，用尽抛，不暂存。

## 边界处理

1. **4xx fail-fast**：404（session 已不存在）/422 直接抛，现有 catch warn。
2. **不暂存**：终态补发语义复杂（backend 可能已判终态），不暂存，靠 backend lease 超时 + daemon recover 兜底（R-09）。
3. **未注入回退**：直接调 _client。
4. **catch 保留**：retryTerminal 抛被现有 catch（如 1345）兜住 warn。
5. **幂等性**：notifySessionEnd backend 幂等（已 ended→no-op，design §5 注释），重试安全。
6. **参数不可变**。

## 非目标

- 不暂存终态（D-005）。
- 不改终态业务逻辑。
- 不改 notifyRunResult/completeLease/notifySessionEnd 签名。
- 不改 onTurnMessage（task-10）。

## 参考

- daemon.ts onTurnResult / onSessionEnd（1331-1348）
- task-runner.ts completeLease
- hub-client.ts notifyRunResult/notifySessionEnd/completeLease
- task-08 retryTerminal
- design.md §5 Phase2 / §10 R-09 / D-005@v1

## TDD 步骤

1. 写测试：三端点注入 mock _resilience → 包 retryTerminal；可重试失败重试；4xx 抛被 catch；未注入回退。
2. 确认失败。
3. 实现。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 三端点包 retryTerminal | grep retryTerminal 命中 3 处 |
| AC-02 | 可重试失败重试 | mock TypeError → 调多次 |
| AC-03 | 4xx 抛 | mock 404 → 抛被 catch warn |
| AC-04 | 未注入回退 | null → 直接调 _client |
| AC-05 | 不暂存 | 用尽不调 outbox |
| AC-06 | 现有测试绿 | `pnpm test` 通过 |
