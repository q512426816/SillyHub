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
import type { DaemonConfig } from './config.js';
import { MSG, WS_PATH } from './protocol.js';
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
import type { TaskRunner, TaskRunnerResult } from './task-runner.js';

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
}

/** daemon 需要的 TaskRunner 接口子集。 */
interface TaskRunnerLike {
  runLease(ctx: LeaseCtx): Promise<TaskRunnerResult>;
}

/** daemon 需要的 WsClient 接口子集。 */
interface WsClientLike {
  connect(): void;
  close(): void;
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

  /** WS 客户端（_wsLoop 时 lazy 创建）。 */
  private _wsClient: WsClientLike | null = null;
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

    // 3. 启动三循环
    this._fire((signal) => this._heartbeatLoop(signal));
    this._fire((signal) => this._pollLoop(signal));
    this._fire((signal) => this._wsLoop(signal));

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

    // 关闭 WS（真实 WsClient.close 是同步 void；mock 可能是 async，try 包裹）
    try {
      this._wsClient?.close();
    } catch (e) {
      this._logger.warn('ws_close_failed', { error: e });
    }
    // 关闭 HTTP（真实 HubClient.close 是同步 void no-op）
    try {
      this._client.close();
    } catch (e) {
      this._logger.warn('client_close_failed', { error: e });
    }

    this._logger.info('stopped');
  }

  // ── 内部：register 单个 agent（task-17 HubClient.register）─────────────────

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
    const wsUrl = this._buildWsUrl();
    // 真实 WsClient 构造签名：new WsClient({ serverUrl, runtimeId, callbacks })。
    // 不是蓝图假设的 new WsClient(wsUrl, { onMessage, onClose })。
    // WsClient 内部自动管理重连，daemon 只负责：构造 + connect() + 等待 stop。
    if (!this._wsClient) {
      const baseOrigin = this._extractOrigin(wsUrl);
      this._wsClient = this._wsClientFactory({
        serverUrl: baseOrigin,
        runtimeId: this._config.runtime_id,
        callbacks: {
          onMessage: (msg) => {
            void this._handleWsMessage(msg);
          },
        },
      });
    }

    // connect 是同步 void（真实 WsClient：connect() 触发异步握手，不返回 Promise）。
    // daemon 不能 await connect；用 abortableSleep 循环等 stop 信号。
    try {
      this._wsClient.connect();
    } catch (e) {
      if (e instanceof AbortError) return;
      this._logger.warn('ws_connect_failed', { error: e });
    }

    // 等待 stop：每秒检查一次 signal.aborted（轻量，不阻塞事件循环）
    while (this._running) {
      try {
        await abortableSleep(1000, signal);
      } catch (e) {
        if (e instanceof AbortError) break;
        this._logger.warn('ws_loop_error', { error: e });
        break;
      }
    }
  }

  /**
   * 从 wsUrl 提取 server origin（去掉 ws path 和 query）。
   * 用于注入真实 WsClient 时按 serverUrl 形态构造。
   */
  private _extractOrigin(wsUrl: string): string {
    // wsUrl 形如 ws://host:port/api/daemon/ws?runtime_id=xxx
    // 取 protocol://host:port 部分
    const m = /^(wss?:\/\/[^/]+)\/.*/.exec(wsUrl);
    if (!m || !m[1]) return this._config.server_url;
    const wsBase = m[1];
    return wsBase.startsWith('wss://')
      ? 'https://' + wsBase.slice('wss://'.length)
      : 'http://' + wsBase.slice('ws://'.length);
  }

  /** 由 server_url 推导 ws URL（http→ws / https→wss，daemon.py:148-160）。 */
  private _buildWsUrl(): string {
    const base = this._config.server_url.replace(/\/+$/, '');
    let wsBase: string;
    if (base.startsWith('https://')) {
      wsBase = 'wss://' + base.slice('https://'.length);
    } else if (base.startsWith('http://')) {
      wsBase = 'ws://' + base.slice('http://'.length);
    } else {
      wsBase = 'ws://' + base;
    }
    return `${wsBase}${WS_PATH}?runtime_id=${encodeURIComponent(this._config.runtime_id)}`;
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
      default: {
        this._logger.warn('unknown_message_type', { type: msgType });
      }
    }
  }

  // ── lease 状态机（daemon.py:269-340，本任务核心 R6）────────────────────────

  private async _executeTask(payload: LeasePayload): Promise<void> {
    const leaseId = payload.leaseId;
    const runtimeId = payload.runtimeId ?? this._config.runtime_id;

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
    };

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
      model: execPayload.model,
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
