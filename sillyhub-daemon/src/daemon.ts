/**
 * Daemon 主类（task-20，W4 编排核心）。
 *
 * 替代 Python `sillyhub_daemon/daemon.py`（341 行）。
 * 守护进程主类：register → 三循环（heartbeat/poll/ws）→ task_available 事件分发
 * → lease 状态机（claim → start → execute → complete）。
 *
 * **编排层**：不实现任何子能力（agent 探测 / HTTP / WS / 子进程 / git 都不在本类），
 * 只做组装。6 个前置模块的接口消费点：
 *   - task-12 config.ts：`DaemonConfig`（只读）
 *   - task-03 protocol.ts：`MSG` / `WS_PATH`
 *   - task-16 agent-detector.ts：`AgentDetector.detectAgents(): Promise<DetectedAgent[]>`
 *   - task-17 hub-client.ts：`HubClient.{register,heartbeat,claimLease,startLease,completeLease,getPendingLeases,close}`
 *   - task-18 ws-client.ts：`WsClient` class（`connect()/close()/send()`）
 *   - task-19 task-runner.ts：`TaskRunner.runLease(ctx): Promise<TaskRunnerResult>`
 *
 * 行为对齐 Python `daemon.py:36-341`。Node 异步模型用 Promise + AbortController
 * 替代 asyncio.Task + CancelledError。
 *
 * **Reverse Sync（蓝图假设 vs 真实 src 差异，以真实为准）**：
 *   1. TaskRunner 真实方法是 `runLease(ctx: LeaseCtx)`，不是 `executeTask(leaseId, token, payload)`。
 *      daemon 在 _runLeaseStateMachine step 3 构造 LeaseCtx 传给 runLease。
 *   2. TaskRunnerResult 字段名是 camelCase（filesChanged/durationMs/sessionId），
 *      complete_lease 提交时映射成 server 期望的 snake_case（files_changed 等）。
 *   3. DetectedAgent 字段：`provider`（非 `name`）、`path`（非 `bin_path`）、
 *      `status: 'available' | 'unavailable'`（非 `available: bool`）。
 *      daemon 用 `agent.status === 'available'` 过滤，用 `agent.provider` 作 key。
 *   4. AgentDetector 方法名是 `detectAgents()`（非 `detectAll()`）。
 *   5. WsClient 构造签名：`new WsClient({ serverUrl, runtimeId, token?, callbacks? })`，
 *      connect() 是同步 void（内部自动重连），不是 `connect(signal): Promise<void>`。
 *      daemon 不能 await connect()，改成一次性调 connect() 后让循环空跑等待 stop。
 *   6. HubClient.register 真实接受对象参数（含 provider/name/version/...），
 *      返回 `Record<string, unknown>`，用 `resp.id` 取 server 分配的 runtime_id。
 *   7. HubClient.close() 是同步 void（非 async），stop 中无需 await。
 *
 * @module daemon
 */

import { arch, homedir, hostname, platform } from 'node:os';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { DaemonConfig } from './config.js';
import { normalizeAllowedRoots } from './config.js';
import { MSG } from './protocol.js';
// task-06（design §5.4.4）：onTurnMessage/onTurnResult 参数类型从 Claude SDK 专属类型
// 放宽为 provider-neutral 联合，支持 Codex flat message/result 透传。
import type {
  InteractiveDriverMessage,
  InteractiveDriverResult,
} from './interactive/driver.js';
import type {
  DaemonMessage,
  ExecutionContextPayload,
  LeaseCtx,
  LeasePayload,
} from './types.js';
import { AgentDetector } from './agent-detector.js';
import type { DetectedAgent } from './agent-detector.js';
import { HubClient, extractCause } from './hub-client.js';
import { WsClient } from './ws-client.js';
import { listDir } from './file-rpc.js';
import { buildSpawnEnv } from './spawn-env.js';
// 2026-06-24 preflight：启动前预检 sillyspec 版本 + daemon 自更新（失败不阻断启动）。
import { runPreflight } from './preflight.js';
// daemon 自身构建标识（release=git SHA），register 时上报供服务端判定是否需推送自更新。
import { BUILD_ID } from './build-id.js';
// 2026-06-24-daemon-network-resilience task-10/12：网络层重试编排（submit 重试 + 终态轻量重试）。
import { ResilienceService } from './resilience/service.js';
import type { Envelope } from './resilience/service.js';
import { dedupKeyFor } from './resilience/error-classify.js';
import type {
  TaskRunner,
  TaskRunnerResult,
  ChangeWriteCtx,
  ChangeWriteFile,
  ChangeWriteResult,
} from './task-runner.js';
import type { SessionManager } from './interactive/session-manager.js';
// task-06（D-007@v1）：spec bundle 同步共享 utility（task-04 抽出），interactive
// 路径接入 pull（session 开始）+ sync（session end）。纯函数 + client 参数注入，
// interactive 无 TaskRunner 实例也能直接调用。
import {
  pullSpecBundle,
  syncSpecTreeIfNeeded,
  readLocalSpecVersion,
  shouldRefreshSpec,
  bumpLocalSpecVersion,
  resolveSpecDir,
} from './spec-sync.js';
import type {
  PersistedSessionRecord,
  SessionStatus,
  SessionStorePersistence,
} from './interactive/types.js';

// ── 最小日志（design G-05 零依赖，不装 winston/pino）──────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

interface Logger {
  debug(event: string, kv?: Record<string, unknown>): void;
  info(event: string, kv?: Record<string, unknown>): void;
  warn(event: string, kv?: Record<string, unknown>): void;
  error(event: string, kv?: Record<string, unknown>): void;
}

function formatVal(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v instanceof Error) return v.message;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function createLogger(level: LogLevel): Logger {
  const filter = LOG_ORDER[level] ?? LOG_ORDER.info;
  const log = (lvl: LogLevel, event: string, kv?: Record<string, unknown>): void => {
    if (LOG_ORDER[lvl] < filter) return;
    const parts = kv
      ? Object.entries(kv).map(([k, v]) => `${k}=${formatVal(v)}`)
      : [];
    // eslint-disable-next-line no-console
    console[lvl === 'debug' ? 'log' : lvl](`[daemon.${event}]`, ...parts);
  };
  return {
    debug: (e, kv) => log('debug', e, kv),
    info: (e, kv) => log('info', e, kv),
    warn: (e, kv) => log('warn', e, kv),
    error: (e, kv) => log('error', e, kv),
  };
}

// ── 可中断 sleep（AbortSignal 替代 asyncio.CancelledError，R7）───────────────

/** abortableSleep 抛出的异常类型（标识 stop 信号）。 */
class AbortError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortError';
  }
}

/**
 * 可中断 sleep。signal.aborted 时立即 reject(AbortError)。
 *
 * 不用 Promise.race([sleep, abortPromise])：会产生未处理的 rejection 警告。
 * 用 setTimeout + signal.addEventListener('abort', ...) 实现干净的中断。
 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new AbortError());
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ── translateSpecRoot（prompt 路径翻译纯函数）─────────────────────────────────
// 2026-06-22-agent-run-pipeline-fix task-02：SPEC_ROOT_MAP 翻译器。
// design §4.1 A1 第 2 层：daemon 在 prompt 透传给 SessionManager.create 前，
// 按 spec_root_map（"from:to"）把容器内路径翻译成宿主机路径，避免 Windows
// Git Bash 把 /data/... 转成 C:\Program Files\Git\data\... 导致 EPERM。
//
// 关键修正（task-02 边界 3 / AC-07）：旧实现 `split(':', 2)` 在 Windows 盘符
// 场景会把 to 截断成 'C'。改用 indexOf(':') + slice 按首个 ':' 分割，
// to 含盘符冒号（如 C:/data/spec-workspaces）。
//
// 纯函数导出便于单测（daemon-spec-root-map.test.ts）。

/**
 * 按 specRootMap（"from:to"）翻译 prompt 中的路径。
 *
 * 语义（task-02 §接口定义）：
 *   - specRootMap 空串 → 不翻译，返回原 prompt
 *   - specRootMap 不含 ':' → 返回原 prompt（调用方负责 warn 日志）
 *   - 按**首个** ':' 分割为 from/to（容忍 to 含 ':'，如 Windows 盘符路径）
 *   - from 或 to 为空 → 返回原 prompt
 *   - prompt.includes(from) → replaceAll(from, to)；否则原样返回
 *
 * @param prompt       原始 prompt
 * @param specRootMap  映射 "from:to"（来自 config.spec_root_map 或 env SPEC_ROOT_MAP）
 * @returns            翻译后 prompt（新字符串；不变时返回原引用）
 */
export function translateSpecRoot(prompt: string, specRootMap: string): string {
  if (!specRootMap) return prompt;
  const colonIdx = specRootMap.indexOf(':');
  if (colonIdx < 0) return prompt;
  const from = specRootMap.slice(0, colonIdx);
  const to = specRootMap.slice(colonIdx + 1);
  if (!from || !to) return prompt;
  if (!prompt.includes(from)) return prompt;
  return prompt.replaceAll(from, to);
}

// ── 依赖契约（鸭子类型，避免硬耦合具体类）─────────────────────────────────────

/** daemon 需要的 AgentDetector 接口子集。 */
interface DetectorLike {
  detectAgents(): Promise<DetectedAgent[]>;
}

/** daemon 需要的 HubClient 接口子集。 */
interface ClientLike {
  register(params: {
    name?: string;
    provider?: string;
    version?: string;
    protocol?: string;
    os?: string;
    arch?: string;
    capabilities?: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  heartbeat(runtimeId: string): Promise<unknown>;
  markOffline?(runtimeId: string): Promise<unknown>;
  claimLease(leaseId: string, runtimeId: string): Promise<Record<string, unknown>>;
  startLease(leaseId: string, claimToken: string): Promise<unknown>;
  completeLease(
    leaseId: string,
    claimToken: string,
    result: Record<string, unknown>,
  ): Promise<unknown>;
  getPendingLeases(runtimeId: string): Promise<Record<string, unknown>[]>;
  getExecutionContext(agentRunId: string): Promise<ExecutionContextPayload>;
  close(): void;
  /**
   * gap-3（design §4）：上报 interactive AgentRun 终态。
   * SessionManager._onResult → deps.onTurnResult → daemon 桥接 → 此方法
   * → backend close_interactive_run。W1 已在 hub-client.ts 实现。
   */
  notifyRunResult(
    leaseId: string,
    claimToken: string,
    runId: string,
    payload: {
      status: string;
      is_error: boolean;
      subtype?: string;
      result_summary?: string;
      // SDKResultSuccess 透传字段（usage / cost / duration 等，interactive 路径
      // 原先丢弃，导致 AgentRun 全 NULL；对齐 batch extractResultStats）。
      total_cost_usd?: number;
      num_turns?: number;
      duration_ms?: number;
      duration_api_ms?: number;
      input_tokens?: number;
      output_tokens?: number;
      // task-16：cache 两维（短名，对齐 backend _METADATA_FIELDS）。
      cache_read_tokens?: number;
      cache_creation_tokens?: number;
    },
  ): Promise<unknown>;
  /**
   * 增量上报 agent 执行消息（流式）。interactive + batch 共用端点，
   * interactive 路径经 daemon 桥接转发（design §6 step 4）。
   */
  submitMessages(
    leaseId: string,
    claimToken: string,
    agentRunId: string,
    messages: Record<string, unknown>[],
  ): Promise<unknown>;
  /**
   * gap-4（design §5）：上报 interactive session 终态（end / idle / fail）。
   * SessionManager.end/fail → deps.onSessionEnd → daemon 桥接 → 此方法
   * → backend end_session。W1 已在 hub-client.ts 实现。
   */
  notifySessionEnd(
    sessionId: string,
    status: 'ended' | 'failed',
    reason: string,
  ): Promise<unknown>;
  /**
   * task-06（D-003@v1 tar 模式 pull）：GET spec bundle（tar Buffer）。
   * 与 hub-client.ts:694 实现对齐。interactive 路径经 pullSpecBundle 调用。
   */
  getSpecBundle(wsId: string): Promise<Buffer>;
  /**
   * task-06（D-003@v1 tar 模式 sync）：POST spec 整树回传（tar Buffer）。
   * 与 hub-client.ts:737 实现对齐。interactive 路径经 postSpecSync 调用。
   */
  postSpecSync(
    wsId: string,
    tarBuf: Buffer,
  ): Promise<{ ok: boolean; reparsed: number }>;
  /**
   * task-11 / FR-08 / D-004@v1：拉取 runtime 下所有 pending change-write。
   * 与 hub-client.ts getPendingChangeWrites 对齐。
   */
  getPendingChangeWrites(
    runtimeId: string,
  ): Promise<Record<string, unknown>[]>;
  /**
   * task-11：抢占一行 pending change-write（换取 claim_token）。
   * task-09 端点无 body，runtimeId 仅日志用。
   */
  claimChangeWrite(
    changeWriteId: string,
    runtimeId?: string,
  ): Promise<Record<string, unknown>>;
  /**
   * task-11：回执 change-write 执行结果（ok/files/error）。
   */
  completeChangeWrite(
    changeWriteId: string,
    claimToken: string,
    payload: { ok: boolean; files?: unknown[]; error?: string },
  ): Promise<unknown>;
}

/** daemon 需要的 TaskRunner 接口子集。 */
interface TaskRunnerLike {
  runLease(ctx: LeaseCtx): Promise<TaskRunnerResult>;
  /**
   * task-11 / FR-10：change-write 轻量执行（不启 agent）。可选——测试 mock
   * TaskRunner 未实现时 daemon 跳过 change-write 分支。
   */
  runChangeWrite?(ctx: ChangeWriteCtx): Promise<ChangeWriteResult>;
}

/** daemon 需要的 WsClient 接口子集。 */
interface WsClientLike {
  connect(): void;
  close(): void;
  /**
   * task-05：注册 RPC handler（D-005@v1）。鸭子类型可选——测试 mock 的 WsClient
   * 可不实现（生产路径真实 WsClient 必须实现，否则 list_dir 等方法不可用，R-5）。
   * daemon 在 _wsLoop 用 `typeof === 'function'` 探测后调用。
   */
  registerRpcHandler?: (
    method: string,
    handler: (params: Record<string, unknown>) => Promise<unknown> | unknown,
  ) => void;
  /**
   * scan 真阻塞（改造点 C）：发 WS 消息到 backend（PERMISSION_REQUEST）。真实 WsClient
   *（task-18）实现 send；此处声明供 daemon.sendToHub 调用。返回类型宽松（真实可能
   * void/boolean），sendToHub 用 try/catch 判定是否成功。
   */
  send?: (msg: { type: string; payload: unknown }) => unknown;
}

/** WsClient 工厂：daemon 在 _wsLoop 用它创建实例（便于测试 mock）。 */
type WsClientFactory = (opts: {
  serverUrl: string;
  runtimeId: string;
  callbacks: {
    onMessage?: (msg: DaemonMessage) => void;
    onConnected?: () => void;
    onDisconnected?: (code: number, reason: string) => void;
    onError?: (err: Error) => void;
  };
}) => WsClientLike;

// ── task-10：daemon 重启恢复编排（鸭子类型端口）──────────────────────────────
//
// daemon 启动时按 §5 编排：load → 对每条记录向 backend recover →
// SessionManager.restoreAndReconnect（query resume）→ reconnecting→active。
//
// backend recover/confirm/markFailed 的真实 HTTP 端点属 task-05 router 范围
//（allowed_paths 限制，不在本任务直接改 HubClient）。daemon 通过此鸭子类型
// 端口调用；生产路径由 main.ts 注入真实 client（内部走 HubClient 的对应方法），
// 测试注入 mock。

/** backend recover 响应状态（task-10 §4.4 / §5）。 */
export type SessionRecoverStatus =
  | 'reconnecting'
  | 'ended'
  | 'failed'
  | 'rejected';

/**
 * task-10 §4.4 / §5：daemon→backend 恢复对账端口（鸭子类型）。
 *
 * 三个方法对应 backend service.py 的 recover_session_after_daemon_restart /
 * confirm_session_reconnected / mark_session_recovery_failed。daemon 启动编排
 * 按序调用；失败隔离（单条 reject/throw 不影响其他 session）。
 */
export interface RecoveryCoordinator {
  /**
   * 向 backend 收敛崩溃 currentRun + 写 session=reconnecting（或返回终态/rejected）。
   * daemon 收到 reconnecting 后才调 SessionManager.restoreAndReconnect。
   */
  recoverSession(
    sessionId: string,
    params: {
      leaseId: string;
      runtimeId: string;
      provider: string;
      agentSessionId: string;
      interruptedRunId?: string;
    },
  ): Promise<{ status: SessionRecoverStatus }>;
  /** 恢复成功（reconnecting → active）后向 backend 确认。 */
  confirmReconnected(sessionId: string): Promise<void>;
  /** 恢复失败（driver.start 抛错）后向 backend 写 reconnecting → failed。 */
  markRecoveryFailed(sessionId: string): Promise<void>;
}

// ── DaemonOptions（便于测试注入 mock detector/wsClientFactory）────────────────

export interface DaemonOptions {
  /** 注入自定义 AgentDetector（测试用 mock）。默认 new AgentDetector()。 */
  detector?: DetectorLike;
  /**
   * 注入自定义 WsClient 工厂（测试用 mock）。
   * 默认用真实 WsClient（task-18）：`new WsClient({ serverUrl, runtimeId, callbacks })`。
   * 用工厂而非 wsClient 实例，因真实 WsClient 在构造时即准备 connect，
   * daemon 需要 _wsLoop 时按 server_url 构造。
   */
  wsClientFactory?: WsClientFactory;
  /** WS 重连退避（毫秒），默认 10000（对齐 Python daemon.py:251 `asyncio.sleep(10)`）。 */
  wsReconnectDelay?: number;
  /**
   * task-04（D-002@v3）：注入 SessionManager（交互式会话生命周期管理）。
   * 默认 undefined：kind=interactive lease 记 error 并由 backend 收 failed，不崩 daemon
   *（生产部署在 main.ts 实例化时传入；本任务默认 null，AC-14 覆盖过渡期）。
   */
  sessionManager?: SessionManager | null;
  /**
   * task-10（FR-08）：sessions.json 元数据持久化端口。注入后在 daemon.start
   * 启动时加载可恢复记录 + 状态变更排队 flush。默认 undefined：不持久化
   *（Wave1/2 内存态行为，回退路径：删 sessions.json 即回到 failed 默认路径）。
   */
  persistence?: SessionStorePersistence | null;
  /**
   * task-10（FR-08）：daemon→backend 恢复对账端口。注入后 daemon.start 在
   * 三循环启动前对每条持久化记录调 recoverSession + restoreAndReconnect。
   * 默认 undefined：不执行恢复编排（Wave1/2 行为）。
   */
  recoveryClient?: RecoveryCoordinator | null;
  /** task-10 §5：恢复并发上限，默认 4。 */
  recoveryConcurrency?: number;
  /**
   * gap-8（interactive 凭证 parity）：本机凭证管理器（鸭子类型，仅用 get/buildEnv）。
   *
   * batch 路径经 buildSpawnEnv(credential) 把 credentials.json 的 ANTHROPIC token 注入
   * claude 子进程；interactive 路径（SessionManager→ClaudeSdkDriver）原先只用裸
   * process.env，**不读 credentials.json**，导致用户按设计在 ~/.sillyhub/daemon/
   * credentials.json 配置 token 后 batch 能跑、interactive 仍因无凭证失败。注入后
   * _startInteractiveSession 用同一 buildSpawnEnv 逻辑构造 env 传给 driver，达成 parity。
   * 默认 undefined：driver 回退裸 process.env（向后兼容）。
   */
  credentialManager?: InteractiveCredentialManager | null;
  /**
   * ql-20260624-006：runtime 单实例 lock 管理器。注入后 daemon.start 在注册 agents 前
   * 对每个 provider acquire lock（强制一 host+一 user+一 provider=一 daemon，防同机双开
   * 共享 backend runtime_id 致 ownership 双通过 + WS 重连风暴），失败回滚并阻止启动；
   * stop 时 releaseAll。默认 undefined：不强制单实例（向后兼容）。
   */
  lockManager?: RuntimeLockLike | null;
  /**
   * 2026-06-24-daemon-network-resilience task-10/12/13：网络层重试编排服务。
   * 注入后 submitMessages 走退避重试（用尽入 outbox）、终态上报走 retryTerminal。
   * 默认 undefined：回退直接调 HubClient（无重试，向后兼容 W1）。
   */
  resilience?: ResilienceService | null;
}

/**
 * gap-8：interactive 路径凭证注入所需的 CredentialManager 接口子集（鸭子类型，
 * 对齐 src/credential.ts 的 get/buildEnv，与 spawn-env.ts 的 SpawnCredentialManager 一致）。
 */
export interface InteractiveCredentialManager {
  get(key: string): string | undefined;
  buildEnv(config: Record<string, unknown>): Record<string, string>;
}

/**
 * ql-20260624-006：runtime 单实例 lock 管理器鸭子类型（对齐 src/runtime-lock.ts 的
 * RuntimeLockManager，便于测试 mock）。
 */
export interface RuntimeLockLike {
  acquire(provider: string): Promise<void>;
  releaseAll(): Promise<void>;
}

// ── Daemon class（核心）──────────────────────────────────────────────────────

/**
 * 守护进程主类。生命周期：
 *   start() → detectAgents → register each → 启动三循环（heartbeat/poll/ws）
 *           → 收 task_available → _executeTask（claim→start→run→complete）
 *   stop()  → 中断三循环 → 关闭 WS/HTTP → 注销信号
 *
 * 行为对齐 sillyhub_daemon/daemon.py:36-341。
 * 编排层：不实现任何子能力，只组装 6 个前置模块。
 */
export class Daemon {
  private readonly _config: DaemonConfig;
  private readonly _client: ClientLike;
  private readonly _taskRunner: TaskRunnerLike | null;
  private readonly _detector: DetectorLike;
  private readonly _logger: Logger;
  /**
   * task-04（D-002@v3）：交互式会话管理器。null/undefined 时 interactive lease 记 error
   * 不崩（AC-14 过渡期）。生产路径由 main.ts 在构造 daemon 时传入。
   */
  private readonly _sessionManager: SessionManager | null;
  /**
   * task-10（FR-08）：sessions.json 元数据持久化端口。
   * null 时不持久化（Wave1/2 内存态）。
   */
  private readonly _persistence: SessionStorePersistence | null;
  /**
   * task-10（FR-08）：daemon→backend 恢复对账端口。
   * null 时不执行启动恢复编排（Wave1/2 行为）。
   */
  private readonly _recoveryClient: RecoveryCoordinator | null;
  /** task-10 §5：恢复并发上限，默认 4。 */
  private readonly _recoveryConcurrency: number;
  /**
   * gap-8：本机凭证管理器（interactive 凭证 parity）。null 时 driver 回退裸 process.env。
   */
  private readonly _credentialManager: InteractiveCredentialManager | null;
  /** ql-20260624-006：runtime 单实例 lock 管理器。null 时不强制单实例。 */
  private readonly _lockManager: RuntimeLockLike | null;
  /**
   * 2026-06-24-daemon-network-resilience task-10/12：网络层重试编排。
   * 注入后 onTurnMessage 走 submitWithRetry、终态走 retryTerminal；未注入（null）
   * 回退直接调 _client（向后兼容）。由 cli（task-13）构造时注入。
   */
  private readonly _resilience: ResilienceService | null;
  /**
   * task-04：interactive lease.id → session_id（防 WS 重放重复 create，AC-09）。
   * batch lease 不进此 map（走 _inflightLeases 去重）。
   */
  private readonly _interactiveSessionsByLease = new Map<string, string>();
  /**
   * task-06（D-003@v1 tar 模式）：interactive lease.id → spec 同步上下文。
   * _startInteractiveSession tar 模式 pull 时 set(leaseId, {workspaceId})；
   * onSessionEnd 经 sessionId→sessionManager.get→leaseId 反查本 map 取 workspaceId，
   * postSpecSync 回传整树后 finally delete（幂等，AC-09 / AC-12）。
   * shared 模式（transport!=='tar'）不 set → onSessionEnd 查不到 ctx 跳过（D-004 现状）。
   */
  private readonly _interactiveSpecSyncCtx = new Map<
    string,
    { workspaceId: string }
  >();

  /**
   * P1-1（2026-06-18）：恢复成功（markReconnected + confirm）后正在 active 运行的
   * session 集合。用于把恢复后**异步**的 driver onError → SessionManager.fail 路径
   * 桥接到 backend markRecoveryFailed（否则 backend session 卡 reconnecting）。
   *
   * daemon 不持有 SessionManager.deps.onSessionEnd 注入点（SessionManager 从外部
   * 注入），故暴露 markRecoveredSessionFailed 让 onSessionEnd 注入方在收到 failed
   * 时调用；daemon 据此集合判定是否走恢复失败通知路径，并清理集合。
   */
  private readonly _recoveredSessionIds = new Set<string>();

  /** server 分配的 runtime_id → WS 客户端（每个 provider runtime 各一条连接）。 */
  private readonly _wsClients = new Map<string, WsClientLike>();
  private readonly _wsClientFactory: WsClientFactory;
  private readonly _wsReconnectDelay: number;

  /** 运行标志，三循环 while 条件。 */
  private _running = false;

  /** 每个 _fire 的 AbortController（stop 时全部 abort，R7）。 */
  private readonly _controllers = new Set<AbortController>();

  /** 每个 _fire 的 Promise（stop 时 allSettled 等待）。 */
  private readonly _loopPromises = new Set<Promise<void>>();

  /**
   * _fire 断路器：记录每次自愈重启的起始时间戳。
   * 循环成功运行超过 loop_restart_backoff_ms 后清除，允许计数器归零。
   */
  private readonly _restartStartedAt = new WeakMap<Function, number>();

  /** agent provider → server 分配的 runtime_id（register 成功后填入）。 */
  private readonly _registeredRuntimes = new Map<string, string>();

  /**
   * task-05（FR-03）：按 rid 维护的心跳断连计数。value=首次失败时间戳 ms，缺 key=健康。
   * _fire 自愈重启 _heartbeatLoop 后类成员保留，不重置（避免重启即误判健康）。
   */
  private readonly _heartbeatFailSince = new Map<string, number>();

  /** task-05：已告警 FATAL 的 rid 集合，防持续断连刷日志风暴；恢复时清除。 */
  private readonly _degradedWarned = new Set<string>();

  /**
   * ql-20260616-006：agent provider → 本机 CLI 可执行文件路径。
   * server 不持有 daemon 本机的 cmd_path（capabilities.bin_path 仅记录不回传），
   * claim_lease 返回的 payload.cmdPath 恒 undefined → spawn 前必须由 daemon 注入。
   */
  private readonly _agentPaths = new Map<string, string>();

  /** 进行中的 lease_id 集合（并发去重，边界 3）。 */
  private readonly _inflightLeases = new Set<string>();
  /**
   * task-11：change-write 在途去重集合（与 lease inflight 独立，避免 UUID 碰撞
   * 误判 + 便于观测）。taskId 进入即 add，执行完 finally delete。
   */
  private readonly _inflightChangeWrites = new Set<string>();

  /** 信号 handler 引用（stop 时 process.off 注销，R8）。 */
  private _sigtermHandler: (() => void) | null = null;
  private _sigintHandler: (() => void) | null = null;

  constructor(
    config: DaemonConfig,
    client: ClientLike,
    taskRunner?: TaskRunnerLike | null,
    options?: DaemonOptions,
  ) {
    this._config = config;
    this._client = client;
    this._taskRunner = taskRunner ?? null;
    this._detector = options?.detector ?? new AgentDetector();
    this._wsClientFactory =
      options?.wsClientFactory ??
      ((opts) => new WsClient(opts) as unknown as WsClientLike);
    this._wsReconnectDelay = options?.wsReconnectDelay ?? 10_000;
    this._sessionManager = options?.sessionManager ?? null;
    this._credentialManager = options?.credentialManager ?? null;
    this._lockManager = options?.lockManager ?? null;
    this._resilience = options?.resilience ?? null;
    this._persistence = options?.persistence ?? null;
    this._recoveryClient = options?.recoveryClient ?? null;
    this._recoveryConcurrency =
      options?.recoveryConcurrency && options.recoveryConcurrency > 0
        ? Math.floor(options.recoveryConcurrency)
        : 4;
    this._logger = createLogger(
      this._normalizeLogLevel(config.log_level),
    );
  }

  private _normalizeLogLevel(level: string): LogLevel {
    if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
      return level;
    }
    return 'info';
  }

  // ── 公开 API ──────────────────────────────────────────────────────────────

  /** 运行中状态查询（对齐 daemon.py:134 is_running property）。 */
  get isRunning(): boolean {
    return this._running;
  }

  /**
   * 启动 daemon：detectAgents → register each → 启动三循环 → 注册信号 handler。
   * 对齐 daemon.py:64-118 start()。
   *
   * 幂等性：若已 _running，直接 return（防重复 start）。
   */
  async start(): Promise<void> {
    if (this._running) {
      this._logger.warn('already_running');
      return;
    }
    this._running = true;
    this._logger.info('starting', { runtime_id: this._config.runtime_id });

    // preflight（2026-06-24）：启动前预检 sillyspec 版本 + daemon 自更新。
    // 失败不阻断启动——runPreflight 内部每步 try/catch 隔离，此处再兜底防意外抛错。
    // 适配内部 Logger（debug/info/warn/error 方法）为 preflight 的 (level,msg,data) 签名。
    try {
      await runPreflight(this._config, (level, msg, data) => {
        this._logger[level](msg, data);
      });
    } catch (e) {
      this._logger.warn('preflight_failed', { error: e });
    }

    // 1. 探测 agent（task-16，真实方法名 detectAgents，不是 detectAll）
    const agents = await this._detector.detectAgents();
    const availableAgents = agents.filter((a) => a.status === 'available');
    this._logger.info('agents_detected', {
      agents: availableAgents.map((a) => a.provider),
    });

    // 2. 逐个 register（task-17，单个失败不中断其余）
    if (availableAgents.length === 0) {
      this._logger.info('no_agents_detected');
    } else {
      // ql-20260624-006：注册前 acquire runtime lock（强制单实例）。
      // 任一 provider lock 被活跃进程持有 → 回滚已持有 + _running 复位 + 抛错，
      // 阻止三循环启动（cli.ts catch 打印提示并 exit 1）。
      if (this._lockManager) {
        try {
          for (const agent of availableAgents) {
            await this._lockManager.acquire(agent.provider);
          }
          this._logger.info('runtime_lock_acquired', {
            providers: availableAgents.map((a) => a.provider),
          });
        } catch (e) {
          this._logger.error('runtime_lock_acquire_failed', { error: e });
          await this._lockManager.releaseAll();
          this._running = false;
          throw e;
        }
      }
      for (const agent of availableAgents) {
        await this._registerOne(agent);
      }
    }

    // task-10（FR-08 / §5）：在三循环启动前执行崩溃恢复编排。
    // load 持久化记录 → 对每条向 backend recover → restoreAndReconnect
    //（query resume）→ reconnecting→active。失败隔离 + backend rejected 删记录。
    // 未注入 persistence/recoveryClient → 跳过（Wave1/2 行为，向后兼容）。
    await this._recoverSessionsOnBoot();

    // 3. 启动三循环
    this._fire((signal) => this._heartbeatLoop(signal));
    this._fire((signal) => this._pollLoop(signal));
    this._fire((signal) => this._wsLoop(signal));

    // task-07（FR-06 / D-004@v1）：启动 SessionManager 空闲扫描定时器。
    // sessionManager 为 null（task-04 边界 14：未注入）时 ?. 不调；空闲扫描不启动。
    // batch 路径完全不受影响。
    try {
      this._sessionManager?.start();
    } catch (e) {
      this._logger.warn('session_manager_start_failed', { error: e });
    }

    // 4. 注册信号 handler（R8）
    this._installSignalHandlers();

    this._logger.info('started', { runtime_id: this._config.runtime_id });
  }

  /**
   * 优雅停止：_running=false → abort 所有循环 → 等待 → 关闭 WS/HTTP → 注销信号。
   * 对齐 daemon.py:120-132 stop()。
   */
  async stop(): Promise<void> {
    if (!this._running) return;
    this._running = false;
    this._logger.info('stopping');

    // 注销信号 handler（避免 stop 中再次收到信号二次触发）
    this._uninstallSignalHandlers();

    // abort 所有循环的 AbortController
    for (const c of this._controllers) c.abort();

    // 等待所有循环退出（AbortError 被 _fire 的 catch 吞掉）
    await Promise.allSettled([...this._loopPromises]);
    this._controllers.clear();
    this._loopPromises.clear();

    await this._markRegisteredRuntimesOffline();

    // task-07（FR-06 / D-004@v1）：停 SessionManager 空闲扫描定时器。
    // 顺序在 WS close 之前，避免 shutdown 中途扫描又触发 end→onSessionEnd→WS 已关报错。
    // sessionManager 为 null 时 ?. 不调。不主动 end 所有 session（避免 shutdown 风暴 backend）；
    // active session 内存态随进程退出丢失，backend 侧 lease 心跳/WS 失活兜底收口。
    try {
      this._sessionManager?.stop();
    } catch (e) {
      this._logger.warn('session_manager_stop_failed', { error: e });
    }

    // task-10（§7 边界 13）：daemon stop 强制 flush 最后一次内存快照
    //（SIGKILL 兜底靠上一次原子快照）。persistence/sessionManager 为 null 时 no-op。
    if (this._persistence && this._sessionManager) {
      try {
        await this._sessionManager.flush();
      } catch (e) {
        this._logger.warn('session_flush_on_stop_failed', { error: e });
      }
    }

    // ql-20260624-006：释放 runtime lock（启动期 acquire 的单实例 lock）。
    // SIGKILL/断电未走到此 → 下次启动靠 pid 存活检测回收 stale lock。
    if (this._lockManager) {
      try {
        await this._lockManager.releaseAll();
      } catch (e) {
        this._logger.warn('runtime_lock_release_failed', { error: e });
      }
    }

    this._closeAllWsClients();
    // 关闭 HTTP（真实 HubClient.close 是同步 void no-op）
    try {
      this._client.close();
    } catch (e) {
      this._logger.warn('client_close_failed', { error: e });
    }

    this._logger.info('stopped');
  }

  // ── 内部：register 单个 agent（task-17 HubClient.register）─────────────────

  private async _markRegisteredRuntimesOffline(): Promise<void> {
    if (!this._client.markOffline) return;
    const runtimeIds = [...new Set(this._registeredRuntimes.values())].filter(Boolean);
    await Promise.allSettled(
      runtimeIds.map(async (rid) => {
        try {
          await this._client.markOffline!(rid);
          this._logger.info('runtime_marked_offline', { runtime_id: rid });
        } catch (e) {
          this._logger.warn('runtime_mark_offline_failed', { runtime_id: rid, error: e });
        }
      }),
    );
  }

  private async _registerOne(agent: DetectedAgent): Promise<void> {
    try {
      // 真实 HubClient.register 接受对象参数，provider 字段填 agent.provider
      //（对齐真实 DetectedAgent.provider，不是蓝图的 agent.name）。
      const resp = await this._client.register({
        name: hostname(),
        provider: agent.provider,
        version: agent.version ?? 'unknown',
        protocol: agent.protocol,
        os: platform(),
        arch: arch(),
        capabilities: {
          provider: agent.provider,
          version: agent.version,
          protocol: agent.protocol,
          bin_path: agent.path, // 真实字段是 path
          daemon_build_id: BUILD_ID, // 上报 daemon 自身构建标识，供服务端判定是否需推送自更新
        },
      });
      const serverRuntimeId = String(resp.id ?? '');
      this._registeredRuntimes.set(agent.provider, serverRuntimeId);
      // ql-20260616-006：cmd_path 不来自 server（server 不知 daemon 本机路径），
      // 由 daemon 自己维护 provider → 本机 path 映射，runLease 前注入到 ctx。
      if (agent.path) {
        this._agentPaths.set(agent.provider, agent.path);
      }
      this._logger.info('registered', {
        provider: agent.provider,
        runtime_id: serverRuntimeId,
      });
    } catch (e) {
      // 单个 agent 失败不中断其余注册（daemon.py:105-111）
      this._logger.error('register_failed', { provider: agent.provider, error: e });
    }
  }

  // ── task-10：daemon 启动崩溃恢复编排（§5）───────────────────────────────────

  /**
   * 启动恢复编排：load → 限流并发对每条记录 recover+restore → flush → 完成。
   *
   * 顺序（§5）：在三循环（heartbeat/poll/ws）启动**前**完成全部恢复。
   * - 未注入 persistence/recoveryClient/sessionManager → no-op（Wave1/2 行为）。
   * - load 抛错（不应发生，persistence 内部已隔离）→ 记 warn 不崩。
   * - 单条记录失败（backend rejected 或 driver.start 抛错）→ 结构化 warn 后
   *   继续其他记录，不崩 daemon（失败隔离）。
   * - 全部恢复完成后 flush（清 currentRunId / 无效记录）。
   */
  private async _recoverSessionsOnBoot(): Promise<void> {
    if (!this._persistence || !this._recoveryClient || !this._sessionManager) {
      // Wave1/2 行为：无持久化 / 无 recovery 端口 / 无 SessionManager → 不恢复。
      return;
    }
    let records: PersistedSessionRecord[];
    try {
      records = await this._persistence.load();
    } catch (e) {
      this._logger.warn('session_recover_load_failed', { error: e });
      return;
    }
    if (records.length === 0) {
      this._logger.debug('session_recover_no_records');
      return;
    }
    this._logger.info('session_recover_start', { count: records.length });

    // 限流并发（默认 4）：用 slot 池控制最大并发，单条失败不影响其他。
    const limit = this._recoveryConcurrency;
    const recovered = new Set<string>();
    const failed = new Set<string>();
    let cursor = 0;
    const workers: Promise<void>[] = [];
    const runOne = async (): Promise<void> => {
      while (cursor < records.length) {
        const idx = cursor++;
        const record = records[idx]!;
        try {
          const ok = await this._recoverOneSession(record);
          if (ok) recovered.add(record.sessionId);
          else failed.add(record.sessionId);
        } catch (e) {
          // 不应到此（_recoverOneSession 内已 try/catch），防御性兜底。
          this._logger.error('session_recover_unexpected_error', {
            session_id: record.sessionId,
            error: e,
          });
          failed.add(record.sessionId);
        }
      }
    };
    for (let i = 0; i < Math.min(limit, records.length); i++) {
      workers.push(runOne());
    }
    await Promise.all(workers);

    // 全部完成后 flush：清 currentRunId / 移除失败与 rejected 记录。
    try {
      await this._sessionManager.flush();
    } catch (e) {
      this._logger.warn('session_recover_flush_failed', { error: e });
    }
    this._logger.info('session_recover_done', {
      total: records.length,
      recovered: recovered.size,
      failed: failed.size,
    });
  }

  /**
   * 恢复单条记录（§5 单条流程）。返回 true=恢复成功（reconnecting→active），
   * false=该记录未恢复（终态/rejected/driver 抛错，已从持久化移除）。
   *
   * 失败隔离：本方法不抛错（所有异常内部 catch + 结构化日志），让调用方
   * 的并发循环继续处理其他记录。
   */
  private async _recoverOneSession(record: PersistedSessionRecord): Promise<boolean> {
    // daemon 注册的 runtime id（恢复对账需要）。取 record 对应 provider 的
    // 已注册 runtime；未注册 → 不恢复为 active（backend 会 reject）。
    const runtimeId = this._registeredRuntimes.get(record.provider) ?? '';
    if (!runtimeId) {
      this._logger.warn('session_recover_no_runtime', {
        session_id: record.sessionId,
        provider: record.provider,
      });
      // 仍向 backend 发 recover 让它收敛 currentRun（即使最后 rejected）。
    }

    let recoverStatus: SessionRecoverStatus;
    try {
      const resp = await this._recoveryClient!.recoverSession(record.sessionId, {
        leaseId: record.leaseId,
        runtimeId: runtimeId || (this._firstRegisteredRuntimeId() ?? ''),
        provider: record.provider,
        agentSessionId: record.agentSessionId,
        interruptedRunId: record.currentRunId,
      });
      recoverStatus = resp.status;
    } catch (e) {
      // recover 调用失败（网络等）：当条 fail，删记录，不复活。
      this._logger.error('session_recover_call_failed', {
        session_id: record.sessionId,
        error: e,
      });
      await this._markRecordRemoved(record);
      return false;
    }

    // backend 终态/rejected → 不调 restoreAndReconnect；删本地记录。
    if (recoverStatus !== 'reconnecting') {
      this._logger.info('session_recover_skipped', {
        session_id: record.sessionId,
        backend_status: recoverStatus,
      });
      await this._markRecordRemoved(record);
      return false;
    }

    // backend reconnecting → driver.start({resume}) 跨进程恢复（spike D3）。
    try {
      await this._sessionManager!.restoreAndReconnect(record);
    } catch (e) {
      // restoreAndReconnect 抛错（cwd 不一致 / executable 缺失 / SDK jsonl 缺失）：
      // session 已被 SessionManager 从内存 store 移除 + onSessionEnd(failed)。
      // 这里向 backend 写 reconnecting→failed + 删记录。继续其他记录。
      this._logger.error('session_restore_failed', {
        session_id: record.sessionId,
        error: e,
      });
      await this._notifyRecoveryFailed(record);
      await this._markRecordRemoved(record);
      return false;
    }

    // P1-1（2026-06-18）：去掉 stillAlive 短路判断。
    // 原逻辑用 `sessionManager.get(sessionId) !== undefined` 判断 driver 是否异步
    // onError 失败，但 driver.start 同步返回且 consume 是 fire-and-forget 协程，
    // 异步 onError 在本同步点尚未触发 → stillAlive 恒 true，短路判断无效。
    // 恢复成功只以 markReconnected 成功为准；恢复后**异步**的 driver onError →
    // SessionManager.fail → onSessionEnd(failed) 由 markRecoveredSessionFailed
    // 桥接到 backend markRecoveryFailed（见该方法注释）。

    // 恢复成功：reconnecting → active；向 backend confirm。
    try {
      await this._sessionManager!.markReconnected(record.sessionId);
    } catch (e) {
      this._logger.warn('session_mark_reconnected_failed', {
        session_id: record.sessionId,
        error: e,
      });
      await this._notifyRecoveryFailed(record);
      await this._markRecordRemoved(record);
      return false;
    }
    try {
      await this._recoveryClient!.confirmReconnected(record.sessionId);
    } catch (e) {
      // confirm 失败：本地已 active，但 backend 仍 reconnecting。由 task-07
      // 空闲扫描或人工 end 收口（§7 边界 5）。记 warn 不回滚本地 active。
      this._logger.warn('session_confirm_reconnected_failed', {
        session_id: record.sessionId,
        error: e,
      });
    }
    // P1-1：登记到恢复成功集合，让后续异步 fail 能桥接到 backend markRecoveryFailed。
    this._recoveredSessionIds.add(record.sessionId);
    // 恢复成功后 flush（清 currentRunId）。
    try {
      await this._sessionManager!.flush();
    } catch {
      /* flush 失败不影响 session 运行（恢复索引非运行依赖） */
    }
    this._logger.info('session_recovered', { session_id: record.sessionId });
    return true;
  }

  /**
   * P1-1（2026-06-18）：恢复成功后**异步** driver onError → SessionManager.fail
   * → onSessionEnd(failed) 的桥接入口。
   *
   * SessionManager 的 onSessionEnd 回调由外部注入（cli.ts / 测试）。当回调收到
   * status='failed' 且 sessionId 属于本 daemon 恢复成功的集合时，注入方应调用本
   * 方法，daemon 据此向 backend 发 markRecoveryFailed（让 reconnecting/active
   * session 收敛为 failed，不卡在 reconnecting）。
   *
   * 非 recovered session（正常创建后 fail）调用本方法是 no-op（集合不含）。
   * 幂等：集合 delete 重复安全；markRecoveryFailed 失败只记 warn 不抛。
   */
  async markRecoveredSessionFailed(sessionId: string): Promise<void> {
    if (!this._recoveredSessionIds.has(sessionId)) return;
    this._recoveredSessionIds.delete(sessionId);
    if (!this._recoveryClient) return;
    try {
      await this._recoveryClient.markRecoveryFailed(sessionId);
    } catch (e) {
      this._logger.warn('recovered_session_fail_notify_failed', {
        session_id: sessionId,
        error: e,
      });
    }
  }

  /** 向 backend 通知恢复失败（reconnecting → failed）。失败本身静默（不复活）。 */
  private async _notifyRecoveryFailed(record: PersistedSessionRecord): Promise<void> {
    if (!this._sessionManager || !this._recoveryClient) return;
    try {
      // SessionManager.fail 已被 restoreAndReconnect 抛错路径或 onError 路径调用
      //（onSessionEnd(failed)），这里幂等再调一次（fail 内部幂等）+ 通知 backend。
      await this._sessionManager.fail(record.sessionId);
    } catch {
      /* fail 幂等，session 可能已不在 store */
    }
    try {
      await this._recoveryClient.markRecoveryFailed(record.sessionId);
    } catch (e) {
      this._logger.warn('session_mark_recovery_failed_call_failed', {
        session_id: record.sessionId,
        error: e,
      });
    }
  }

  /**
   * 把单条记录从持久化集合移除（终态/rejected/driver 抛错路径）。
   *
   * 实现：直接调 persistence.save，写入 SessionManager.snapshotPersistable()
   * 的结果（已恢复成功的 session 仍在；失败/终态的 session 因不在 _store
   * 而被自动剔除）。不依赖 SessionManager.flush 的 microtask 去抖，保证启动
   * 编排路径同步落盘正确的「移除后」状态。
   */
  private async _markRecordRemoved(record: PersistedSessionRecord): Promise<void> {
    if (!this._persistence || !this._sessionManager) return;
    try {
      const remaining = this._sessionManager.snapshotPersistable();
      await this._persistence.save(remaining);
    } catch (e) {
      this._logger.warn('session_mark_removed_flush_failed', {
        session_id: record.sessionId,
        error: e,
      });
    }
  }

  // ── Wave2 task-04 gap-1：interactive session 桥接 deps → hubClient ─────────
  //
  // 调用链（design §6）：
  //   SessionManager._onResult/_onMessage/end/fail
  //   → deps.onTurnResult/onTurnMessage/onSessionEnd（cli.ts 注入的闭包，延迟绑定 daemon）
  //   → daemon.onTurnResult/onTurnMessage/onSessionEnd（以下三方法）
  //   → hubClient.notifyRunResult/submitMessages/notifySessionEnd
  //   → backend close_interactive_run / submitMessages / end_session
  //
  // 边界（R-bridge）：state 不存在 / sessionManager null → warn 不抛（不崩 daemon）。
  // hubClient 抛错 → warn 不向上抛（SessionManager 调用方不感知 backend 故障，
  // daemon 主循环 / consume 协程继续运行）。

  /**
   * gap-3 桥接：上报 interactive AgentRun 终态（SDK result）。
   *
   * 查 SessionState（this._sessionManager.get），取 leaseId + claimToken + runId，
   * 调 hubClient.notifyRunResult → backend close_interactive_run。
   *
   * payload 字段对齐 backend InteractiveRunResultRequest：
   *   - status：SDK result.subtype（'success' | 'error_during_execution' | 其他）
   *   - is_error：SDK result.is_error
   *   - subtype：SDK result.subtype（可选）
   *   - result_summary：可读摘要（可选，SDK result.result 字段截断）
   *
   * 边界：
   *   - sessionManager 为 null（AC-14 过渡期）→ warn 不抛；
   *   - state 不存在（session 已结束 / 迟到 result）→ warn 不抛，不调 notifyRunResult；
   *   - state.claimToken 空（恢复路径占位，design §恢复链路）→ warn 不抛；
   *   - hubClient.notifyRunResult 抛错 → warn 不向上抛。
   *
   * @param sessionId  AgentSession.id
   * @param runId  当前 turn 的 AgentRun.id（SessionManager 已切 active 时由调用方传）
   * @param result  SDK SDKResultMessage
   */
  async onTurnResult(
    sessionId: string,
    runId: string,
    // task-06（design §5.4.4）：放宽为 provider-neutral 联合。Claude driver 传
    // SDKResultMessage；Codex driver 传 InteractiveDriverResult（flat：subtype/is_error/
    // total_cost_usd/usage）。下方字段提取用 `as SDKResultMessage & {...}` duck-typing，
    // 两种 provider 都兼容（字段不存在则 undefined，不写 payload）。
    result: SDKResultMessage | InteractiveDriverResult,
  ): Promise<void> {
    if (!this._sessionManager) {
      this._logger.warn('on_turn_result_no_manager', { session_id: sessionId });
      return;
    }
    const state = this._sessionManager.get(sessionId);
    if (!state) {
      this._logger.warn('on_turn_result_session_not_found', {
        session_id: sessionId,
      });
      return;
    }
    if (!state.claimToken) {
      this._logger.warn('on_turn_result_no_claim_token', {
        session_id: sessionId,
        lease_id: state.leaseId,
      });
      return;
    }
    // payload 字段映射（snake_case 对齐 backend InteractiveRunResultRequest）。
    // SDKResultSuccess 含 total_cost_usd / num_turns / duration_ms / duration_api_ms /
    // usage.{input_tokens,output_tokens}（见 sdk.d.ts SDKResultSuccess 类型）；
    // interactive 路径原先丢弃这些字段导致 AgentRun 全 NULL（对齐 batch
    // task-runner extractResultStats）。
    const resultMeta = result as SDKResultMessage & {
      subtype?: string;
      is_error?: boolean;
      result?: unknown;
      total_cost_usd?: number;
      num_turns?: number;
      duration_ms?: number;
      duration_api_ms?: number;
      // task-16：usage 字段名映射点 —— Anthropic SDK 全名 cache_*_input_tokens，
      // 提取处映射为短名 cache_*_tokens（对齐 backend 列 / _METADATA_FIELDS）。
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
    const status = resultMeta.subtype ?? 'success';
    const isError = resultMeta.is_error === true;
    const payload: {
      status: string;
      is_error: boolean;
      subtype?: string;
      result_summary?: string;
      total_cost_usd?: number;
      num_turns?: number;
      duration_ms?: number;
      duration_api_ms?: number;
      input_tokens?: number;
      output_tokens?: number;
      // task-16：cache 两维（短名），SDK 全名在此处映射注入。
      cache_read_tokens?: number;
      cache_creation_tokens?: number;
    } = {
      status,
      is_error: isError,
    };
    if (resultMeta.subtype !== undefined) {
      payload.subtype = resultMeta.subtype;
    }
    // 可读摘要：result.result 可能是 string / object，截断后送 backend redact 存储。
    if (resultMeta.result !== undefined) {
      const raw =
        typeof resultMeta.result === 'string'
          ? resultMeta.result
          : JSON.stringify(resultMeta.result);
      payload.result_summary = raw.length > 500 ? `${raw.slice(0, 500)}...` : raw;
    }
    // SDKResultSuccess 透传（undefined 字段不写，保留 backend AgentRun 原值）。
    if (typeof resultMeta.total_cost_usd === 'number') {
      payload.total_cost_usd = resultMeta.total_cost_usd;
    }
    if (typeof resultMeta.num_turns === 'number') {
      payload.num_turns = resultMeta.num_turns;
    }
    if (typeof resultMeta.duration_ms === 'number') {
      payload.duration_ms = resultMeta.duration_ms;
    }
    if (typeof resultMeta.duration_api_ms === 'number') {
      payload.duration_api_ms = resultMeta.duration_api_ms;
    }
    if (resultMeta.usage && typeof resultMeta.usage.input_tokens === 'number') {
      payload.input_tokens = resultMeta.usage.input_tokens;
    }
    if (resultMeta.usage && typeof resultMeta.usage.output_tokens === 'number') {
      payload.output_tokens = resultMeta.usage.output_tokens;
    }
    // task-16：cache 两维提取（Anthropic SDK 全名 → payload 短名映射）。
    // 全名 cache_*_input_tokens 来自 Claude SDK result.usage；映射为短名 cache_*_tokens
    //（对齐 backend agent_runs 列 / _METADATA_FIELDS）。typeof 'number' 守卫，
    // 字段缺失（codex/老 CLI）不 set → backend NULL（D-001@v1）。0 值合法不丢。
    if (
      resultMeta.usage &&
      typeof resultMeta.usage.cache_creation_input_tokens === 'number'
    ) {
      payload.cache_creation_tokens = resultMeta.usage.cache_creation_input_tokens;
    }
    if (
      resultMeta.usage &&
      typeof resultMeta.usage.cache_read_input_tokens === 'number'
    ) {
      payload.cache_read_tokens = resultMeta.usage.cache_read_input_tokens;
    }
    try {
      // task-12（FR-05 / D-005@v1）：终态上报包 retryTerminal 轻量重试（不暂存）。
      // _resilience 未注入 → 回退直接调 _client。用尽抛被下方 catch 兜住 warn。
      const call = (): Promise<unknown> =>
        this._client.notifyRunResult(state.leaseId, state.claimToken, runId, payload);
      if (this._resilience) {
        await this._resilience.retryTerminal(call);
      } else {
        await call();
      }
    } catch (e) {
      // backend 500 / 422 / 网络 → warn 不向上抛（SessionManager._onResult 不感知，
      // daemon 主循环继续）。run 关闭失败由 backend 兜底（lease 超时 / SSE 重连）。
      this._logger.warn('on_turn_result_notify_failed', {
        session_id: sessionId,
        lease_id: state.leaseId,
        run_id: runId,
        error: e,
      });
    }

    // task-06（FR-05 / D-002@v1）：scan run 终态额外触发 spec 树回灌（独立于 session end）。
    // scan/stage 跑在长生命周期 interactive session（scan 期 session 永不 end），仅靠
    // onSessionEnd 兜底会导致 scan-docs/knowledge/.runtime 一直不可见；此处终态点立即回灌。
    // 仅 scan/stage interactive 有 specSyncCtx（quick-chat/shared 不 set → syncSpecTreeIfNeeded no-op）。
    // 幂等：apply_sync 整树覆写（D-006@v1），与后续 onSessionEnd double-sync 无害；终态点不
    // delete ctx，留给 onSessionEnd 兜底再同步一次。
    await syncSpecTreeIfNeeded(
      this._interactiveSpecSyncCtx.get(state.leaseId) ?? null,
      this._client as never,
    );
  }

  /**
   * 桥接：增量上报 agent 执行消息（流式）。
   *
   * 查 SessionState，调 hubClient.submitMessages(leaseId, claimToken, runId, [msg])
   * → backend SSE turn_progress。复用既有 submitMessages 端点（interactive + batch 共用）。
   *
   * 边界同 onTurnResult：state 不存在 / claimToken 空 / submitMessages 抛错 → warn 不抛。
   *
   * @param sessionId  AgentSession.id
   * @param runId  当前 turn 的 AgentRun.id
   * @param msg  SDK SDKMessage
   */
  async onTurnMessage(
    sessionId: string,
    runId: string,
    // task-06（design §5.4.4）：放宽为 provider-neutral 联合。Claude driver 传
    // SDKMessage（{type:'assistant'|'user'|..., message:{usage}}）；Codex driver 传
    // InteractiveDriverMessage（= Record<string,unknown>，flat：{event_type, content,
    // metadata, session_id}）。下方 duck-typing 按 type/event_type 分流提取。
    msg: SDKMessage | InteractiveDriverMessage,
  ): Promise<void> {
    if (!this._sessionManager) {
      this._logger.warn('on_turn_message_no_manager', { session_id: sessionId });
      return;
    }
    const state = this._sessionManager.get(sessionId);
    if (!state) {
      this._logger.warn('on_turn_message_session_not_found', {
        session_id: sessionId,
      });
      return;
    }
    if (!state.claimToken) {
      this._logger.warn('on_turn_message_no_claim_token', {
        session_id: sessionId,
        lease_id: state.leaseId,
      });
      return;
    }
    if (!runId) {
      // ql-004：空 runId（''/undefined）不发 submitMessages，避免空 agent_run_id
      // 触发 backend 422 风暴（每请求 auth 占连接 → 连接池耗尽）。
      this._logger.warn('on_turn_message_empty_run_id', {
        session_id: sessionId,
        lease_id: state.leaseId,
      });
      return;
    }
    try {
      const fwdMsg = msg as unknown as Record<string, unknown>;
      const msgType = fwdMsg['type'];
      // ql-20260627-usage（实时 token 透传）：通用 usage lift，提到 if/else 之外。
      // 两类消息都可能携带 usage：
      //   1) session-manager flush 产出的 flat 消息（[THINKING]/[ASSISTANT]）——
      //      message_delta.usage 已注入顶层 fwdMsg['usage']（partial 实时计费）。
      //   2) Claude SDK assistant 完整消息——usage 嵌套在 msg.message.usage。
      // 统一提到顶层并做 Anthropic 全名（cache_*_input_tokens）→ 短名（cache_*_tokens）
      // 映射，让 backend submit_messages 实时更新 AgentRun token，不必等 result 汇总。
      // task-16：复制一份再映射，不修改原 usage 对象（adapter 产，只读）；全名缺失 →
      // 短名也不 set（backend NULL，D-001@v1）。
      let liftedUsage = fwdMsg['usage'] as Record<string, unknown> | undefined;
      if (!liftedUsage && msgType === 'assistant') {
        // assistant 完整消息：usage 嵌套在 message.usage，先取出（message_delta 未及时
        // flush 被 _clearPartialBufferSync 清掉时的兜底终态来源）。
        const inner = fwdMsg['message'] as Record<string, unknown> | undefined;
        liftedUsage = inner?.['usage'] as Record<string, unknown> | undefined;
      }
      if (liftedUsage && typeof liftedUsage['input_tokens'] === 'number') {
        const lifted: Record<string, unknown> = { ...liftedUsage };
        if (
          typeof lifted['cache_creation_input_tokens'] === 'number' &&
          lifted['cache_creation_tokens'] === undefined
        ) {
          lifted['cache_creation_tokens'] = lifted['cache_creation_input_tokens'];
        }
        if (
          typeof lifted['cache_read_input_tokens'] === 'number' &&
          lifted['cache_read_tokens'] === undefined
        ) {
          lifted['cache_read_tokens'] = lifted['cache_read_input_tokens'];
        }
        fwdMsg['usage'] = lifted;
      }
      // task-06（Reverse Sync / design §5.3 第 6 点）：Codex flat message 的
      // thread_started 事件携带 session_id=threadId。daemon 提取并记日志，便于
      // 追踪 Codex thread 与 AgentSession 的绑定；flat message 原样 submitMessages
      // 透传，backend submit_messages 现有逻辑据 message.session_id 写回
      // AgentRun.session_id（ql-20260617-001）。AgentSession.agent_session_id 的对齐
      // 由 session-manager _onMessage 写 state.agentSessionId（供落盘/恢复）。
      const eventType = fwdMsg['event_type'];
      if (typeof eventType === 'string' && eventType !== undefined) {
        const metadata = fwdMsg['metadata'] as Record<string, unknown> | undefined;
        const subtype = metadata?.['subtype'];
        const flatSessionId = fwdMsg['session_id'];
        if (subtype === 'thread_started' && typeof flatSessionId === 'string' && flatSessionId) {
          this._logger.info('interactive_codex_thread_started', {
            session_id: sessionId,
            lease_id: state.leaseId,
            thread_id: flatSessionId,
            provider: state.provider,
          });
        }
      }
      // task-10（FR-04 / D-005@v1）：interactive submit 走退避重试。
      // _resilience 未注入 → 回退直接调 _client（无重试，向后兼容）。
      // dedup_key：Claude msg.id 优先（dedupKeyFor），无则 runId 兜底（interactive 单条，
      // 无显式 seq 计数，task-16 用 runId+timestamp 确定性兜底）。
      if (this._resilience) {
        const envelope: Envelope = {
          message: fwdMsg,
          dedup_key: dedupKeyFor(fwdMsg, runId),
        };
        await this._resilience.submitWithRetry(
          state.leaseId,
          state.claimToken,
          runId,
          [envelope],
        );
      } else {
        await this._client.submitMessages(
          state.leaseId,
          state.claimToken,
          runId,
          [fwdMsg],
        );
      }
    } catch (e) {
      // task-02（FR-01）：展开底层 cause，让 fetch failed 暴露 ECONNREFUSED/
      // ENOTFOUND/ETIMEDOUT/证书错误等 undici code，而非仅 "fetch failed"。
      this._logger.warn('on_turn_message_submit_failed', {
        session_id: sessionId,
        lease_id: state.leaseId,
        run_id: runId,
        message: (e as Error | undefined)?.message ?? String(e),
        cause: extractCause(e),
      });
    }
  }

  /**
   * gap-4 桥接：上报 interactive session 终态（end / idle 30min / fail）。
   *
   * 调 hubClient.notifySessionEnd(sessionId, status, reason) → backend end_session
   *（daemon 入口，api-key 鉴权，区别前端 user JWT）。backend 端幂等（已 ended → no-op）。
   *
   * reason 推导：
   *   - status='ended'：正常收口（手动 end / idle 30min）。idle 路径在 SessionManager
   *     _onIdleExpire 走 end → onSessionEnd('ended')，daemon 此处统一 'manual' 占位
   *     （idle vs manual 的精确区分在 SessionManager 调用方语义，daemon 桥接不感知）。
   *   - status='failed'：driver onError / 不可恢复异常。reason 含 'error'。
   *
   * **幂等**：SessionManager.end/fail 自身幂等（已 ended/failed 不重复调 onSessionEnd），
   * daemon 此处只在 SessionManager 触发时转发；backend notifySessionEnd 自身幂等
   *（重复调用安全，design §5 已声明）。
   *
   * **不依赖 state**：session 终态时 state 仍在 store（end/fail 不从 store 移除，
   * task-10 flush 后 snapshotPersistable 过滤掉终态记录），但 notifySessionEnd 是
   * session 级通知（api-key 鉴权），不需要 claim_token，故不读 state.claimToken。
   *
   * 边界：
   *   - sessionManager null → warn 不抛（仍可调 notifySessionEnd，但 daemon 选择 ?. 兜底
   *     不调，避免无 sessionManager 上下文时无意义通知；AC-14 过渡期一致）；
   *   - notifySessionEnd 抛错 → warn 不向上抛。
   *
   * @param sessionId  AgentSession.id
   * @param status  'ended'（正常 / idle）/ 'failed'（driver error）
   */
  async onSessionEnd(
    sessionId: string,
    status: SessionStatus,
  ): Promise<void> {
    // status 收敛：reconnecting 等中间态不应进此路径（SessionManager 仅在 end/fail 调）。
    // 防御性：非 ended/failed 的 status 视为 ended 兜底（backend 接受 SessionStatus）。
    const mappedStatus: 'ended' | 'failed' =
      status === 'failed' ? 'failed' : 'ended';
    const reason =
      mappedStatus === 'failed'
        ? 'driver_error'
        : 'manual';
    try {
      // task-12（FR-05 / D-005@v1）：终态上报包 retryTerminal 轻量重试（不暂存）。
      // _resilience 未注入 → 回退直接调 _client。用尽抛被下方 catch 兜住 warn。
      const call = (): Promise<unknown> =>
        this._client.notifySessionEnd(sessionId, mappedStatus, reason);
      if (this._resilience) {
        await this._resilience.retryTerminal(call);
      } else {
        await call();
      }
    } catch (e) {
      this._logger.warn('on_session_end_notify_failed', {
        session_id: sessionId,
        status: mappedStatus,
        error: e,
      });
    }

    // task-06（D-003@v1 tar 模式 sync / R-07 时序）：在 notifySessionEnd **之后**触发。
    // session 须真正结束（driver 已退出、SessionManager 已 end/fail）后才回传，避免
    // 回传时 sillyspec 还在写文件导致 tar 不完整。即便 notifySessionEnd 失败（warn），
    // 仍继续尝试 sync——sync 尽力而为，失败也仅 warn（R-03）。shared 模式无 specSyncCtx →
    // 跳过（D-004）。
    await this._postInteractiveSpecSync(sessionId);

    // 清理 _interactiveSessionsByLease（防内存泄漏）。
    // SESSION_END WS 消息路径已在 _routeSessionControl 中 delete（line ~2022）；
    // 但 session 通过 idle 超时 / driver error / 手动 end 结束时只走本回调，
    // 不经过 SESSION_END WS 消息 → 条目泄漏。此处兜底清理（幂等，重复 delete 无副作用）。
    try {
      const state = this._sessionManager?.get(sessionId);
      if (state?.leaseId) {
        this._interactiveSessionsByLease.delete(state.leaseId);
      }
    } catch {
      // state 查不到（sessionManager 已 dispose 等极端情况）——忽略。
    }
  }

  /**
   * task-06：onSessionEnd 后置 spec 整树回传（tar 模式）。
   *
   * 反查路径：sessionId → sessionManager.get(sessionId).leaseId → _interactiveSpecSyncCtx
   * 取 workspaceId → postSpecSync。非 tar 模式 / pull 未登记 / sessionManager null → 跳过。
   *
   * 容错（R-03）：sync 失败仅 warn，不阻塞、不改写 session 终态（notifySessionEnd 已先行
   * 上报）；finally 内 delete specSyncCtx 保证 onSessionEnd 幂等（AC-09）。
   */
  private async _postInteractiveSpecSync(sessionId: string): Promise<void> {
    if (!this._sessionManager) return; // AC-14 过渡期
    let leaseId: string | undefined;
    try {
      const state = this._sessionManager.get(sessionId);
      leaseId = state?.leaseId;
    } catch (e) {
      this._logger.warn('interactive_spec_sync_state_lookup_failed', {
        session_id: sessionId,
        error: (e as Error)?.message ?? String(e),
      });
      return;
    }
    if (!leaseId) return; // 边界 10：state 查不到 / 无 leaseId
    const ctx = this._interactiveSpecSyncCtx.get(leaseId);
    if (!ctx) return; // 非 tar 模式 / pull 未登记 → 跳过（D-004 shared 现状）

    try {
      // task-06（D-002@v1）：改调 syncSpecTreeIfNeeded（ctx-guarded 薄封装，内部 try/catch
      // 仅 warn 不抛）。`as never`：见 _startInteractiveSession pull 处同款说明（ClientLike → HubClient）。
      await syncSpecTreeIfNeeded(ctx, this._client as never);
      this._logger.info('interactive_spec_sync_ok', {
        session_id: sessionId,
        lease_id: leaseId,
        workspace_id: ctx.workspaceId,
      });
    } catch (e) {
      // R-03 容错：sync 失败仅 warn，不阻塞、不改写 session 终态。
      //（syncSpecTreeIfNeeded 自身已 catch 不抛，此分支为防御性兜底；notifySessionEnd 已上报）
      this._logger.warn('interactive_spec_sync_failed', {
        session_id: sessionId,
        lease_id: leaseId,
        workspace_id: ctx.workspaceId,
        error: (e as Error)?.message ?? String(e),
      });
    } finally {
      // 幂等：二次 onSessionEnd 查不到 ctx 直接 return（AC-09 / 边界 9）。
      this._interactiveSpecSyncCtx.delete(leaseId);
    }
  }

  // ── 内部：_fire（AbortController 追踪，R7）─────────────────────────────────

  /**
   * 启动一个后台循环并追踪它的 AbortController + Promise。
   * 循环抛 AbortError 时静默吞掉（正常停止）；其他异常记日志。
   * task-04（FR-02）：非 AbortError 异常带退避自愈重启，防三循环崩了永久死。
   * 重启前双重检查 _running（sleep 前后），stop() 退出后不复活循环。
   *
   * 断路器（circuit-breaker）：连续崩溃超过 max_loop_restarts 次后停止重启，
   * 记 FATAL 日志。循环成功运行超过 loop_restart_backoff_ms 后计数器自动归零，
   * 避免偶发崩溃累积到上限。
   *
   * @param loop  后台循环函数
   * @param restartCount  当前连续重启次数（内部递归传递，外部调用省略）
   */
  private _fire(
    loop: (signal: AbortSignal) => Promise<void>,
    restartCount = 0,
  ): void {
    const controller = new AbortController();
    this._controllers.add(controller);
    const startedAt = Date.now();
    const p: Promise<void> = loop(controller.signal)
      .catch(async (e: unknown) => {
        if (e instanceof AbortError || (e as Error | undefined)?.name === 'AbortError') {
          return;
        }
        // 断路器：循环成功运行超过退避时间 → 重置计数器（瞬态故障，非持久性 bug）。
        const survivedMs = Date.now() - startedAt;
        const backoffMs = this._config.loop_restart_backoff_ms ?? 5000;
        const effectiveCount = survivedMs >= backoffMs ? 0 : restartCount;

        const nextCount = effectiveCount + 1;
        const maxRestarts = this._config.max_loop_restarts ?? 10;

        this._logger.error('loop_crashed', {
          error: e,
          restart_count: nextCount,
          max_restarts: maxRestarts,
          survived_ms: survivedMs,
        });

        // 断路器触发：连续崩溃超限 → 停止重启，记 FATAL。
        if (nextCount >= maxRestarts) {
          this._logger.error('loop_circuit_breaker_open', {
            restart_count: nextCount,
            max_restarts: maxRestarts,
            error: e,
          });
          this._restartStartedAt.delete(loop);
          return;
        }

        // task-04：自愈重启——仅当仍在运行时带退避重启，AbortError/已 stop 不重启。
        if (!this._running) return;
        this._restartStartedAt.set(loop, Date.now());
        try {
          await abortableSleep(backoffMs, controller.signal);
        } catch {
          // sleep 期间被 abort（stop 触发）——不再重启。
          this._restartStartedAt.delete(loop);
          return;
        }
        if (this._running) this._fire(loop, nextCount);
        else this._restartStartedAt.delete(loop);
      })
      .finally(() => {
        this._controllers.delete(controller);
        this._loopPromises.delete(p);
      });
    this._loopPromises.add(p);
  }

  // ── 心跳循环（daemon.py:164-179）───────────────────────────────────────────

  private async _heartbeatLoop(signal: AbortSignal): Promise<void> {
    while (this._running) {
      try {
        await abortableSleep(this._config.heartbeat_interval * 1000, signal);
        for (const rid of this._registeredRuntimes.values()) {
          try {
            const hbResp = await this._client.heartbeat(rid);
            // task-05（FR-03）：成功→清断连计数 + 告警标记，下次断连重新计时告警。
            this._heartbeatFailSince.delete(rid);
            this._degradedWarned.delete(rid);
            // task-18（FR-07 / D-004@v1）：心跳健康 → 触发 outbox drain（pending 非空时补发）。
            this._resilience?.notifyHeartbeatResult(true);
            // 2026-06-29-runtime-allowed-roots-config task-04：心跳响应同步 allowed_roots。
            this._syncAllowedRoots(rid, hbResp);
          } catch (e) {
            // 单个 rid 心跳失败不影响其他（daemon.py:172-177）
            // task-02（FR-01）：展开 cause 暴露底层 undici code。
            // task-05（FR-03 / D-006）：按 rid 累加断连时长，超阈值记一次 FATAL
            //   （运维感知），不主动调 offline——backend 45s 自然判 runtime offline，
            //   网络恢复后 heartbeat 自动拉回 online。
            if (!this._heartbeatFailSince.has(rid)) {
              this._heartbeatFailSince.set(rid, Date.now());
            }
            const elapsed = Date.now() - (this._heartbeatFailSince.get(rid) ?? Date.now());
            if (
              !this._degradedWarned.has(rid) &&
              elapsed >= this._config.disconnect_log_threshold_sec * 1000
            ) {
              this._logger.error('daemon_disconnect_degraded', {
                runtime_id: rid,
                elapsed_sec: Math.round(elapsed / 1000),
              });
              this._degradedWarned.add(rid);
            }
            this._logger.warn('heartbeat_failed', {
              runtime_id: rid,
              message: (e as Error | undefined)?.message ?? String(e),
              cause: extractCause(e),
            });
            // task-18：心跳失败 → 标记不健康（drainOutbox 不补发，等恢复）。
            this._resilience?.notifyHeartbeatResult(false);
          }
        }
      } catch (e) {
        if (e instanceof AbortError) break;
        // 非预期异常：记日志后继续循环（不崩）
        this._logger.warn('heartbeat_loop_error', { error: e });
      }
    }
  }

  /**
   * 2026-06-29-runtime-allowed-roots-config task-04：心跳响应同步 allowed_roots。
   *
   * **per-runtime map + 并集**（修 bug：多 runtime allowed_roots 不同时，
   * 单 runtime 覆盖全局 config 导致振荡——claude 配 F:/ 被 hermes 心跳覆盖丢失）。
   * daemon 一台机器一个沙箱，config.allowed_roots = 所有 runtime allowed_roots 并集。
   *
   * 向后兼容：响应无 allowed_roots 字段（旧 backend）→ 不动。
   */
  private readonly _allowedRootsByRuntime = new Map<string, string[]>();
  private _syncAllowedRoots(rid: string, resp: Record<string, unknown> | unknown): void {
    if (!resp || typeof resp !== 'object') return;
    const raw = (resp as Record<string, unknown>).allowed_roots;
    if (!Array.isArray(raw)) return; // 旧 backend 无字段 → 向后兼容
    // 展开 ~/.sillyhub 占位
    const expanded = raw
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.replace(/^~(?=$|[/\\])/, homedir()));
    this._allowedRootsByRuntime.set(rid, expanded);
    // 并集：所有 runtime allowed_roots + homedir 兜底
    const union = new Set<string>();
    for (const roots of this._allowedRootsByRuntime.values()) {
      for (const r of roots) union.add(r);
    }
    union.add(homedir());
    const normalized = normalizeAllowedRoots([...union]);
    // 仅在变化时覆盖（避免每心跳重复写对象引用）
    if (JSON.stringify(normalized) !== JSON.stringify(this._config.allowed_roots)) {
      this._config.allowed_roots = normalized;
      this._logger.info('allowed_roots_synced', { count: normalized.length, runtimes: this._allowedRootsByRuntime.size });
    }
  }

  // ── 轮询循环（daemon.py:183-215，HTTP 兜底）────────────────────────────────

  private async _pollLoop(signal: AbortSignal): Promise<void> {
    while (this._running) {
      try {
        await abortableSleep(this._config.poll_interval * 1000, signal);
        if (!this._taskRunner) continue; // daemon.py:188-189
        const allIds = [...this._registeredRuntimes.values()];
        for (const rid of allIds) {
          try {
            const pending = await this._client.getPendingLeases(rid);
            for (const task of pending) {
              const leaseId = task.lease_id as string | undefined;
              if (!leaseId) continue;
              this._logger.info('poll_task', { lease_id: leaseId });
              // poll payload 字段映射（daemon.py:199-206）：
              // 把 server 返回的 snake_case 组装成 LeaseCtx（camelCase）
              const payload: LeasePayload = {
                leaseId,
                runtimeId: rid,
                agentRunId: (task.agent_run_id as string | undefined) ?? undefined,
                prompt: (task.prompt as string | undefined) ?? undefined,
                provider: (task.provider as string | undefined) ?? undefined,
                cmdPath: (task.cmd_path as string | undefined) ?? undefined,
              };
              this._fire(() => this._executeTask(payload));
            }
          } catch (e) {
            this._logger.debug('poll_runtime_failed', { rid, error: e });
          }

          // task-11 / FR-08 / D-004@v1：change-write 轮询分支（与 lease 轮询同节奏，
          // 独立通道，**不走** _runLeaseStateMachine 的 claim→start→runLease→complete
          // lease 三段；走 claim→本地写→complete→spec 回灌轻量流，FR-10 不启 agent）。
          try {
            const writes =
              await this._client.getPendingChangeWrites(rid);
            for (const w of writes) {
              const taskId = w.task_id as string | undefined;
              if (!taskId) continue;
              this._fire(() => this._executeChangeWrite(taskId, rid, w));
            }
          } catch (e) {
            this._logger.debug('poll_change_writes_failed', {
              rid,
              error: e,
            });
          }
        }
      } catch (e) {
        if (e instanceof AbortError) break;
        this._logger.warn('poll_failed', { error: e });
      }
    }
  }

  // ── WS 循环（daemon.py:219-251，抽象为 WsClient 委托，R4.3）─────────────────

  private async _wsLoop(signal: AbortSignal): Promise<void> {
    // 每个 register 返回的 server runtime id 各建一条 WS（与心跳/轮询一致）。
    // WsClient 内部自动管理重连；daemon 每秒 reconcile 新注册的 runtime。
    while (this._running) {
      try {
        this._ensureWsClients();
        await abortableSleep(1000, signal);
      } catch (e) {
        if (e instanceof AbortError) break;
        this._logger.warn('ws_loop_error', { error: e });
        break;
      }
    }
  }

  /** Hub HTTP origin（WsClient 内部 http→ws / https→wss 转换）。 */
  private _serverOrigin(): string {
    return this._config.server_url.replace(/\/+$/, '');
  }

  private _registeredRuntimeIds(): string[] {
    return [...new Set(this._registeredRuntimes.values())].filter(Boolean);
  }

  private _firstRegisteredRuntimeId(): string | undefined {
    return this._registeredRuntimeIds()[0];
  }

  /**
   * scan 真阻塞（generic-wibbling-whisper.md 改造点 C）：发 WS 消息（PERMISSION_REQUEST）
   * 到 backend，供 SessionManager 的 permissionWsClient.send 调用。用首个已注册 runtime 的
   * WsClient（scan 单 runtime；backend 从 WS 连接识别 runtime_id）。连接未就绪 / 发送异常
   * → 返回 false（fail-closed，canUseTool 回调 deny，不让工具静默放行）。
   */
  sendToHub(msg: { type: string; payload: unknown }): boolean {
    const rid = this._firstRegisteredRuntimeId();
    if (!rid) {
      this._logger.warn('send_to_hub_no_runtime', { msg_type: msg.type });
      return false;
    }
    const ws = this._wsClients.get(rid);
    if (!ws || typeof ws.send !== 'function') {
      this._logger.warn('send_to_hub_no_ws', { msg_type: msg.type, runtime_id: rid });
      return false;
    }
    try {
      ws.send(msg);
      return true;
    } catch (e) {
      this._logger.warn('send_to_hub_failed', {
        msg_type: msg.type,
        error: (e as Error)?.message ?? String(e),
      });
      return false;
    }
  }

  /** 为每个 server 分配的 runtime id 确保存在 WS 连接。 */
  private _ensureWsClients(): void {
    const registeredIds = this._registeredRuntimeIds();
    if (registeredIds.length === 0) {
      this._closeAllWsClients();
      return;
    }

    for (const rid of [...this._wsClients.keys()]) {
      if (!registeredIds.includes(rid)) {
        try {
          this._wsClients.get(rid)?.close();
        } catch (e) {
          this._logger.warn('ws_close_failed', { runtime_id: rid, error: e });
        }
        this._wsClients.delete(rid);
      }
    }

    const serverUrl = this._serverOrigin();
    for (const runtimeId of registeredIds) {
      if (this._wsClients.has(runtimeId)) continue;

      const ws = this._wsClientFactory({
        serverUrl,
        runtimeId,
        callbacks: {
          onMessage: (msg) => {
            void this._handleWsMessage(msg);
          },
          // task-18（FR-07 / D-004@v1）：WS 重连成功 → 触发 outbox drain（补发断连期间暂存的消息）。
          onConnected: () => {
            void this._resilience?.drainOutbox();
          },
        },
      });
      this._registerListDirRpcHandler(ws, runtimeId);
      this._registerGetSpecBundleRpcHandler(ws, runtimeId);

      try {
        ws.connect();
      } catch (e) {
        this._logger.warn('ws_connect_failed', { runtime_id: runtimeId, error: e });
      }

      this._wsClients.set(runtimeId, ws);
      this._logger.info('ws_client_created', { runtime_id: runtimeId });
    }
  }

  private _registerListDirRpcHandler(ws: WsClientLike, runtimeId: string): void {
    if (typeof ws.registerRpcHandler !== 'function') {
      this._logger.warn('ws_no_rpc_support', { runtime_id: runtimeId });
      return;
    }
    ws.registerRpcHandler('list_dir', async (params) => {
      const path = typeof params.path === 'string' ? params.path : '';
      return listDir(path, this._config.allowed_roots);
    });
  }

  /**
   * 2026-06-30：spec import RPC——backend 经 WS RPC 让 daemon 打包客户端
   * rootPath/.sillyspec 整树为 tar，base64 编码回传。backend apply_sync 写入 spec_root。
   * daemon-client workspace 的 root_path 是宿主机路径（F:\WorkNew\SillyHub），daemon 可访问。
   */
  private _registerGetSpecBundleRpcHandler(ws: WsClientLike, runtimeId: string): void {
    if (typeof ws.registerRpcHandler !== 'function') return;
    ws.registerRpcHandler('get_spec_bundle', async (params) => {
      const rootPath = typeof params.root_path === 'string' ? params.root_path : '';
      if (!rootPath) throw new Error('root_path required for get_spec_bundle');
      const specDir = join(rootPath, '.sillyspec');
      const { packSpecDir } = await import('./spec-sync.js');
      // ql-20260701-002：排除 .runtime（运行时缓存含 worktrees 2.1G，非 spec 数据）。
      // D-002（2026-07-01-spec-import-async-and-change-reparse）：撤销 ql-003 的
      // excludeNames:['changes'] 误判——changes 是变更中心依赖（ChangeService.reparse 解析
      // 填 Change 表），必须导入。打包慢改由 backend import SSE 异步化解决，而非排除数据。
      // postSpecSync 回灌路径不受影响（不传此选项，保持含 .runtime）。
      const tarBuf = await packSpecDir(specDir, { excludeRuntime: true });
      return { tar_base64: tarBuf.toString('base64') };
    });
  }

  private _closeAllWsClients(): void {
    for (const [rid, ws] of this._wsClients) {
      try {
        ws.close();
      } catch (e) {
        this._logger.warn('ws_close_failed', { runtime_id: rid, error: e });
      }
    }
    this._wsClients.clear();
  }

  // ── 事件分发（daemon.py:253-267）───────────────────────────────────────────

  private async _handleWsMessage(msg: DaemonMessage): Promise<void> {
    const msgType = msg.type;
    // ql-20260616-006：backend WS 发 snake_case (lease_id/runtime_id/task_id)，
    // daemon 内部统一用 camelCase (LeasePayload/LeaseCtx)。在分发前做一次归一化，
    // 让 _executeTask 不再因字段名不匹配而 task_no_lease_id 丢任务。
    const rawPayload = (msg.payload ?? {}) as Record<string, unknown>;
    const payload: LeasePayload = {
      ...((rawPayload as unknown) as LeasePayload),
      leaseId:
        (rawPayload.leaseId as string | undefined) ??
        (rawPayload.lease_id as string | undefined) ??
        '',
      runtimeId:
        (rawPayload.runtimeId as string | undefined) ??
        (rawPayload.runtime_id as string | undefined) ??
        this._firstRegisteredRuntimeId() ??
        this._config.runtime_id,
      agentRunId:
        (rawPayload.agentRunId as string | undefined) ??
        (rawPayload.agent_run_id as string | undefined),
    };
    switch (msgType) {
      case MSG.TASK_AVAILABLE: {
        this._logger.info('task_available', { lease_id: payload.leaseId });
        if (!this._taskRunner) {
          this._logger.warn('task_available_no_runner');
          return;
        }
        // 非阻塞分发：_fire 立即返回，WS 接收下一条不受影响（R5）
        this._fire(() => this._executeTask(payload));
        break;
      }
      case MSG.HEARTBEAT_ACK: {
        this._logger.debug('heartbeat_ack', { payload });
        break;
      }
      // task-04：交互式会话控制消息（SESSION_INJECT/INTERRUPT/END）路由到 SessionManager。
      case MSG.SESSION_INJECT:
      case MSG.SESSION_INTERRUPT:
      case MSG.SESSION_END:
      case MSG.SESSION_RESUME: {
        // 非阻塞分发（同 task_available 风格，不阻塞 WS 接收）。
        void this._routeSessionControl(msgType, rawPayload).catch((e) => {
          this._logger.error('session_control_failed', { type: msgType, error: e });
        });
        break;
      }
      // task-08（D-007@v1 / FR-07）：backend PERMISSION_RESPONSE → resolver.resolve
      // settle canUseTool 回调。session 不存在 / resolver 不存在 / unknown_request
      // 只 warn 丢弃（迟到 response，turn 已结束）；不断 WS、不崩。
      case MSG.PERMISSION_RESPONSE: {
        void this._routePermissionResponse(rawPayload).catch((e) => {
          this._logger.error('permission_response_failed', { error: e });
        });
        break;
      }
      // Server → Daemon：服务端判定 daemon 版本落后后推送的自更新指令。
      // 复用 preflight 的 runDaemonSelfUpdate 下载 + 原子替换 bundle，成功后
      // 优雅退出等外部 supervisor（install.sh wrapper）重启拉起新版本。
      case MSG.SELF_UPDATE: {
        const payload = (msg as { payload?: { version?: string } }).payload;
        this._logger.info('self_update_received', {
          version: payload?.version,
        });
        try {
          // 复用 preflight 的自更新逻辑（下载 + 替换 bundle 文件）
          const { runDaemonSelfUpdate } = await import('./preflight.js');
          await runDaemonSelfUpdate(BUILD_ID, this._config, (level, m, data) => {
            // 适配 PreflightLogger 的 (level,msg,data) 签名为内部 Logger 方法
            this._logger[level](m, data);
          });
          this._logger.info('self_update_done', { version: payload?.version });
          // 替换成功 → 优雅退出，等外部 supervisor 重启
          this._logger.info('self_update_restart', {});
          setTimeout(() => process.exit(0), 500); // 给日志 flush 500ms
        } catch (e) {
          this._logger.warn('self_update_failed', {
            error: (e as Error)?.message ?? String(e),
          });
        }
        break;
      }
      default: {
        this._logger.warn('unknown_message_type', { type: msgType });
      }
    }
  }

  /**
   * task-04：路由 SESSION_INJECT/INTERRUPT/END 到 SessionManager。
   *
   * 字段名兼容 snake_case（backend WS 发 session_id/lease_id/run_id/prompt）。
   * 校验：session 存在 + lease_id 与 store 中 state.leaseId 匹配，否则 warn 丢弃
   *（边界 6）。未注入 sessionManager → warn 不崩（AC-14）。
   */
  private async _routeSessionControl(
    msgType: string,
    raw: Record<string, unknown>,
  ): Promise<void> {
    if (!this._sessionManager) {
      this._logger.warn('session_control_no_manager', { type: msgType });
      return;
    }
    // task-08（session-history-enhance / FR-2）：SESSION_RESUME 在 session 尚未在
    // 内存 SessionStore 时到达（用户 reopen 历史 session），不能走下面 get(state)
    // + leaseId 匹配的 inject/end 校验路径——分流到 resume 分支。
    if (msgType === MSG.SESSION_RESUME) {
      await this._routeSessionResume(raw);
      return;
    }
    const sessionId =
      (raw.session_id as string | undefined) ?? (raw.sessionId as string | undefined) ?? '';
    const leaseId =
      (raw.lease_id as string | undefined) ?? (raw.leaseId as string | undefined) ?? '';
    if (!sessionId) {
      this._logger.warn('session_control_no_session_id', { type: msgType });
      return;
    }

    const state = this._sessionManager.get(sessionId);
    if (!state) {
      this._logger.warn('session_control_session_not_found', {
        type: msgType,
        session_id: sessionId,
      });
      return;
    }
    if (state.leaseId !== leaseId) {
      // 边界 6：lease 不匹配（防误操作他人 session），warn 丢弃不操作。
      this._logger.warn('session_control_lease_mismatch', {
        type: msgType,
        session_id: sessionId,
        expected_lease_id: state.leaseId,
        received_lease_id: leaseId,
      });
      return;
    }

    switch (msgType) {
      case MSG.SESSION_INJECT: {
        const runId =
          (raw.run_id as string | undefined) ?? (raw.runId as string | undefined) ?? '';
        const prompt = (raw.prompt as string | undefined) ?? '';
        if (!runId || !prompt) {
          this._logger.warn('session_inject_missing_fields', {
            session_id: sessionId,
            run_id: runId,
            prompt_len: prompt.length,
          });
          return;
        }
        // gap-8.4（design §11）：SESSION_INJECT 带 lease 级 claim_token（recover 后
        // rotated）。刷新 state.claimToken（恢复路径 restoreAndReconnect 占位空串），
        // 让后续 onTurnMessage（submitMessages）/ onTurnResult（notifyRunResult）能用新 token。
        const claimToken =
          (raw.claim_token as string | undefined) ?? (raw.claimToken as string | undefined) ?? '';
        if (claimToken) {
          await this._sessionManager.refreshClaimToken(sessionId, claimToken);
        }
        await this._sessionManager.inject(sessionId, prompt, runId);
        break;
      }
      case MSG.SESSION_INTERRUPT: {
        await this._sessionManager.interrupt(sessionId);
        break;
      }
      case MSG.SESSION_END: {
        await this._sessionManager.end(sessionId);
        this._interactiveSessionsByLease.delete(state.leaseId);
        break;
      }
      default: {
        this._logger.warn('session_control_unknown_type', { type: msgType });
      }
    }
  }

  /**
   * task-08（session-history-enhance / FR-2）：路由 backend SESSION_RESUME。
   *
   * 与 INJECT/INTERRUPT/END 不同：resume 时目标 session 尚未在内存 SessionStore
   *（已 end 或 daemon 进程重启），用 backend 下发的 agent_session_id 调
   * SessionManager.restoreAndReconnect（driver.start({resume}) 跨进程还原 SDK 上下文，
   * spike D3）→ 随后 markReconnected 切 active → backend 收 confirm 切 status=active。
   *
   * 字段名 snake/camel 双写归一化（与 SESSION_INJECT 同风格，ql-20260616-006）：
   * backend 发 snake_case（task-07），daemon 入口映射到 PersistedSessionRecord
   *（camelCase），避免字段名漂移导致丢 resume。
   *
   * 边界（task-08.md AC-05）：
   *   - payload 缺 session_id / agent_session_id → warn 丢弃，不 resume；
   *   - restoreAndReconnect 抛错（provider≠claude / session 已存在 / driver.start 失败）
   *     → 由上层 _handleWsMessage 的 void Promise catch 记 error，不崩主循环；
   *     restoreAndReconnect 内部已收敛 driver.start 抛错（onSessionEnd(failed)）。
   */
  private async _routeSessionResume(
    raw: Record<string, unknown>,
  ): Promise<void> {
    if (!this._sessionManager) {
      // 与 _routeSessionControl 同风格：防御未来其它调用路径 NPE。
      this._logger.warn('session_resume received but SessionManager unavailable');
      return;
    }
    const sessionId =
      (raw.session_id as string | undefined) ?? (raw.sessionId as string | undefined) ?? '';
    const leaseId =
      (raw.lease_id as string | undefined) ?? (raw.leaseId as string | undefined) ?? '';
    const agentSessionId =
      (raw.agent_session_id as string | undefined) ??
      (raw.agentSessionId as string | undefined) ??
      '';
    if (!sessionId || !agentSessionId) {
      // AC-05：缺 session_id / agent_session_id（无 SDK resume key）→ 拒绝 + warn。
      this._logger.warn('session_resume_missing_fields', {
        session_id: sessionId,
        agent_session_id: agentSessionId,
        lease_id: leaseId,
      });
      return;
    }
    const provider =
      ((raw.provider as string | undefined) ?? 'claude') === 'codex' ? 'codex' : 'claude';
    // backend reopen payload 不带 exe path；按归一化后的 provider 从 _agentPaths
    //（agent-detector 注册：create 时 _agentPaths.set(provider, path)）补齐，否则
    // restoreAndReconnect 内 exe = record.pathToAgentExecutable ??
    // pathToClaudeCodeExecutable ?? '' 拿到空串 → Codex driver start() 抛
    // CodexExecutableNotFoundError → reopen 失败（design §11 Codex reopen 验收）。
    // 字段同时填 pathToAgentExecutable（Codex driver 读）+ pathToClaudeCodeExecutable
    //（兼容名，SessionManager.restoreAndReconnect fallback）。
    const exePath = this._agentPaths.get(provider) ?? '';
    const record: PersistedSessionRecord = {
      sessionId,
      leaseId,
      agentSessionId,
      cwd: (raw.cwd as string | undefined) ?? '',
      provider,
      pathToClaudeCodeExecutable: exePath,
      pathToAgentExecutable: exePath,
      // backend reopen payload 不带 turnCount/lastActiveAt（非恢复必需），
      // 给合理默认：turnCount=0（新进程无内存计数），lastActiveAt=now。
      turnCount: 0,
      lastActiveAt: Date.now(),
    };
    // restoreAndReconnect 内部 new InputQueue + driver.start({resume}) + fire
    // consume 协程；成功返回后调 markReconnected 切 active（resume 是 daemon 主动
    // 触发的 reopen，无需 backend 二次 confirm）。
    await this._sessionManager!.restoreAndReconnect(record);
    await this._sessionManager!.markReconnected(sessionId);
    this._logger.info('session_resume_ok', { session_id: sessionId, lease_id: leaseId });
  }

  /**
   * task-08（D-007@v1 / FR-07）：路由 backend PERMISSION_RESPONSE 到 SessionManager
   * 当前 session 的 resolver.resolve，settle 对应 canUseTool 回调的 pending promise。
   *
   * 边界：
   *   - payload 非法（缺 request_id/decision 非 allow|deny）→ warn 丢弃，不抛；
   *   - session_id 不在 SessionStore → warn（迟到 response，turn 已结束），不抛；
   *   - resolver 不存在（manual_approval=false 或 session 无 resolver）→ warn 不抛；
   *   - resolver.resolve 返回 unknown_request / session_mismatch → warn（已记日志）。
   *
   * 字段名兼容 snake_case（backend WS 发 session_id/request_id/decision/message?）。
   */
  private async _routePermissionResponse(
    raw: Record<string, unknown>,
  ): Promise<void> {
    if (!this._sessionManager) {
      this._logger.warn('permission_response_no_manager');
      return;
    }
    const sessionId =
      (raw.session_id as string | undefined) ?? (raw.sessionId as string | undefined) ?? '';
    const requestId = (raw.request_id as string | undefined) ?? '';
    const decisionRaw = raw.decision;
    const message = raw.message as string | undefined;
    // onUserDialog 扩展：前端用户在对话卡上选择/填写的答案（仅当对应
    // PERMISSION_REQUEST 带 dialog_kind 时有意义）。透传给 resolver.resolve，
    // 由 onUserDialog 回调回喂 SDK UserDialogResult.result。
    const dialogResult =
      'dialog_result' in raw ? (raw as { dialog_result?: unknown }).dialog_result : undefined;

    // payload schema 非法（缺字段 / decision 非 allow|deny）→ warn 丢弃，不抛。
    if (!sessionId || !requestId || (decisionRaw !== 'allow' && decisionRaw !== 'deny')) {
      this._logger.warn('permission_response_invalid_payload', {
        session_id: sessionId,
        request_id: requestId,
        decision: decisionRaw,
      });
      return;
    }

    // session 不在 SessionStore → warn（迟到 response）。
    const state = this._sessionManager.get(sessionId);
    if (!state) {
      this._logger.warn('permission_response_unknown_session', {
        session_id: sessionId,
        request_id: requestId,
      });
      return;
    }

    const resolver = this._sessionManager.getPermissionResolver(sessionId);
    if (!resolver) {
      // manual_approval=false 或 session 无 resolver（已 end/fail）。
      this._logger.debug('permission_response_no_resolver', {
        session_id: sessionId,
        request_id: requestId,
      });
      return;
    }

    const result = resolver.resolve(
      {
        session_id: sessionId,
        request_id: requestId,
        decision: decisionRaw,
        ...(message !== undefined ? { message } : {}),
        ...(dialogResult !== undefined ? { dialog_result: dialogResult } : {}),
      },
      sessionId,
    );
    if (result !== 'resolved') {
      this._logger.warn('permission_response_not_resolved', {
        session_id: sessionId,
        request_id: requestId,
        result,
      });
    } else {
      this._logger.debug('permission_response_resolved', {
        session_id: sessionId,
        request_id: requestId,
        decision: decisionRaw,
      });
    }
  }

  /**
   * task-04（D-002@v3）：启动交互式会话。
   *
   * 与 batch 路径互斥：不调 startLease/completeLease（backend claim/start 时已处理），
   * 不调 TaskRunner.runLease。委托 SessionManager.create 建 session + 启动 driver 协程。
   *
   * 边界：
   *   - 未注入 sessionManager（AC-14 过渡期）：记 error 不崩，backend end_session 收 failed。
   *   - agent-detector 未检测 claude / _agentPaths 无 path（AC-07）：不调 create，
   *     记 CLAUDE_EXECUTABLE_NOT_FOUND，由 backend onSessionEnd 收 failed。
   *   - 重复 task_available 同 leaseId（AC-09）：_interactiveSessionsByLease 命中跳过。
   *   - SessionManager.create 抛错（executable 解析失败等）：记 error，不崩 daemon。
   */
  private async _startInteractiveSession(
    leaseId: string,
    execPayload: LeasePayload,
  ): Promise<void> {
    // AC-09：重复 task_available（WS 重连/重放）→ 跳过，driver 只启动一次。
    if (this._interactiveSessionsByLease.has(leaseId)) {
      this._logger.info('interactive_session_already_started', { lease_id: leaseId });
      return;
    }

    if (!this._sessionManager) {
      // AC-14 过渡期：未注入 SessionManager。kind=interactive 无法执行，记 error；
      // batch 路径完全不受影响。backend 据 lease 超时/WS 失活收 failed。
      this._logger.error('interactive_no_session_manager', { lease_id: leaseId });
      return;
    }

    const sessionId = execPayload.agentSessionId ?? '';
    const firstRunId = execPayload.agentRunId ?? '';
    let prompt = execPayload.prompt ?? '';
    // 路径映射：backend 在 Docker 容器内跑，spec_root 用容器内路径（如
    // /data/spec-workspaces/{id}）；daemon 跑在宿主机上（Windows/Mac），本地无 /data。
    // spec_root_map 格式 "from:to"，如 "/data/spec-workspaces:C:/data/spec-workspaces"。
    // 在 prompt 透传给 SessionManager.create 前，把 from 替换为 to。
    //
    // 数据源（task-02）：优先读 config.spec_root_map（loadConfig 已从 env SPEC_ROOT_MAP
    // 覆盖到 config），env 兜底（双保险）。详见 design §4.1 A1 第 2 层。
    //
    // 翻译逻辑抽为纯函数 translateSpecRoot（按首个 ':' 分割，避免 split(':',2)
    // 在 Windows 盘符场景把 to 截断成 'C'，见 task-02 边界 3 / AC-07）。
    const specRootMap = this._config.spec_root_map || process.env.SPEC_ROOT_MAP || '';
    if (specRootMap) {
      const colonIdx = specRootMap.indexOf(':');
      if (colonIdx < 0) {
        // AC-06：specRootMap 无冒号 → 跳过，记 warn（配置可能写错）
        this._logger.warn('interactive_spec_root_map_invalid', {
          lease_id: leaseId,
          spec_root_map: specRootMap,
        });
      } else {
        const from = specRootMap.slice(0, colonIdx);
        const to = specRootMap.slice(colonIdx + 1);
        const translated = translateSpecRoot(prompt, specRootMap);
        if (translated !== prompt) {
          // AC-02：翻译生效，记 info（含 from/to + prompt 摘要前 200 字符）
          this._logger.info('interactive_spec_root_translated', {
            lease_id: leaseId,
            from,
            to,
            prompt_before_snippet: prompt.slice(0, 200),
          });
          prompt = translated;
        } else if (from && to) {
          // 边界 2：prompt 不含 from → 跳过，记 debug（避免每次 interactive 刷 info）
          this._logger.debug('interactive_spec_root_not_matched', {
            lease_id: leaseId,
            from,
          });
        }
        // from/to 为空（specRootMap=':' 或 'from:' 或 ':to'）→ 静默跳过（不刷日志）
      }
    }
    // specRootMap 空串 → 完全跳过（向后兼容旧 daemon，AC-04）
    // rootPath 优先作 cwd（与 batch 一致，ql-20260617-009）；无则 workspace_dir 兜底。
    const cwd = execPayload.rootPath ?? this._config.workspace_dir;
    const provider = (execPayload.provider ?? 'claude') as 'claude' | 'codex';
    // task-06（D-002@v1）：executable path 按 provider 取。claude → claude CLI path；
    // codex → codex app-server path（agent-detector 探测后 _agentPaths.set('codex', path)）。
    // 字段名保留 pathToClaudeCodeExecutable（CreateSessionInput 兼容名，语义=provider
    // executable path；SessionManager.create 内部 fallback 到 pathToAgentExecutable）。
    const pathToClaudeCodeExecutable = this._agentPaths.get(provider) ?? '';

    if (!sessionId || !firstRunId || !prompt) {
      this._logger.error('interactive_missing_fields', {
        lease_id: leaseId,
        has_session_id: !!sessionId,
        has_run_id: !!firstRunId,
        has_prompt: !!prompt,
      });
      return;
    }

    if (!pathToClaudeCodeExecutable) {
      // task-06（FR-05 / D-002@v1）：provider 的 executable 缺失 → 拒绝启动。
      // 错误码 provider-specific（interactive_${provider}_executable_not_found），
      // 让日志/监控能区分 claude vs codex 缺失。不调 create；backend 据 lease 超时 /
      // WS 失活 / onSessionEnd 收 failed（与 Claude AC-07 同路径）。daemon 主循环不崩。
      this._logger.error(`interactive_${provider}_executable_not_found`, {
        lease_id: leaseId,
        provider,
        code: `${provider.toUpperCase()}_EXECUTABLE_NOT_FOUND`,
      });
      return;
    }

    // gap-8（interactive cwd 不存在导致 SDK spawn 失败）：daemon-client 交互会话
    // 没有 workspace → execPayload.rootPath 为空 → cwd 回落到 config.workspace_dir
    //（默认 ~/sillyhub_workspaces），该目录通常不存在。batch 路径由 TaskRunner 在
    // spawn 前 mkdir 工作目录（task-runner.ts），但交互路径（SessionManager→
    // ClaudeSdkDriver）从不创建 cwd，导致 SDK child_process.spawn 因 cwd 不存在
    // 立即失败（SDK 误报成 "native binary failed to launch"），session 秒挂
    // onError→fail→onSessionEnd，agent_session_id 永远为 null（实测复现）。
    // 修复：create 前确保 cwd 存在（与 batch 对齐）。失败仅 warn 不阻断——让 SDK
    // 的真实错误经 onError 收口，不在此吞掉诊断信息。
    try {
      await mkdir(cwd, { recursive: true });
    } catch (e) {
      this._logger.warn('interactive_cwd_mkdir_failed', {
        lease_id: leaseId,
        cwd,
        error: (e as Error)?.message ?? String(e),
      });
    }

    // gap-8（interactive 凭证 parity）：与 batch 一致用 buildSpawnEnv 构造子进程 env，
    // 让 driver 能读到 credentials.json 的 ANTHROPIC token（+ lease tool_config 占位符
    // 渲染）。未注入 credentialManager 时传 undefined，driver 回退裸 process.env（兼容）。
    let interactiveEnv: NodeJS.ProcessEnv | undefined;
    if (this._credentialManager) {
      interactiveEnv = buildSpawnEnv(
        { toolConfig: execPayload.toolConfig ?? {} },
        { credential: this._credentialManager },
      );
    }

    // 先登记 lease→session（即使 create 抛错也登记，防 create 失败后 WS 重放反复重试；
    // SessionManager.create 抛 SessionAlreadyExistsError 时 store 已无此 session，安全）。
    this._interactiveSessionsByLease.set(leaseId, sessionId);

    // task-06（D-003@v1 tar 模式 pull / R-07 时序）：在 _sessionManager.create（driver
    // spawn）**之前** await 完成。ClaudeSdkDriver 一旦 spawn 即开始跑 sillyspec scan/stage，
    // 读 --spec-root 指向的本地缓存目录（~/.sillyhub/daemon/specs/{ws}）——pull 须先完成才有
    // 内容可读。shared 模式（transport!=='tar'）跳过，bind mount 共享现状不变（D-004）。
    //
    // transport/workspaceId 读取：camelCase 优先 + snake_case 兜底，与 _runLeaseStateMachine
    // 归一化风格一致（types.ts 字段由 task-03 透传，此处只读，类型用 as 断言兼容未定义期）。
    const transport =
      (execPayload as { transport?: string }).transport ??
      (execPayload as { transport_mode?: string }).transport_mode ??
      'shared';
    const workspaceId =
      (execPayload as { workspaceId?: string }).workspaceId ??
      (execPayload as { workspace_id?: string }).workspace_id;
    // spec 同步策略 + 源项目路径（2026-06-28-daemon-client-spec-sync-strategy，D-001）：
    // daemon pullSpecBundle 据此三分支初始化缓存（platform-managed/repo-mirrored/repo-native）。
    // specStrategy 缺省（旧 lease/quick-chat）→ pullSpecBundle 内按 platform-managed 兼容。
    const specStrategy =
      (execPayload as { specStrategy?: string }).specStrategy ??
      (execPayload as { spec_strategy?: string }).spec_strategy;
    const specRootPath =
      (execPayload as { rootPath?: string }).rootPath ??
      (execPayload as { root_path?: string }).root_path;

    if (transport === 'tar') {
      if (!workspaceId) {
        // 边界 5：transport=tar 但 workspaceId 缺失 → task-03 透传链路异常，warn 不阻塞。
        this._logger.warn('interactive_spec_pull_no_workspace', {
          lease_id: leaseId,
        });
      } else {
        // task-11（D-010 日常保鲜）：pull 前比对 lease latest_spec_version 与本地
        // `.sillyspec-platform.json.spec_version`。一致 → 跳过 pull（interactive 路径仍
        // set specSyncCtx 保证 onSessionEnd 回灌）；不一致 / 本地无记录 → pullSpecBundle
        // 刷新，成功后 bumpLocalSpecVersion 回写新版本。lease 未透传 latest_spec_version
        //（旧 backend）→ 保持旧行为（无条件 pull）。
        const leaseSpecVersion =
          (execPayload as { latestSpecVersion?: number }).latestSpecVersion ??
          (execPayload as { latest_spec_version?: number }).latest_spec_version;
        let skipPullDueToVersion = false;
        if (leaseSpecVersion !== undefined) {
          const localVersion = await readLocalSpecVersion(specRootPath);
          if (!shouldRefreshSpec(localVersion, leaseSpecVersion)) {
            skipPullDueToVersion = true;
            this._logger.info('interactive_spec_version_fresh_skip_pull', {
              lease_id: leaseId,
              workspace_id: workspaceId,
              spec_version: localVersion,
            });
          }
        }
        // 无论 pull 与否，specSyncCtx 都登记（interactive 路径 onSessionEnd 兜底回灌）。
        this._interactiveSpecSyncCtx.set(leaseId, { workspaceId });
        if (skipPullDueToVersion) {
          // 版本一致跳过 pull：仍 info 一次便于观测，specSyncCtx 已 set。
          this._logger.info('interactive_spec_pulled', {
            lease_id: leaseId,
            workspace_id: workspaceId,
            spec_dir: resolveSpecDir(workspaceId),
            skipped: 'version_fresh',
          });
        } else {
          try {
            // `as never`：ClientLike 是 daemon 内部鸭子类型，spec-sync utility 期望 HubClient
            // 具体类型；ClientLike 已声明 getSpecBundle/postSpecSync 签名（additive），运行时
            // 真实 _client 为 HubClient 实例（main.ts 注入），duck-type 安全（task-06 §4.1/边界 11）。
            const specDir = await pullSpecBundle(
              this._client as never,
              workspaceId,
              { strategy: specStrategy, rootPath: specRootPath },
            );
            // 404 容错（首次 scan backend 无 bundle）：utility 内已 mkdir 空目录返回路径非 null。
            // lease 带了 latest_spec_version → 回写本地版本保鲜（D-010）。
            if (leaseSpecVersion !== undefined) {
              await bumpLocalSpecVersion(specRootPath, leaseSpecVersion);
            }
            this._logger.info('interactive_spec_pulled', {
              lease_id: leaseId,
              workspace_id: workspaceId,
              spec_dir: specDir,
            });
          } catch (e) {
            // R-03 容错：pull 失败（5xx/网络，404 已被 utility 容错）不阻塞 session 启动。
            // agent 仍可跑（读不到缓存则 sillyspec 生成新文档）。specSyncCtx 已 set，
            // onSessionEnd 仍会尝试回灌（保守：即使 pull 失败也回传本地状态）。
            this._logger.warn('interactive_spec_pull_failed', {
              lease_id: leaseId,
              workspace_id: workspaceId,
              error: (e as Error)?.message ?? String(e),
            });
          }
        }
      }
    }
    // transport !== 'tar'（shared）→ 跳过 pull + 不 set specSyncCtx（onSessionEnd 自然跳过 sync）。

    try {
      await this._sessionManager.create({
        sessionId,
        leaseId,
        env: interactiveEnv,
        // gap-2：claim_token 从 claimResp 归一化到 execPayload.claimToken，
        // 透传给 SessionManager 存入 state.claimToken，供 onTurnMessage→submitMessages
        // + gap-3 notifyRunResult 复用（桥接在 task-04）。
        claimToken: execPayload.claimToken ?? '',
        firstPrompt: prompt,
        firstRunId,
        cwd,
        provider,
        pathToClaudeCodeExecutable,
        model: execPayload.model,
        // scan 真阻塞：透传给 SessionManager.create 决定是否注入 canUseTool + 分流策略。
        manualApproval: execPayload.manualApproval,
        askUserOnly: execPayload.askUserOnly,
      });
      this._logger.info('interactive_session_started', {
        lease_id: leaseId,
        session_id: sessionId,
        run_id: firstRunId,
      });
    } catch (e) {
      // create 抛错（ClaudeExecutableNotFoundError wrapper 解析失败等）：移除登记，
      // 让 WS 重放可重试；记录错误不崩。SessionManager 已标 failed（onSessionEnd）。
      this._interactiveSessionsByLease.delete(leaseId);
      const code =
        (e as Error & { code?: string })?.code ??
        (e instanceof Error ? e.name : 'UNKNOWN');
      this._logger.error('interactive_session_create_failed', {
        lease_id: leaseId,
        session_id: sessionId,
        code,
        error: e,
      });
    }
  }

  // ── lease 状态机（daemon.py:269-340，本任务核心 R6）────────────────────────

  private async _executeTask(payload: LeasePayload): Promise<void> {
    const leaseId = payload.leaseId;
    const runtimeId =
      payload.runtimeId ?? this._firstRegisteredRuntimeId() ?? this._config.runtime_id;

    if (!leaseId) {
      this._logger.warn('task_no_lease_id', { payload });
      return;
    }

    // 并发去重（边界 3）：同一 lease_id 已在执行，跳过
    if (this._inflightLeases.has(leaseId)) {
      this._logger.info('lease_inflight_skip', { lease_id: leaseId });
      return;
    }
    // 并发上限（边界 3）
    if (this._inflightLeases.size >= this._config.max_concurrent_tasks) {
      this._logger.warn('concurrent_limit_reached', {
        inflight: this._inflightLeases.size,
        max: this._config.max_concurrent_tasks,
      });
      return;
    }

    this._inflightLeases.add(leaseId);
    try {
      await this._runLeaseStateMachine(leaseId, runtimeId, payload);
    } finally {
      this._inflightLeases.delete(leaseId);
    }
  }

  // ── task-11 / FR-10 / D-004@v1：change-write 轻量执行（不启 agent）─────────────

  /**
   * 执行一个 change-write 任务（claim → 本地写 → complete 回执 → sync）。
   *
   * **严格不走** ``_runLeaseStateMachine``（FR-10：纯文件写 + sync，不启 agent driver）。
   * 调用 task-runner ``runChangeWrite`` 轻量分支（不 import/不调用 SessionManager /
   * driver），complete 成功后由 runChangeWrite 内部触发 spec 回灌。
   *
   * 容错策略（对齐 design R-03）：
   *   - claim 失败（404/409/网络）→ 仅 log，return（不重试，等下轮 poll）。
   *   - 写文件 / path traversal 失败 → 回执 ok=false（若 client 支持），return。
   *   - sync 失败 → runChangeWrite 内部已 warn 不抛（不改写 ok）。
   *
   * @param taskId  DaemonChangeWrite.id（task-09 task_id）
   * @param runtimeId  当前 runtime（日志/claim 透传）
   * @param item  getPendingChangeWrites 返回的单条（含 change_key/workspace_id/files）
   */
  private async _executeChangeWrite(
    taskId: string,
    runtimeId: string,
    item: Record<string, unknown>,
  ): Promise<void> {
    // 并发去重：同一 taskId 已在执行，跳过。
    if (this._inflightChangeWrites.has(taskId)) {
      this._logger.info('change_write_inflight_skip', { task_id: taskId });
      return;
    }

    const changeKey = item.change_key as string | undefined;
    const workspaceId = item.workspace_id as string | undefined;
    if (!changeKey || !workspaceId) {
      this._logger.warn('change_write_missing_fields', {
        task_id: taskId,
        change_key: changeKey,
        workspace_id: workspaceId,
      });
      return;
    }

    this._inflightChangeWrites.add(taskId);
    let claimToken = '';
    try {
      // 1. CLAIM：抢占，拿 claim_token（task-09 端点无 body）。
      let claimResp: Record<string, unknown>;
      try {
        claimResp = await this._client.claimChangeWrite(taskId, runtimeId);
      } catch (e) {
        // 404/409/网络 → 仅 log（不重试，等下轮 poll）。
        this._logger.warn('change_write_claim_failed', {
          task_id: taskId,
          error: e,
        });
        return;
      }
      claimToken = (claimResp.claim_token as string | undefined) ?? '';
      if (!claimToken) {
        this._logger.warn('change_write_no_claim_token', { task_id: taskId });
        return;
      }

      // 2. files 取 claim 回执（task-09 ChangeWriteClaimResponse 带 files，对齐 pending）。
      const rawFiles = (claimResp.files ?? item.files ?? []) as unknown[];
      const files: ChangeWriteFile[] = rawFiles.map((f) => {
        const obj = f as { path?: string; content?: string };
        return { path: String(obj.path ?? ''), content: String(obj.content ?? '') };
      });

      // 3. 本地写 + complete 回执 + sync（task-runner 轻量分支，不启 agent）。
      // task-13 / D-012：透传 kind（claim 回执 ChangeWriteClaimResponse 带 kind），
      // task-runner 据 kind=spec-sync 分流到 postSpecSync 整树回灌（不写文件）。
      const kind = (claimResp.kind as string | undefined) ?? 'create';
      const ctx: ChangeWriteCtx = {
        taskId,
        changeKey,
        workspaceId,
        claimToken,
        files,
        kind,
      };
      await this._taskRunner!.runChangeWrite!(ctx);
      this._logger.info('change_write_done', { task_id: taskId, change_key: changeKey });
    } catch (e) {
      // 写文件 / path traversal 失败 → 回执 ok=false（尽力，对齐 R-03 不崩循环）。
      this._logger.warn('change_write_execute_failed', {
        task_id: taskId,
        error: e,
      });
      try {
        await this._client.completeChangeWrite(taskId, claimToken, {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      } catch (e2) {
        // 回执失败本身不阻塞（claim_token 为空时 backend 会 409，下轮 gc 兜底）。
        this._logger.debug('change_write_complete_failed_failed', {
          task_id: taskId,
          error: e2,
        });
      }
    } finally {
      this._inflightChangeWrites.delete(taskId);
    }
  }

  private async _runLeaseStateMachine(
    leaseId: string,
    runtimeId: string,
    payload: LeasePayload,
  ): Promise<void> {
    // 1. CLAIM：拿 claim_token（task-17 claimLease）
    let claimResp: Record<string, unknown>;
    try {
      claimResp = await this._client.claimLease(leaseId, runtimeId);
    } catch (e) {
      this._logger.error('lease_claim_failed', { lease_id: leaseId, error: e });
      return;
    }
    const claimToken = String(claimResp.claim_token ?? '');
    if (!claimToken) {
      this._logger.error('lease_claim_no_token', { lease_id: leaseId });
      return;
    }

    // 3. EXECUTE：委托 TaskRunner.runLease（真实方法名，不是 executeTask）
    // claim_resp.payload 兼容两种形态（daemon.py:306）：
    //   - server 返回 { lease_id, claim_token, payload: {...}, lease_expires_at }
    //   - 或 server 直接返回 payload 字段平铺
    //
    // ql-20260616-006：backend claim 返回 snake_case（lease_id/agent_run_id/...），
    // 必须把 snake_case 归一化为 camelCase LeasePayload，否则 agentRunId/cmdPath 等
    // 永远 undefined，submitMessages 因 agent_run_id 空字符串触发 422。
    const nestedPayload = claimResp.payload as Record<string, unknown> | undefined;
    const flatClaimResp = claimResp as Record<string, unknown>;
    const rawExec: Record<string, unknown> = nestedPayload
      ? { ...(nestedPayload as object), ...(flatClaimResp as object) }
      : { ...(flatClaimResp as object) };
    const execPayload: LeasePayload = {
      ...payload,
      leaseId: (rawExec.leaseId as string | undefined) ?? (rawExec.lease_id as string | undefined) ?? payload.leaseId,
      runtimeId: (rawExec.runtimeId as string | undefined) ?? (rawExec.runtime_id as string | undefined) ?? runtimeId,
      agentRunId:
        (rawExec.agentRunId as string | undefined) ??
        (rawExec.agent_run_id as string | undefined) ??
        payload.agentRunId,
      workspaceName:
        (rawExec.workspaceName as string | undefined) ??
        (rawExec.workspace_name as string | undefined) ??
        payload.workspaceName,
      // ql-20260617-009：workspace slug + 真实 root_path 透传（root_path 优先作 cwd）。
      workspaceSlug:
        (rawExec.workspaceSlug as string | undefined) ??
        (rawExec.workspace_slug as string | undefined) ??
        payload.workspaceSlug,
      rootPath:
        (rawExec.rootPath as string | undefined) ??
        (rawExec.root_path as string | undefined) ??
        payload.rootPath,
      repoUrl: (rawExec.repoUrl as string | undefined) ?? (rawExec.repo_url as string | undefined) ?? payload.repoUrl,
      branch: (rawExec.branch as string | undefined) ?? payload.branch,
      claudeMd:
        (rawExec.claudeMd as string | undefined) ??
        (rawExec.claude_md as string | undefined) ??
        payload.claudeMd,
      provider:
        (rawExec.provider as string | undefined) ??
        (rawExec.agent_type as string | undefined) ??
        payload.provider,
      toolConfig:
        (rawExec.toolConfig as LeaseCtx['toolConfig'] | undefined) ??
        (rawExec.tool_config as LeaseCtx['toolConfig'] | undefined) ??
        payload.toolConfig,
      resumeSessionId:
        (rawExec.resumeSessionId as string | undefined) ??
        (rawExec.resume_session_id as string | undefined) ??
        payload.resumeSessionId,
      sessionId:
        (rawExec.sessionId as string | undefined) ??
        (rawExec.session_id as string | undefined) ??
        payload.sessionId,
      cmdPath: (rawExec.cmdPath as string | undefined) ?? (rawExec.cmd_path as string | undefined) ?? payload.cmdPath,
      cmd: (rawExec.cmd as string | undefined) ?? payload.cmd,
      prompt: (rawExec.prompt as string | undefined) ?? payload.prompt,
      model: (rawExec.model as string | undefined) ?? payload.model,
      timeout: (rawExec.timeout as number | undefined) ?? payload.timeout,
      timeoutSeconds:
        (rawExec.timeoutSeconds as number | undefined) ??
        (rawExec.timeout_seconds as number | undefined) ??
        payload.timeoutSeconds,
      // task-04（D-002@v3）：lease.kind 分流 + interactive agent_session_id 透传。
      // snake_case 兼容（backend claim 响应可能给 agent_session_id）。
      kind:
        (rawExec.kind as 'batch' | 'interactive' | undefined) ??
        (payload.kind as 'batch' | 'interactive' | undefined),
      agentSessionId:
        (rawExec.agentSessionId as string | undefined) ??
        (rawExec.agent_session_id as string | undefined) ??
        payload.agentSessionId,
      // ql-20260627：tar 模式 transport + workspaceId 透传（build_claim_payload 已返回，
      // 但 execPayload 构造遗漏 → _startInteractiveSession 读不到 → 默认 shared → spec
      // pull/sync 从不触发 → interactive scan 文档不同步到服务器）。
      transport:
        (rawExec.transport as string | undefined) ??
        (rawExec.transport_mode as string | undefined) ??
        (rawExec.transportMode as string | undefined) ??
        'shared',
      workspaceId:
        (rawExec.workspaceId as string | undefined) ??
        (rawExec.workspace_id as string | undefined),
      // gap-2：claim_token 归一化到 execPayload.claimToken。
      // 优先用 claim 阶段拿到的 claimToken（局部变量，来自 claimResp.claim_token）；
      // 兜底 rawExec.claim_token / rawExec.claimToken（理论上 claimResp 顶层就有，
      // 这里是防御性）。interactive lease 必须带 claimToken 供 SessionManager 复用。
      claimToken: claimToken,
      // scan 真阻塞：lease metadata.manual_approval / ask_user_only 透传（scan=true）。
      manualApproval:
        (rawExec.manual_approval as boolean | undefined) ??
        (rawExec.manualApproval as boolean | undefined) ??
        payload.manualApproval,
      askUserOnly:
        (rawExec.ask_user_only as boolean | undefined) ??
        (rawExec.askUserOnly as boolean | undefined) ??
        payload.askUserOnly,
    };

    // task-04（D-002@v3）：kind 分流。在 fetch/startLease 之前——interactive 不走
    // TaskRunner / startLease / completeLease（backend 已 startLease），独立由
    // SessionManager 接管。缺省/未知 kind 一律按 batch（design §9 兼容）。
    const kind = execPayload.kind;
    if (kind === 'interactive') {
      await this._startInteractiveSession(leaseId, execPayload);
      return;
    }

    // 1.5 FETCH execution-context：claim 成功后、startLease 之前从 server 拉完整 bundle。
    // 当前 ctx 构造字段恒 undefined（claudeMd/repoUrl/branch/toolConfig...），
    // 必须先 fetch 再构造 ctx。位置必须在 startLease 之前：startLease 触发 server 把
    // lease 标 claimed、AgentRun → running；放 startLease 前让 fetch 属 claim-claimed 过渡态，
    // 避免 running 期间拉 bundle 增加窗口期延迟（task-05 §实现要求 3）。
    // R-03：fetch 失败不致命——claim 已扣 token，中断会留 dangling lease；
    // 记 error 供排查，继续用 payload 兜底（裸 prompt 也能跑）。
    let execCtx: ExecutionContextPayload | null = null;
    if (execPayload.agentRunId) {
      try {
        execCtx = await this._client.getExecutionContext(execPayload.agentRunId);
      } catch (e) {
        this._logger.error('execution_context_fetch_failed', {
          lease_id: leaseId,
          agent_run_id: execPayload.agentRunId,
          error: e,
        });
      }
    }

    // 2. START：通知 server lease 开始（task-17 startLease）
    try {
      await this._client.startLease(leaseId, claimToken);
    } catch (e) {
      this._logger.error('lease_start_failed', { lease_id: leaseId, error: e });
      return;
    }

    // 构造 LeaseCtx（对齐 types.ts LeaseCtx 接口，camelCase）。
    // 字段优先级：execCtx（fetch 结果，最新源）?? execPayload（claim payload 兜底）。
    // **prompt 不从 fetch 覆盖**：payload.prompt 是 dispatch 时写入 lease.metadata 的
    // 最终意图，避免 fetch 端点重建 prompt 的潜在差异（task-05 §边界处理 5）。
    //
    // ql-20260616-006：cmdPath server 不会下发，daemon 必须从 _agentPaths（注册时
    // 探测的本机路径）按 provider 注入，否则 task-runner 因 cmdPath 空直接 failed。
    const resolvedProvider = execCtx?.provider ?? execPayload.provider ?? 'claude';
    const localCmdPath =
      execPayload.cmdPath ?? execPayload.cmd ?? this._agentPaths.get(resolvedProvider) ?? '';
    const ctx: LeaseCtx = {
      leaseId,
      runtimeId,
      claimToken,
      agentRunId: execPayload.agentRunId,
      workspaceName: execPayload.workspaceName,
      // ql-20260617-009：fetch 是 task-05 之后的最新源，优先覆盖（fetch 失败回落 payload）
      workspaceSlug: execCtx?.workspace_slug ?? execPayload.workspaceSlug,
      rootPath: execCtx?.root_path ?? execPayload.rootPath,
      // fetch 覆盖（fetch 失败 execCtx=null 时回落 payload，payload 仍可能 undefined）
      repoUrl: execCtx?.repo_url ?? execPayload.repoUrl,
      branch: execCtx?.branch ?? execPayload.branch,
      claudeMd: execCtx?.claude_md ?? execPayload.claudeMd,
      provider: resolvedProvider,
      // toolConfig：fetch.tool_config 是 snake_case Record，payload.toolConfig 是 camelCase；
      // fetch 优先（端点是 task-03 之后的最新源）
      toolConfig: execCtx?.tool_config ?? execPayload.toolConfig,
      // resumeSessionId 优先用 fetch（端点是最新源）；session_id 兜底
      resumeSessionId: execCtx?.resume_session_id ?? execPayload.resumeSessionId,
      sessionId: execCtx?.session_id ?? execPayload.sessionId,
      cmdPath: localCmdPath,
      cmd: execPayload.cmd ?? localCmdPath,
      prompt: execPayload.prompt, // 不从 fetch 覆盖
      model: execCtx?.model ?? execPayload.model,
      timeout: execPayload.timeout,
    };

    const taskResult: TaskRunnerResult = await this._taskRunner!.runLease(ctx);

    // 4. COMPLETE：回传结果（task-17 completeLease）
    // 字段映射：TaskRunnerResult 是 camelCase，server complete_lease 期望 snake_case
    try {
      // task-12（FR-05 / D-005@v1）：终态上报包 retryTerminal 轻量重试（不暂存）。
      // _resilience 未注入 → 回退直接调 _client。用尽抛被下方 catch 兜住。
      const call = (): Promise<unknown> =>
        this._client.completeLease(leaseId, claimToken, {
          success: taskResult.success,
          output: taskResult.output,
          error: taskResult.error,
          patch: taskResult.patch,
          files_changed: taskResult.filesChanged,
          insertions: taskResult.insertions,
          deletions: taskResult.deletions,
          duration_ms: taskResult.durationMs,
          session_id: taskResult.metadata?.session_id ?? taskResult.sessionId ?? '',
          stats: taskResult.stats,
          exit_code: taskResult.exitCode,
          status: taskResult.status,
        });
      if (this._resilience) {
        await this._resilience.retryTerminal(call);
      } else {
        await call();
      }
      this._logger.info('task_completed', {
        lease_id: leaseId,
        success: taskResult.success,
      });
    } catch (e) {
      this._logger.error('lease_complete_failed', { lease_id: leaseId, error: e });
    }
  }

  // ── 信号处理（R8）──────────────────────────────────────────────────────────

  private _installSignalHandlers(): void {
    if (this._sigtermHandler) return; // 防重复注册
    this._sigtermHandler = (): void => {
      void this.stop();
    };
    this._sigintHandler = (): void => {
      // 第一次 SIGINT：优雅 stop；第二次（连按）：_running 已 false → 强制 exit 130
      if (!this._running) {
        process.exit(130); // 128 + SIGINT(2)
      }
      void this.stop();
    };
    process.on('SIGTERM', this._sigtermHandler);
    process.on('SIGINT', this._sigintHandler);
  }

  private _uninstallSignalHandlers(): void {
    if (this._sigtermHandler) {
      process.off('SIGTERM', this._sigtermHandler);
      this._sigtermHandler = null;
    }
    if (this._sigintHandler) {
      process.off('SIGINT', this._sigintHandler);
      this._sigintHandler = null;
    }
  }
}
