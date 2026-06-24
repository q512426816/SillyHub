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
// task-18：drainOutbox 遇 422（claim_token rotate 失效）丢弃该条（R-10）。
import { HubHttpError } from '../hub-client.js';
// task-15：Envelope/OutboxEntry/Outbox 接口统一定义在 outbox.ts，此处 re-export。
export type { Envelope, OutboxEntry, Outbox } from './outbox.js';
import type { Envelope, Outbox } from './outbox.js';

/** 重试配置（来自 DaemonConfig 的 retry_* 字段）。 */
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  backoffFactor: number;
  jitter: number;
}

/**
 * task-18：drainOutbox 补发前的终态校验回调（由 daemon 注入）。
 *   - isLeaseValid(leaseId)：lease 未过期（claim_token 仍有效）。
 *   - isSessionEnded(runId)：对应 session 是否已 ended/failed。
 * 返回 true 表示**不可补发**（应丢弃）。
 */
export interface DrainValidityChecker {
  isLeaseValid(leaseId: string): boolean;
  isSessionEnded(runId: string): boolean;
}
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
  /** drainOutbox 防重入标记（task-18 AC-07）。 */
  private _draining = false;

  constructor(
    private readonly _client: SubmitClient,
    private readonly _outbox: Outbox | null,
    private readonly _retry: RetryConfig,
    private readonly _logger: ResilienceLogger,
    /**
     * task-18：drainOutbox 补发前的终态校验回调（daemon 注入）。
     * 未注入（null）时 drain 不做终态校验，仅按网络结果处理（422 仍丢弃）。
     */
    private readonly _validity: DrainValidityChecker | null = null,
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
    // task-19（FR-08）：dedup_key 写入 message 顶层字段（backend submit_messages
    // 从 msg['dedup_key'] 取，task-21 ON CONFLICT 据此去重）。envelope.dedup_key 仅
    // daemon 内部（outbox markDelivered）用，提交时注入到 message。
    const messages = envelopes.map((e) => ({ ...e.message, dedup_key: e.dedup_key }));
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
    if (ok && this._outbox) {
      // task-18：健康后 drain 补发 pending outbox（防抖：仅 pending 非空时）。
      void this.drainOutbox();
    }
  }

  /**
   * 补发 outbox 暂存消息（task-18 / FR-07 / D-004@v1）。
   *
   * 由 ws onConnected / heartbeat healthy 触发。按 runId 顺序补发 pending：
   *   - lease 过期 / session ended（校验回调判定）→ warn 丢弃该 run 待补发项。
   *   - 补发走 retryTerminal（用尽抛，保留 entry 待下轮；不再 enqueue 避免死循环）。
   *   - 422（claim_token rotate 失效）→ warn 丢弃该条（R-10，不无限重试）。
   *   - 成功 → markDelivered。
   * 防重入：_draining 标记。
   */
  async drainOutbox(): Promise<void> {
    if (!this._outbox || !this._healthy || this._draining) return;
    this._draining = true;
    try {
      for (const runId of this._outbox.runs()) {
        const entries = this._outbox.pendingByRun(runId);
        for (const entry of entries) {
          // 终态校验：lease 过期 / session ended → 丢弃该 run 待补发（R-07）。
          if (this._validity) {
            if (!this._validity.isLeaseValid(entry.leaseId)) {
              await this._outbox.markDelivered(
                runId,
                entry.envelopes.map((e) => e.dedup_key),
              );
              this._logger.warn('drain_skipped_terminal', {
                run_id: runId,
                reason: 'lease_expired',
              });
              continue;
            }
            if (this._validity.isSessionEnded(runId)) {
              await this._outbox.markDelivered(
                runId,
                entry.envelopes.map((e) => e.dedup_key),
              );
              this._logger.warn('drain_skipped_terminal', {
                run_id: runId,
                reason: 'session_ended',
              });
              continue;
            }
          }
          // 补发：走 retryTerminal（用尽抛保留 entry，不 enqueue 避免死循环）。
          // dedup_key 注入 message 顶层（与 submitWithRetry 一致，task-19）。
          const messages = entry.envelopes.map((e) => ({
            ...e.message,
            dedup_key: e.dedup_key,
          }));
          try {
            await this.retryTerminal(() =>
              this._client.submitMessages(
                entry.leaseId,
                entry.claimToken,
                runId,
                messages,
              ),
            );
            await this._outbox.markDelivered(
              runId,
              entry.envelopes.map((e) => e.dedup_key),
            );
          } catch (e) {
            if (e instanceof HubHttpError && e.status === 422) {
              // claim_token rotate 失效：丢弃该条（R-10）。
              await this._outbox.markDelivered(
                runId,
                entry.envelopes.map((e) => e.dedup_key),
              );
              this._logger.warn('drain_dropped_token_invalid', {
                run_id: runId,
                error: this._causeForLog(e),
              });
            } else if (e instanceof HubHttpError && !isRetryable(e)) {
              // 4xx 业务错误（401/403/404/409 等，retryTerminal fail-fast 抛出）：
              // lease/run 已终态或无权——不补发，丢弃该条（等同 validity 终态校验，
              // 但在 backend 侧判定，避免 daemon 维护 lease/session 查询的复杂度）。
              await this._outbox.markDelivered(
                runId,
                entry.envelopes.map((env) => env.dedup_key),
              );
              this._logger.warn('drain_dropped_terminal_http', {
                run_id: runId,
                status: e.status,
                error: this._causeForLog(e),
              });
            } else {
              // 可重试网络错误用尽仍失败（5xx/timeout/fetch failed）：保留 entry 待
              // 下轮 drain（网络恢复后重试）；不抛（drain 是尽力而为的后台任务）。
              this._logger.warn('drain_entry_failed', {
                run_id: runId,
                error: this._causeForLog(e),
              });
            }
          }
        }
      }
    } finally {
      this._draining = false;
    }
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
