/**
 * interactive/session-manager.ts —— 交互式会话生命周期管理（task-04 §4.3 + task-07 增强）。
 *
 * 职责（design §7.2 / §7.6）：
 *   - 内存 SessionStore（Map<sessionId, SessionState>），Wave1/2 内存态（D-003，daemon
 *     重启丢失，task-10 持久化）。
 *   - create：建 InputQueue + push 首 SDKUserMessage → driver.start → fire consume。
 *   - inject：push 追问（spike S1：turn 级串行，SDK 在当前 turn result 后消费）。
 *     task-07 增量：status=running 时 pendingInjectCount++ + onTurnQueued 回调（排队检测，
 *     非拒绝，可观察）。
 *   - interrupt：driver.interrupt（spike D1：turn 级，session 仍 active）。
 *     task-07 增量：interrupt 后更新 lastActiveAt；终态由 _onResult 按 SDK 实际 result 收尾。
 *   - end：InputQueue.close → query 自然结束 → status=ended → onSessionEnd（统一收口）。
 *   - fail：driver onError → status=failed → onSessionEnd。
 *   - task-07 增量：start()/stop() 启停空闲扫描定时器（FR-06 / D-004@v1）；
 *     _scanIdle → _onIdleExpire → end（running 先 interrupt 再 end 兜底）。
 *
 * state.query / state.inputQueue 是 SDK 长生命周期句柄；driver.consume 作为 session
 * 协程一次启动，跨多 turn 持续直到 InputQueue.close 或 query 自然结束。
 *
 * 来源：design.md §7.2 / §7.6 / §8.5；spike-02 §3.7 H2（同进程多轮）/ D1（interrupt 续轮）/
 * D4（result 边界）/ S1（turn 级串行）；task-07 FR-04 / FR-06 / D-004@v1。
 *
 * @module interactive/session-manager
 */

import type {
  CanUseTool,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeSdkDriver } from './claude-sdk-driver.js';
import { InputQueue } from './input-queue.js';
import { PermissionResolver } from './permission-resolver.js';
import type { PermissionSendFn } from './permission-resolver.js';
import type {
  CreateSessionInput,
  InjectResult,
  PersistedSessionRecord,
  SessionManagerDeps,
  SessionState,
  SessionStatus,
  SessionStorePersistence,
} from './types.js';
import {
  SessionAlreadyExistsError,
  SessionNotFoundError,
  SessionNotActiveError,
  UnsupportedProviderError,
} from './types.js';

/**
 * task-08（D-007@v1 / FR-07）：wsClient.send 注入接口（鸭子类型，便于测试 mock）。
 * daemon 注入真实 WsClient；测试注入 mock。
 */
export interface PermissionWsSender {
  send: PermissionSendFn;
}

/**
 * task-07 增量构造 opts（FR-06 / D-004@v1）。
 *
 * 第二参数可选，保持 task-04 单参数构造兼容（既有 `new SessionManager({ driver, ...deps })`
 * 调用不破）。opts 主要用于测试注入短周期（idleTimeoutSec / idleScanSec）+ 生产路径不传
 * 时从 process.env.SESSION_IDLE_TIMEOUT_SEC 读配置。
 */
export interface SessionManagerOptions {
  /** D-004@v1：空闲阈值秒。优先于 env SESSION_IDLE_TIMEOUT_SEC；缺省走 env 或默认 1800。 */
  idleTimeoutSec?: number;
  /** 扫描周期秒，默认 60（避免与空闲阈值同量级导致抖动）。测试可注入短周期。 */
  idleScanSec?: number;
  /**
   * task-08（D-007@v1 / FR-07）：是否启用 canUseTool 远程人审。
   *
   * 默认 false：driver 不注入 canUseTool，SDK 走内置默认策略（spike H1 行为不变）；
   * 仅 manual_approval=true 时（resolver + wsClient 同步注入）driver 注入真实远程人审回调。
   */
  manualApproval?: boolean;
  /**
   * task-08：canUseTool 远程人审 pending 注册表。
   *
   * 仅 manualApproval=true 时必需；manualApproval=false 时可不传（不实例化）。
   * create 时按 session 持有，end/fail/interrupt/_onResult 收尾时 abortAll。
   */
  permissionResolver?: PermissionResolver;
  /**
   * task-08：WS 客户端（鸭子类型，仅用 .send）。canUseTool 回调用它发 PERMISSION_REQUEST。
   * 仅 manualApproval=true 时必需。
   */
  permissionWsClient?: PermissionWsSender;
}

/**
 * task-07 onTurnQueued 回调类型（R-conv / spike S1 可观察性）。
 *
 * 不写入 types.ts 的 SessionManagerDeps（避免越界 task-04 的接口签名）；SessionManager
 * 通过 `(deps as SessionManagerDepsWithQueued).onTurnQueued` 探测消费——deps 注入方
 * （task-05/11）按需附带该回调，未注入则只做内部计数，不报错。
 */
export type OnTurnQueuedCallback = (
  sessionId: string,
  runId: string,
  queuePosition: number,
) => void | Promise<void>;

/** 内部类型：SessionManagerDeps + 可选 onTurnQueued（结构探测）。 */
interface SessionManagerDepsWithQueued extends SessionManagerDeps {
  onTurnQueued?: OnTurnQueuedCallback;
}

/** 默认空闲阈值（秒）= 30min（FR-06 / D-004@v1）。 */
const DEFAULT_IDLE_TIMEOUT_SEC = 1800;
/** 默认扫描周期（秒）。 */
const DEFAULT_IDLE_SCAN_SEC = 60;

export class SessionManager {
  /** 内存 SessionStore。Wave1/2 内存态，daemon 重启丢失（D-003）。 */
  private readonly _store = new Map<string, SessionState>();

  /**
   * task-07（R-conv 可观察性）：sessionId → 排队中的 inject 计数。
   *
   * 不写入 SessionState（types.ts 是 task-04 范围，本任务只补增量可观察字段，且
   * pendingInjectCount 是纯可观察计数不参与 SDK 行为控制），故维护独立的内部 Map。
   * _onResult 收尾时递减（min 0）。
   */
  private readonly _pendingInjectCount = new Map<string, number>();

  /**
   * task-07（FR-06 / D-004@v1）：空闲扫描定时器。start() 启动、stop() 清理。
   * unref 不阻止 node 退出；daemon.shutdown 显式 stop。
   */
  private _idleTimer: ReturnType<typeof setInterval> | null = null;

  /** D-004@v1：空闲阈值秒。env / opts / 默认 1800 三者优先级 opts > env > 默认。 */
  private readonly _idleTimeoutSec: number;
  /** 扫描周期秒。默认 60；测试可注入短周期。 */
  private readonly _idleScanSec: number;

  /**
   * task-08（D-007@v1 / FR-07）：canUseTool 远程人审三件套。
   *
   * 实例级配置——manualApproval=true 时必需 resolverFactory + wsClient；
   * manualApproval=false（默认）时均为 undefined，driver 不注入 canUseTool，
   * SDK 走内置默认策略（spike H1 行为不变，batch/无审批零变化）。
   *
   * **生命周期**：每个 session 一个 PermissionResolver 实例（按 sessionId 分桶，
   * Map<sessionId, PermissionResolver>），create 时实例化，end/fail 收尾时
   * abortAll + 从 map 移除。绝不让跨 session 的 pending 互相干扰。
   */
  private readonly _manualApproval: boolean;
  private readonly _permissionResolverFactory:
    | (() => PermissionResolver)
    | undefined;
  private readonly _permissionWsClient: PermissionWsSender | undefined;
  /** sessionId → 当前 session 的 resolver（manualApproval=true 时维护）。 */
  private readonly _resolversBySession = new Map<string, PermissionResolver>();

  constructor(
    private readonly deps: SessionManagerDeps,
    opts: SessionManagerOptions = {},
  ) {
    // env 读取（NaN / <=0 兜底 1800）。
    const envRaw = Number(process.env.SESSION_IDLE_TIMEOUT_SEC);
    const envTimeout =
      Number.isFinite(envRaw) && envRaw > 0 ? envRaw : DEFAULT_IDLE_TIMEOUT_SEC;
    // opts.idleTimeoutSec 优先于 env（测试显式覆盖）；若 opts 给非法值也兜底。
    const optsTimeout = opts.idleTimeoutSec;
    this._idleTimeoutSec =
      optsTimeout !== undefined && Number.isFinite(optsTimeout) && optsTimeout > 0
        ? optsTimeout
        : envTimeout;
    const optsScan = opts.idleScanSec;
    this._idleScanSec =
      optsScan !== undefined && Number.isFinite(optsScan) && optsScan > 0
        ? optsScan
        : DEFAULT_IDLE_SCAN_SEC;

    // task-08：远程人审三件套。manualApproval=true 时 resolverFactory/wsClient 必需。
    this._manualApproval = opts.manualApproval === true;
    // resolver 直接作为工厂：用户传实例时工厂返回它（测试用单例）；生产路径
    // 传 () => new PermissionResolver() 每 session 一个。这样保持 API 简单又灵活。
    if (opts.permissionResolver !== undefined) {
      const r = opts.permissionResolver;
      this._permissionResolverFactory = () => r;
    } else if (this._manualApproval) {
      this._permissionResolverFactory = () => new PermissionResolver();
    } else {
      this._permissionResolverFactory = undefined;
    }
    this._permissionWsClient = opts.permissionWsClient;
    if (this._manualApproval) {
      if (!this._permissionResolverFactory) {
        throw new Error(
          'SessionManager: manualApproval=true requires permissionResolver',
        );
      }
      if (!this._permissionWsClient) {
        throw new Error(
          'SessionManager: manualApproval=true requires permissionWsClient',
        );
      }
    }
  }

  /** task-08：manual_approval 当前是否启用（测试 / daemon 透传用）。 */
  get manualApproval(): boolean {
    return this._manualApproval;
  }

  /**
   * task-08：按 sessionId 取 resolver（daemon._handleWsMessage 路由
   * PERMISSION_RESPONSE 时调用 resolver.resolve）。session 不存在或
   * manualApproval=false 时返回 undefined。
   */
  getPermissionResolver(sessionId: string): PermissionResolver | undefined {
    return this._resolversBySession.get(sessionId);
  }

  /**
   * 创建 session 并启动 driver 协程（design §7.6）。
   *
   * @throws {SessionAlreadyExistsError} 重复 sessionId
   * @throws {UnsupportedProviderError} provider 非 claude
   * @throws {ClaudeExecutableNotFoundError} executable 缺失（driver.start 内抛，透传）
   */
  async create(input: CreateSessionInput): Promise<void> {
    if (input.provider !== 'claude') {
      throw new UnsupportedProviderError(input.provider);
    }
    if (this._store.has(input.sessionId)) {
      throw new SessionAlreadyExistsError(input.sessionId);
    }

    // 1. 建 InputQueue，push 首 SDKUserMessage（spike H2 实测形态）。
    const inputQueue = new InputQueue();
    const firstMsg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: input.firstPrompt },
      parent_tool_use_id: null,
    };
    inputQueue.push(firstMsg);

    // 2. 写 SessionState（status=running，首 turn 的 currentRunId=firstRunId）。
    const state: SessionState = {
      sessionId: input.sessionId,
      leaseId: input.leaseId,
      inputQueue,
      status: 'running',
      currentRunId: input.firstRunId,
      lastActiveAt: Date.now(),
      cwd: input.cwd,
      provider: input.provider,
      pathToClaudeCodeExecutable: input.pathToClaudeCodeExecutable,
    };
    this._store.set(input.sessionId, state);

    // 3. driver.start（若 executable 缺失，这里抛 ClaudeExecutableNotFoundError；
    //    state 已写入 store，但 driver 协程未启动——由 onError 路径不会触发，
    //    daemon 在 _startInteractiveSession 内 try/catch 把 session 收 failed）。
    try {
      // task-08（D-007@v1 / FR-07）：manual_approval=true 时为当前 session 建独立
      // resolver（每 session 一份，互不干扰）+ 构造远程人审 canUseTool 回调；
      // false（默认）时不传，SDK 走内置默认策略（spike H1 行为不变）。
      let resolver: PermissionResolver | undefined;
      const driverOpts: Record<string, unknown> = {
        pathToClaudeCodeExecutable: input.pathToClaudeCodeExecutable,
        cwd: input.cwd,
        model: input.model,
        allowedTools: input.allowedTools,
      };
      if (
        this._manualApproval &&
        this._permissionResolverFactory &&
        this._permissionWsClient
      ) {
        resolver = this._permissionResolverFactory();
        this._resolversBySession.set(input.sessionId, resolver);
        driverOpts.canUseTool = this._buildCanUseToolCallback(input.sessionId);
      }
      const query = this.deps.driver.start(
        inputQueue,
        driverOpts as unknown as Parameters<ClaudeSdkDriver['start']>[1],
      );
      state.query = query;

      // 4. 异步 fire driver.consume（不阻塞 create 返回）。
      void this._runConsume(state);
      // task-10：create 成功排队 flush（agentSessionId 尚未写入，snapshotPersistable
      // 会过滤；真正的「带 agentSessionId 落盘」发生在 _onMessage system/init 后再 flush）。
      this._scheduleFlush();
    } catch (e) {
      // driver.start 抛错（executable 缺失等）：state 已在 store，标 failed。
      this._store.delete(input.sessionId);
      // task-08：create 失败前若已注册 pending resolver（register 在 start 前，
      // 但 start 抛错发生在 register 之后极不可能），防御性 abortAll 清理。
      const r = this._resolversBySession.get(input.sessionId);
      if (r) {
        r.abortAll('session_create_failed');
        this._resolversBySession.delete(input.sessionId);
      }
      throw e;
    }
  }

  /**
   * task-08（D-007@v1 / spike-02 §3.7 D2）+ task-09（deny 收敛）：
   * 构造 canUseTool 远程人审回调。
   *
   * 回调内不本地批准、不读 credentials.json，唯一出口是 permissionResolver.register
   * 返回的 promise（SDK 全程 await，spike D2 已证不超时）：
   *   1. session 非 running turn / 无 currentRunId → 立即 deny（防 interrupt 后 SDK
   *      仍触发回调，spike D1 result 边界已收敛，但防御性 fail-closed）；
   *   2. resolver.register（内部 send PERMISSION_REQUEST + 启 5min 兜底 + 链 AbortSignal）；
   *   3. await promise → 返回 {behavior}。
   *
   * **task-09 deny 收敛（FR-07 / D-007@v1 / AC-09.1）**：
   *   - 远程 deny 未带 message 时用默认模板（含 toolName / sessionId / runId），
   *     让 claude 拿到可读原因决定下一步；禁止返回空 message；
   *   - driver 不二次决策、不强制结束 turn；deny.message 原样经 SDK 回喂；
   *   - allow 不篡改 input（不附加 updatedInput）。
   *
   * **task-09 边界 12（wrapper 自身异常）**：
   *   resolver.register 抛 / await 抛 → catch 后返回 deny（带原因 message），
   *   不向上抛让 SDK 把包装器异常当 query 失败；并保证 registry 不残留半登记条目。
   *
   * @param sessionId  bind 给当前 session 的回调（同一 SessionManager 多 session 时各独立）。
   */
  private _buildCanUseToolCallback(sessionId: string): CanUseTool {
    return async (
      toolName: string,
      toolInput: unknown,
      options?: { signal?: AbortSignal },
    ): ReturnType<CanUseTool> => {
      const state = this._store.get(sessionId);
      // state 不存在 / 非 running turn / 无 currentRunId → fail-closed deny。
      if (
        !state ||
        state.status !== 'running' ||
        state.currentRunId === undefined
      ) {
        return { behavior: 'deny', message: 'session not in running turn' };
      }
      const runId = state.currentRunId;
      // task-09：默认 deny message 模板（含 toolName / sessionId / runId），
      // 远程 deny 未带 message 时回填，让 claude 拿到可读原因自决定收敛行为。
      const defaultDenyMessage = `Tool "${toolName}" denied by reviewer (session=${sessionId}, run=${runId})`;
      // resolver/wsClient 在 manualApproval=true 时已校验存在。
      const resolver = this._resolversBySession.get(sessionId);
      const wsClient = this._permissionWsClient;
      if (!resolver || !wsClient) {
        // 不应发生（create 时已建 resolver）；防御性 deny。
        return { behavior: 'deny', message: defaultDenyMessage };
      }
      try {
        // resolver.register 内部 send 失败 / signal aborted 时立即 deny（fail-closed）。
        const { promise } = resolver.register({
          sessionId,
          runId,
          toolName,
          toolInput:
            toolInput && typeof toolInput === 'object'
              ? (toolInput as Record<string, unknown>)
              : { value: toolInput },
          signal: options?.signal,
          send: (msg) => wsClient.send(msg),
        });
        // SDK PermissionResult.deny.message 必填；resolver CanUseToolDecision 的
        // deny.message 可选——此处补默认 message 兜底（task-09：含上下文字段）。
        const decision = await promise;
        if (decision.behavior === 'deny') {
          return {
            behavior: 'deny',
            message: decision.message ?? defaultDenyMessage,
          };
        }
        return { behavior: 'allow' };
      } catch (err) {
        // task-09 边界 12：wrapper 自身异常（register 抛 / promise reject 非正常路径）
        // → catch 后返回 deny（带原因），不向上抛让 SDK 把它当 query 失败。
        const reason =
          err instanceof Error ? err.message : String(err ?? 'unknown error');
        return {
          behavior: 'deny',
          message: `${defaultDenyMessage}: wrapper error (${reason})`,
        };
      }
    };
  }

  /** driver.consume 协程：一个 session 启动一次，跨多 turn。 */
  private async _runConsume(state: SessionState): Promise<void> {
    const q = state.query;
    if (!q) return;
    try {
      await this.deps.driver.consume(q, {
        onResult: (r) => this._onResult(state, r),
        onMessage: (m) => this._onMessage(state, m),
        onError: (e) => {
          // 边界 2：query 异常 → fail。fail 内部幂等。
          void this.fail(state.sessionId).then(() => undefined, () => undefined);
          // 记录原始错误（便于 daemon 日志），consume 已结束。
          this._lastError = e;
        },
      });
    } catch {
      // consume 自身不应抛（driver.consume 内 try/catch），防御性标 failed。
      void this.fail(state.sessionId).then(
        () => undefined,
        () => undefined,
      );
    }
    // task-08（生命周期收敛）+ task-09 边界 12（防御性）：consume 退出（正常 result
    // 结束 / generator throw）时清空当前 session 的 pending resolver，绝不让回调悬空
    // 或跨 turn 命中。manualApproval=false 时该 session 无 resolver，?. 不调。
    // task-09：abortAll 调用包 try/catch（resolver 可能是 mock / 缺方法的测试替身，
    // 或 resolver 内部异常）—— 绝不让清理路径自身抛出导致 daemon 主循环崩 / zombie promise。
    const exitingResolver = this._resolversBySession.get(state.sessionId);
    if (exitingResolver && typeof exitingResolver.abortAll === 'function') {
      try {
        exitingResolver.abortAll('consume_exited');
      } catch {
        // 清理路径不抛（resolver 内部异常已被 settle 的 promise 吞，pending 不残留）。
      }
    }
  }

  /** 最近一次 driver error（测试 / 日志用）。 */
  private _lastError: unknown = null;

  /**
   * 追问：push 新 SDKUserMessage（spike H2/S1）。
   *
   * task-07 增量（R-conv / spike S1 排队检测，非拒绝）：
   *   - status=running（上一 turn 未 result）时 push 仍入 buffer（SDK 在当前 turn result
   *     后按 FIFO 消费 → 新 turn）；额外 pendingInjectCount++ + onTurnQueued 回调通知
   *     backend「排队中」（UI 可提示），让 inject 行为可观察、可解释。
   *   - 绝不拒绝并发 inject（spike S1 实测：priority:'now' 仍排队到下一 turn）。
   *
   * @throws {SessionNotFoundError}
   * @throws {SessionNotActiveError} status ∈ {ended, failed, reconnecting}
   */
  async inject(sessionId: string, prompt: string, runId: string): Promise<InjectResult> {
    const state = this._store.get(sessionId);
    if (!state) {
      throw new SessionNotFoundError(sessionId);
    }
    if (state.status === 'ended' || state.status === 'failed' || state.status === 'reconnecting') {
      throw new SessionNotActiveError(sessionId, state.status);
    }

    // task-07 排队检测：在切换 status 前抓取「前一 turn 是否未 result」。
    // status=running（driver 正在跑 turn）→ 本条 inject 排队到下一 turn（spike S1）。
    const wasRunningBeforeInject = state.status === 'running';

    // spike S1：push 永远进 InputQueue（turn 级串行由 SDK result 边界保证），不拒绝。
    // currentRunId 在前 turn result 收尾前由本 inject 切换（task-04 既有行为，保留）：
    // inject 时 backend 行锁已防重复创建，daemon 侧 currentRunId 反映「即将执行的 run」。
    state.inputQueue.push({
      type: 'user',
      message: { role: 'user', content: prompt },
      parent_tool_use_id: null,
    });
    state.currentRunId = runId;
    state.status = 'running';
    state.lastActiveAt = Date.now();
    // task-10：inject push 后排队 flush（含 currentRunId，崩溃对账用）。
    this._scheduleFlush();

    if (wasRunningBeforeInject) {
      // 本条 inject 排在前一未 result turn 之后（spike S1 QUEUED 语义）。
      const next = (this._pendingInjectCount.get(sessionId) ?? 0) + 1;
      this._pendingInjectCount.set(sessionId, next);
      // onTurnQueued 可选（types.ts 的 SessionManagerDeps 未声明该字段，结构探测消费，
      // 不改 task-04 接口签名）。未注入则只计数不通知，不报错。
      const cb = (this.deps as SessionManagerDepsWithQueued).onTurnQueued;
      if (typeof cb === 'function') {
        await cb(sessionId, runId, next);
      }
    } else {
      // 首条 inject（无前置 turn 在跑）：确保计数存在且为 0（_onResult 递减不会负）。
      if (!this._pendingInjectCount.has(sessionId)) {
        this._pendingInjectCount.set(sessionId, 0);
      }
    }

    return { runId };
  }

  /**
   * spike D1：turn 级 interrupt。
   *   - session 不存在 / 无 query → no-op false
   *   - status=active（无 running turn）→ no-op false
   *   - status=running → driver.interrupt(query)，返回其结果
   *
   * task-07 增量：interrupt 本身不改 status（spike D1：终态由 _onResult 按 SDK 实际
   * result subtype=error_during_execution 收尾）；但更新 lastActiveAt（算用户活动）。
   * driver.interrupt 返回 false（q=null/已结束）→ SessionManager 保守返回 false，不改
   * status、不调 onTurnResult（避免对已结束 query 误标 failed）。
   */
  async interrupt(sessionId: string): Promise<boolean> {
    const state = this._store.get(sessionId);
    if (!state) return false;
    if (state.status !== 'running') return false;
    // task-08（AC-08.7）：interrupt 时 SDK 会 abort canUseTool 回调的 signal
    //（resolver 内 signal abort → 立即 deny），但保险起见也 abortAll 当前 session
    // 的 pending resolver（pending 回调不应跨 interrupt 续）。SDK result 边界
    // 会再次 abortAll，幂等无副作用。
    const interrupted = await this.deps.driver.interrupt(state.query ?? null);
    if (interrupted) {
      // interrupt 信号本身不等同 run 终态（spike D1：等 SDK 吐 result subtype=
      // error_during_execution 才收敛）。但算用户活动（影响空闲回收）。
      state.lastActiveAt = Date.now();
      // task-08：interrupt 已生效，pending 审批不再有意义 → abortAll deny。
      this._resolversBySession.get(sessionId)?.abortAll('session_interrupted');
      // task-10：interrupt 后排队 flush（currentRunId 仍在，等 result 收尾）。
      this._scheduleFlush();
    }
    return interrupted;
  }

  /**
   * task-07（R-conv 可观察性）：查询某 session 当前排队中的 inject 计数。
   * session 不存在或无排队返回 0。
   */
  getPendingInjectCount(sessionId: string): number {
    return this._pendingInjectCount.get(sessionId) ?? 0;
  }

  /**
   * task-07（FR-06 / D-004@v1）：当前空闲阈值秒（env / opts / 默认 1800）。
   * 测试 + daemon 透传 env 校验用。
   */
  getIdleTimeoutSec(): number {
    return this._idleTimeoutSec;
  }

  /**
   * task-07（FR-06 / D-004@v1）：启动空闲扫描定时器。daemon.start 后调用。幂等。
   *
   * 守卫：_idleTimer 已存在直接 return（多次 start 不创建多个定时器）。
   * unref：不阻止 node 进程退出（daemon.shutdown 显式 stop）。
   * 单 session end 失败由 _scanIdle 外层 catch 隔离，不中断本轮扫描、不崩 daemon。
   */
  start(): void {
    if (this._idleTimer) return;
    this._idleTimer = setInterval(() => {
      void this._scanIdle().catch((err) => {
        // 扫描异常不崩 daemon；console.error 兜底（真实 log 在 daemon 层，此处仅兜底）。
        // eslint-disable-next-line no-console
        console.error('[session-manager] idle scan failed', err);
      });
    }, this._idleScanSec * 1000);
    // node 标准：定时器不阻塞 daemon 退出。
    if (typeof this._idleTimer.unref === 'function') {
      this._idleTimer.unref();
    }
  }

  /**
   * task-07（FR-06 / D-004@v1）：停空闲扫描定时器。daemon.shutdown 调用（顺序在 WS close
   * 之前，避免 shutdown 中途扫描又触发 end→onSessionEnd→WS 已关报错）。幂等。
   *
   * 不主动 end 所有 session（避免 shutdown 风暴 backend）；active session 内存态随进程
   * 退出丢失（D-003 Wave1/2=failed），backend 侧 lease 心跳超时/WS 断开兜底收口。
   */
  stop(): void {
    if (this._idleTimer) {
      clearInterval(this._idleTimer);
      this._idleTimer = null;
    }
  }

  /**
   * task-07 D-004 扫描一轮：active/running 且空闲超阈值的 session → end。
   *
   * 快照 sessionId 列表（避免 end 修改 _store 时迭代异常）；ended/failed/reconnecting
   * 跳过；单 session end 抛错外层 catch 隔离，不中断本轮其余 session 扫描。
   *
   * 公开为 scanOnce（生产定时器调 + 测试直接驱动单轮 + 未来运维手动触发），
   * 避免测试依赖 setInterval 在 fake timer 下的嵌套宏任务时序。
   */
  async scanOnce(): Promise<void> {
    return this._scanIdle();
  }

  private async _scanIdle(): Promise<void> {
    const now = Date.now();
    // 快照 sessionId 列表，避免 end 修改 _store 时迭代异常。
    const ids = Array.from(this._store.keys());
    for (const sessionId of ids) {
      const state = this._store.get(sessionId);
      if (!state) continue;
      // 守卫：仅 active/running 回收；ended/failed/reconnecting 跳过。
      if (state.status !== 'active' && state.status !== 'running') continue;
      const idleSec = (now - state.lastActiveAt) / 1000;
      if (idleSec > this._idleTimeoutSec) {
        try {
          await this._onIdleExpire(state);
        } catch (err) {
          // 单 session end 失败不中断本轮其余扫描；记日志后继续下一周期。
          // eslint-disable-next-line no-console
          console.error('[session-manager] idle expire failed', sessionId, err);
        }
      }
    }
  }

  /**
   * task-07 空闲到期：走 end 统一收口（design §8.5 service.end_session）。
   *
   * running turn 进行中：先 interrupt（spike D1 turn 级）兜底，避免 end 时
   * InputQueue.close 与 SDK 当前 turn result 竞态无人收尾；interrupt 抛错忽略，
   * 靠 end 的 InputQueue.close 让 query 自然结束。
   */
  private async _onIdleExpire(state: SessionState): Promise<void> {
    if (state.status === 'running' && state.query) {
      try {
        await this.deps.driver.interrupt(state.query);
      } catch {
        // interrupt 失败不阻塞 end；end 会 close InputQueue 让 query 自然结束。
      }
    }
    await this.end(state.sessionId);
    // backend end_session 统一更新 agent_sessions.status=ended + lease=completed（design §8.5）
  }

  /**
   * 结束 session：close InputQueue（让 query 自然结束），status=ended，调 onSessionEnd。
   * 幂等：已 ended/failed 直接返回。
   */
  async end(sessionId: string): Promise<void> {
    const state = this._store.get(sessionId);
    if (!state) return;
    if (state.status === 'ended' || state.status === 'failed') return;
    state.status = 'ended';
    // task-08（AC-08.7）：session 终态时 abortAll 当前 session 的 pending 审批
    // + 移除 resolver（session 不再可 inject，resolver 无存在意义）。
    this._abortPermissionResolver(sessionId, 'session_ended');
    try {
      state.inputQueue.close();
    } catch {
      /* close 幂等，已 closed 不抛 */
    }
    await this.deps.onSessionEnd(state.sessionId, 'ended');
    // task-10：终态从落盘集合移除后 flush（不复活 ended session）。
    this._scheduleFlush();
  }

  /** 标 failed（driver onError / 不可恢复异常）。幂等。 */
  async fail(sessionId: string): Promise<void> {
    const state = this._store.get(sessionId);
    if (!state) return;
    if (state.status === 'ended' || state.status === 'failed') return;
    state.status = 'failed';
    // task-08：failed 时同样 abortAll + 移除 resolver。
    this._abortPermissionResolver(sessionId, 'session_failed');
    try {
      state.inputQueue.close();
    } catch {
      /* noop */
    }
    await this.deps.onSessionEnd(state.sessionId, 'failed');
    // task-10：终态从落盘集合移除后 flush（不复活 failed session）。
    this._scheduleFlush();
  }

  /**
   * task-08：abort 当前 session 的 pending resolver 并从 map 移除（幂等）。
   * manualApproval=false 时该 session 无 resolver，no-op。
   */
  private _abortPermissionResolver(sessionId: string, reason: string): void {
    const r = this._resolversBySession.get(sessionId);
    if (r) {
      r.abortAll(reason);
      this._resolversBySession.delete(sessionId);
    }
  }

  /** 查询（测试用 + daemon 路由校验用）。 */
  get(sessionId: string): Readonly<SessionState> | undefined {
    return this._store.get(sessionId);
  }

  // ── task-10：持久化 + 崩溃恢复 ──────────────────────────────────────────────

  /**
   * task-10（§4.3）：快照可恢复记录（active|running 且 agentSessionId 非空）。
   *
   * 供 flush 持久化用。ended/failed/reconnecting 不落盘；agentSessionId 空
   *（首 turn system/init 未到）也不落盘（不可恢复，D-003）。currentRunId 仅在
   * running 时携带（active 时为 undefined），重启对账用。
   */
  snapshotPersistable(): PersistedSessionRecord[] {
    const out: PersistedSessionRecord[] = [];
    for (const state of this._store.values()) {
      if (state.status !== 'active' && state.status !== 'running') continue;
      if (!state.agentSessionId) continue;
      const rec: PersistedSessionRecord = {
        sessionId: state.sessionId,
        leaseId: state.leaseId,
        agentSessionId: state.agentSessionId,
        cwd: state.cwd,
        provider: state.provider,
        turnCount: this._pendingInjectCount.has(state.sessionId)
          ? this._pendingInjectCount.get(state.sessionId)!
          : 0,
        lastActiveAt: state.lastActiveAt,
      };
      if (state.currentRunId) {
        rec.currentRunId = state.currentRunId;
      }
      if (state.pathToClaudeCodeExecutable) {
        rec.pathToClaudeCodeExecutable = state.pathToClaudeCodeExecutable;
      }
      out.push(rec);
    }
    return out;
  }

  /**
   * task-10（§6 + spike D3）：用持久化 agentSessionId 调 driver.start({resume})
   * 在固定 cwd 重启 driver，重建跨进程上下文。
   *
   * 流程：
   *   1. 构造 fresh InputQueue（新对象，不恢复旧队列）。
   *   2. state = { reconnecting, currentRunId=undefined, agentSessionId=record.agentSessionId,
   *      cwd=record.cwd } 写入 _store。
   *   3. driver.start(inputQueue, { cwd: record.cwd, resume: record.agentSessionId, ... }).
   *      start 抛错 → fail → onSessionEnd(failed) + 从 store 移除。
   *   4. fire driver.consume 后台协程（不阻塞返回）。
   *
   * **不 push 任何 SDKUserMessage**（resume query 不带 prompt，spike D3：resume
   * 不带 prompt 时 SDK 空闲，等下一次 inject 才跑新 turn）。
   * 调用方在 backend recover 成功后调 markReconnected 切 active。
   */
  async restoreAndReconnect(record: PersistedSessionRecord): Promise<void> {
    if (record.provider !== 'claude') {
      throw new UnsupportedProviderError(record.provider);
    }
    if (this._store.has(record.sessionId)) {
      throw new SessionAlreadyExistsError(record.sessionId);
    }

    const inputQueue = new InputQueue();
    const state: SessionState = {
      sessionId: record.sessionId,
      leaseId: record.leaseId,
      agentSessionId: record.agentSessionId,
      inputQueue,
      status: 'reconnecting',
      currentRunId: undefined, // 崩溃 currentRun 由 backend 收敛，daemon 不持有。
      lastActiveAt: record.lastActiveAt,
      cwd: record.cwd,
      provider: record.provider,
      pathToClaudeCodeExecutable: record.pathToClaudeCodeExecutable ?? '',
    };
    this._store.set(state.sessionId, state);

    // 探测 executable（D-009）：记录里带则复用，否则用空串（driver.start 内
    // resolveClaudeExecutable 对空串抛 ClaudeExecutableNotFoundError → 同步 catch）。
    const exe = record.pathToClaudeCodeExecutable ?? '';

    try {
      const driverOpts: Record<string, unknown> = {
        pathToClaudeCodeExecutable: exe,
        cwd: record.cwd, // R-cwd：必须用记录 cwd。
        resume: record.agentSessionId, // spike D3 跨进程 resume。
      };
      if (record.model) {
        driverOpts.model = record.model;
      }
      // task-08：恢复路径不重建 permission resolver（canUseTool 由 daemon 在
      // manualApproval=true 时按 session 重建；恢复后 session 若触发 canUseTool
      // 由 task-08 既有路径接住。本任务 manualApproval 默认 false，不注入 canUseTool）。
      const query = this.deps.driver.start(
        inputQueue,
        driverOpts as unknown as Parameters<ClaudeSdkDriver['start']>[1],
      );
      state.query = query;
      // fire consume 后台协程（同 create，长生命周期）。
      void this._runConsume(state);
    } catch {
      // driver.start 抛错（cwd 不一致 / executable 缺失 / SDK jsonl 缺失）：
      // 同步收敛 → onSessionEnd(failed) + 从 store 移除（不复活）。
      // 不重新抛错：调用方（daemon 启动编排）通过检查 get(sessionId)===undefined
      // 判断恢复失败（记录已不在内存 store），再调 HubClient.markRecoveryFailed
      // + persistence 删记录。原始错误在 driver.consume onError 内已被记 _lastError。
      this._store.delete(state.sessionId);
      this._abortPermissionResolver(state.sessionId, 'restore_failed');
      this._scheduleFlush();
      try {
        await this.deps.onSessionEnd(state.sessionId, 'failed');
      } catch {
        // onSessionEnd 不应阻塞 restore 收敛；吞错但不丢主路径。
      }
    }
  }

  /**
   * task-10：reconnecting → active；flush（清 currentRunId）。
   *
   * 只能从 reconnecting 转入（restoreAndReconnect 之后调）。
   * daemon 启动编排在 driver.resume 成功后调此方法，再向 backend confirm。
   *
   * @throws {SessionNotFoundError} session 不存在
   * @throws {Error} session 非 reconnecting 状态（不能从 active 等转入）
   */
  async markReconnected(sessionId: string): Promise<void> {
    const state = this._store.get(sessionId);
    if (!state) {
      throw new SessionNotFoundError(sessionId);
    }
    if (state.status !== 'reconnecting') {
      throw new Error(
        `markReconnected: session ${sessionId} not reconnecting (status=${state.status})`,
      );
    }
    state.status = 'active';
    state.currentRunId = undefined;
    state.lastActiveAt = Date.now();
    this._scheduleFlush();
  }

  /**
   * task-10：强制把当前内存 store 落盘（snapshotPersistable → persistence.save）。
   *
   * daemon stop / 测试显式 flush 用。未注入 persistence → no-op（向后兼容 task-04）。
   */
  async flush(): Promise<void> {
    await this._flushNow();
  }

  /**
   * task-10：排队一次 flush（去抖合并到 microtask）。
   *
   * 多次状态变更（create + onResult + end 在同一 tick）只产生一次 save，
   * 避免高频率落盘。queue 已在途则复用，不叠加。
   */
  private _flushScheduled: Promise<void> | null = null;
  private _scheduleFlush(): void {
    if (!this.deps.persistence) return;
    if (this._flushScheduled) return;
    this._flushScheduled = (async () => {
      // 让出当前 microtask，让同一 tick 内的多次状态变更合并。
      await Promise.resolve();
      this._flushScheduled = null;
      await this._flushNow();
    })().catch((err) => {
      this._flushScheduled = null;
      // flush 失败不崩 session 运行（落盘是恢复索引，不是运行依赖）；
      // 记日志后继续（不吞错到调用方，但不在状态变更路径上抛）。
      // eslint-disable-next-line no-console
      console.error('[session-manager] flush failed', err);
    });
  }

  /** 立即落盘当前快照（无去抖）。 */
  private async _flushNow(): Promise<void> {
    if (!this.deps.persistence) return;
    const records = this.snapshotPersistable();
    await this.deps.persistence.save(records);
  }

  // ── 内部：driver.consume 回调 ────────────────────────────────────────────────

  /**
   * onResult（spike D4：result 是干净 turn 边界）。
   *   - result.subtype=success → onTurnResult(sessionId, currentRunId, result)
   *   - is_error / subtype=error_* → onTurnResult（backend 据 is_error 标 failed/interrupted）
   *   - status: running → active（currentRunId 清空，待下个 inject 下发新 runId）
   *   - ended 时不重复调（边界 8：END 与 turn 完成竞态，幂等）
   *   - lastActiveAt 更新
   */
  private async _onResult(state: SessionState, result: SDKResultMessage): Promise<void> {
    if (state.status === 'ended' || state.status === 'failed') {
      // 迟到的 result，session 已收口：不重复发终态，避免双 onTurnResult。
      return;
    }
    // 先切换 status→active + 清空 currentRunId（turn 边界已落，spike D4），
    // 再 await onTurnResult。这样即便调用方同步触发 onResult（fire-and-forget），
    // 也能在 onTurnResult 回调内读到稳定的 active 状态；且避免 onTurnResult 抛错时
    // status 残留 running（虽然 onTurnResult 应不抛，但先收敛更鲁棒）。
    const runId = state.currentRunId;
    state.status = 'active';
    state.currentRunId = undefined;
    state.lastActiveAt = Date.now();
    // task-07（R-conv 边界 8）：每收一个 result 表示消费了一条 turn（含排队 inject）。
    // pendingInjectCount 递减（min 0，不下溢）；表示一条排队 turn 被消费。
    const cur = this._pendingInjectCount.get(state.sessionId) ?? 0;
    if (cur > 0) {
      this._pendingInjectCount.set(state.sessionId, cur - 1);
    } else {
      // 确保 map 中存在该 sessionId 条目（即便为 0），便于 getPendingInjectCount 稳定返回。
      if (!this._pendingInjectCount.has(state.sessionId)) {
        this._pendingInjectCount.set(state.sessionId, 0);
      }
    }
    if (runId !== undefined) {
      // task-08（AC-08.8）：turn result 完成时 abort 当前 turn 的 pending resolver。
      // spike D4：result 后无孤儿 canUseTool，但防御性 fail-closed——本 turn 的
      // pending 审批（若 canUseTool 回调还没 settle）立即 deny。resolver 实例
      // 不删（session 仍 active，下个 inject 还要用同一 resolver）。
      this._resolversBySession
        .get(state.sessionId)
        ?.abortAll('turn_completed');
      await this.deps.onTurnResult(state.sessionId, runId, result);
    }
    // task-10：turn result 收尾后排队 flush（currentRunId 已清空）。
    this._scheduleFlush();
  }

  /**
   * onMessage：system/init 写 agentSessionId（只写一次）；其余转发 onTurnMessage。
   */
  private async _onMessage(state: SessionState, msg: SDKMessage): Promise<void> {
    if (
      msg &&
      typeof msg === 'object' &&
      (msg as { type?: string }).type === 'system' &&
      (msg as { subtype?: string }).subtype === 'init'
    ) {
      const sid = (msg as { session_id?: string }).session_id;
      if (sid && state.agentSessionId === undefined) {
        state.agentSessionId = sid;
        // task-10：首 turn system/init 拿到 agentSessionId 后才可恢复 → 排队 flush。
        this._scheduleFlush();
      }
    }
    const runId = state.currentRunId;
    if (runId !== undefined) {
      await this.deps.onTurnMessage(state.sessionId, runId, msg);
    }
  }
}
