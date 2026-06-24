/**
 * ResilienceService——网络层重试编排（task-08 / FR-04 / FR-05 / D-005@v1）。
 *
 * 来源：design.md §5 Phase2 / §7 接口定义 / §7.5 契约表；plan.md Wave2 task-08。
 * 架构方案 B（独立 ResilienceService，HubClient 保持瘦客户端不动）。
 *
 * 职责：
 *   - submitWithRetry：流式消息退避重试，用尽入 outbox（W2 outbox 可为 null → warn 丢；
 *     W3 task-15/17 接通真实 outbox）。
 *   - retryTerminal：终态上报（result/complete/end）轻量重试，不暂存，用尽抛。
 *   - notifyHeartbeatResult：心跳健康信号，drainOutbox 触发钩子（W3 task-18 实现）。
 *   - drainOutbox：W3 task-18 实现，本 task 占位。
 *
 * 错误分类委托 task-07 的 isRetryable（4xx fail-fast / 5xx+429+timeout+fetch-failed 重试）。
 *
 * @module resilience/service
 */

import { isRetryable, toCauseInfo } from './error-classify.js';
import type { CauseInfo } from './error-classify.js';

// ── 类型（task-15 落地后 Outbox/Envelope/OutboxEntry 统一到 outbox.ts）──────────

/** 待提交消息信封：消息体 + 幂等键（task-16 dedupKeyFor 生成）。 */
export interface Envelope {
  message: Record<string, unknown>;
  dedup_key: string;
}

/** outbox 落盘条目。 */
export interface OutboxEntry {
  leaseId: string;
  claimToken: string;
  runId: string;
  envelopes: Envelope[];
  ts: string;
}

/**
 * Outbox 接口（task-15 实现；W2 阶段 ResilienceService 可注入 null 表示无暂存）。
 * 本 task 在此内联接口定义，task-15 落地后从此 re-export 统一。
 */
export interface Outbox {
  enqueue(entry: OutboxEntry): Promise<void>;
  markDelivered(runId: string, dedupKeys: string[]): Promise<void>;
  pendingByRun(runId: string): OutboxEntry[];
  load(): Promise<void>;
}

/** 重试配置（来自 DaemonConfig 的 retry_* 字段）。 */
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  backoffFactor: number;
  jitter: number;
}

/** 最小 Logger 接口（与 daemon.Logger 对齐，避免循环依赖）。 */
export interface ResilienceLogger {
  warn(event: string, kv?: Record<string, unknown>): void;
  info(event: string, kv?: Record<string, unknown>): void;
  error(event: string, kv?: Record<string, unknown>): void;
}

/** HubClient 最小调用接口（只声明 ResilienceService 用到的方法，避免循环 import）。 */
export interface SubmitClient {
  submitMessages(
    leaseId: string,
    claimToken: string,
    agentRunId: string,
    messages: Record<string, unknown>[],
  ): Promise<unknown>;
}

/**
 * 退避总上限约 8s（3 次 1/2/4s + jitter ≈ 7s）。超出截断，防极端退避。
 */
const MAX_BACKOFF_MS = 8000;

/**
 * 网络层重试编排服务。
 *
 * 不持有可变业务状态（除内部 healthy 信号），每次调用独立重试。
 */
export class ResilienceService {
  /** 最近一次心跳是否健康（notifyHeartbeatResult 维护，drainOutbox W3 用）。 */
  private _healthy = true;

  constructor(
    private readonly _client: SubmitClient,
    private readonly _outbox: Outbox | null,
    private readonly _retry: RetryConfig,
    private readonly _logger: ResilienceLogger,
  ) {}

  /**
   * 流式消息带退避重试提交（FR-04 / D-005@v1）。
   *
   * - 成功 → outbox.markDelivered（幂等，无该 key 时 no-op）→ return。
   * - 可重试失败 → 退避 baseDelay * factor^i ± jitter 后重试。
   * - 不可重试失败（4xx）→ 立即抛（fail-fast）。
   * - 用尽仍可重试失败 → 注入 outbox 则 enqueue 暂存；否则 warn 丢。
   */
  async submitWithRetry(
    leaseId: string,
    claimToken: string,
    runId: string,
    envelopes: Envelope[],
  ): Promise<void> {
    const messages = envelopes.map((e) => e.message);
    const dedupKeys = envelopes.map((e) => e.dedup_key);
    let lastErr: unknown;
    for (let i = 0; i < this._retry.maxAttempts; i++) {
      try {
        await this._client.submitMessages(leaseId, claimToken, runId, messages);
        if (this._outbox) {
          await this._outbox.markDelivered(runId, dedupKeys);
        }
        return;
      } catch (e) {
        lastErr = e;
        if (!isRetryable(e)) {
          // 4xx 业务错误 fail-fast，不重试不暂存。
          throw e;
        }
        if (i < this._retry.maxAttempts - 1) {
          await this._sleep(this._delay(i));
        }
      }
    }
    // 用尽：注入 outbox 则暂存（W3 task-17 接通），否则 warn 丢（W2 行为）。
    if (this._outbox) {
      await this._outbox.enqueue({
        leaseId,
        claimToken,
        runId,
        envelopes,
        ts: new Date().toISOString(),
      });
      this._logger.warn('submit_enqueued_to_outbox', {
        run_id: runId,
        count: envelopes.length,
        error: this._causeForLog(lastErr),
      });
    } else {
      this._logger.warn('submit_exhausted_no_outbox', {
        run_id: runId,
        count: envelopes.length,
        error: this._causeForLog(lastErr),
      });
    }
  }

  /**
   * 终态上报轻量重试（FR-05）。不暂存，用尽抛。
   *
   * 用于 notifyRunResult / completeLease / notifySessionEnd 等终态调用——
   * 这些调用幂等性靠 claim_token rotate 兜底，重试用尽即抛由调用方记 warn。
   */
  async retryTerminal<T>(call: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < this._retry.maxAttempts; i++) {
      try {
        return await call();
      } catch (e) {
        lastErr = e;
        if (!isRetryable(e)) throw e;
        if (i < this._retry.maxAttempts - 1) {
          await this._sleep(this._delay(i));
        }
      }
    }
    throw lastErr;
  }

  /**
   * 心跳结果信号（FR-03 协同 / W3 drain 触发）。
   *
   * - ok=true：标记健康 + 触发 drainOutbox（W3 task-18 实现真实补发）。
   * - ok=false：标记不健康；断连 FATAL 计数由 task-05 的 _heartbeatLoop 负责，
   *   本方法仅维护 healthy 信号供 drainOutbox 决策。
   */
  notifyHeartbeatResult(ok: boolean): void {
    this._healthy = ok;
    if (ok) {
      // W3 task-18：健康后 drain 补发 pending outbox。W2 阶段 drainOutbox 占位空实现。
      void this.drainOutbox();
    }
  }

  /**
   * 补发 outbox 暂存消息（W3 task-18 实现）。
   * W2 占位：无 outbox 或未实现时 no-op。
   */
  async drainOutbox(): Promise<void> {
    if (!this._outbox || !this._healthy) return;
    // W3 task-18 接入真实 drain 逻辑（遍历 pending → submitWithRetry → 422 丢弃）。
  }

  /** 退避第 i 次延迟（base * factor^i，±jitter，截断 MAX_BACKOFF_MS）。 */
  private _delay(i: number): number {
    const base =
      this._retry.baseDelayMs * Math.pow(this._retry.backoffFactor, i);
    const jittered = Math.round(
      base * (1 + (Math.random() * 2 - 1) * this._retry.jitter),
    );
    return Math.min(jittered, MAX_BACKOFF_MS);
  }

  private async _sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private _causeForLog(err: unknown): CauseInfo {
    return toCauseInfo(err);
  }
}
