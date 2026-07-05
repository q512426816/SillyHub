---
id: task-13
title: cli.ts 注入 ResilienceService（构造时传入 client/outbox/config/logger）
priority: P0
wave: W2
depends_on: [task-08, task-15]
blocks: [task-14]
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/cli.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-13: cli 注入 ResilienceService

> 来源：design.md §5 Phase2（cli 注入）/ §9 兼容；plan.md Wave2 task-13。依赖 task-08（ResilienceService）+ task-15（Outbox，W3）。
> 本质：cli.ts 构造 Daemon 时，构造 Outbox + ResilienceService 并注入 Daemon（供 task-10/11/12 用）。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/cli.ts` | startAction 构造 Outbox + ResilienceService 注入 Daemon |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-04 | ResilienceService 可用 | cli 构造注入 |

## 实现要求

1. **依赖说明**：本 task 在 W2，但 Outbox（task-15）在 W3。处理：W2 阶段 ResilienceService 构造时 outbox 传 `null`（task-08 已支持 outbox 可选，用尽 warn 丢）；W3 task-15 落地后 cli 改传真实 Outbox。execute 时 W2 先注 outbox=null 占位，W3 补真实。
2. **构造**：
   ```ts
   const outbox = new Outbox(outboxDir, { maxPerRun, maxTotal }, logger);  // W3 task-15；W2 暂 null
   const resilience = new ResilienceService(client, outbox, {
     maxAttempts: config.retry_max_attempts, baseDelayMs: config.retry_base_delay_ms,
     backoffFactor: config.retry_backoff_factor, jitter: config.retry_jitter }, logger);
   const daemon = new Daemon({ ..., resilience });
   ```
3. **outboxDir**：`~/.sillyhub/daemon/outbox/`（config.ts 同源 homedir）。
4. **Daemon 构造接 resilience**：task-10 已让 Daemon 接 `_resilience` 可选注入，本 task 在 cli 实际传入。

## 接口定义

见实现要求伪码。ResilienceService/Outbox 构造签名由 task-08/15 定义。

## 边界处理

1. **W2 outbox=null**：ResilienceService 用尽 warn 丢（task-08 支持），W3 补真实 outbox。
2. **config 默认值**：task-09 已提供。
3. **向后兼容**：Daemon 构造 resilience 可选，未传=null 回退（task-10）。
4. **outboxDir 创建**：Outbox 内部 ensureDir（task-15）。
5. **参数不可变**。
6. **生命周期**：daemon.stop 时 outbox 不需显式关（文件句柄按需开闭，task-15 设计）。

## 非目标

- 不实现 Outbox（task-15）。
- 不实现 ResilienceService（task-08）。
- 不改 Daemon 构造签名（task-10 已改）。
- 不加 CLI option（config.json 覆盖）。

## 参考

- cli.ts startAction（构造 Daemon 处）
- task-08 ResilienceService / task-15 Outbox
- task-09 config
- design.md §5 / §9

## TDD 步骤

1. 写测试：startAction 构造的 Daemon 含非 null resilience（mock 注入）；W2 outbox=null；config 默认值传入。
2. 确认失败。
3. 实现注入。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归 cli 测试。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | cli 构造 ResilienceService | grep new ResilienceService cli.ts |
| AC-02 | 注入 Daemon | Daemon 收到 resilience 非 undefined |
| AC-03 | config 默认值传入 | maxAttempts=3 等 |
| AC-04 | W2 outbox=null | W2 阶段 outbox 占位 null |
| AC-05 | 现有测试绿 | `pnpm test` 通过 |
