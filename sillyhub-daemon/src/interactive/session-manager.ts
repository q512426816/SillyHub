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
  UserDialogResult,
} from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeSdkDriver } from './claude-sdk-driver.js';
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
  InteractiveDriverResult,
  UserTurnInput,
} from './driver.js';
import { InputQueue } from './input-queue.js';
import { PermissionResolver } from './permission-resolver.js';
import type { PermissionSendFn } from './permission-resolver.js';
import type { CanUseToolDecision } from './types.js';
import type { PolicyEngine } from '../policy/filesystem-policy.js';
import { isPathUnderAnyRoot } from '../policy/path-utils.js';
import {
  extractShellWritePaths,
  type ShellKind,
} from '../policy/shell-paths.js';
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
  /**
   * 写工具白名单根目录提供者（interactive CC 写拦截，2026-06-29）。
   *
   * 返回 daemon config.allowed_roots（heartbeat 同步的绝对路径数组）。注入后，
   * SessionManager 在「所有」session（含默认 chat / enableApproval=false）都注入
   * canUseTool 回调，对写工具（Write/Edit/MultiEdit）做白名单校验：
   *   - 落在某个 root 之下（含等于 root）→ 继续 allow / 走原 enableApproval 人审逻辑；
   *   - 越界 → deny（message "path outside allowed_roots"）。
   * 读工具（Read/Grep/Bash/Glob/WebFetch 等）不拦（读自由）。
   *
   * 用函数而非数组：daemon 心跳会更新 config.allowed_roots（daemon.ts
   * _syncAllowedRoots 写同一 config 对象引用），provider 每次调用读到最新值，无需
   * SessionManager 感知更新事件。
   *
   * 不注入（undefined）= 不启用写拦截（向后兼容，测试默认）。注入空数组也视为
   * 不启用（isWriteWithinAllowedRoots 内 allowedRoots.length===0 直接放行，避免
   * 配置缺失导致全 deny 卡死 chat）。
   *
   * **task-14（design §5.2 D-002）**：`policyEngine` 注入后，写校验优先走
   * `PolicyEngine.canWrite(runtimeId, path, provider, tool)`（按 runtime_id 隔离，
   * 统一中文 deny 文案 + audit）。`allowedRootsProvider` 仅作 fallback
   * （policyEngine 未注入时向后兼容，task-15 删 write-guard.ts 后清理）。
   */
  allowedRootsProvider?: () => string[];
  /**
   * task-14（design §5.1.3 / §5.2 D-002 D-006）：文件系统权限引擎。
   *
   * 注入后，interactive session 的 canUseTool 写守卫（_wrapWithWriteGuard）改调
   * `policyEngine.canWrite(runtimeId, path, provider, tool)`：按 runtime_id 隔离的
   * PolicyCache 边界校验 + 统一中文 deny 文案（PolicyDecision.reason）+ audit
   * （ALLOW/DENY 均记）。runtimeId 由 `runtimeIdProvider(sessionId)` 实时解析。
   *
   * 覆盖工具：Write/Edit/MultiEdit（取 file_path/path）+ Bash/PowerShell/CMD
   * （经 policy/shell-paths 的 extractShellWritePaths 提取写目标路径，逐条 canWrite）。
   * 读工具 / 提取不到写路径 → 不拦（读自由，交内层 allow/审批）。
   *
   * 不注入（undefined/null）= 退化到 allowedRootsProvider fallback（向后兼容，
   * task-11 装配但未接入 tool 前的过渡态）。task-15 删 write-guard.ts 后此字段
   * 必填（cli.ts 生产路径已注入）。
   */
  policyEngine?: PolicyEngine | null;
  /**
   * task-14：按 sessionId 解析归属 runtime_id（PolicyEngine.canWrite 第一参数）。
   *
   * daemon 生产路径注入闭包：`daemon._registeredRuntimes.get(state.provider)`
   * （session 归属 runtime，design §5.2 L175）。session 不存在 / provider 未注册
   * 运行时 → 闭包返回空串，PolicyEngine.cache 未命中 deny（fail-closed）。
   *
   * 测试注入固定 runtimeId 字符串。policyEngine 未注入时此字段无意义（不读）。
   */
  runtimeIdProvider?: (provider: string) => string;
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
/**
 * ql-20260627-usage：partial flush 注入的 usage 快照。来自 stream_event
 * message_delta.usage（Claude 流式 cumulative 计费，整条 message 的累计值）。
 * 字段名映射为短名 cache_*_tokens（Claude SDK 原始为 cache_*_input_tokens），
 * 与 backend _METADATA_FIELDS 对齐，避免 daemon lift 重复映射。
 */
interface PartialUsageSnapshot {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

interface PartialFlushBuffer {
  /**
   * 2026-06-28-daemon-subagent-transcript task-03 / D-002@v1：本桶归属 parentKey。
   * 'main' = 主 agent（parent_tool_use_id=null）；否则 = 子代理的 tool_use_id。
   * _resolveSegmentId 据此给 segmentId 加 parent 前缀，避免主/子 segment 撞 id。
   */
  parentKey: string;
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
  /**
   * ql-20260627-usage：最新 message_delta.usage（cumulative）。null = 本 turn 尚未
   * 收到 message_delta。_flushPartial 注入到 flat 消息顶层 usage，经 daemon
   * onTurnMessage lift → backend submit_messages 实时更新 AgentRun token
   *（不必等终态 result 汇总）。
   */
  pendingUsage: PartialUsageSnapshot | null;
  /** ql-20260627-usage：上次已 flush 的 usage（去重，仅在变化时注入）。null = 从未注入。 */
  flushedUsage: PartialUsageSnapshot | null;
  /**
   * ql-session-usage：session 级跨 API call 累积 token（实时显示用）。
   * 每次 message_start 累加 input_tokens，message_delta 累加 output delta。
   * pendingUsage 取 sessionUsage 值，使 submitMessages 发送递增的 session 总量。
   */
  sessionInputTokens: number;
  sessionOutputTokens: number;
  sessionCacheReadTokens: number;
  sessionCacheCreationTokens: number;
  /** 当前 API call 上次的 output_tokens（算 delta 用）。 */
  lastCallOutputTokens: number;
  lastCallCacheReadTokens: number;
  lastCallCacheCreationTokens: number;
}

/**
 * 默认空闲阈值（秒）。D-001@v1（2026-06-25-interactive-idle-timeout-fix）：默认 0 = 禁用
 * idle 自动回收。scan/stage 完成由 backend 主动 end_session 收口（D-002@v1），session 不再
 * 因假性空闲被误杀。env SESSION_IDLE_TIMEOUT_SEC 显式设 >0 可恢复旧行为（逃生口）。
 */
const DEFAULT_IDLE_TIMEOUT_SEC = 0;
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
   * ql-20260621-partial + 2026-06-28-daemon-subagent-transcript task-03 / D-002@v1：
   * 二级 Map partial 缓冲——外层 key=sessionId，内层 key=parentKey（'main'=主 agent /
   * 子代理 tool_use_id），value=PartialFlushBuffer。按 parent 分桶：子代理完整 assistant
   * message 只清自己的桶，不误清主 agent partial（R-02 P0）。主 agent 单代理场景恒用
   * 'main' 桶，行为与改造前单桶逐字节等价。create 时按需懒建，end/fail/shutdown 销毁整 session。
   */
  private readonly _partialBuffers = new Map<string, Map<string, PartialFlushBuffer>>();

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
  /**
   * 写工具白名单根目录提供者（interactive CC 写拦截，2026-06-29）。
   * 未注入 = 不启用写拦截。注入后所有 session 的 canUseTool 都前置写校验。
   * 见 SessionManagerOptions.allowedRootsProvider 文档。
   *
   * **task-14**：policyEngine 注入后此字段仅 fallback 用。
   */
  private readonly _allowedRootsProvider: (() => string[]) | undefined;
  /**
   * task-14（design §5.1.3 / §5.2）：PolicyEngine 引用。注入后写守卫改调 canWrite
   * （按 runtimeId 隔离 + 统一中文文案 + audit）。null/undefined = fallback 旧行为。
   */
  private readonly _policyEngine: PolicyEngine | null | undefined;
  /** task-14：按 sessionId 解析 runtimeId 的闭包（daemon 注入 _registeredRuntimes 查询）。 */
  private readonly _runtimeIdProvider:
    | ((sessionId: string) => string)
    | undefined;

  /**
   * D-001@v1（task-02）：provider driver registry。`drivers.claude` / `drivers.codex`
   * 由调用方注入（task-06 cli.ts 构造时 `drivers: { claude, codex }`）。
   *
   * 兼容（D-009 向后兼容）：构造函数把旧单 driver 入参 `deps.driver`（ClaudeSdkDriver）
   * 映射到 `_drivers.claude`，让 cli.ts 现有 `new SessionManager({ driver, ... })` 零改动。
   * 优先级：`deps.drivers.claude`（显式 registry）> `deps.driver`（兼容入口）。
   */
  private readonly _drivers: Partial<Record<'claude' | 'codex', InteractiveDriver>>;

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

    // task-02（D-001@v1）：构造 drivers registry。显式 registry 优先；兼容旧单 driver 入参。
    const explicitDrivers = deps.drivers ?? {};
    this._drivers = { ...explicitDrivers };
    if (deps.driver && !this._drivers.claude) {
      // 兼容：旧调用方传 deps.driver（ClaudeSdkDriver）→ 映射到 _drivers.claude。
      // task-03 让 ClaudeSdkDriver implements InteractiveDriver 后类型自然对齐；
      // 此处 unknown 断言渡过过渡期类型差异（运行时鸭子类型满足）。
      this._drivers.claude = deps.driver as unknown as InteractiveDriver;
    }

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
    // interactive CC 写拦截（2026-06-29）：注入 provider 后所有 session 的 canUseTool
    // 前置写校验（含默认 chat / enableApproval=false）。未注入 = 不启用（向后兼容）。
    this._allowedRootsProvider = opts.allowedRootsProvider;
    // task-14（design §5.2）：PolicyEngine 注入后写守卫改调 canWrite（按 runtimeId
    // 隔离 + 统一中文 deny 文案 + audit）。null/undefined = fallback allowedRootsProvider。
    this._policyEngine = opts.policyEngine ?? null;
    this._runtimeIdProvider = opts.runtimeIdProvider;
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
   * D-008@v1（task-02）：provider-neutral 普通审批 public 入口。Codex driver 收到
   * app-server server request（command/file/permission requestApproval）时调用，
   * Claude driver 经 _buildCanUseToolCallback 内部走相同 resolver 机制。
   *
   * 策略（D-006）：
   *   - session 非 running / 无 currentRunId → fail-closed deny（防 interrupt 后回调悬空）；
   *   - askUserOnly=true 且非用户输入类（isUserInputKind≠true）→ allow-through
   *     （不弹卡，记 metadata；scan 场景让普通工具自动推进）；
   *   - 否则 → resolver.register（send PERMISSION_REQUEST）→ await decision（fail-closed：
   *     send 失败 / signal aborted / 5min 超时 / wrapper 异常 全 deny）。
   *
   * 返回 CanUseToolDecision（Claude 直接用；Codex driver 据此映射 accept/decline）。
   *
   * @param sessionId 目标 session（resolver 按 session 隔离）
   * @param input toolName/toolInput/signal/toolUseId/isUserInputKind
   */
  async requestPermission(
    sessionId: string,
    input: {
      toolName: string;
      toolInput: Record<string, unknown>;
      signal?: AbortSignal;
      toolUseId?: string;
      isUserInputKind?: boolean;
    },
  ): Promise<CanUseToolDecision> {
    return this._requestPermission({ sessionId, ...input });
  }

  /**
   * D-008@v1（task-02）：provider-neutral 用户对话 public 入口。Codex driver 收到
   * `item/tool/requestUserInput` 或可归一化的 MCP elicitation 时调用；Claude driver
   * 经 _buildOnUserDialogCallback 内部走相同 resolver 机制（PERMISSION_REQUEST 带
   * dialog_kind/dialog_payload）。
   *
   * 返回 { behavior:'completed', result } | { behavior:'cancelled' }。
   * fail-closed：session 非 running / 无 resolver / send 失败 / 超时 / wrapper 异常 → cancelled。
   */
  async requestUserDialog(
    sessionId: string,
    input: {
      dialogKind: string;
      dialogPayload: Record<string, unknown>;
      toolUseId?: string;
      signal?: AbortSignal;
    },
  ): Promise<{ behavior: 'completed'; result: unknown } | { behavior: 'cancelled' }> {
    return this._requestUserDialog({ sessionId, ...input });
  }

  /**
   * D-008@v1（task-02）：requestPermission 内部实现。封装「读策略 → register → await」。
   * 与 _buildCanUseToolCallback 共享同一套 fail-closed 语义（resolver.register 内部
   * send 失败/signal aborted/5min 超时全 deny）。供 Codex driver 与未来 Claude helper 重构复用。
   */
  private async _requestPermission(input: {
    sessionId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    signal?: AbortSignal;
    toolUseId?: string;
    isUserInputKind?: boolean;
  }): Promise<CanUseToolDecision> {
    const state = this._store.get(input.sessionId);
    // session 非 running / 无 currentRunId → fail-closed deny。
    if (!state || state.status !== 'running' || !state.currentRunId) {
      return { behavior: 'deny', message: 'session not in running turn' };
    }
    const runId = state.currentRunId;
    // D-006：askUserOnly=true 且非用户输入类 → allow-through（scan 场景普通工具自动推进）。
    if (state.askUserOnly === true && !input.isUserInputKind) {
      return { behavior: 'allow' };
    }
    const resolver = this._resolversBySession.get(input.sessionId);
    const wsClient = this._permissionWsClient;
    if (!resolver || !wsClient) {
      // 无 resolver（manualApproval=false 或未初始化）→ fail-closed deny。
      return {
        behavior: 'deny',
        message: `Tool "${input.toolName}" denied: no permission resolver (session=${input.sessionId}, run=${runId})`,
      };
    }
    const defaultDenyMessage = `Tool "${input.toolName}" denied by reviewer (session=${input.sessionId}, run=${runId})`;
    try {
      const { promise } = resolver.register({
        sessionId: input.sessionId,
        runId,
        toolName: input.toolName,
        toolInput: input.toolInput,
        ...(input.toolUseId !== undefined ? { toolUseId: input.toolUseId } : {}),
        signal: input.signal,
        send: (msg) => wsClient.send(msg),
        // 用户输入类（Codex request_user_input / Claude AskUserQuestion）标记 dialog，
        // backend 据此走对话路径（不 arm 5min 超时 + SSE 携带 dialog 渲染问答卡）。
        ...(input.isUserInputKind
          ? { dialogKind: input.toolName, dialogPayload: input.toolInput }
          : {}),
      });
      const decision = await promise;
      if (decision.behavior === 'deny') {
        return { behavior: 'deny', message: decision.message ?? defaultDenyMessage };
      }
      return { behavior: 'allow' };
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : String(err ?? 'unknown error');
      return { behavior: 'deny', message: `${defaultDenyMessage}: wrapper error (${reason})` };
    }
  }

  /**
   * D-008@v1（task-02）：requestUserDialog 内部实现。与 _buildOnUserDialogCallback
   * 共享同一套 resolver 机制（PERMISSION_REQUEST 带 dialog_kind/dialog_payload，
   * PERMISSION_RESPONSE.allow 的 dialog_result 回喂）。
   */
  private async _requestUserDialog(input: {
    sessionId: string;
    dialogKind: string;
    dialogPayload: Record<string, unknown>;
    toolUseId?: string;
    signal?: AbortSignal;
  }): Promise<{ behavior: 'completed'; result: unknown } | { behavior: 'cancelled' }> {
    const state = this._store.get(input.sessionId);
    if (!state || state.status !== 'running' || !state.currentRunId) {
      return { behavior: 'cancelled' };
    }
    const runId = state.currentRunId;
    const resolver = this._resolversBySession.get(input.sessionId);
    const wsClient = this._permissionWsClient;
    if (!resolver || !wsClient) {
      return { behavior: 'cancelled' };
    }
    try {
      const { promise } = resolver.register({
        sessionId: input.sessionId,
        runId,
        toolName: input.dialogKind,
        toolInput: input.dialogPayload,
        ...(input.toolUseId !== undefined ? { toolUseId: input.toolUseId } : {}),
        signal: input.signal,
        send: (msg) => wsClient.send(msg),
        dialogKind: input.dialogKind,
        dialogPayload: input.dialogPayload,
      });
      const decision = await promise;
      if (decision.behavior === 'deny') {
        return { behavior: 'cancelled' };
      }
      const dialogResult = (decision as { dialogResult?: unknown }).dialogResult;
      return {
        behavior: 'completed',
        result: dialogResult !== undefined ? dialogResult : null,
      };
    } catch {
      return { behavior: 'cancelled' };
    }
  }

  /**
   * D-001@v1（task-02）：按 provider 取已注册 driver。未注册 → 抛 UnsupportedProviderError。
   *
   * 兼容入口：`deps.driver`（ClaudeSdkDriver）经构造函数已映射到 `_drivers.claude`，
   * 故 claude 路径无论走 `drivers` registry 还是旧 `driver` 入参都能取到 driver。
   * 文案保留现有 Wave1/2 模板（task-02 不改文案；codex 未注册时仍抛此错，符合
   *「driver 未注册即不支持」语义）。
   */
  private _getDriver(provider: 'claude' | 'codex'): InteractiveDriver {
    const driver = this._drivers[provider];
    if (!driver) {
      throw new UnsupportedProviderError(provider);
    }
    return driver;
  }

  /**
   * 创建 session 并启动 driver 协程（design §7.6）。
   *
   * task-02（D-001/FR-01）：不再硬编码 claude；按 `input.provider` 经 `_getDriver`
   * 路由到对应 driver。未注册 provider 抛 UnsupportedProviderError（在写 store 前，不留孤儿）。
   *
   * @throws {SessionAlreadyExistsError} 重复 sessionId
   * @throws {UnsupportedProviderError} provider driver 未注册
   * @throws {ClaudeExecutableNotFoundError} executable 缺失（driver.start 内抛，透传）
   */
  async create(input: CreateSessionInput): Promise<void> {
    // D-001：先解析 driver（未注册即抛，在写 store 前，不留孤儿 state）。
    const driver = this._getDriver(input.provider);
    if (this._store.has(input.sessionId)) {
      throw new SessionAlreadyExistsError(input.sessionId);
    }

    // D-009（task-02）：InputQueue 改 provider-neutral UserTurnInput。SessionManager
    // 不再构造 SDKUserMessage；Claude driver 内部做形态转换（task-03）。
    const inputQueue = new InputQueue<UserTurnInput>();
    inputQueue.push({ type: 'user', text: input.firstPrompt });

    // 2. 写 SessionState（status=running，首 turn 的 currentRunId=firstRunId）。
    // scan 真阻塞（generic-wibbling-whisper 改造点 C/B/D）：求值 effective
    // manualApproval / askUserOnly 并写入 state，供 snapshotPersistable 落盘 +
    // restoreAndReconnect 跨 daemon 重启恢复审批能力。
    const enableApproval = input.manualApproval ?? this._manualApproval;
    const effectiveAskUserOnly = input.askUserOnly === true;
    // D-002（task-02）：provider-neutral executable path。codex 用 input.pathToAgentExecutable
    //（daemon _agentPaths.get('codex')）；claude 继续用 pathToClaudeCodeExecutable。
    const exePath = input.pathToAgentExecutable ?? input.pathToClaudeCodeExecutable;
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
      pathToAgentExecutable: exePath,
      env: input.env,
      manualApproval: enableApproval,
      askUserOnly: effectiveAskUserOnly,
      driver, // D-001：写入归属 driver，供 interrupt/consume 路由。
      subagentDepth: new Map(), // task-02 / D-007@v1：子代理 depth 追踪。
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
      // _buildDriverOptions 内部按 enableApproval 注入 canUseTool/onUserDialog +
      // 建 resolver（scan 真阻塞，改造点 C/D）；create/restore 复用同一套注入逻辑。
      const driverOpts = this._buildDriverOptions(state, {
        exePath,
        model: input.model,
        allowedTools: input.allowedTools,
        env: input.env,
        enableApproval,
        effectiveAskUserOnly,
      });
      // 抽 helper 后 resolver 仍需在本作用域持有（create catch 清理用）。
      resolver = this._resolversBySession.get(input.sessionId);
      // task-02（D-001）：用 session 归属 driver（不再全局 this.deps.driver）。
      // 过渡期 ClaudeSdkDriver.start 同步返回 Query、InteractiveDriver.start 返回
      // Promise<Handle>；统一 await（同步返回值经 await 等价直传）。按 provider 写句柄：
      // claude → state.query（SDK Query）；codex → state.driverHandle。
      const handleOrQuery = (await driver.start(
        inputQueue,
        driverOpts as unknown as Parameters<InteractiveDriver['start']>[1],
      )) as unknown;
      if (input.provider === 'claude') {
        state.query = handleOrQuery as import('@anthropic-ai/claude-agent-sdk').Query;
      } else {
        state.driverHandle = handleOrQuery as InteractiveDriverHandle;
      }

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
   * task-02（R7/D-008）：构造 provider-neutral driver options。create 与
   * restoreAndReconnect 复用，保证 Claude canUseTool/onUserDialog 注入逻辑单一来源
   *（FR-10 不回退：行为与改造前逐行等价，仅从 create/restore 抽出到此 helper）。
   *
   * 职责：
   *   1. 构造 driverOpts base（exe path / cwd / model / allowedTools / env）；
   *      exe 字段同时填 pathToClaudeCodeExecutable（Claude driver 读）和
   *      pathToAgentExecutable（Codex driver 读，task-04），按 provider 决定主字段。
   *   2. enableApproval=true 且 resolverFactory/wsClient 就绪时：建独立 resolver +
   *      注入 canUseTool（_buildCanUseToolCallback，内部调 _requestPermission）+
   *      onUserDialog（supportedDialogKinds 非空时）。
   *
   * @param state 当前 session（写 driver 归属、读 provider）
   * @param spec exePath/model/allowedTools/env/enableApproval/effectiveAskUserOnly/resume
   */
  private _buildDriverOptions(
    state: SessionState,
    spec: {
      exePath: string;
      model?: string;
      allowedTools?: string[];
      env?: NodeJS.ProcessEnv;
      enableApproval: boolean;
      effectiveAskUserOnly: boolean;
      resume?: string;
    },
  ): Record<string, unknown> {
    const driverOpts: Record<string, unknown> = {
      // Claude driver 读 pathToClaudeCodeExecutable；Codex driver 读 pathToAgentExecutable。
      // 两字段都填 exePath，各 driver 取自己需要的（provider-neutral，不依赖 SessionManager 知道）。
      pathToClaudeCodeExecutable: spec.exePath,
      pathToAgentExecutable: spec.exePath,
      cwd: state.cwd,
      // ql-20260624-007：透传 sessionId 给 codex driver 落盘 stdout 诊断日志
      //（claude driver 忽略此字段；provider-neutral 填充，各 driver 按需取）。
      sessionId: state.sessionId,
    };
    if (spec.model !== undefined) {
      driverOpts.model = spec.model;
    }
    if (spec.allowedTools !== undefined) {
      driverOpts.allowedTools = spec.allowedTools;
    }
    // gap-8：仅当传入 env 时覆盖（缺省让 driver 回退裸 process.env，兼容）。
    if (spec.env !== undefined) {
      driverOpts.env = spec.env;
    }
    if (spec.resume !== undefined) {
      driverOpts.resume = spec.resume;
    }
    // scan 真阻塞（per-session，generic-wibbling-whisper.md 改造点 C/D）：
    // enableApproval=true 时按 session 建独立 resolver + 注入远程人审 canUseTool +
    // onUserDialog，让 scan 真阻塞等人审（chat=false 不注入 AskUserQuestion 人审，
    // 但见下方 allowed_roots 写拦截：注入 provider 后 chat 也注入 canUseTool 做写校验）。
    // 行为与改造前逐行等价（FR-10）+ allowed_roots 写拦截增量（2026-06-29）。
    // 显式 permissionMode=default（2026-06-30 修 bug：SDK permissionMode 缺失时
    // 可能沿用 session resume 的旧状态，绕过 canUseTool → 写守卫失效）。
    driverOpts.permissionMode = 'default';
    const approvalReady =
      spec.enableApproval &&
      !!this._permissionResolverFactory &&
      !!this._permissionWsClient;
    // interactive CC 写拦截（2026-06-29）+ task-14（design §5.2 PolicyEngine）：
    // 注入 policyEngine（优先）或 allowedRootsProvider（fallback）后，无论
    // enableApproval true/false，都给 Claude driver 注入 canUseTool（写工具白名单前置
    // 校验）。enableApproval=true 时 canUseTool = 写校验 + 远程人审；false 时
    // canUseTool = 写校验 + 直接 allow。读工具不拦（读自由）。
    const writeGuardEnabled = !!this._policyEngine || !!this._allowedRootsProvider;
    if (approvalReady) {
      const resolver = this._permissionResolverFactory!();
      this._resolversBySession.set(state.sessionId, resolver);
      const inner = this._buildCanUseToolCallback(
        state.sessionId,
        spec.effectiveAskUserOnly,
      );
      driverOpts.canUseTool = writeGuardEnabled
        ? this._wrapWithWriteGuard(state.sessionId, state.provider, inner)
        : inner;
      // onUserDialog 路由（SDK request_user_dialog 路径）：supportedDialogKinds 非空才注入。
      // ⚠️ AskUserQuestion 在 SDK headless 模式实际不走 onUserDialog（经 canUseTool 拦截）；
      // 此处仅对 SDK 真正发出 request_user_dialog 的其他 kind 生效。默认 ['AskUserQuestion']
      // 历史值，保留向后兼容。
      if (this._supportedDialogKinds && this._supportedDialogKinds.length > 0) {
        driverOpts.onUserDialog = this._buildOnUserDialogCallback(
          state.sessionId,
        );
        driverOpts.supportedDialogKinds = this._supportedDialogKinds;
      }
      // task-06（D-008@v1 / task-05）：Codex driver 的 sessionPermission hooks 注入。
      // Codex driver 经 CodexStartOptions.sessionPermission 读这两个方法引用（task-05
      // approval/user-input/elicitation 映射）。绑定到当前 session 的 SessionManager
      // public 入口（requestPermission/requestUserDialog，签名与 CodexSessionPermissionHooks
      // 一致）。manualApproval=true 时注入；未注入时 driver 走 fail-closed 占位（task-05
      // 既有测试语义）。仅 codex provider 走此分支（Claude 用 canUseTool/onUserDialog）。
      if (state.provider === 'codex') {
        // 参数类型与 CodexSessionPermissionHooks 契约一致（与 SessionManager public
        // requestPermission/requestUserDialog 入参同形，去掉 sessionId 由闭包绑定）。
        driverOpts.sessionPermission = {
          requestPermission: (input: {
            toolName: string;
            toolInput: Record<string, unknown>;
            signal?: AbortSignal;
            toolUseId?: string;
            isUserInputKind?: boolean;
          }) => this.requestPermission(state.sessionId, input),
          requestUserDialog: (input: {
            dialogKind: string;
            dialogPayload: Record<string, unknown>;
            toolUseId?: string;
            signal?: AbortSignal;
          }) => this.requestUserDialog(state.sessionId, input),
        };
      }
    } else if (writeGuardEnabled) {
      // 默认 chat（enableApproval=false）：注入「写校验 only」canUseTool。
      // 不依赖 resolver/wsClient（纯本地校验）：写工具白名单外 deny、白名单内 allow；
      // 读工具 / 其他 allow（读自由）。SDK 不会因 canUseTool 注入而走人审（人审只在
      // approvalReady 分支内经 resolver.register 触发）。
      const inner = this._buildWriteOnlyCanUseToolCallback(state.sessionId);
      driverOpts.canUseTool = this._wrapWithWriteGuard(
        state.sessionId,
        state.provider,
        inner,
      );
    }
    return driverOpts;
  }

  /**
   * interactive CC 写拦截（2026-06-29）+ task-14（design §5.2 PolicyEngine）：
   * 包装一层写工具白名单前置守卫。
   *
   * **task-14 主路径（policyEngine 注入）**：
   *   - 写工具（Write/Edit/MultiEdit）：取 file_path/path，调
   *     `policyEngine.canWrite(runtimeId, path, provider, toolName)`；
   *   - Shell 工具（Bash/PowerShell/CMD）：经 policy/shell-paths 的
   *     `extractShellWritePaths(command, shell)` 提取写目标路径，逐条 canWrite，
   *     任一 deny 即拒绝（reason 取首个 deny）；
   *   - deny → 返回 decision.reason（PolicyEngine 统一中文文案，含 provider/路径/原因）；
   *   - allow / 非写工具 / 提取不到写路径 → 交内层 callback（approvalReady=true 走
   *     远程人审；false 走直接 allow）。
   *
   * **fallback 路径（policyEngine 未注入，向后兼容 / 测试）**：复用旧
   * `allowedRootsProvider + isWriteWithinAllowedRoots` 语义。task-15 删 write-guard.ts
   * 时清理（届时 cli.ts 生产路径必注入 policyEngine）。
   *
   * @param sessionId  当前 session（runtimeIdProvider 闭包查询用）。
   * @param provider   session 归属 provider（透传 PolicyEngine.canWrite 第三参数）。
   * @param inner      内层 canUseTool（写校验通过后调用的真实审批 / allow 逻辑）。
   */
  private _wrapWithWriteGuard(
    sessionId: string,
    provider: 'claude' | 'codex',
    inner: CanUseTool,
  ): CanUseTool {
    return async (
      toolName: string,
      toolInput: Record<string, unknown>,
      options: Parameters<CanUseTool>[2],
    ): ReturnType<CanUseTool> => {
      // task-14 主路径：policyEngine 注入 → 走 canWrite（按 runtimeId 隔离 + 中文文案 + audit）。
      if (this._policyEngine) {
        const deny = this._judgeWriteViaPolicyEngine(
          sessionId,
          provider,
          toolName,
          toolInput,
        );
        if (deny) {
          return { behavior: 'deny', message: deny };
        }
        return inner(toolName, toolInput, options);
      }
      // fallback（policyEngine 未注入，向后兼容 / 测试）：复用与主路径相同的路径提取
      // （policy/shell-paths）+ isPathUnderAnyRoot 边界校验（迁移自 write-guard.ts，
      // task-15 删 write-guard.ts）。allowedRootsProvider 空数组 → 视为未启用放行。
      const roots = this._allowedRootsProvider?.() ?? [];
      if (roots.length > 0) {
        const writePaths = this._extractWritePathsForTool(toolName, toolInput);
        const outside = writePaths.find((p) => !isPathUnderAnyRoot(p, roots));
        if (outside !== undefined) {
          return {
            behavior: 'deny',
            message: `path outside allowed_roots: ${outside}`,
          };
        }
      }
      return inner(toolName, toolInput, options);
    };
  }

  /**
   * task-14（design §5.1.3 / §5.2）：经 PolicyEngine 校验一次工具调用的写路径。
   *
   * 提取写目标路径（Write/Edit/MultiEdit 取 file_path/path；Bash/PowerShell/CMD
   * 经 extractShellWritePaths），逐条 `canWrite(runtimeId, path, provider, tool)`。
   * 任一 deny 即返回首个 deny 的 reason（统一中文文案）；全 allow / 无写路径返回 null。
   *
   * runtimeId 由 runtimeIdProvider 闭包解析（daemon._registeredRuntimes.get(provider)）；
   * 解析为空串时 PolicyCache 未命中 → fail-closed deny（design D-007）。
   *
   * @returns deny 的 reason 字符串；null = 放行（交内层）。
   */
  private _judgeWriteViaPolicyEngine(
    sessionId: string,
    provider: 'claude' | 'codex',
    toolName: string,
    toolInput: Record<string, unknown>,
  ): string | null {
    const engine = this._policyEngine;
    if (!engine) return null;

    // 提取写目标路径。
    const writePaths = this._extractWritePathsForTool(toolName, toolInput);
    if (writePaths.length === 0) return null; // 非写工具 / 提取不到 → 放行

    const runtimeId = this._runtimeIdProvider?.(provider) ?? '';
    const tool = toolName; // PolicyEngine audit 字段（Write/Edit/Bash/...）。
    for (const p of writePaths) {
      const decision = engine.canWrite(runtimeId, p, provider, tool);
      if (!decision.allowed) {
        // 取首个 deny 的 reason（PolicyEngine 已组装中文文案）。
        return decision.reason;
      }
    }
    return null;
  }

  /**
   * task-14：从工具入参提取写目标路径。
   *
   *   - Write/Edit/MultiEdit：取 file_path / path；
   *   - Bash：extractShellWritePaths(command, 'bash')；
   *   - PowerShell：extractShellWritePaths(command, 'powershell')；
   *   - CMD：extractShellWritePaths(command, 'cmd')；
   *   - 其余工具 → []（读自由，不拦）。
   */
  private _extractWritePathsForTool(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): string[] {
    // 显式写文件工具（Write/Edit/MultiEdit）
    if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
      const fp = toolInput['file_path'];
      if (typeof fp === 'string' && fp.length > 0) return [fp];
      const p = toolInput['path'];
      if (typeof p === 'string' && p.length > 0) return [p];
      return [];
    }
    // Shell 间接写（Bash/PowerShell/CMD）
    // 注意：claude 只暴露 Bash tool（无独立 PowerShell/CMD tool），agent 常用
    // Bash tool 跑跨 shell 命令（如 `powershell -Command "Set-Content ..."`、
    // `cmd /c mkdir ...`）。若仅按 toolName 选 bash 提取，会漏 PowerShell cmdlet
    // 与 CMD 命令的写路径（真机回归 ql-20260703-001 发现 Set-Content 绕过）。
    // 因此对 shell 工具合并 bash + powershell + cmd 三种提取取并集（正则各自
    // 精确，PowerShell cmdlet 名不会误匹配 bash/cmd 命令，反之亦然，安全）。
    const shell = this._shellKindOfTool(toolName);
    if (shell) {
      const command = toolInput['command'];
      if (typeof command !== 'string' || command.length === 0) return [];
      const all = [
        ...extractShellWritePaths(command, 'bash'),
        ...extractShellWritePaths(command, 'powershell'),
        ...extractShellWritePaths(command, 'cmd'),
      ];
      return [...new Set(all)];
    }
    return [];
  }

  /** task-14：工具名 → ShellKind（非 shell 工具返回 undefined）。 */
  private _shellKindOfTool(toolName: string): ShellKind | undefined {
    switch (toolName) {
      case 'Bash':
        return 'bash';
      case 'PowerShell':
        return 'powershell';
      case 'CMD':
        return 'cmd';
      default:
        return undefined;
    }
  }

  /**
   * interactive CC 写拦截（2026-06-29）：默认 chat（enableApproval=false）的 canUseTool
   * 内层逻辑——写校验通过后直接 allow（透传 updatedInput 满足 Claude CLI Zod record 校验，
   * 与 _buildCanUseToolCallback allow 分支同模式）。读工具 / 其他一律 allow。
   *
   * fail-closed 守卫：session 非 running turn → allow（无审批状态可守，回退到 SDK 内置
   * 行为；写拦截只在 running turn 有意义，且 _wrapWithWriteGuard 已先行 deny 越界写）。
   * 实际上 SDK 不会在非 running turn 调 canUseTool，此分支仅为类型完整 + 防御性。
   */
  private _buildWriteOnlyCanUseToolCallback(_sessionId: string): CanUseTool {
    return async (
      _toolName: string,
      toolInput: Record<string, unknown>,
      _options: Parameters<CanUseTool>[2],
    ): ReturnType<CanUseTool> => {
      // toolInput 已是 record（SDK 契约）；原样透传满足 Claude CLI Zod record 校验
      //（allow 分支 updatedInput required）。
      return { behavior: 'allow', updatedInput: toolInput };
    };
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

  /** driver.consume 协程：一个 session 启动一次，跨多 turn。
   *
   * task-02（D-001）：用 `state.driver`（session 归属）+ 按 provider 选 target
   *（claude=state.query；codex=state.driverHandle）。过渡兼容：旧内存 state（task-02 前
   * 创建）无 driver 字段 → fallback `_drivers.claude`（FR-10 不回退）。
   *
   * 回调适配：同时提供 ClaudeSdkDriver 旧形态（onResult/onMessage/onError）与
   * InteractiveDriver 新形态（onTurnResult/onTurnMessage/onTurnError）两组键，让
   * Claude driver（task-03 前读旧键）与 Codex driver / fake driver（读新键）都能工作。
   * task-03 合并后 ClaudeSdkDriver implements InteractiveDriver 改读新键，旧键自然废弃。 */
  private async _runConsume(state: SessionState): Promise<void> {
    const driver = state.driver ?? this._drivers.claude;
    if (!driver) return;
    // 按 provider 选 consume target：claude=Query，codex=InteractiveDriverHandle。
    const target = state.provider === 'claude' ? state.query : state.driverHandle;
    if (!target) return;
    // onResult/onMessage 内部 Claude partial buffer 节流逻辑（ql-20260621-partial）保留；
    // Codex flat message 不触发 stream_event 分支，自然走末尾 onTurnMessage 转发。
    const onResult = (r: SDKResultMessage | InteractiveDriverResult): void => {
      void this._onResult(state, r);
    };
    const onMessage = (m: SDKMessage | Record<string, unknown>): void => {
      void this._onMessage(state, m as SDKMessage);
    };
    const onError = (e: unknown): void => {
      // 边界 2：driver 异常 → fail。fail 内部幂等。
      void this.fail(state.sessionId).then(() => undefined, () => undefined);
      // 记录原始错误（便于 daemon 日志），consume 已结束。
      this._lastError = e;
    };
    // 适配对象：新旧两组键并存（见方法注释）。
    const callbacks = {
      onResult,
      onMessage,
      onError,
      onTurnResult: onResult,
      onTurnMessage: onMessage,
      onTurnError: onError,
    };
    try {
      await driver.consume(
        target as InteractiveDriverHandle,
        callbacks as unknown as InteractiveDriverCallbacks,
      );
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
    // task-02（D-009）：push provider-neutral UserTurnInput（不再构造 SDKUserMessage；
    // Claude driver 内部做形态转换，task-03）。
    state.inputQueue.push({ type: 'user', text: prompt });
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
    // task-02（D-001/FR-03）：按 session 归属 driver interrupt（不用全局 deps.driver），
    // 避免 codex session 误调 ClaudeSdkDriver.interrupt(null) 静默失效。target 按 provider 选。
    const interrupted = await this._interruptInternal(state);
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
   * task-02（D-001/FR-03）：provider-neutral interrupt 内部实现。interrupt 与
   * _onIdleExpire 复用。按 `state.driver`（fallback `_drivers.claude` 兼容旧 state）
   * + 按 provider 选 target（claude=query / codex=driverHandle）调用 driver.interrupt。
   * 无 driver / 无 target → 返回 false（不抛）。
   */
  private async _interruptInternal(state: SessionState): Promise<boolean> {
    const driver = state.driver ?? this._drivers.claude;
    if (!driver) return false;
    // 按 provider 选 target：claude=query / codex=driverHandle。缺省 null（与原
    // `state.query ?? null` 语义一致，FR-10 不回退：query undefined 时仍调
    // driver.interrupt(null) 让 driver 自行 no-op 返回 false）。
    const rawTarget =
      state.provider === 'claude' ? state.query : state.driverHandle;
    const target = (rawTarget ?? null) as InteractiveDriverHandle | null;
    try {
      return await driver.interrupt(target);
    } catch {
      // interrupt 抛错保守返回 false（不冒泡，与现有 ClaudeSdkDriver.interrupt no-op 一致）。
      return false;
    }
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
    // D-001@v1：idle 默认禁用（_idleTimeoutSec=0）。仅显式 >0 才启动定时器，
    // 避免 scan 等长 turn 被 idle 误杀。完成驱动 end（D-002@v1）+ 用户手动 end 负责收口。
    if (this._idleTimeoutSec <= 0) return;
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
    // D-001@v1：idle 禁用（_idleTimeoutSec<=0）时直接返回，即使 scanOnce 被显式
    // 调用也不 end。完成驱动 end（D-002@v1）+ 用户手动 end 负责收口。
    if (this._idleTimeoutSec <= 0) return;
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
    if (state.status === 'running') {
      // task-02（D-001）：用 provider-neutral _interruptInternal（不再全局 deps.driver）。
      // interrupt 失败不阻塞 end；end 会 close InputQueue 让 driver 自然结束。
      try {
        await this._interruptInternal(state);
      } catch {
        // noop
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
      // task-02 R8（D-002）：按 provider 落盘 executable path。claude 继续写
      // pathToClaudeCodeExecutable（向后兼容旧 sessions.json + Claude resume）；
      // codex 写 pathToAgentExecutable（恢复时 codex driver 读此字段）。
      if (state.provider === 'codex') {
        if (state.pathToAgentExecutable) {
          rec.pathToAgentExecutable = state.pathToAgentExecutable;
        }
      } else if (state.pathToClaudeCodeExecutable) {
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
    // task-02（D-007）：agentSessionId 是恢复必需的 provider 会话 id（Claude SDK
    // session_id / Codex thread id）。空则不伪造恢复——抛错，不写 store、不调 driver.start。
    // daemon._routeSessionResume 已在进入前校验，这里是第二道守卫。
    if (!record.agentSessionId) {
      throw new Error(
        `restoreAndReconnect: missing agentSessionId (thread id) for session ${record.sessionId}`,
      );
    }
    // task-02（D-001/FR-06）：按 provider 取 driver（未注册 → UnsupportedProviderError）。
    // 删除原 `if (record.provider !== 'claude') throw` 硬编码，codex 不再被拦截。
    const driver = this._getDriver(record.provider);
    if (this._store.has(record.sessionId)) {
      throw new SessionAlreadyExistsError(record.sessionId);
    }

    // task-02（D-009）：恢复路径同样用 provider-neutral UserTurnInput 队列。
    const inputQueue = new InputQueue<UserTurnInput>();
    // scan 真阻塞（恢复路径用，generic-wibbling-whisper 改造点 C/B/D）：
    // record 持久化字段优先，fallback 到实例级 _manualApproval / true（scan 主用场景）。
    // 旧 sessions.json（无 manualApproval/askUserOnly 字段）→ fallback 兼容。
    const restoreManualApproval =
      record.manualApproval ?? this._manualApproval;
    const restoreAskUserOnly = record.askUserOnly ?? true;
    // task-02（D-002/R8）：provider-neutral executable path。codex 用 pathToAgentExecutable
    //（落盘时写的 codex path）；claude 继续用 pathToClaudeCodeExecutable。
    const exe =
      record.pathToAgentExecutable ?? record.pathToClaudeCodeExecutable ?? '';
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
      pathToAgentExecutable: exe,
      manualApproval: restoreManualApproval,
      askUserOnly: restoreAskUserOnly,
      driver, // D-001：写入归属 driver。
      subagentDepth: new Map(), // task-02 / D-007@v1：恢复后从空开始（depth 不持久化）。
    };
    this._store.set(state.sessionId, state);

    try {
      // task-02（R7）：复用 _buildDriverOptions（含 canUseTool/onUserDialog 注入，
      // 与 create 对齐，FR-10 行为不变）。resume = agentSessionId（Codex thread id / Claude session_id）。
      const driverOpts = this._buildDriverOptions(state, {
        exePath: exe,
        model: record.model,
        env: undefined,
        enableApproval: restoreManualApproval,
        effectiveAskUserOnly: restoreAskUserOnly,
        resume: record.agentSessionId, // spike D3 跨进程 resume。
      });
      // task-02（D-001）：用归属 driver，按 provider 写句柄。
      const handleOrQuery = (await driver.start(
        inputQueue,
        driverOpts as unknown as Parameters<InteractiveDriver['start']>[1],
      )) as unknown;
      if (record.provider === 'claude') {
        state.query = handleOrQuery as import('@anthropic-ai/claude-agent-sdk').Query;
      } else {
        state.driverHandle = handleOrQuery as InteractiveDriverHandle;
      }
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
  private async _onResult(state: SessionState, result: SDKResultMessage | InteractiveDriverResult): Promise<void> {
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
    // task-11（边界 7）+ task-03（D-002）：turn 边界重置所有桶的 completedSegments ——
    // 新 turn 的 segmentId 空间独立，避免跨 turn 误判 late partial。多桶（主+各子代理）
    // 全部重置；buffer 不销毁（session 仍 active，下 turn 复用桶）。
    const turnSessionMap = this._partialBuffers.get(state.sessionId);
    if (turnSessionMap) {
      for (const buf of turnSessionMap.values()) {
        buf.completedSegments = new Set<string>();
      }
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
    // 2026-06-28-daemon-subagent-transcript task-02 / D-007@v1：子代理 depth 计算 +
    // 注入 msg.depth（转发给 backend 落库 depth 列）。主 agent(parent_tool_use_id=null)
    // →0；子代理按 parent_tool_use_id 查 state.subagentDepth 得 depth（查不到退化 1，R-04）。
    // assistant message 另遍历 tool_use blocks 预登记 tool_use.id → msgDepth+1，供该
    // tool_use 派生的子代理消息查 depth（主 tool_use→子 1，子 tool_use→孙 2，多层嵌套）。
    const msgRecord = msg as Record<string, unknown>;
    const rawParent = msgRecord['parent_tool_use_id'];
    const parentToolUseId = typeof rawParent === 'string' ? rawParent : null;
    const msgDepth = parentToolUseId
      ? (state.subagentDepth.get(parentToolUseId) ?? 1)
      : 0;
    msgRecord['depth'] = msgDepth;
    if (msgRecord['type'] === 'assistant') {
      const inner = msgRecord['message'] as Record<string, unknown> | undefined;
      const blocks = inner?.['content'];
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (
            b &&
            typeof b === 'object' &&
            (b as { type?: string }).type === 'tool_use'
          ) {
            const tId = (b as { id?: string }).id;
            if (typeof tId === 'string' && tId) {
              state.subagentDepth.set(tId, msgDepth + 1);
            }
          }
        }
      }
    }

    if (
      msg &&
      typeof msg === 'object' &&
      (msg as { type?: string }).type === 'system' &&
      (msg as { subtype?: string }).subtype === 'init'
    ) {
      const sid = (msg as { session_id?: string }).session_id;
      // 2026-06-28-daemon-subagent-transcript task-04 / D-003@v1：防御性守卫——
      // 子代理 system/init（parent_tool_use_id 非空）不得覆盖主 session 的
      // agentSessionId（resume key）。现有 ===undefined 守卫已挡住（主 init 必
      // 先于子代理到达），此处加 parent_tool_use_id 双重守卫防御时序异常，
      // 不依赖单一 ===undefined。
      const isSubagentInit =
        (msg as { parent_tool_use_id?: string | null }).parent_tool_use_id != null;
      if (sid && !isSubagentInit && state.agentSessionId === undefined) {
        state.agentSessionId = sid;
        // task-10：首 turn system/init 拿到 agentSessionId 后才可恢复 → 排队 flush。
        this._scheduleFlush();
      }
    }

    // task-06（Reverse Sync / design §5.3 第 6 点 + task-04 L128-130）：Codex flat
    // message 的 thread_started 事件（{event_type, content, metadata:{subtype:
    // 'thread_started'}, session_id:threadId}）携带 Codex thread id。提取 session_id
    // 写入 state.agentSessionId，让 snapshotPersistable 落盘 + restoreAndReconnect
    // 可用（Codex thread id = resume key，缺失则不可恢复，D-007）。只写一次（与
    // Claude system/init 同语义）。仅 Codex provider 的 flat message 走此分支
    //（Claude 走上方 system/init）。
    if (
      state.provider === 'codex' &&
      state.agentSessionId === undefined &&
      msg &&
      typeof msg === 'object'
    ) {
      const flat = msg as Record<string, unknown>;
      const metadata = flat['metadata'] as Record<string, unknown> | undefined;
      if (
        metadata?.['subtype'] === 'thread_started' &&
        typeof flat['session_id'] === 'string' &&
        flat['session_id']
      ) {
        state.agentSessionId = flat['session_id'];
        // task-10：拿到 agentSessionId 后才可恢复 → 排队 flush。
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
      // task-03 / D-002@v1：按本 message 的 parentKey 分桶——子代理完整 assistant
      // message 只清/override 自己的桶，绝不触碰主 agent 桶（R-02 P0）。completed/
      // segmentId 全部带 parent 前缀，与该桶 partial 对齐。
      const parentKey = parentToolUseId ?? 'main';
      const completed = this._extractCompletedSegments(state, msg, parentKey);
      const buf = this._partialBuffers.get(state.sessionId)?.get(parentKey);
      const flushedSnapshot = buf
        ? buf.flushedSegments.slice()
        : [];
      // 第一阶段：sync 清 buffer + 记录 completedSegments（late partial 守卫立即生效）。
      this._clearPartialBufferSync(state.sessionId, parentKey, completed);
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
   * 2026-06-28-daemon-subagent-transcript task-03 / D-002@v1：从消息读归属 parentKey。
   * SDKPartialAssistantMessage（stream_event，sdk.d.ts:3723）/ assistant / user message
   * 带 parent_tool_use_id（非空=子代理该 tool_use 的 id，null=主 agent）→ 取该 id；
   * 其余消息类型（如 SDKThinkingTokensMessage 不带该字段）读不到 → 退化 'main'
   *（thinking_tokens 归主桶，estimated_tokens 显示降级，非计费不影响 R-02 回归）。
   */
  private _parentKeyOf(msg: SDKMessage): string {
    const raw = (msg as Record<string, unknown>)['parent_tool_use_id'];
    return typeof raw === 'string' && raw ? raw : 'main';
  }

  /**
   * task-03 / D-002@v1：获取或创建指定 parentKey 的 partial 桶（二级 Map 内层）。
   * 主 agent → 'main' 桶（行为与改造前单桶等价，R-02）；子代理 → 各自 tool_use_id 桶，
   * 互不干扰。空桶对象首次 partial 时懒建。
   */
  private _getOrCreateBuffer(
    sessionId: string,
    parentKey: string,
  ): PartialFlushBuffer {
    let sessionMap = this._partialBuffers.get(sessionId);
    if (!sessionMap) {
      sessionMap = new Map<string, PartialFlushBuffer>();
      this._partialBuffers.set(sessionId, sessionMap);
    }
    let buf = sessionMap.get(parentKey);
    if (!buf) {
      buf = {
        parentKey,
        thinking: '',
        assistant: '',
        lastTokens: 0,
        flushedTokens: 0,
        timer: null,
        currentMessageId: null,
        currentSegmentId: null,
        flushedSegments: [],
        completedSegments: new Set<string>(),
        pendingUsage: null,
        flushedUsage: null,
        sessionInputTokens: 0,
        sessionOutputTokens: 0,
        sessionCacheReadTokens: 0,
        sessionCacheCreationTokens: 0,
        lastCallOutputTokens: 0,
        lastCallCacheReadTokens: 0,
        lastCallCacheCreationTokens: 0,
      };
      sessionMap.set(parentKey, buf);
    }
    return buf;
  }

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
  ): string {
    // P1 修复：messageId 单一数据源 = buf.currentMessageId（由 message_start 事件
    // event.message.id 设置）。真实 SDK 的 content_block_delta 事件自身不带
    // message.id（SDKPartialAssistantMessage 也没有顶层 message 字段），旧实现的
    // 「从 delta 顶层读 message.id 作 hint」永远拿到 undefined，形同虚设；保留它
    // 反而掩盖了「currentMessageId 被 _clearPartialBufferSync 清空 → late delta
    // 退化为 runId:thinking」的真问题。故移除 hint，只信 currentMessageId。
    // task-03 / D-002：segmentId 加 buf.parentKey 前缀（'main' 或 tool_use_id），
    // 主/子代理 segment 空间隔离，避免不同 agent 的同 messageId:index 撞 id 导致
    // completedSegments 守卫跨 agent 误判。partial 与 complete 都加同前缀，去重自洽。
    const mid = buf.currentMessageId;
    const idx = typeof blockIndex === 'number' ? String(blockIndex) : 'thinking';
    const prefix = buf.parentKey;
    if (mid) {
      return `${prefix}:${mid}:${idx}`;
    }
    // 退化：同 turn 共享 segmentId（接受合并精度损失，边界 6）。
    const runKey = state.currentRunId ?? 'unknown';
    return `${prefix}:${runKey}:thinking`;
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
    parentKey: string,
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
        // task-03 / D-002：segmentId 带 parentKey 前缀，与 _resolveSegmentId 对齐
        //（partial/complete 同前缀，completedSegments 守卫不跨 agent 误判）。
        segments.add(mid ? `${parentKey}:${mid}:${i}` : `${parentKey}:${runKey}:thinking`);
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
    // task-03 / D-002@v1：按 msg 归属 parentKey 分桶——子代理 partial delta 进自己的
    // 桶，主 agent 进 'main' 桶。stream_event 带 parent_tool_use_id（sdk.d.ts:3723），
    // thinking_tokens 不带（退化 'main'）。主/子 partial 互不干扰（R-02 P0）。
    const parentKey = this._parentKeyOf(msg);
    const buf = this._getOrCreateBuffer(sessionId, parentKey);

    const msgType = (msg as { type?: string }).type;
    if (msgType === 'stream_event') {
      const event = (msg as { event?: unknown }).event;
      if (event && typeof event === 'object') {
        const ev = event as {
          type?: string;
          index?: number;
          delta?: { type?: string; thinking?: string; text?: string };
          message?: { id?: string };
          // ql-20260627-usage：message_delta.usage（Claude SDK 全名 cache_*_input_tokens）。
          usage?: Record<string, unknown>;
        };
        // task-11：message_start 提取 message.id（segmentId 拼接用，跨 message 隔离）。
        // SDK 实测 message_start 带 message.id（Anthropic Messages API 标准）；若缺失
        //（退化方案）后续 segmentId 回退到 currentRunId。
        if (ev.type === 'message_start' && ev.message) {
          const mid = ev.message.id;
          if (typeof mid === 'string' && mid) {
            buf.currentMessageId = mid;
          }
          // ql-session-usage：message_start.usage.input_tokens 是本次 API call
          // 的完整输入 token（含 context）。累加到 session 级总量。
          // cache_*_input_tokens 也在 message_start 中（如果启用 prompt caching）。
          const startUsage = (ev.message as { usage?: Record<string, unknown> }).usage;
          if (startUsage && typeof startUsage['input_tokens'] === 'number') {
            buf.sessionInputTokens += startUsage['input_tokens'] as number;
          }
          if (startUsage && typeof startUsage['cache_read_input_tokens'] === 'number') {
            buf.sessionCacheReadTokens += startUsage['cache_read_input_tokens'] as number;
          }
          if (startUsage && typeof startUsage['cache_creation_input_tokens'] === 'number') {
            buf.sessionCacheCreationTokens += startUsage['cache_creation_input_tokens'] as number;
          }
          // 新 API call 开始，重置 per-call output tracker
          buf.lastCallOutputTokens = 0;
          buf.lastCallCacheReadTokens = 0;
          buf.lastCallCacheCreationTokens = 0;
        }
        // content_block_start 带 content_block.type==='thinking' 仅是开始标记，
        // thinking_delta 会跟随，无需特殊处理（避免 emit 空消息）。
        if (ev.type === 'content_block_delta' && ev.delta) {
          const delta = ev.delta;
          if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
            // task-11（边界 5，late partial 守卫）+ P1 修复：完整 message 已覆盖
            // 该 segment → 后到的 partial 直接丢弃（网络重排，罕见）。不累积、
            // 不重启 timer。
            //
            // segmentId 复用 buf.currentMessageId（由 message_start 的
            // event.message.id 设置）。真实 SDK 的 content_block_delta 事件自身
            // 不带 message.id（SDKPartialAssistantMessage 也没有顶层 message 字段）
            // ——旧实现读 msg.message?.id 永远是 undefined，且 _clearPartialBufferSync
            // 把 currentMessageId 清成 null，导致 late delta 退化为 runId:thinking，
            // 与 completedSegments 里的 messageId:index 对不上 → 守卫失效，late
            // partial 被放行。现状：_clearPartialBufferSync 不再清 currentMessageId
            //（完整 message 与 message_start 共享同一 id，下一条 message_start 自然
            // 覆盖），late delta 解析出与原 partial 相同的 segmentId → 守卫正确拦截。
            const segId = this._resolveSegmentId(state, buf, ev.index);
            if (buf.completedSegments.has(segId)) {
              return;
            }
            buf.currentSegmentId = segId;
            buf.thinking += delta.thinking;
          } else if (delta.type === 'text_delta' && typeof delta.text === 'string') {
            buf.assistant += delta.text;
          }
        }
        // ql-20260627-usage：message_delta 携带本 message 的 cumulative usage
        //（Claude 流式计费，整条累计；cache_*_input_tokens 为全名）。
        // ql-session-usage：message_delta.usage.output_tokens 是本 API call 的累计
        // output。我们算 delta（本次 - 上次）累加到 session 级总量，让 submitMessages
        // 发送递增的 session 总量（而非单次 call 的值，避免前端只看到几 k）。
        if (ev.type === 'message_delta' && ev.usage) {
          const u = ev.usage;
          // output delta accumulation
          const callOut = typeof u['output_tokens'] === 'number' ? (u['output_tokens'] as number) : 0;
          const outDelta = Math.max(0, callOut - buf.lastCallOutputTokens);
          buf.sessionOutputTokens += outDelta;
          buf.lastCallOutputTokens = callOut;

          // cache_read delta (message_delta may update cache_read cumulative for this call)
          const callCacheRead = typeof u['cache_read_input_tokens'] === 'number'
            ? (u['cache_read_input_tokens'] as number) : 0;
          const cacheReadDelta = Math.max(0, callCacheRead - buf.lastCallCacheReadTokens);
          buf.sessionCacheReadTokens += cacheReadDelta;
          buf.lastCallCacheReadTokens = callCacheRead;

          // cache_creation delta
          const callCacheCreate = typeof u['cache_creation_input_tokens'] === 'number'
            ? (u['cache_creation_input_tokens'] as number) : 0;
          const cacheCreateDelta = Math.max(0, callCacheCreate - buf.lastCallCacheCreationTokens);
          buf.sessionCacheCreationTokens += cacheCreateDelta;
          buf.lastCallCacheCreationTokens = callCacheCreate;

          // pendingUsage 用 session 级累积值
          buf.pendingUsage = {
            input_tokens: buf.sessionInputTokens,
            output_tokens: buf.sessionOutputTokens,
            cache_read_tokens: buf.sessionCacheReadTokens,
            cache_creation_tokens: buf.sessionCacheCreationTokens,
          };
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
        // task-03：flush 指定 parentKey 的桶（timer 是 per-buffer 的）。
        this._flushPartial(sessionId, parentKey).catch((err) => {
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
  private async _flushPartial(
    sessionId: string,
    parentKey: string,
  ): Promise<void> {
    const buf = this._partialBuffers.get(sessionId)?.get(parentKey);
    if (!buf) return;
    // 先清 timer 引用，让下次 partial 能重建（自然节流）。
    buf.timer = null;

    const state = this._store.get(sessionId);
    if (!state) {
      // session 已不存在（end/fail 已销毁 buffer，但定时器可能已 in-flight）→ 销毁
      // 整个 session 所有桶（_destroyPartialBuffer 遍历内层 Map clearTimeout）。
      this._destroyPartialBuffer(sessionId);
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

    // ql-20260627-usage：usage 仅在 pendingUsage 变化时注入一条 flat 消息
    //（message_delta.usage 是 cumulative 全量，去重避免 backend 重复累加 token）。
    // 一次 flush 至多注入一条（thinking 优先，否则 assistant）。
    const usageToFlush =
      buf.pendingUsage &&
      !this._usageEqual(buf.pendingUsage, buf.flushedUsage)
        ? buf.pendingUsage
        : null;
    let usageAttached = false;
    const attachUsage = (formatted: SDKMessage): void => {
      if (usageToFlush && !usageAttached) {
        (formatted as Record<string, unknown>)['usage'] = { ...usageToFlush };
        usageAttached = true;
      }
    };

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
      attachUsage(formatted);
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
      attachUsage(formatted);
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
    // usage 没有被任何 content 消息携带（message_delta 在 content 之后到达，
    // thinking/assistant 可能已被前一轮 flush 清空）→ 发一条独立 usage 消息，
    // 确保 backend 实时拿到 token 计数。content 为空字符串避免 agent_run_logs 多一行噪声。
    if (usageToFlush && !usageAttached) {
      const formatted = {
        event_type: 'text',
        content: '',
        channel: 'stdout',
      } as unknown as SDKMessage;
      attachUsage(formatted);
      await this.deps.onTurnMessage(sessionId, runId, formatted);
    }
    // usage 已通过 flat 消息注入 → 标记去重（下次同值不再发）。
    if (usageToFlush) {
      buf.flushedUsage = buf.pendingUsage;
    }
  }

  /**
   * ql-20260627-usage：比较两个 usage 快照是否全字段相等（_flushPartial 去重判定）。
   * 两者皆 null 视为相等；任一为 null 视为不等。
   */
  private _usageEqual(
    a: PartialUsageSnapshot | null,
    b: PartialUsageSnapshot | null,
  ): boolean {
    if (!a || !b) return a === b;
    return (
      a.input_tokens === b.input_tokens &&
      a.output_tokens === b.output_tokens &&
      a.cache_read_tokens === b.cache_read_tokens &&
      a.cache_creation_tokens === b.cache_creation_tokens
    );
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
    parentKey: string,
    completedSegments: ReadonlySet<string> = new Set(),
  ): void {
    const buf = this._partialBuffers.get(sessionId)?.get(parentKey);
    if (!buf) return;
    if (buf.timer) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }
    buf.thinking = '';
    buf.assistant = '';
    buf.lastTokens = 0;
    buf.flushedTokens = 0;
    // ql-20260627-usage：完整 assistant message 已带终态 usage（daemon lift 自
    // message.usage）；下条 message_start 开始新 message，usage 重新累计，故清零。
    buf.pendingUsage = null;
    buf.flushedUsage = null;

    // task-11：记录已完成 segment（late partial 守卫用）。
    for (const segId of completedSegments) {
      buf.completedSegments.add(segId);
    }

    // flushedSegments 清空（override 已在 _emitOverrideSignals 里消费）。
    // 注意 completedSegments 不在此清——完整 message 到达 ≠ turn 结束，late partial
    // 守卫需在本 turn 内持续生效；turn 真正结束由 _onResult 收尾时清。
    buf.flushedSegments = [];
    buf.currentSegmentId = null;
    // P1 修复：保留 currentMessageId。完整 assistant message 与 message_start
    // 共享同一 message.id，late partial delta（content_block_delta 自身不带 id）
    // 必须据此解析 segmentId 才能与 completedSegments 对齐 → 守卫才能拦截。
    // 下一条 message_start 会自然覆盖；在此清空会让 late delta 退化为
    // runId:thinking → 守卫失效。
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
    // task-03 / D-002：销毁整个 session 的所有桶（主 + 各子代理）。每个桶有独立 timer，
    // 全部 clearTimeout 防泄漏。
    const sessionMap = this._partialBuffers.get(sessionId);
    if (!sessionMap) return;
    for (const buf of sessionMap.values()) {
      if (buf.timer) {
        clearTimeout(buf.timer);
        buf.timer = null;
      }
    }
    this._partialBuffers.delete(sessionId);
  }
}
