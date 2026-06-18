/**
 * interactive/permission-resolver.ts —— canUseTool 远程人审 pending 注册表
 *（task-08 §4.1 / D-007@v1 / spike-02 §3.7 D2）。
 *
 * 职责：
 *   - SDK canUseTool 回调被触发时，register() 生成 wire request_id（uuid）+
 *     发 PERMISSION_REQUEST → 返回 canUseTool 回调应 await 的 Promise；
 *   - backend PERMISSION_RESPONSE 到达 resolve() 时 settle 对应 promise；
 *   - AbortSignal 链接：SDK 在 interrupt 时 abort signal → 立即 deny；
 *   - 5min 兜底定时器：到点 deny + 清理（防 WS 丢消息永久 hang）；
 *   - abortAll()：SessionManager.end/fail/interrupt/_onResult 收尾时调用，
 *     所有未决 promise settle deny + 清定时器 + 移除 abort listener。
 *
 * 约束（铁律）：
 *   - wire request_id 用 crypto.randomUUID()，跨进程跨 turn 唯一；
 *   - fail-closed：send 失败 / signal aborted / 5min 超时 / abortAll 全部 deny，
 *     绝不本地 allow；
 *   - 每个 promise 只 settle 一次（重复 resolve/abortAll/超时任一路径幂等）；
 *   - listener 在 settle 时移除防泄漏；
 *   - resolver 只活在当前 turn 的 SDK Query 协程内，绝不跨 turn。
 *
 * 来源：design.md §7.1（canUseTool 回调签名）/ §7.6（turn 边界）；spike-02 §3.7 D2
 *（回调可 await 任意延迟、带 AbortSignal）；requirements.md FR-07（5min 超时 deny）；
 * decisions.md D-007@v1（远程人审 await 往返）。
 *
 * @module interactive/permission-resolver
 */

import { randomUUID } from 'node:crypto';
import { MSG } from '../protocol.js';
import type { PermissionResponsePayload } from '../protocol.js';

/**
 * canUseTool 回调返回类型（与 SDK CanUseTool 签名逐字对齐）。
 * 来源：design.md §7.1 + spike-02 §3.7 D2。
 */
export type CanUseToolDecision =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message?: string };

/**
 * 5min 兜底超时（ms）。
 *
 * D-007：backend 主超时 5min（PERMISSION_TIMEOUT_SEC=300）；daemon 兜底定时器
 * 设 5min + 5s 容差，避免 backend 已发 deny 但 WS 丢消息导致回调永久 hang。
 * 双保险 fail-closed。
 */
export const PERMISSION_FALLBACK_TIMEOUT_MS = 5 * 60 * 1000 + 5_000;

/** send 函数签名（注入便于测试 mock；生产路径是 wsClient.send）。 */
export type PermissionSendFn = (
  msg: { type: string; payload: unknown },
) => boolean;

/** register 入参。 */
export interface PermissionRegisterInput {
  /** 当前 AgentSession.id。 */
  sessionId: string;
  /** 当前 turn 的 AgentRun.id。 */
  runId: string;
  /** SDK 传来的工具名（Write/Bash/...）。 */
  toolName: string;
  /** SDK 传来的工具参数（原样转发，不读不改）。 */
  toolInput: Record<string, unknown>;
  /** SDK tool_use_id（可选，便于追溯）。 */
  toolUseId?: string;
  /** SDK canUseTool options.signal（interrupt 时 SDK abort）。 */
  signal?: AbortSignal;
  /** wsClient.send（注入便于测试）。 */
  send: PermissionSendFn;
}

/** register 返回。 */
export interface PermissionRegisterResult {
  /** wire request_id（uuid v4），跨进程跨 turn 唯一。 */
  requestId: string;
  /** canUseTool 回调应 await 的 Promise；settle 后返回 decision。 */
  promise: Promise<CanUseToolDecision>;
}

/** resolve 返回值（用于日志区分）。 */
export type PermissionResolveResult =
  | 'resolved'
  | 'unknown_request'
  | 'session_mismatch';

/** pending entry 内部结构。 */
interface PendingEntry {
  requestId: string;
  /** settle promise 的 resolver。 */
  resolveFn: (decision: CanUseToolDecision) => void;
  /** 5min 兜底定时器句柄。 */
  fallbackTimer: ReturnType<typeof setTimeout>;
  /** AbortSignal 的 listener 引用（settle 时 removeEventListener 防泄漏）。 */
  abortListener?: () => void;
  /** 关联的 AbortSignal（listener 移除用）。 */
  signal?: AbortSignal;
  /** 已 settle 标记，防重复 settle。 */
  settled: boolean;
}

/**
 * canUseTool 远程人审 pending 注册表。
 *
 * 实例化由 SessionManager.create 在 manual_approval=true 时持有；每个 session
 * 一个 resolver（与 SessionState 同生命周期）。生命周期由 SessionManager 控制：
 * end/fail/interrupt/_onResult 收尾时调 abortAll。
 */
export class PermissionResolver {
  private readonly _pending = new Map<string, PendingEntry>();

  /**
   * 注册一个 pending 审批请求。
   *
   * 步骤：
   *   1. 生成 requestId = randomUUID()；
   *   2. 构造 PERMISSION_REQUEST payload 并 send；send=false → 立即 deny
   *      （fail-closed），不进 pending Map；
   *   3. signal 已 aborted → 立即 deny，不进 pending Map；
   *   4. 否则进 pending Map + 启 5min 兜底定时器 + 注册 signal abort listener；
   *   5. promise 在 resolve/abortAll/定时器/abort 任一路径只 settle 一次。
   */
  register(input: PermissionRegisterInput): PermissionRegisterResult {
    const requestId = randomUUID();

    // signal 已 aborted（SDK 在 register 前已 interrupt）：fail-closed deny。
    if (input.signal?.aborted) {
      return {
        requestId,
        promise: Promise.resolve<CanUseToolDecision>({
          behavior: 'deny',
          message: 'permission request aborted (signal already aborted)',
        }),
      };
    }

    // 发 PERMISSION_REQUEST。send=false → fail-closed deny，不本地 allow。
    const sent = input.send({
      type: MSG.PERMISSION_REQUEST,
      payload: {
        session_id: input.sessionId,
        run_id: input.runId,
        request_id: requestId,
        tool_name: input.toolName,
        input: input.toolInput,
        ...(input.toolUseId !== undefined
          ? { tool_use_id: input.toolUseId }
          : {}),
      } as Record<string, unknown>,
    });
    if (!sent) {
      return {
        requestId,
        promise: Promise.resolve<CanUseToolDecision>({
          behavior: 'deny',
          message: 'permission request send failed',
        }),
      };
    }

    // pending promise + 内部 resolver。
    let resolveFn!: (decision: CanUseToolDecision) => void;
    const promise = new Promise<CanUseToolDecision>((resolve) => {
      resolveFn = resolve;
    });

    const entry: PendingEntry = {
      requestId,
      resolveFn,
      fallbackTimer: undefined as unknown as ReturnType<typeof setTimeout>,
      settled: false,
      signal: input.signal,
    };

    // 5min 兜底定时器：到点 deny + 清理（防 WS 丢消息永久 hang）。
    entry.fallbackTimer = setTimeout(() => {
      this._settle(entry, {
        behavior: 'deny',
        message: 'permission request timeout (5min fallback)',
      });
    }, PERMISSION_FALLBACK_TIMEOUT_MS);
    // 不阻塞进程退出。
    entry.fallbackTimer.unref?.();

    // signal 后续 abort → 立即 deny + 清理（移除 listener 防泄漏）。
    if (input.signal) {
      const listener = (): void => {
        this._settle(entry, {
          behavior: 'deny',
          message: 'permission request aborted (signal aborted)',
        });
      };
      entry.abortListener = listener;
      input.signal.addEventListener('abort', listener, { once: true });
    }

    this._pending.set(requestId, entry);
    return { requestId, promise };
  }

  /**
   * 收到 backend PERMISSION_RESPONSE 时调用。
   *
   * 命中 pending 且 session_id 匹配 → settle 对应 decision + 清理。
   * 未命中 / 重复 / session 不匹配 → 返回对应结果，不抛。
   */
  resolve(
    payload: PermissionResponsePayload,
    expectedSessionId: string,
  ): PermissionResolveResult {
    if (payload.session_id !== expectedSessionId) {
      return 'session_mismatch';
    }
    const entry = this._pending.get(payload.request_id);
    if (!entry) {
      return 'unknown_request';
    }
    const decision: CanUseToolDecision =
      payload.decision === 'allow'
        ? { behavior: 'allow' }
        : { behavior: 'deny', ...(payload.message ? { message: payload.message } : {}) };
    this._settle(entry, decision);
    return 'resolved';
  }

  /**
   * SessionManager.end/fail/interrupt/_onResult 收尾时调用。
   *
   * 所有未决 promise 立即 settle deny（带 reason），清 pending、清定时器、
   * 移除 abort listener。幂等：重复调用无副作用。
   *
   * @returns 本次实际 settle 的 entry 数（已 settle 的不算）。
   */
  abortAll(reason: string): number {
    let count = 0;
    for (const entry of Array.from(this._pending.values())) {
      if (this._settle(entry, { behavior: 'deny', message: reason })) {
        count += 1;
      }
    }
    return count;
  }

  /** 测试用：当前 pending 数量。 */
  get pendingCount(): number {
    return this._pending.size;
  }

  /**
   * settle 单个 entry（幂等）。返回是否本次实际 settle。
   *
   * 清理顺序：先从 Map 移除 → clearTimeout → removeEventListener → resolveFn。
   * settled 标记防重复 settle（resolve/abortAll/定时器/abort 并发到达时只生效一次）。
   */
  private _settle(
    entry: PendingEntry,
    decision: CanUseToolDecision,
  ): boolean {
    if (entry.settled) return false;
    entry.settled = true;
    this._pending.delete(entry.requestId);
    if (entry.fallbackTimer) {
      clearTimeout(entry.fallbackTimer);
    }
    if (entry.abortListener && entry.signal) {
      try {
        entry.signal.removeEventListener('abort', entry.abortListener);
      } catch {
        /* noop */
      }
    }
    entry.resolveFn(decision);
    return true;
  }
}
