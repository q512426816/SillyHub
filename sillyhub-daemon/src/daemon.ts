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

import { hostname, platform, arch } from 'node:os';
import { mkdir } from 'node:fs/promises';
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { DaemonConfig } from './config.js';
import { MSG } from './protocol.js';
import type {
  DaemonMessage,
  ExecutionContextPayload,
  LeaseCtx,
  LeasePayload,
} from './types.js';
import { AgentDetector } from './agent-detector.js';
import type { DetectedAgent } from './agent-detector.js';
import { HubClient } from './hub-client.js';
import { WsClient } from './ws-client.js';
import { listDir } from './file-rpc.js';
import { buildSpawnEnv } from './spawn-env.js';
import type { TaskRunner, TaskRunnerResult } from './task-runner.js';
import type { SessionManager } from './interactive/session-manager.js';
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
}

/** daemon 需要的 TaskRunner 接口子集。 */
interface TaskRunnerLike {
  runLease(ctx: LeaseCtx): Promise<TaskRunnerResult>;
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
}

/**
 * gap-8：interactive 路径凭证注入所需的 CredentialManager 接口子集（鸭子类型，
 * 对齐 src/credential.ts 的 get/buildEnv，与 spawn-env.ts 的 SpawnCredentialManager 一致）。
 */
export interface InteractiveCredentialManager {
  get(key: string): string | undefined;
  buildEnv(config: Record<string, unknown>): Record<string, string>;
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
  /**
   * task-04：interactive lease.id → session_id（防 WS 重放重复 create，AC-09）。
   * batch lease 不进此 map（走 _inflightLeases 去重）。
   */
  private readonly _interactiveSessionsByLease = new Map<string, string>();

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

  /** agent provider → server 分配的 runtime_id（register 成功后填入）。 */
  private readonly _registeredRuntimes = new Map<string, string>();

  /**
   * ql-20260616-006：agent provider → 本机 CLI 可执行文件路径。
   * server 不持有 daemon 本机的 cmd_path（capabilities.bin_path 仅记录不回传），
   * claim_lease 返回的 payload.cmdPath 恒 undefined → spawn 前必须由 daemon 注入。
   */
  private readonly _agentPaths = new Map<string, string>();

  /** 进行中的 lease_id 集合（并发去重，边界 3）。 */
  private readonly _inflightLeases = new Set<string>();

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
    result: SDKResultMessage,
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
    const resultMeta = result as SDKResultMessage & {
      subtype?: string;
      is_error?: boolean;
      result?: unknown;
    };
    const status = resultMeta.subtype ?? 'success';
    const isError = resultMeta.is_error === true;
    const payload: {
      status: string;
      is_error: boolean;
      subtype?: string;
      result_summary?: string;
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
    try {
      await this._client.notifyRunResult(
        state.leaseId,
        state.claimToken,
        runId,
        payload,
      );
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
    msg: SDKMessage,
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
      await this._client.submitMessages(
        state.leaseId,
        state.claimToken,
        runId,
        [msg as unknown as Record<string, unknown>],
      );
    } catch (e) {
      this._logger.warn('on_turn_message_submit_failed', {
        session_id: sessionId,
        lease_id: state.leaseId,
        run_id: runId,
        error: e,
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
      await this._client.notifySessionEnd(sessionId, mappedStatus, reason);
    } catch (e) {
      this._logger.warn('on_session_end_notify_failed', {
        session_id: sessionId,
        status: mappedStatus,
        error: e,
      });
    }
  }

  // ── 内部：_fire（AbortController 追踪，R7）─────────────────────────────────

  /**
   * 启动一个后台循环并追踪它的 AbortController + Promise。
   * 循环抛 AbortError 时静默吞掉（正常停止）；其他异常记日志（不重启）。
   */
  private _fire(loop: (signal: AbortSignal) => Promise<void>): void {
    const controller = new AbortController();
    this._controllers.add(controller);
    const p: Promise<void> = loop(controller.signal)
      .catch((e: unknown) => {
        if (e instanceof AbortError || (e as Error | undefined)?.name === 'AbortError') {
          return;
        }
        this._logger.error('loop_crashed', { error: e });
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
            await this._client.heartbeat(rid);
          } catch (e) {
            // 单个 rid 心跳失败不影响其他（daemon.py:172-177）
            this._logger.warn('heartbeat_failed', { runtime_id: rid, error: e });
          }
        }
      } catch (e) {
        if (e instanceof AbortError) break;
        // 非预期异常：记日志后继续循环（不崩）
        this._logger.warn('heartbeat_loop_error', { error: e });
      }
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
        },
      });
      this._registerListDirRpcHandler(ws, runtimeId);

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
    const record: PersistedSessionRecord = {
      sessionId,
      leaseId,
      agentSessionId,
      cwd: (raw.cwd as string | undefined) ?? '',
      provider,
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
    const prompt = execPayload.prompt ?? '';
    // rootPath 优先作 cwd（与 batch 一致，ql-20260617-009）；无则 workspace_dir 兜底。
    const cwd = execPayload.rootPath ?? this._config.workspace_dir;
    const provider = (execPayload.provider ?? 'claude') as 'claude' | 'codex';
    const pathToClaudeCodeExecutable = this._agentPaths.get('claude') ?? '';

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
      // AC-07：agent-detector 未检测 claude → 拒绝启动（D-009 normalized_requirement 第 3 条）。
      // 不调 create；backend 据 lease 超时 / onSessionEnd 收 failed。daemon 主循环不崩。
      this._logger.error('interactive_claude_executable_not_found', {
        lease_id: leaseId,
        code: 'CLAUDE_EXECUTABLE_NOT_FOUND',
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
      await this._client.completeLease(leaseId, claimToken, {
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
