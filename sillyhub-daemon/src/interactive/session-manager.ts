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
  OnUserDialog,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
  UserDialogResult,
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
  /**
   * onUserDialog（SDK request_user_dialog / AskUserQuestion 真实路由）能渲染的
   * dialog kind 列表。manualApproval=true 时缺省 ['AskUserQuestion']。
   *
   * SDK 契约：supportedDialogKinds 非空且 onUserDialog 注入时，AskUserQuestion 等
   * 声明的 kind 经 onUserDialog 回调（发 PERMISSION_REQUEST 带 dialog_kind/
   * dialog_payload 等前端答案），而非 canUseTool（canUseTool 只能 allow/deny
   * 无法回传用户选择）。manualApproval=false 时本字段无意义（不注入 onUserDialog）。
   */
  supportedDialogKinds?: string[];
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

/**
 * ql-20260621-partial：per-session partial 消息缓冲（streaming delta 节流）。
 *
 * includePartialMessages=true 后 SDK 会高频 emit SDKPartialAssistantMessage
 *（type='stream_event'，每个 content_block_delta 一条，通常 1-5 字符/token）
 * 和 SDKThinkingTokensMessage（type='system', subtype='thinking_tokens'）。
 * 若每条都直接 onTurnMessage → submitMessages → HTTP POST + DB commit +
 * Redis publish + SSE push，100 个 token 累积十几秒延迟（卡顿）。
 *
 * 策略：累积 delta 到 buffer，500ms 定时器批量 flush 为 [THINKING] /
 * [ASSISTANT] / [SYSTEM:thinking_tokens] stdout 消息（对齐 task-runner
 * _eventToMessages 格式 + 前端 normalize.ts [THINKING] 合并逻辑
 * ql-20260617-012）。完整 assistant message 到达时清空 buffer（delta 是
 * 完整内容的子集，避免重复）。session end/fail 时销毁 timer。
 */
interface PartialFlushBuffer {
  /** 累积的 thinking_delta.thinking 内容（待 flush）。 */
  thinking: string;
  /** 累积的 text_delta.text 内容（待 flush）。 */
  assistant: string;
  /** 最后一次 thinking_tokens.estimated_tokens（running total，非增量）。 */
  lastTokens: number;
  /** 上次已 flush 的 tokens 值（去重，仅在变化时 emit）。 */
  flushedTokens: number;
  /** 500ms flush 定时器句柄（null = idle，无 pending 内容）。 */
  timer: ReturnType<typeof setTimeout> | null;
  /**
   * task-11（FR-07/FR-08，design §5.3 D1/D2）：当前 turn 的 SDK message.id
   *（来自 message_start 事件，用于拼 segmentId = `${messageId}:${blockIndex}`）。
   * null = 尚未收到 message_start，退化方案用 currentRunId。
   */
  currentMessageId: string | null;
  /**
   * task-11：当前累积中的 thinking segment 的 segmentId（`messageId:index` 或
   * 退化 `runId:thinking`）。null = 当前 buffer 非 thinking 或尚未收到 delta。
   */
  currentSegmentId: string | null;
  /**
   * task-11：本 turn 已 flush 的 thinking partial segment 列表（供 _clearPartialBuffer
   * 在完整 message 到达时 emit [THINKING_OVERRIDE] 覆盖信号）。turn 边界
   *（_clearPartialBuffer）清空。
   */
  flushedSegments: Array<{ segmentId: string; logTimestamp: string }>;
  /**
   * task-11：本 turn 已到达完整 message 的 thinking segmentId 集合（late partial
   * 守卫：同 segment 的后续 partial 直接丢弃）。_clearPartialBuffer 后清空（turn 边界）。
   */
  completedSegments: Set<string>;
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
   * ql-20260621-partial：per-session partial 消息缓冲（streaming delta 节流）。
   * key = sessionId，value = PartialFlushBuffer（thinking/text delta 累积 +
   * 500ms flush 定时器）。create 时按需懒建，end/fail 时销毁。
   */
  private readonly _partialBuffers = new Map<string, PartialFlushBuffer>();

  /** partial flush 节流间隔（ms）。累积 delta 到此窗口后批量推送一次。 */
  private static readonly PARTIAL_FLUSH_MS = 500;

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
  /**
   * onUserDialog 支持的 dialog kind 列表（manualApproval=true 时注入到 driver
   * options.supportedDialogKinds，缺省 ['AskUserQuestion']）。manualApproval=false
   * 时不读（不注入 onUserDialog）。
   */
  private readonly _supportedDialogKinds: string[] | undefined;

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
    // onUserDialog 支持的 dialog kind：manualApproval=true 时缺省 ['AskUserQuestion']，
    // 调用方可显式覆盖（如 cli.ts 传不同列表或空数组禁用对话路由）。
    this._supportedDialogKinds =
      opts.supportedDialogKinds ??
      (this._manualApproval ? ['AskUserQuestion'] : undefined);
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
    // scan 真阻塞（generic-wibbling-whisper 改造点 C/B/D）：求值 effective
    // manualApproval / askUserOnly 并写入 state，供 snapshotPersistable 落盘 +
    // restoreAndReconnect 跨 daemon 重启恢复审批能力。
    const enableApproval = input.manualApproval ?? this._manualApproval;
    const effectiveAskUserOnly = input.askUserOnly === true;
    const state: SessionState = {
      sessionId: input.sessionId,
      leaseId: input.leaseId,
      claimToken: input.claimToken,
      inputQueue,
      status: 'running',
      currentRunId: input.firstRunId,
      lastActiveAt: Date.now(),
      cwd: input.cwd,
      provider: input.provider,
      pathToClaudeCodeExecutable: input.pathToClaudeCodeExecutable,
      env: input.env,
      manualApproval: enableApproval,
      askUserOnly: effectiveAskUserOnly,
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
      // gap-8：仅当 daemon 传入 env 时覆盖（缺省让 driver 回退裸 process.env，兼容）。
      if (input.env !== undefined) {
        driverOpts.env = input.env;
      }
      // scan 真阻塞（per-session，generic-wibbling-whisper.md 改造点 C）：
      // input.manualApproval 显式控制（chat=false / scan=true，来自 backend lease metadata）；
      // 未传时回退实例级 manualApproval（兼容现有测试 + cli.ts 实例级能力就绪）。
      // chat=false 不注入 canUseTool，避免其 AskUserQuestion 被 backend
      //（config.manual_approval=False）drop → 5min 超时 deny；scan=true 注入，真阻塞等人审。
      // enableApproval 已在 state 构造前求值（见上），此处复用。
      if (
        enableApproval &&
        this._permissionResolverFactory &&
        this._permissionWsClient
      ) {
        resolver = this._permissionResolverFactory();
        this._resolversBySession.set(input.sessionId, resolver);
        driverOpts.canUseTool = this._buildCanUseToolCallback(
          input.sessionId,
          effectiveAskUserOnly,
        );
        // onUserDialog 路由（SDK request_user_dialog 路径）：
        // supportedDialogKinds 非空才注入——SDK 契约「声明在此的 kind 才经
        // onUserDialog」。⚠️ 注意：AskUserQuestion 在 SDK headless 模式下实际
        // **不走** onUserDialog（它经 canUseTool 拦截，详见 _buildCanUseToolCallback
        // 的 askUserOnly 分支）；此处 supportedDialogKinds 仅对 SDK 真正发出
        // request_user_dialog 的其他 dialog kind 生效。默认 ['AskUserQuestion']：
        // 历史值，保留向后兼容（即便 AskUserQuestion 实际不路由到这里也不破坏其他 kind）。
        if (this._supportedDialogKinds && this._supportedDialogKinds.length > 0) {
          driverOpts.onUserDialog = this._buildOnUserDialogCallback(
            input.sessionId,
          );
          driverOpts.supportedDialogKinds = this._supportedDialogKinds;
        }
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
   *   - allow 不篡改 input：updatedInput 透传原始 toolInput（Claude CLI Zod 校验
   *     allow 分支 updatedInput required，缺字段报 ZodError；类型虽 optional 但运行时必填）；
   *
   * **task-09 边界 12（wrapper 自身异常）**：
   *   resolver.register 抛 / await 抛 → catch 后返回 deny（带原因 message），
   *   不向上抛让 SDK 把包装器异常当 query 失败；并保证 registry 不残留半登记条目。
   *
   * @param sessionId  bind 给当前 session 的回调（同一 SessionManager 多 session 时各独立）。
   */
  private _buildCanUseToolCallback(sessionId: string, askUserOnly: boolean): CanUseTool {
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
        !state.currentRunId
      ) {
        return { behavior: 'deny', message: 'session not in running turn' };
      }
      const runId = state.currentRunId;
      // Claude CLI 经 --permission-prompt-tool stdio 对 allow 分支做 Zod 运行时校验，
      // updatedInput 为 required（record）；SDK 类型虽标 optional 但 CLI 运行时必填，
      // 缺字段会报 ZodError invalid_union → 全量工具调用失败（scan 阻塞根因）。
      // toolInput 形态是 unknown，归一化为 record（非 object 包装成 { value }），
      // 既满足 Zod record 校验又给 resolver / allow 透传同一份。
      const updatedInput: Record<string, unknown> =
        toolInput && typeof toolInput === 'object'
          ? (toolInput as Record<string, unknown>)
          : { value: toolInput };
      // AskUserQuestion 拦截（所有模式共享，提到 askUserOnly 判断之前）：
      // AskUserQuestion 是 Claude Code 内置工具，在 TUI 模式通过 setToolJSX 渲染，
      // SDK headless 模式无法渲染 → allow 后 SDK 执行必失败 → 立即返回空结果
      //（"The user did not answer the questions"）。
      // 故不 allow：拦截 AskUserQuestion，经 resolver 发 PERMISSION_REQUEST 到前端
      //（前端据 tool_name=AskUserQuestion 渲染选项卡片），await 用户回答后把答案作为
      // deny message 回传给 Claude——canUseTool 唯一回传自定义内容给 Claude 的方式
      //（deny 语义虽不完美，但 Claude 把 deny.message 当 tool_result 看到答案继续工作）。
      // 此拦截对所有模式（askUserOnly true/false）生效：askUserOnly=true（scan）原本就
      // 拦截；askUserOnly=false（chat 交互式）现在也拦截，确保前端弹对话卡。
      // 超时 / abort / wrapper 异常 → deny 默认 message（让 Claude 按推荐项继续）。
      if (toolName === 'AskUserQuestion') {
        const askDefaultMsg =
          'User did not respond to the question. Proceed with the recommended option.';
        // resolver/wsClient 在 manualApproval=true 时已校验存在
        //（_buildCanUseToolCallback 仅在 enableApproval=true 分支内注入 driver，
        // 调用时一定存在）。防御性取值便于单测 / 边界容错。
        const askResolver = this._resolversBySession.get(sessionId);
        const askWsClient = this._permissionWsClient;
        if (!askResolver || !askWsClient) {
          return { behavior: 'deny', message: askDefaultMsg };
        }
        try {
          const { promise } = askResolver.register({
            sessionId,
            runId,
            toolName,
            toolInput: updatedInput,
            signal: options?.signal,
            send: (msg) => askWsClient.send(msg),
            // 标记为 dialog（AskUserQuestion 不是普通审批，是对话）：
            // backend handle_permission_request 见 dialog_kind 走 dialog 路径
            //（持久化 session_dialog_requests + 不 arm 5min 超时 + SSE 携带
            // dialog_kind/dialog_payload 让前端渲染问答卡而非 allow/deny 审批卡）。
            dialogKind: 'AskUserQuestion',
            dialogPayload: updatedInput,
          });
          const decision = await promise;
          if (decision.behavior === 'allow') {
            // 用户回答了。优先取 dialogResult（前端用户选择回传字段），
            // 否则 fallback 到兜底文案（兼容旧 backend 不识别 dialog_result 的 allow）。
            const dialogResult = (decision as { dialogResult?: unknown })
              .dialogResult;
            const answer =
              dialogResult !== undefined && dialogResult !== null
                ? dialogResult
                : 'no answer payload';
            return {
              behavior: 'deny',
              message: `User answered: ${JSON.stringify(answer)}`,
            };
          }
          // deny / 超时 / abort：让 Claude 按推荐项继续，不卡死 scan。
          return {
            behavior: 'deny',
            message:
              decision.message && decision.message.length > 0
                ? `User did not answer the question (${decision.message}). Proceed with the recommended option.`
                : askDefaultMsg,
          };
        } catch (err) {
          const reason =
            err instanceof Error ? err.message : String(err ?? 'unknown error');
          return {
            behavior: 'deny',
            message: `Failed to get user response (${reason}). Proceed with the recommended option.`,
          };
        }
      }
      // scan 真阻塞（AskUserQuestion-only 策略，改造点 D）：askUserOnly=true 的 session
      //（scan）AskUserQuestion 已在上方拦截，其他工具 allow-through 让 scan 自动推进；
      // 默认 askUserOnly=false（全工具人审的 chat）其他工具走 register
      //（task-08 远程审批危险工具语义不变）。
      if (askUserOnly) {
        // 其他工具正常 allow-through：透传归一化后的 updatedInput（不篡改语义，
        // 仅满足 Zod record 要求），让 scan 自动推进。
        return { behavior: 'allow', updatedInput };
      }
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
          toolInput: updatedInput,
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
        // 远程审批 allow：透传归一化后的 updatedInput（resolver 决策不携带 input 修改语义，
        // 不篡改；updatedInput 仅满足 Claude CLI Zod record 校验）。
        return { behavior: 'allow', updatedInput };
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

  /**
   * onUserDialog 回调（SDK request_user_dialog 路由）。
   *
   * ⚠️ AskUserQuestion **不走此路径**：AskUserQuestion 是 Claude Code 内置工具，在
   * SDK headless 模式下不会触发 SDK 的 request_user_dialog（它在 TUI 模式经 setToolJSX
   * 渲染，headless 模式 SDK 直接当普通工具调 canUseTool）。故 AskUserQuestion 的真实
   * 路由是 `_buildCanUseToolCallback` 的 askUserOnly 分支（拦截 → register → 答案经
   * deny.message 回喂 Claude）。
   *
   * 此回调仅对 SDK 真正发出 request_user_dialog 的其他 dialog kind 生效（保留能力，
   * 不影响其他 dialog 路由）。与 _buildCanUseToolCallback 同构但走 SDK 对话协议
   *（返回 {behavior:'completed', result} | {behavior:'cancelled'}），关键差异：
   *   - 走 PERMISSION_REQUEST 时 payload 额外带 dialog_kind + dialog_payload
   *     （backend/前端据此渲染对话卡而非普通审批卡）；
   *   - PERMISSION_RESPONSE.allow 带 dialog_result → 返回 {behavior:'completed',
   *     result: dialog_result}（前端用户选择的答案原样回喂 SDK）；
   *   - allow 但无 dialog_result → {behavior:'completed', result: null}（兼容
   *     旧 backend 不识别 dialog_result 的 allow，不让 SDK 因缺答案报错）；
   *   - deny / 超时 / abort / wrapper 异常 → {behavior:'cancelled'}（SDK 对
   *     cancelled 应用 dialog 默认行为；fail-closed，不本地编造答案）。
   *
   * state 非 running turn / 无 currentRunId / 无 resolver/wsClient → cancelled
   *（防 interrupt 后 SDK 仍触发回调，与 canUseTool 同 fail-closed 语义）。
   *
   * @param sessionId  bind 给当前 session 的回调（同一 SessionManager 多 session 时各独立）。
   */
  private _buildOnUserDialogCallback(sessionId: string): OnUserDialog {
    return async (
      request: {
        dialogKind: string;
        payload: Record<string, unknown>;
        toolUseID?: string;
      },
      options?: { signal?: AbortSignal },
    ): Promise<UserDialogResult> => {
      const state = this._store.get(sessionId);
      // state 不存在 / 非 running turn / 无 currentRunId → fail-closed cancelled。
      if (
        !state ||
        state.status !== 'running' ||
        !state.currentRunId
      ) {
        return { behavior: 'cancelled' };
      }
      const runId = state.currentRunId;
      const resolver = this._resolversBySession.get(sessionId);
      const wsClient = this._permissionWsClient;
      if (!resolver || !wsClient) {
        // 不应发生（create 时已建 resolver）；防御性 cancelled。
        return { behavior: 'cancelled' };
      }
      try {
        const { promise } = resolver.register({
          sessionId,
          runId,
          // toolName 标记 AskUserQuestion 便于 backend/前端按工具名分发；
          // 实际对话内容由 dialog_kind/dialog_payload 携带。
          toolName: 'AskUserQuestion',
          // toolInput 用 dialog payload（兼容既有的 input 字段，backend 侧若
          // 不读 dialog_payload 仍可从 input 渲染）。
          toolInput: request.payload,
          ...(request.toolUseID !== undefined
            ? { toolUseId: request.toolUseID }
            : {}),
          signal: options?.signal,
          send: (msg) => wsClient.send(msg),
          dialogKind: request.dialogKind,
          dialogPayload: request.payload,
        });
        const decision = await promise;
        if (decision.behavior === 'deny') {
          // deny / 超时 / abort：SDK cancelled 应用 dialog 默认行为。
          return { behavior: 'cancelled' };
        }
        // allow：dialog_result 存在则原样回喂，否则 null（不本地编造）。
        const dialogResult = (decision as { dialogResult?: unknown })
          .dialogResult;
        return {
          behavior: 'completed',
          result: dialogResult !== undefined ? dialogResult : null,
        };
      } catch {
        // wrapper 自身异常（register 抛 / await reject 非正常路径）→ cancelled，
        // 不向上抛让 SDK 把它当 query 失败。
        return { behavior: 'cancelled' };
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
  /**
   * gap-8.4（design §11）：刷新 session 的 lease 级 claim_token。
   *
   * 恢复路径（restoreAndReconnect）claimToken 占位空串（session-manager.ts:761）；
   * backend SESSION_INJECT 带 rotated claim_token（recover_session_after_daemon_restart
   * step 7 rotate），daemon 收到后调此方法刷新，让后续 onTurnMessage（submitMessages）
   * + onTurnResult（notifyRunResult）能用新 token（否则 warn 不调 → turn 卡）。
   * session 不存在 / token 空 → 静默 no-op。
   */
  async refreshClaimToken(sessionId: string, claimToken: string): Promise<void> {
    const state = this._store.get(sessionId);
    if (!state || !claimToken) return;
    state.claimToken = claimToken;
  }

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
    // ql-20260621-partial：daemon shutdown 时销毁所有 partial buffer 的 timer，
    // 防止 unref'd timer 在进程退出途中 fire 触发已销毁 store 的访问。
    for (const sid of Array.from(this._partialBuffers.keys())) {
      this._destroyPartialBuffer(sid);
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
    // ql-20260621-partial：销毁 partial buffer（含 timer），防止 end 后定时器
    // 仍 fire 推送到已结束 session。
    this._destroyPartialBuffer(sessionId);
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
    // ql-20260621-partial：销毁 partial buffer（含 timer），同 end。
    this._destroyPartialBuffer(sessionId);
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
      // scan 真阻塞（恢复路径用，generic-wibbling-whisper 改造点 C/B/D）：
      // manualApproval=true 时把审批标志 + askUserOnly 落盘，让 restoreAndReconnect
      // 跨 daemon 重启恢复审批能力。askUserOnly 即便 false 也写（否则恢复 fallback
      // 到 true 会把 chat 误当 scan）；manualApproval=false 不写（默认行为）。
      if (state.manualApproval === true) {
        rec.manualApproval = true;
        rec.askUserOnly = state.askUserOnly === true;
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
    // scan 真阻塞（恢复路径用，generic-wibbling-whisper 改造点 C/B/D）：
    // record 持久化字段优先，fallback 到实例级 _manualApproval / true（scan 主用场景）。
    // 旧 sessions.json（无 manualApproval/askUserOnly 字段）→ fallback 兼容。
    const restoreManualApproval =
      record.manualApproval ?? this._manualApproval;
    const restoreAskUserOnly = record.askUserOnly ?? true;
    const state: SessionState = {
      sessionId: record.sessionId,
      leaseId: record.leaseId,
      // gap-2：恢复路径的 claimToken 留空——崩溃恢复时 lease.claim_token 已被
      // backend rotate（recover_session_after_daemon_restart step 7），旧 token 失效。
      // 恢复后的 inject 由 backend SESSION_INJECT 重新下发新 claim_token；但本任务
      // 范围（task-01/02/03）不改恢复链路（task-05/10 owns），故占位空串不破坏类型。
      // 后续 task（恢复路径 token 协商）若需要会经 SESSION_INJECT payload 刷新。
      claimToken: '',
      agentSessionId: record.agentSessionId,
      inputQueue,
      status: 'reconnecting',
      currentRunId: undefined, // 崩溃 currentRun 由 backend 收敛，daemon 不持有。
      lastActiveAt: record.lastActiveAt,
      cwd: record.cwd,
      provider: record.provider,
      pathToClaudeCodeExecutable: record.pathToClaudeCodeExecutable ?? '',
      manualApproval: restoreManualApproval,
      askUserOnly: restoreAskUserOnly,
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
      // 恢复路径注入 canUseTool（与 create 对齐，generic-wibbling-whisper 改造点 C/D）：
      // manualApproval=true 时按 session 建独立 resolver + 注入远程人审回调 +
      // onUserDialog，让 daemon 重启后恢复的 session 保留审批能力（否则 SDK 走内置
      // 默认策略，AskUserQuestion 无阻塞 → scan 无法等人审）。
      if (
        restoreManualApproval &&
        this._permissionResolverFactory &&
        this._permissionWsClient
      ) {
        const resolver = this._permissionResolverFactory();
        this._resolversBySession.set(record.sessionId, resolver);
        driverOpts.canUseTool = this._buildCanUseToolCallback(
          record.sessionId,
          restoreAskUserOnly,
        );
        // onUserDialog 路由（SDK request_user_dialog 路径）：supportedDialogKinds
        // 非空才注入——SDK 契约「声明在此的 kind 才经 onUserDialog」。与 create
        // 对齐：默认 ['AskUserQuestion']，保留向后兼容。
        if (
          this._supportedDialogKinds &&
          this._supportedDialogKinds.length > 0
        ) {
          driverOpts.onUserDialog = this._buildOnUserDialogCallback(
            record.sessionId,
          );
          driverOpts.supportedDialogKinds = this._supportedDialogKinds;
        }
      }
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
    if (runId) {
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
    // task-11（边界 7）：turn 边界重置 completedSegments —— 新 turn 的 segmentId
    // 空间独立，避免跨 turn 误判 late partial。buffer 不销毁（session 仍 active）。
    const buf = this._partialBuffers.get(state.sessionId);
    if (buf) {
      buf.completedSegments = new Set<string>();
    }
  }

  /**
   * onMessage：system/init 写 agentSessionId（只写一次）；其余转发 onTurnMessage。
   *
   * ql-20260621-partial：识别 SDKPartialAssistantMessage（type='stream_event'）
   * 与 SDKThinkingTokensMessage（type='system', subtype='thinking_tokens'），
   * 累积到 per-session PartialFlushBuffer，由 500ms 定时器批量 flush 为
   * [THINKING]/[ASSISTANT]/[SYSTEM:thinking_tokens] stdout 消息（不直接转发，
   * 避免每 token 一次 HTTP）。完整 assistant message（type='assistant'）到达
   * 时清空 buffer（delta 是完整内容子集，backend _extract_sdk_messages 会展开
   * 完整 message 为全文 [THINKING]/[ASSISTANT]，partial delta 必须丢弃避免重复）。
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

    // ql-20260621-partial：partial 事件缓冲节流（不直接转发）。
    const msgType = msg && typeof msg === 'object'
      ? (msg as { type?: string }).type
      : undefined;
    const msgSubtype = msg && typeof msg === 'object'
      ? (msg as { subtype?: string }).subtype
      : undefined;
    if (
      msgType === 'stream_event' ||
      (msgType === 'system' && msgSubtype === 'thinking_tokens')
    ) {
      this._bufferPartial(state, msg);
      return; // 不直接转发；由 500ms 定时器批量 flush
    }

    // 完整 assistant message 到达 → 清空 partial buffer 的未 flush 尾部，
    // 避免与完整 message（backend 展开为全文）重复。
    if (msgType === 'assistant') {
      // task-11（design §5.3 D1/D2）：先抓已 flush partial 快照（sync 清理前），
      // 再 sync 清 buffer + 记 completedSegments，转发完整 message，最后异步 emit
      // [THINKING_OVERRIDE] 覆盖信号（必须在完整 message 之后，语义"完整行覆盖
      // partial 行"）。driver 的 onMessage 回调不 await _onMessage 返回值，故 override
      // 异步 emit 不影响转发时序。
      const completed = this._extractCompletedSegments(state, msg);
      const buf = this._partialBuffers.get(state.sessionId);
      const flushedSnapshot = buf
        ? buf.flushedSegments.slice()
        : [];
      // 第一阶段：sync 清 buffer + 记录 completedSegments（late partial 守卫立即生效）。
      this._clearPartialBufferSync(state.sessionId, completed);
      // 转发完整 message（保持原有 await onTurnMessage 语义）。
      const runId = state.currentRunId;
      if (runId) {
        await this.deps.onTurnMessage(state.sessionId, runId, msg);
      }
      // 第二阶段：异步 emit override 信号（fire-and-forget，不阻塞下一事件；
      // 失败仅记日志，不影响 turn 主流程）。
      this._emitOverrideSignals(state.sessionId, runId, completed, flushedSnapshot)
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[session-manager] thinking override emit failed', err);
        });
      return;
    }

    const runId = state.currentRunId;
    if (runId) {
      await this.deps.onTurnMessage(state.sessionId, runId, msg);
    }
  }

  // ── ql-20260621-partial：streaming delta 缓冲节流 ──────────────────────────

  /**
   * task-11（design §5.3 D1/D2）：拼 thinking segment 的稳定 segmentId。
   *
   * 优先方案：`${messageId}:${blockIndex}`（同 assistant message 内 content block
   * 数组下标稳定，跨 turn 用 messageId 隔离）。退化方案：message.id 缺失时退化为
   * `${runId}:thinking`（同 turn 所有 thinking 共享一个 segmentId，边界 6 接受精度损失）。
   *
   * @param buf 当前 PartialFlushBuffer（读 currentMessageId）
   * @param blockIndex content_block_delta 事件的 index 字段（缺失用 'thinking'）
   */
  private _resolveSegmentId(
    state: SessionState,
    buf: PartialFlushBuffer,
    blockIndex: number | undefined,
    messageIdHint?: string,
  ): string {
    const mid = messageIdHint ?? buf.currentMessageId;
    const idx = typeof blockIndex === 'number' ? String(blockIndex) : 'thinking';
    if (mid) {
      return `${mid}:${idx}`;
    }
    // 退化：同 turn 共享 segmentId（接受合并精度损失，边界 6）。
    const runKey = state.currentRunId ?? 'unknown';
    return `${runKey}:thinking`;
  }

  /**
   * task-11：从完整 assistant message 提取所有 thinking block 的 segmentId。
   *
   * 遍历 `msg.message.content` 数组，对 `type==='thinking'` 的 block 用其数组下标
   * 拼 segmentId（与 partial 的 `messageId:blockIndex` 对齐）。messageId 优先用
   * `msg.message.id`；缺失时退化到 currentRunId:thinking（同 _resolveSegmentId 策略）。
   */
  private _extractCompletedSegments(
    state: SessionState,
    msg: SDKMessage,
  ): Set<string> {
    const segments = new Set<string>();
    const message = (msg as { message?: { id?: string; content?: unknown } }).message;
    if (!message || typeof message !== 'object') return segments;
    const mid =
      typeof message.id === 'string' && message.id ? message.id : null;
    const runKey = state.currentRunId ?? 'unknown';
    const content = message.content;
    if (!Array.isArray(content)) return segments;
    for (let i = 0; i < content.length; i++) {
      const block = content[i] as { type?: string } | null;
      if (block && block.type === 'thinking') {
        segments.add(mid ? `${mid}:${i}` : `${runKey}:thinking`);
      }
    }
    return segments;
  }

  /**
   * 把一条 partial 事件（SDKPartialAssistantMessage / SDKThinkingTokensMessage）
   * 累积到 per-session buffer，并按需启动 500ms flush 定时器。
   *
   * content_block_delta.thinking_delta → buf.thinking += delta.thinking
   * content_block_delta.text_delta     → buf.assistant += delta.text
   * system/thinking_tokens             → buf.lastTokens = estimated_tokens
   * 其余 stream_event（message_start / content_block_start / message_delta 等）
   * 无显示内容，跳过（timer 可能空转一次，flush 时空 buffer no-op）。
   */
  private _bufferPartial(state: SessionState, msg: SDKMessage): void {
    const sessionId = state.sessionId;
    let buf = this._partialBuffers.get(sessionId);
    if (!buf) {
      buf = {
        thinking: '',
        assistant: '',
        lastTokens: 0,
        flushedTokens: 0,
        timer: null,
        currentMessageId: null,
        currentSegmentId: null,
        flushedSegments: [],
        completedSegments: new Set<string>(),
      };
      this._partialBuffers.set(sessionId, buf);
    }

    const msgType = (msg as { type?: string }).type;
    if (msgType === 'stream_event') {
      const event = (msg as { event?: unknown }).event;
      if (event && typeof event === 'object') {
        const ev = event as {
          type?: string;
          index?: number;
          delta?: { type?: string; thinking?: string; text?: string };
          message?: { id?: string };
        };
        // task-11：message_start 提取 message.id（segmentId 拼接用，跨 message 隔离）。
        // SDK 实测 message_start 带 message.id（Anthropic Messages API 标准）；若缺失
        //（退化方案）后续 segmentId 回退到 currentRunId。
        if (ev.type === 'message_start' && ev.message) {
          const mid = ev.message.id;
          if (typeof mid === 'string' && mid) {
            buf.currentMessageId = mid;
          }
        }
        // content_block_start 带 content_block.type==='thinking' 仅是开始标记，
        // thinking_delta 会跟随，无需特殊处理（避免 emit 空消息）。
        if (ev.type === 'content_block_delta' && ev.delta) {
          const delta = ev.delta;
          if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
            // task-11（边界 5，late partial 守卫）：完整 message 已覆盖该 segment
            // → 后到的 partial 直接丢弃（网络重排，罕见）。不累积、不重启 timer。
            // messageIdHint 从当前 msg 顶层提取（late partial 场景 buf.currentMessageId
            // 可能已被 _clearPartialBuffer 重置，但 late delta 仍带 message.id）。
            const msgMid = (msg as { message?: { id?: string } }).message?.id;
            const midHint =
              typeof msgMid === 'string' && msgMid ? msgMid : undefined;
            const segId = this._resolveSegmentId(
              state,
              buf,
              ev.index,
              midHint,
            );
            if (buf.completedSegments.has(segId)) {
              return;
            }
            buf.currentSegmentId = segId;
            buf.thinking += delta.thinking;
          } else if (delta.type === 'text_delta' && typeof delta.text === 'string') {
            buf.assistant += delta.text;
          }
        }
      }
    } else if (msgType === 'system') {
      // SDKThinkingTokensMessage：estimated_tokens 是 running total（非增量）。
      const tokens = (msg as { estimated_tokens?: number }).estimated_tokens;
      if (typeof tokens === 'number') {
        buf.lastTokens = tokens;
      }
    }

    // 启动 500ms 定时器（若未在跑）。首次 partial 触发，后续 partial 复用同一 timer
    // 直到 flush 清 timer；flush 后若仍有 partial 到达会重建 timer（自然节流）。
    if (buf.timer === null) {
      buf.timer = setTimeout(() => {
        this._flushPartial(sessionId).catch((err) => {
          // flush 失败不崩 session 运行；记日志后继续（buffer 清空，下次 partial 重建）。
          // eslint-disable-next-line no-console
          console.error('[session-manager] partial flush failed', err);
        });
      }, SessionManager.PARTIAL_FLUSH_MS);
      // unref 不阻止 node 退出（与 _idleTimer 同策略）。
      const t = buf.timer as unknown as { unref?: () => void };
      if (typeof t.unref === 'function') {
        t.unref();
      }
    }
  }

  /**
   * flush 一个 session 的 partial buffer：把累积的 thinking/text/tokens
   * 格式化为 [THINKING]/[ASSISTANT]/[SYSTEM:thinking_tokens] stdout 消息，
   * 调 onTurnMessage 推送（与 task-runner _eventToMessages 同格式，前端
   * normalize.ts 自动合并连续 [THINKING] delta）。
   *
   * 清空 buffer 内容 + timer 引用（idle）。无 currentRunId / session 不存在
   * 时丢弃（不推到已结束的 turn）。
   */
  private async _flushPartial(sessionId: string): Promise<void> {
    const buf = this._partialBuffers.get(sessionId);
    if (!buf) return;
    // 先清 timer 引用，让下次 partial 能重建（自然节流）。
    buf.timer = null;

    const state = this._store.get(sessionId);
    if (!state) {
      // session 已不存在（end/fail 已销毁 buffer，但定时器可能已 in-flight）。
      this._partialBuffers.delete(sessionId);
      return;
    }
    const runId = state.currentRunId;
    if (!runId) {
      // 无 active turn（turn 边界已过）→ 丢弃残留 buffer，不推到旧/空 runId。
      buf.thinking = '';
      buf.assistant = '';
      return;
    }

    // 快照累积内容后清空，允许 flush 期间（async await）继续累积到下个窗口。
    const thinking = buf.thinking;
    const assistant = buf.assistant;
    const tokens = buf.lastTokens;
    buf.thinking = '';
    buf.assistant = '';

    if (thinking) {
      // task-11（FR-07/FR-08）：partial 行携带 segmentId + isPartial，
      // 供 backend（task-12）+ 前端 normalize 识别「该 segment 已有完整行时丢弃」。
      const segmentId = buf.currentSegmentId ?? this._resolveSegmentId(state, buf, undefined);
      const formatted = {
        event_type: 'text',
        content: `[THINKING] ${thinking}`,
        channel: 'stdout',
        metadata: { thinking: true, segmentId, isPartial: true },
      } as unknown as SDKMessage;
      // 记录已 flush 的 segment（完整 message 到达时据此 emit override 信号）。
      buf.flushedSegments.push({ segmentId, logTimestamp: new Date().toISOString() });
      await this.deps.onTurnMessage(sessionId, runId, formatted);
      // 清空 currentSegmentId（下批 delta 会重新解析；text_delta 不污染）。
      buf.currentSegmentId = null;
    }
    if (assistant) {
      const formatted = {
        event_type: 'text',
        content: `[ASSISTANT] ${assistant}`,
        channel: 'stdout',
      } as unknown as SDKMessage;
      await this.deps.onTurnMessage(sessionId, runId, formatted);
    }
    // thinking_tokens 仅在值变化时 emit（running total，去重）。
    if (tokens && tokens !== buf.flushedTokens) {
      buf.flushedTokens = tokens;
      const formatted = {
        event_type: 'text',
        content: `[SYSTEM:thinking_tokens] ${tokens}`,
        channel: 'stdout',
      } as unknown as SDKMessage;
      await this.deps.onTurnMessage(sessionId, runId, formatted);
    }
  }

  /**
   * 清空 partial buffer 内容 + 取消 pending timer（保留 buffer entry，
   * session 仍 active，下个 turn 的 partial 会复用）。
   *
   * 完整 assistant message 到达时调用：delta 是完整内容子集，backend 会展开
   * 完整 message 为全文 [THINKING]/[ASSISTANT]，未 flush 的 partial 尾部
   * 必须丢弃避免重复。
   *
   * task-11（design §5.3 D1/D2）：sync 部分只清 buffer + 记录 completedSegments
   *（late partial 守卫立即生效）；override 信号由 _emitOverrideSignals 异步发
   *（在完整 message 转发之后，语义上"完整行覆盖 partial 行"）。
   */
  private _clearPartialBufferSync(
    sessionId: string,
    completedSegments: ReadonlySet<string> = new Set(),
  ): void {
    const buf = this._partialBuffers.get(sessionId);
    if (!buf) return;
    if (buf.timer) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }
    buf.thinking = '';
    buf.assistant = '';
    buf.lastTokens = 0;
    buf.flushedTokens = 0;

    // task-11：记录已完成 segment（late partial 守卫用）。
    for (const segId of completedSegments) {
      buf.completedSegments.add(segId);
    }

    // flushedSegments 清空（override 已在 _emitOverrideSignals 里消费）。
    // 注意 completedSegments 不在此清——完整 message 到达 ≠ turn 结束，late partial
    // 守卫需在本 turn 内持续生效；turn 真正结束由 _onResult 收尾时清。
    buf.flushedSegments = [];
    buf.currentSegmentId = null;
    buf.currentMessageId = null;
  }

  /**
   * task-11：对「已 flush 过 + 完整 message 已覆盖」的 segment emit
   * [THINKING_OVERRIDE] <segmentId> 覆盖信号。
   *
   * daemon 无法召回已发给 backend 的 partial 行（HTTP 已发、可能已落库 + SSE push），
   * 只能 emit 信号通知 backend（task-12 据此丢弃同 segmentId 的 partial 落库行）+
   * 前端 normalize（据此覆盖展示）。在完整 message 转发之后异步调用，不阻塞主流程。
   *
   * @param flushedSnapshot 调用方（_onMessage）在 _clearPartialBufferSync 清空
   *   flushedSegments 之前抓的快照（sync 清理后 buf.flushedSegments 已空）。
   */
  private async _emitOverrideSignals(
    sessionId: string,
    runId: string | undefined,
    completedSegments: ReadonlySet<string>,
    flushedSnapshot: Array<{ segmentId: string; logTimestamp: string }>,
  ): Promise<void> {
    if (completedSegments.size === 0 || !runId) return;
    const overrides = flushedSnapshot.filter((s) =>
      completedSegments.has(s.segmentId),
    );
    if (overrides.length === 0) return;
    await Promise.all(
      overrides.map((s) =>
        this.deps.onTurnMessage(sessionId, runId, {
          event_type: 'text',
          content: `[THINKING_OVERRIDE] ${s.segmentId}`,
          channel: 'stdout',
          metadata: { thinking: true, segmentId: s.segmentId, stale: true },
        } as unknown as SDKMessage),
      ),
    );
  }

  /**
   * 销毁 partial buffer（含 timer）+ 从 Map 移除。
   * session end/fail/daemon shutdown 时调用，防止 timer 泄漏。
   */
  private _destroyPartialBuffer(sessionId: string): void {
    const buf = this._partialBuffers.get(sessionId);
    if (!buf) return;
    if (buf.timer) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }
    this._partialBuffers.delete(sessionId);
  }
}
