---
id: task-08
title: 新增 resilience/service.ts ResilienceService（submitWithRetry + retryTerminal + notifyHeartbeatResult + drainOutbox 占位）
priority: P0
wave: W2
depends_on: [task-07]
blocks: [task-10, task-11, task-12, task-13, task-14]
requirement_ids: [FR-04, FR-05]
decision_ids: [D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/resilience/service.ts
  - sillyhub-daemon/src/resilience/__tests__/resilience-service.test.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-08: ResilienceService

> 来源：design.md §5 Phase2 / §7 接口定义 / §7.5 契约表；plan.md Wave2 task-08。架构方案 B（独立 ResilienceService，HubClient 不动）。
> 本质：封装重试编排。submitWithRetry（流式消息，重试用尽入 outbox，W2 outbox 占位/W3 task-17 接通）；retryTerminal（终态轻量重试不暂存）；notifyHeartbeatResult（健康信号 + 断连）；drainOutbox（W3 task-18 实现，本 task 占位空方法）。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/resilience/service.ts` | ResilienceService 类 |
| 新增 | `sillyhub-daemon/src/resilience/__tests__/resilience-service.test.ts` | 单测 |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-04 | submitWithRetry 3 次退避 + 错误分类 | submitWithRetry 实现 |
| FR-05 | 终态轻量重试 | retryTerminal 实现 |
| D-005@v1 | 范围 B（submit 重试 + 终态轻量重试） | 两方法 |

## 实现要求

1. **构造**：`constructor(client: HubClient, outbox: Outbox, retry: RetryConfig, logger: Logger)`。Outbox 接口由 task-15 定义，本 task 用接口占位（依赖注入，W2 可传 no-op outbox）。
2. **submitWithRetry(leaseId, claimToken, runId, envelopes)**：
   - 循环 maxAttempts（默认 3）：调 `client.submitMessages(...)`，成功 → markDelivered（W3 task-17；W2 outbox 为 no-op 时 markDelivered 空实现）→ return。
   - 失败 → `isRetryable(err)`：false → 抛（4xx fail-fast）；true → 退避 `baseDelay * factor^i` ± jitter，sleep 后重试。
   - 用尽仍可重试失败 → **W3 task-17 接入 outbox.enqueue**；W2 本 task 暂直接 rethrow 或记 warn（用占位 `this._outbox?.enqueue` 可选注入，未注入则 warn 丢）。
   - 总退避上限 ~8s。
3. **retryTerminal\<T\>(call)**：`for i in maxAttempts: try call() return; catch isRetryable? sleep backoff : throw`。不暂存，用尽抛。
4. **notifyHeartbeatResult(ok)**：ok→healthy=true + 触发 drainOutbox（W3）+ 清断连计数；false→断连计数（与 task-05 协同，本 task 提供信号，task-05 已在 _heartbeatLoop 实现；本方法主要为 W3 drain 触发用）。
5. **drainOutbox()**：W3 task-18 实现，本 task 占位 `async drainOutbox(): Promise<void> { /* W3 */ }`。
6. **退避工具**：内部 `sleep(ms, signal)` 用 setTimeout + AbortSignal（不用 abortableSleep 以免循环依赖，或复用 daemon 的，读代码决定）。
7. **jitter**：±20%，`delay * (1 + (Math.random()*2-1)*jitter)`（Math.random 在 daemon 运行时可用）。

## 接口定义

```ts
export interface RetryConfig { maxAttempts: number; baseDelayMs: number; backoffFactor: number; jitter: number; }

export class ResilienceService {
  constructor(private _client: HubClient, private _outbox: Outbox | null,
              private _retry: RetryConfig, private _logger: Logger) {}

  async submitWithRetry(leaseId: string, claimToken: string, runId: string,
                        envelopes: Envelope[]): Promise<void> {
    let lastErr: unknown;
    for (let i = 0; i < this._retry.maxAttempts; i++) {
      try {
        await this._client.submitMessages(leaseId, claimToken, runId, envelopes.map(e => e.message));
        await this._outbox?.markDelivered(runId, envelopes.map(e => e.dedup_key));
        return;
      } catch (e) {
        lastErr = e;
        if (!isRetryable(e)) throw e;          // 4xx fail-fast
        if (i < this._retry.maxAttempts - 1) await this._sleep(this._delay(i));
      }
    }
    // 用尽：W3 接 outbox，W2 占位
    if (this._outbox) {
      await this._outbox.enqueue({ leaseId, claimToken, runId, envelopes, ts: new Date().toISOString() });
      this._logger.warn('submit_enqueued_to_outbox', { runId, count: envelopes.length, error: toCauseInfo(lastErr) });
    } else {
      this._logger.warn('submit_exhausted_no_outbox', { runId, error: toCauseInfo(lastErr) });
    }
  }

  async retryTerminal<T>(call: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < this._retry.maxAttempts; i++) {
      try { return await call(); }
      catch (e) { lastErr = e; if (!isRetryable(e)) throw e;
        if (i < this._retry.maxAttempts - 1) await this._sleep(this._delay(i)); }
    }
    throw lastErr;
  }

  notifyHeartbeatResult(ok: boolean): void { /* ok→healthy+drain触发(W3); 记录供 drain */ }
  async drainOutbox(): Promise<void> { /* W3 task-18 */ }

  private _delay(i: number): number {
    const base = this._retry.baseDelayMs * Math.pow(this._retry.backoffFactor, i);
    return Math.round(base * (1 + (Math.random() * 2 - 1) * this._retry.jitter));
  }
  private async _sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
}
```

Envelope/Outbox/OutboxEntry 接口由 task-15/16 定义；本 task 在 service.ts 顶部 import 类型（task-15 未就绪时本 task 可临时内联 interface 定义，task-15 落地后统一）。

## 边界处理

1. **4xx fail-fast**：isRetryable false 立即抛，不重试不暂存。
2. **outbox 未注入（W2）**：submitWithRetry 用尽→warn 丢（_outbox null）；retryTerminal 用尽→抛。
3. **退避抖动**：避免多调用同步重试风暴。
4. **总上限 ~8s**：3 次 1/2/4s 约 7s + jitter。
5. **markDelivered 幂等**：成功后调 outbox.markDelivered，outbox 无该 key 时 no-op。
6. **参数不可变**：envelopes 只读 map。
7. **AbortError 传播**：sleep 期间若 daemon stop，setTimeout 不受 signal（简化；stop 时 in-flight 重试自然结束，不强制 abort，可接受）。
8. **不破坏 HubClient**：纯调用，不改 client。

## 非目标

- 不实现 outbox 落盘（task-15）。
- 不实现 drainOutbox（task-18）。
- 不实现 dedup_key 生成（task-16，本 task 接收已带 dedup_key 的 envelopes）。
- 不改 HubClient（N-2）。
- 不改 onTurnMessage/task-runner 调用点（task-10/11）。

## 参考

- design.md §5 Phase2 / §7 / §7.5
- task-07 isRetryable/toCauseInfo
- hub-client.ts submitMessages（360）
- decisions.md D-005@v1

## TDD 步骤

1. 写测试：submitWithRetry 成功路径（1 次成功）；可重试失败重试 3 次后入 outbox（mock outbox.enqueue 被调）；4xx 立即抛不重试；retryTerminal 成功/重试/4xx 抛；退避延迟断言（fake timers）；outbox null 时用尽 warn 不崩。
2. 确认失败。
3. 实现。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | submitWithRetry 成功 1 次 | mock client 成功 → 调 1 次 |
| AC-02 | 可重试失败重试 3 次 | mock client 连续抛 TypeError → 调 3 次 |
| AC-03 | 用尽入 outbox | outbox.enqueue 被调（注入 outbox 时） |
| AC-04 | 4xx fail-fast | mock HubHttpError 422 → 调 1 次即抛，不重试 |
| AC-05 | 退避递增 | fake timers 断言 1s/2s/4s 量级 |
| AC-06 | retryTerminal 不暂存 | 用尽抛，不调 outbox |
| AC-07 | outbox null 不崩 | 用尽 warn，不抛 |
| AC-08 | 测试全绿 | `pnpm test` 通过 |
