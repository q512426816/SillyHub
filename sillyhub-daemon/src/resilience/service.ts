/**
 * ResilienceService——网络层重试编排（task-08 / FR-04 / FR-05 / D-005@v1）。
 *
 * 来源：design.md §5 Phase2 / §7 接口定义 / §7.5 契约表；plan.md Wave2 task-08。
 * 架构方案 B（独立 ResilienceService，HubClient 保持瘦客户端不动）。
 *
 * 职责：
 *   - submitWithRetry：流式消息退避重试，用尽入 outbox（W2 outbox 可为 null → warn 丢；
 *     W3 task-15/17 接通真实 outbox）。task-07（A3）：遇 422（claim_token 失效）
 *     不再抛丢——入 outbox（pending_token 标记）+ 触发一次 claim_token 刷新对账。
 *   - retryTerminal：终态上报（result/complete/end）轻量重试，不暂存，用尽抛。
 *     task-07：daemon 调用点把用尽异常转 enqueueRunResult/enqueueSessionEnd 落箱重放。
 *   - notifyHeartbeatResult：心跳健康信号，drainOutbox 触发钩子（W3 task-18 实现）。
 *   - drainOutbox：按 entry.kind 路由三类补发（task-07 / D-007@v1）——
 *     messages→submitMessages、run_result→notifyRunResult、session_end→notifySessionEnd。
 *
 * 错误分类委托 task-07 的 isRetryable（4xx fail-fast / 5xx+429+timeout+fetch-failed 重试）。
 *
 * @module resilience/service
 */

import { isRetryable, toCauseInfo } from './error-classify.js';
import type { CauseInfo } from './error-classify.js';
// task-18：drainOutbox 遇 422（claim_token rotate 失效）丢弃该条（R-10）。
// task-07：submitWithRetry 对 422 转入箱+对账（A3），drain 侧保留兜底丢弃。
import { HubHttpError } from '../hub-client.js';
// task-15：Envelope/OutboxEntry/Outbox 接口统一定义在 outbox.ts，此处 re-export。
// task-07：kind/pending_token 扩展类型（OutboxTerminalKinds 契约）一并 re-export。
export type {
  Envelope,
  OutboxEntry,
  Outbox,
  OutboxEntryKind,
  OutboxTerminalKinds,
} from './outbox.js';
import type { Envelope, Outbox, OutboxEntry } from './outbox.js';

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
  /**
   * task-07（D-007@v1）：drainOutbox 对 kind=run_result entry 的补发目标。
   * 可选——真实 HubClient 已实现；旧测试 fake 未实现时 drain 对该类 entry
   * warn 丢弃（无法重放，不无限滞留）。
   */
  notifyRunResult?(
    leaseId: string,
    claimToken: string,
    runId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown>;
  /**
   * task-07（D-007@v1）：drainOutbox 对 kind=session_end entry 的补发目标。
   * 可选，语义同 notifyRunResult。
   */
  notifySessionEnd?(
    sessionId: string,
    status: 'ended' | 'failed',
    reason: string,
  ): Promise<unknown>;
}

/**
 * task-07（A3 422 对账 / A5 空窗重放）：claim_token 刷新回调。
 *
 * daemon 注入（setClaimTokenRefresher）：按 runId 返回当前有效 claim_token
 * （daemon SessionState 由 SESSION_INJECT 刷新维护），null/undefined/空串 =
 * 暂不可得。drain 重放 pending_token entry 前先取新 token；submitWithRetry
 * 遇 422 后也触发一次（每 run 防抖）尝试恢复并立即 drain。
 */
export type ClaimTokenRefresher = (runId: string) => Promise<string | null>;

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
  /** task-07：claim_token 刷新回调（daemon 注入；null=未接线）。 */
  private _refresher: ClaimTokenRefresher | null = null;
  /** task-07：422 对账防抖——每 run 只主动触发一次刷新（重复 422 不打爆）。 */
  private readonly _refreshTriggered = new Set<string>();

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
   * task-07（A3/A5）：注入 claim_token 刷新回调。
   *
   * daemon 在持有 SessionState 后接线（runId→当前 claimToken）；此后
   * submitWithRetry 的 422 对账与 drain 的 pending_token 重放都会咨询。
   */
  setClaimTokenRefresher(refresher: ClaimTokenRefresher | null): void {
    this._refresher = refresher;
  }

  /**
   * task-07：重放前解析有效 claim_token。
   *
   * pending_token entry（空窗/422 入箱）优先经 refresher 取当前 token
   * （SESSION_INJECT 已刷新到 daemon SessionState）；取不到回落 entry 原值
   * （backend dedup/终态规则兜底）。非 pending_token entry 直接用原值。
   */
  private async _replayToken(entry: OutboxEntry): Promise<string> {
    if (!entry.pending_token || !this._refresher) return entry.claimToken;
    try {
      const fresh = await this._refresher(entry.runId);
      if (fresh) return fresh;
    } catch (e) {
      this._logger.warn('claim_token_refresh_failed', {
        run_id: entry.runId,
        error: this._causeForLog(e),
      });
    }
    return entry.claimToken;
  }

  /**
   * task-07（A3 422 对账）：触发一次 claim_token 刷新尝试（每 run 防抖）。
   *
   * fire-and-forget：刷新成功拿到非空 token 即触发一轮 drain（此时网络健康才
   * 会真正补发）；失败/取不到仅 warn——entry 留箱，由后续心跳/重连 drain 或
   * backend dedup/终态规则兜底。
   */
  private _scheduleClaimTokenRefresh(runId: string): void {
    if (!this._refresher || this._refreshTriggered.has(runId)) return;
    this._refreshTriggered.add(runId);
    void this._refresher(runId)
      .then((token) => {
        if (token) {
          this._logger.info('claim_token_refreshed_after_422', {
            run_id: runId,
          });
          // token 已恢复且网络健康 → 立即重放（不等奖下一个心跳拍）。
          void this.drainOutbox();
        } else {
          this._logger.warn('claim_token_refresh_unavailable', { run_id: runId });
        }
      })
      .catch((e: unknown) => {
        this._logger.warn('claim_token_refresh_failed', {
          run_id: runId,
          error: this._causeForLog(e),
        });
      });
  }

  /**
   * 流式消息带退避重试提交（FR-04 / D-005@v1）。
   *
   * - 成功 → outbox.markDelivered（幂等，无该 key 时 no-op）→ return。
   * - 可重试失败 → 退避 baseDelay * factor^i ± jitter 后重试。
   * - 422（claim_token 失效，task-07 A3）→ 入 outbox 暂存（pending_token 标记）
   *   + 触发一次会话详情刷新对账（恢复 token 后 drain 重放），不向上抛。
   * - 其它不可重试失败（4xx）→ 立即抛（fail-fast）。
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
        if (e instanceof HubHttpError && e.status === 422) {
          // task-07（A3）：claim_token 失效不再静默丢/抛——入箱 + 刷新对账。
          if (this._outbox) {
            await this._outbox.enqueue({
              leaseId,
              claimToken,
              runId,
              envelopes,
              ts: new Date().toISOString(),
              kind: 'messages',
              pending_token: true,
            });
            this._logger.warn('submit_422_enqueued_to_outbox', {
              run_id: runId,
              count: envelopes.length,
              error: this._causeForLog(e),
            });
          } else {
            this._logger.warn('submit_422_dropped_no_outbox', {
              run_id: runId,
              count: envelopes.length,
              error: this._causeForLog(e),
            });
          }
          this._scheduleClaimTokenRefresh(runId);
          return;
        }
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
        kind: 'messages',
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

  // ── task-07（A3 终态入箱）：retryTerminal 用尽后的落箱重放入口 ──────────────

  /**
   * run 终态（SDK result）入箱（kind=run_result，dedupId=runId）。
   *
   * retryTerminal 快路径用尽/失败后由 daemon.onTurnResult 调用；entry 携带完整
   * result payload（envelopes[0].message），drain 按 kind 路由 notifyRunResult。
   * claimToken 空串（恢复空窗）自动加 pending_token 标记，drain 前经 refresher
   * 取新 token。同 run 已有未补发 run_result entry 时跳过（终态只有一份语义，
   * backend 端点幂等但无需重复滞留）。
   */
  async enqueueRunResult(
    leaseId: string,
    claimToken: string,
    runId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this._outbox) {
      this._logger.warn('run_result_enqueued_no_outbox', { run_id: runId });
      return;
    }
    const dup = this._outbox
      .pendingByRun(runId)
      .some((e) => (e.kind ?? 'messages') === 'run_result');
    if (dup) {
      this._logger.warn('run_result_enqueued_duplicate_skip', { run_id: runId });
      return;
    }
    await this._outbox.enqueue({
      leaseId,
      claimToken,
      runId,
      envelopes: [{ message: payload, dedup_key: runId }],
      ts: new Date().toISOString(),
      kind: 'run_result',
      ...(claimToken ? {} : { pending_token: true }),
    });
    this._logger.warn('run_result_enqueued_to_outbox', { run_id: runId });
  }

  /**
   * session 终态入箱（kind=session_end，dedupId=sessionId）。
   *
   * daemon.onSessionEnd 的 retryTerminal 用尽后调用；entry 无 lease/token 语义
   *（notifySessionEnd 走 api-key 鉴权），drain 按 kind 路由 notifySessionEnd。
   * 同 session 已有未补发 session_end entry 时跳过。
   */
  async enqueueSessionEnd(
    sessionId: string,
    status: 'ended' | 'failed',
    reason: string,
  ): Promise<void> {
    if (!this._outbox) {
      this._logger.warn('session_end_enqueued_no_outbox', { session_id: sessionId });
      return;
    }
    const dup = this._outbox
      .pendingByRun(sessionId)
      .some((e) => (e.kind ?? 'messages') === 'session_end');
    if (dup) {
      this._logger.warn('session_end_enqueued_duplicate_skip', { session_id: sessionId });
      return;
    }
    await this._outbox.enqueue({
      leaseId: '',
      claimToken: '',
      runId: sessionId,
      envelopes: [{ message: { status, reason }, dedup_key: sessionId }],
      ts: new Date().toISOString(),
      kind: 'session_end',
    });
    this._logger.warn('session_end_enqueued_to_outbox', { session_id: sessionId });
  }

  /**
   * task-07（A5 claim_token 空窗）：claimToken 缺失时的消息直接入箱。
   *
   * daemon.onTurnMessage 遇 no_claim_token 不再丢弃——带 pending_token 标记入箱，
   * SESSION_INJECT 刷新 token 后（refresher 咨询）drain 重放；重放仍 422 则走
   * A3 对账（drain 侧 422 丢弃由 backend dedup 兜底）。
   */
  async enqueuePendingToken(
    leaseId: string,
    runId: string,
    envelopes: Envelope[],
  ): Promise<void> {
    if (!this._outbox) {
      this._logger.warn('pending_token_enqueued_no_outbox', { run_id: runId });
      return;
    }
    await this._outbox.enqueue({
      leaseId,
      claimToken: '',
      runId,
      envelopes,
      ts: new Date().toISOString(),
      kind: 'messages',
      pending_token: true,
    });
    this._logger.warn('pending_token_enqueued_to_outbox', {
      run_id: runId,
      count: envelopes.length,
    });
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
   * 补发 outbox 暂存消息（task-18 / FR-07 / D-004@v1；task-07 kind 路由扩展）。
   *
   * 由 ws onConnected / heartbeat healthy / 422 对账触发。按 dedupId 顺序遍历，
   * 按 entry.kind 路由（D-007@v1）：
   *   - messages → submitMessages（现状）；
   *   - run_result → notifyRunResult（payload=envelopes[0].message）；
   *   - session_end → notifySessionEnd（status/reason 取自 envelope）。
   * 终态校验（validity）：messages/run_result 沿用 lease/session 终态预检，
   * session_end 跳过（其本身即终态通知，无 lease 语义）。
   *   - 补发走 retryTerminal（用尽抛，保留 entry 待下轮；不再 enqueue 避免死循环）。
   *   - 422（claim_token rotate 失效）→ warn 丢弃该条（R-10，backend dedup 兜底）。
   *   - 成功 → markDelivered。
   * 防重入：_draining 标记。
   */
  async drainOutbox(): Promise<void> {
    if (!this._outbox || !this._healthy || this._draining) return;
    this._draining = true;
    try {
      for (const dedupId of this._outbox.runs()) {
        const entries = this._outbox.pendingByRun(dedupId);
        for (const entry of entries) {
          const kind = entry.kind ?? 'messages';
          if (kind === 'session_end') {
            await this._drainSessionEnd(dedupId, entry);
            continue;
          }
          if (kind === 'run_result') {
            await this._drainRunResult(dedupId, entry);
            continue;
          }
          await this._drainMessages(dedupId, entry);
        }
      }
    } catch (e) {
      // D4（健壮性，2026-07-24）：外层兜底——runs()/pendingByRun/终态校验里的
      // markDelivered 等抛异常时，内层 per-entry catch 不覆盖；本方法经 void 调用，
      // 未捕获会成 unhandled rejection 被 cli.ts 全局处理器静默吞掉、drain 批次中途终止。
      // 记 warn 不重抛（drain 是尽力而为的后台任务；_draining 由 finally 复位，
      // 下轮 heartbeat healthy 会重跑）。
      this._logger.warn('drain_outbox_unexpected_failed', {
        error: this._causeForLog(e),
      });
    } finally {
      this._draining = false;
    }
  }

  /** drain 单类 entry 的公共错误分类（422/终态 4xx 丢弃，可重试保留）。 */
  private async _drainHandleFailure(
    dedupId: string,
    entry: OutboxEntry,
    e: unknown,
  ): Promise<void> {
    const outbox = this._outbox;
    if (!outbox) return;
    if (e instanceof HubHttpError && e.status === 422) {
      // claim_token rotate 失效：丢弃该条（R-10；backend dedup/终态规则兜底）。
      await outbox.markDelivered(
        dedupId,
        entry.envelopes.map((env) => env.dedup_key),
      );
      this._logger.warn('drain_dropped_token_invalid', {
        run_id: dedupId,
        kind: entry.kind ?? 'messages',
        error: this._causeForLog(e),
      });
    } else if (e instanceof HubHttpError && !isRetryable(e)) {
      // 4xx 业务错误（401/403/404/409 等，retryTerminal fail-fast 抛出）：
      // lease/run 已终态或无权——不补发，丢弃该条（等同 validity 终态校验，
      // 但在 backend 侧判定，避免 daemon 维护 lease/session 查询的复杂度）。
      await outbox.markDelivered(
        dedupId,
        entry.envelopes.map((env) => env.dedup_key),
      );
      this._logger.warn('drain_dropped_terminal_http', {
        run_id: dedupId,
        kind: entry.kind ?? 'messages',
        status: e.status,
        error: this._causeForLog(e),
      });
    } else {
      // 可重试网络错误用尽仍失败（5xx/timeout/fetch failed）：保留 entry 待
      // 下轮 drain（网络恢复后重试）；不抛（drain 是尽力而为的后台任务）。
      this._logger.warn('drain_entry_failed', {
        run_id: dedupId,
        kind: entry.kind ?? 'messages',
        error: this._causeForLog(e),
      });
    }
  }

  /** drain 终态校验（messages/run_result 共用）：lease 过期 / session ended → 丢弃。 */
  private async _drainCheckValidity(
    dedupId: string,
    entry: OutboxEntry,
  ): Promise<boolean> {
    if (!this._validity || !this._outbox) return false;
    if (!this._validity.isLeaseValid(entry.leaseId)) {
      await this._outbox.markDelivered(
        dedupId,
        entry.envelopes.map((e) => e.dedup_key),
      );
      this._logger.warn('drain_skipped_terminal', {
        run_id: dedupId,
        kind: entry.kind ?? 'messages',
        reason: 'lease_expired',
      });
      return true;
    }
    if (this._validity.isSessionEnded(dedupId)) {
      await this._outbox.markDelivered(
        dedupId,
        entry.envelopes.map((e) => e.dedup_key),
      );
      this._logger.warn('drain_skipped_terminal', {
        run_id: dedupId,
        kind: entry.kind ?? 'messages',
        reason: 'session_ended',
      });
      return true;
    }
    return false;
  }

  /** drain kind=messages：现状路径（submitMessages 重放）。 */
  private async _drainMessages(dedupId: string, entry: OutboxEntry): Promise<void> {
    if (await this._drainCheckValidity(dedupId, entry)) return;
    // 补发：走 retryTerminal（用尽抛保留 entry，不 enqueue 避免死循环）。
    // dedup_key 注入 message 顶层（与 submitWithRetry 一致，task-19）。
    const messages = entry.envelopes.map((e) => ({
      ...e.message,
      dedup_key: e.dedup_key,
    }));
    const claimToken = await this._replayToken(entry);
    try {
      await this.retryTerminal(() =>
        this._client.submitMessages(entry.leaseId, claimToken, dedupId, messages),
      );
      await this._outbox?.markDelivered(
        dedupId,
        entry.envelopes.map((e) => e.dedup_key),
      );
    } catch (e) {
      await this._drainHandleFailure(dedupId, entry, e);
    }
  }

  /** drain kind=run_result：notifyRunResult 重放（task-07 / D-007@v1）。 */
  private async _drainRunResult(dedupId: string, entry: OutboxEntry): Promise<void> {
    const notify = this._client.notifyRunResult;
    if (typeof notify !== 'function') {
      // 旧测试 fake 未实现两扩展方法：无法重放，丢弃（不无限滞留）。
      await this._outbox?.markDelivered(
        dedupId,
        entry.envelopes.map((e) => e.dedup_key),
      );
      this._logger.warn('drain_run_result_no_client_method', { run_id: dedupId });
      return;
    }
    if (await this._drainCheckValidity(dedupId, entry)) return;
    const payload = entry.envelopes[0]?.message ?? {};
    const claimToken = await this._replayToken(entry);
    try {
      await this.retryTerminal(() =>
        notify.call(this._client, entry.leaseId, claimToken, dedupId, payload),
      );
      await this._outbox?.markDelivered(
        dedupId,
        entry.envelopes.map((e) => e.dedup_key),
      );
    } catch (e) {
      await this._drainHandleFailure(dedupId, entry, e);
    }
  }

  /** drain kind=session_end：notifySessionEnd 重放（无 lease 语义，跳过 validity）。 */
  private async _drainSessionEnd(dedupId: string, entry: OutboxEntry): Promise<void> {
    const notify = this._client.notifySessionEnd;
    if (typeof notify !== 'function') {
      await this._outbox?.markDelivered(
        dedupId,
        entry.envelopes.map((e) => e.dedup_key),
      );
      this._logger.warn('drain_session_end_no_client_method', { session_id: dedupId });
      return;
    }
    const endPayload = entry.envelopes[0]?.message as
      | { status?: unknown; reason?: unknown }
      | undefined;
    const status = endPayload?.status === 'failed' ? 'failed' : 'ended';
    const reason =
      typeof endPayload?.reason === 'string' ? endPayload.reason : 'daemon_replay';
    try {
      await this.retryTerminal(() => notify.call(this._client, dedupId, status, reason));
      await this._outbox?.markDelivered(
        dedupId,
        entry.envelopes.map((e) => e.dedup_key),
      );
    } catch (e) {
      await this._drainHandleFailure(dedupId, entry, e);
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
