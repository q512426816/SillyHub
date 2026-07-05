---
id: task-18
title: drainOutbox 实现（onConnected/heartbeat healthy 触发 + lease/session 终态校验 + 422 token 容忍）
priority: P0
wave: W3
depends_on: [task-15, task-17]
blocks: [task-23]
requirement_ids: [FR-07]
decision_ids: [D-004@v1]
allowed_paths:
  - sillyhub-daemon/src/resilience/service.ts
  - sillyhub-daemon/src/daemon.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-18: drainOutbox 实现

> 来源：design.md §5 Phase3 drainOutbox / §10 R-07/R-10；plan.md Wave3 task-18。D-004 补发触发。
> 本质：drainOutbox 由 ws onConnected / heartbeat healthy 触发，按 runId 顺序补发 pending，补发前校验 lease 未过期 + session 非 ended，遇 422（claim_token rotate 失效）丢弃。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/resilience/service.ts` | drainOutbox 实现（替换 task-08 占位） |
| 修改 | `sillyhub-daemon/src/daemon.ts` | _heartbeatLoop 成功调 notifyHeartbeatResult(true)；ws onConnected 调 drainOutbox |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-07 | drain 触发 + 终态校验 + token 422 容忍 | drainOutbox 实现 |
| D-004@v1 | 补发触发复用 onConnected | ws onConnected / heartbeat healthy 触发 |

## 实现要求

1. **drainOutbox**：
   - 遍历 outbox pendingByRun（各 runId）。
   - 每个 run：校验 lease 未过期 + session 非 ended（调 daemon 提供的校验回调，或 ResilienceService 持 sessionManager/lease 校验引用）。ended/过期 → warn 丢弃该 run 待补发项（outbox.markDelivered 清空该 run）。
   - 调 `client.submitMessages(leaseId, claimToken, runId, envelopes)`（走 submitWithRetry 复用重试，或直接调 + 内部重试）。
   - 成功 → markDelivered。
   - **422（claim_token rotate 失效）**：catch HubHttpError 422 → warn 丢弃该条（outbox.markDelivered），不无限重试（R-10）。
2. **触发点**：
   - ws onConnected（ws-client.ts:331）：daemon 在 _wsLoop 的 WsClient callbacks.onConnected 调 `_resilience.drainOutbox()`。
   - heartbeat healthy：_heartbeatLoop 成功调 `notifyHeartbeatResult(true)` → 内部触发 drainOutbox（防抖：避免每次 heartbeat 都 drain，仅 healthy 转换或 pending 非空时）。
3. **防重入**：drainOutbox 进行中标记，避免并发多次 drain 同 run。
4. **顺序**：按 runId 顺序，run 内按 entry 顺序。

## 接口定义

```ts
async drainOutbox(): Promise<void> {
  if (this._draining) return;
  this._draining = true;
  try {
    for (const runId of this._outbox!.runs()) {
      const entries = this._outbox!.pendingByRun(runId);
      for (const entry of entries) {
        if (!this._isLeaseValid(entry.leaseId) || this._isSessionEnded(runId)) {
          await this._outbox!.markDelivered(runId, entry.envelopes.map(e=>e.dedup_key));
          this._logger.warn('drain_skipped_terminal', { runId });
          continue;
        }
        try {
          await this.submitWithRetry(entry.leaseId, entry.claimToken, runId, entry.envelopes);
        } catch (e) {
          if (e instanceof HubHttpError && e.status === 422) {
            await this._outbox!.markDelivered(runId, entry.envelopes.map(e=>e.dedup_key));
            this._logger.warn('drain_dropped_token_invalid', { runId });
          } else throw e;
        }
      }
    }
  } finally { this._draining = false; }
}
```

lease/session 校验：ResilienceService 持 daemon 提供的校验回调（`isLeaseValid(leaseId)` / `isSessionEnded(runId)`），由 daemon 注入。

## 边界处理

1. **lease 过期/session ended**：丢弃该 run 待补发（warn），不补发（R-07）。
2. **422 token 失效**：丢弃该条（warn），不无限重试（R-10）。
3. **防重入**：_draining 标记。
4. **触发防抖**：heartbeat healthy 每次都 drain 浪费，仅 pending 非空或 healthy 转换时 drain。
5. **submitWithRetry 复用**：drain 内补发走 submitWithRetry（含重试），用尽再入 outbox（避免循环——drain 用尽入 outbox 后下次 drain 再试，但 422/终态已丢弃不会死循环；可重试网络错误重试后仍失败会重新 enqueue 同条，需防 drain 死循环：限制 drain 每轮每条最多 1 次 submitWithRetry，失败不入 outbox 而是留原 entry 待下轮）。**注意**：drain 内补发不应再调 submitWithRetry 的 enqueue 逻辑，应直接调 client + 重试，失败保留 entry。需调整：drain 用独立 retry 不 enqueue。
6. **参数不可变**。
7. **顺序**：runId 顺序 + entry 顺序。

## 非目标

- 不改 ws-client 重连（复用 onConnected）。
- 不实现 outbox（task-15）。
- 不实现 backend 幂等（task-21，drain 依赖其去重）。

## 参考

- ws-client.ts:331 onConnected
- daemon.ts _heartbeatLoop / _wsLoop
- task-15 Outbox / task-17
- design.md §5 Phase3 / §10 R-07/R-10 / D-004@v1

## TDD 步骤

1. 写测试：pending 非空 + onConnected → drain 调 submitMessages + markDelivered；session ended → 丢弃；422 → 丢弃；lease 过期 → 丢弃；防重入；顺序。
2. 确认失败。
3. 实现 + 触发点接线。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | onConnected 触发 drain | ws onConnected → drainOutbox 调用 |
| AC-02 | heartbeat healthy 触发 | 成功 → notifyHeartbeatResult → drain（pending 非空时） |
| AC-03 | 成功 markDelivered | 补发成功 → 移除 |
| AC-04 | session ended 丢弃 | ended → warn + 清该 run |
| AC-05 | lease 过期丢弃 | 过期 → warn + 清 |
| AC-06 | 422 token 丢弃 | 422 → warn + 清该条 |
| AC-07 | 防重入 | 并发 drain 不重复 |
| AC-08 | 顺序 | runId + entry 顺序补发 |
| AC-09 | 测试全绿 | `pnpm test` 通过 |
