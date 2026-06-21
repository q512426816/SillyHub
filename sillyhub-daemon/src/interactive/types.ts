/**
 * interactive/types.ts —— 交互式会话局部类型（task-04 §4.3 + task-10 §4.1）。
 *
 * 集中定义 SessionState / SessionStatus / 错误类，避免 claude-sdk-driver.ts 与
 * session-manager.ts 之间循环依赖。SDK 类型（Query / SDKMessage / SDKResultMessage）
 * 直接从 @anthropic-ai/claude-agent-sdk 复用（type-only import）。
 *
 * task-10 增量（§4.1）：PersistedSessionRecord / PersistedSessionFile /
 * SessionStorePersistence / SESSION_FILE_VERSION —— daemon 元数据持久化 schema
 *（SDK 自动持久化 jsonl，daemon 只存恢复索引，spike D3）。
 *
 * 来源：design.md §7.2 SessionManager / §7.6 turn 时序；task-10 §4.1。
 *
 * @module interactive/types
 */

import type { Query, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

/** session 生命周期状态。 */
export type SessionStatus =
  | 'active' // 空闲可接 inject（无 running turn）
  | 'running' // turn 执行中（driver.consume 未返回该 turn 的 result）
  | 'reconnecting' // 预留（D-003 daemon 重启后 resume，task-10）
  | 'ended' // end 收口，不可再 inject
  | 'failed'; // driver onError / 不可恢复异常

/** 单个 session 的运行态。SessionManager 内存 Map<sessionId, SessionState>。 */
export interface SessionState {
  /** agent_sessions.id（backend 实体，create 时下发）。 */
  sessionId: string;
  /** 长生命周期 interactive lease.id（create 时下发，SESSION_* payload 校验用）。 */
  leaseId: string;
  /**
   * gap-2（D-002@v3 补丁）：lease 级 claim_token，跨 turn 复用。
   *
   * backend 在 lease 创建时生成（prepare_interactive_dispatch 写入 lease metadata），
   * daemon claim 后从 claimResp.claim_token 归一化到 execPayload.claimToken，再经
   * SESSION_INJECT payload（首 turn + 后续 inject）下发。SessionManager.create 时存入
   * state.claimToken，供 onTurnMessage → hubClient.submitMessages（D-002@v3 task-04 桥接，
   * task-04 完成）+ gap-3 notifyRunResult（task-04 桥接）复用。
   */
  claimToken: string;
  /** SDK 返回的 session_id（首 turn system/init 写入；resume 用，spike D3）。Wave1/2 内存态。 */
  agentSessionId?: string;
  /** SDK Query 句柄，长生命周期跨多 turn（spike H2）。 */
  query?: Query;
  /** per-session 输入队列（query 订阅一次）。 */
  inputQueue: import('./input-queue.js').InputQueue;
  /** 当前 turn 的 AgentRun.id（backend 在 inject 时创建并下发）。 */
  currentRunId?: string;
  /** 当前 turn 状态：active=空闲可接 inject，running=turn 执行中。 */
  status: SessionStatus;
  /** 最后活动时间（D-004 空闲 30min 回收，task-07 实现）。 */
  lastActiveAt: number;
  /** 固定 cwd（resume 还原用，spike D3）。driver.start 必须用 state.cwd。 */
  cwd: string;
  /** provider（claude；codex 后续 CodexAppServerDriver 单独）。 */
  provider: 'claude' | 'codex';
  /** pathToClaudeCodeExecutable（create 时由 daemon._agentPaths 提供）。 */
  pathToClaudeCodeExecutable: string;
  /**
   * gap-8（凭证 parity）：claude 子进程 env（含 credentials.json token）。
   * 仅内存态，**禁止**写入 PersistedSessionRecord（task-10 白名单已禁密钥）。
   */
  env?: NodeJS.ProcessEnv;
  /**
   * scan 真阻塞（恢复路径用，generic-wibbling-whisper 改造点 C/B）：当前 session
   * 是否启用 canUseTool 远程人审。create 时从 input.manualApproval ??
   * this._manualApproval 求值；restoreAndReconnect 时从 record.manualApproval ??
   * this._manualApproval 求值。snapshotPersistable 输出到 record.manualApproval
   *（仅 true 时输出，让恢复路径跨 daemon 重启保留审批能力）。
   */
  manualApproval?: boolean;
  /**
   * scan 真阻塞（AskUserQuestion-only 策略，恢复路径用，改造点 D）：true 时只
   * AskUserQuestion 走远程人审，其他工具 allow-through。create 时从
   * input.askUserOnly===true 求值；restoreAndReconnect 时从 record.askUserOnly ??
   * true 求值（scan 主用场景）。manualApproval=true 时才随 state 持久化。
   */
  askUserOnly?: boolean;
}

/** CreateSessionInput（daemon._startInteractiveSession → SessionManager.create）。 */
export interface CreateSessionInput {
  sessionId: string;
  leaseId: string;
  /**
   * gap-2：lease 级 claim_token（必填）。daemon._startInteractiveSession 从
   * execPayload.claimToken（claimResp 归一化）取，存入 SessionState.claimToken。
   */
  claimToken: string;
  firstPrompt: string;
  firstRunId: string;
  cwd: string;
  provider: 'claude' | 'codex';
  /** pathToClaudeCodeExecutable（来自 daemon._agentPaths.get('claude')）。 */
  pathToClaudeCodeExecutable: string;
  model?: string;
  allowedTools?: string[];
  /**
   * scan 真阻塞（per-session，generic-wibbling-whisper.md 改造点 C/B）：
   * 该 session 是否注入 canUseTool 远程人审。来自 backend lease metadata.manual_approval
   *（scan=true / chat=false），经 daemon _startInteractiveSession 透传。仅 true 时 driver
   * 注入 canUseTool（且 AskUserQuestion 才阻塞，其他工具 allow-through）。
   */
  manualApproval?: boolean;
  /**
   * scan 真阻塞（AskUserQuestion-only 策略，改造点 D）：true 时只 AskUserQuestion
   * 走远程人审（歧义决策阻塞），其他工具（Read/Bash/sillyspec）allow-through 让 scan 自动跑；
   * 缺省 false = 全工具人审（task-08 远程审批危险工具，chat 场景）。来自 backend lease
   * metadata.ask_user_only，经 daemon _startInteractiveSession 透传。
   */
  askUserOnly?: boolean;
  /**
   * gap-8（凭证 parity）：claude 子进程 env（daemon 用 buildSpawnEnv 构造，含
   * credentials.json 的 ANTHROPIC token + tool_config 渲染）。缺省时 driver 回退
   * 裸 process.env（向后兼容 task-04）。**仅本地内存**，禁止序列化/落盘/回传。
   */
  env?: NodeJS.ProcessEnv;
}

/** inject 返回值（runId 由 backend 在 inject 时已创建）。 */
export interface InjectResult {
  runId: string;
}

/** SessionManager 持有的依赖（便于注入 mock driver + backend 通知回调）。 */
export interface SessionManagerDeps {
  driver: import('./claude-sdk-driver.js').ClaudeSdkDriver;
  /** backend 通知回调：result 触发关闭 AgentRun（task-05 真正实现，本任务用 mock）。 */
  onTurnResult: (
    sessionId: string,
    runId: string,
    result: SDKResultMessage,
  ) => void | Promise<void>;
  /** 中间消息 → submit AgentRunLog（task-06 SSE，本任务用 mock）。 */
  onTurnMessage: (
    sessionId: string,
    runId: string,
    msg: SDKMessage,
  ) => void | Promise<void>;
  /** session 终态通知 backend（end/failed → backend end_session，task-05 实现）。 */
  onSessionEnd: (
    sessionId: string,
    status: SessionStatus,
  ) => void | Promise<void>;
  /**
   * task-10（§4.3）：元数据持久化端口。
   *
   * 可选（未注入时 SessionManager 不落盘，保持 task-04 内存态行为向后兼容；
   * daemon.start 在构造时注入生产实例 JsonSessionPersistence）。
   */
  persistence?: SessionStorePersistence;
}

// ── 错误类（稳定 code 供 daemon / backend / 测试识别）──────────────────────────

/** session 不存在（inject/interrupt/end 目标 id 未在 SessionStore）。 */
export class SessionNotFoundError extends Error {
  readonly code = 'SESSION_NOT_FOUND' as const;
  constructor(sessionId: string) {
    super(`session not found: ${sessionId} (SESSION_NOT_FOUND)`);
    this.name = 'SessionNotFoundError';
  }
}

/** session 已存在（重复 create 同一 sessionId）。 */
export class SessionAlreadyExistsError extends Error {
  readonly code = 'SESSION_ALREADY_EXISTS' as const;
  constructor(sessionId: string) {
    super(`session already exists: ${sessionId} (SESSION_ALREADY_EXISTS)`);
    this.name = 'SessionAlreadyExistsError';
  }
}

/** session 非 active（inject 到 ended/failed session）。 */
export class SessionNotActiveError extends Error {
  readonly code = 'SESSION_NOT_ACTIVE' as const;
  constructor(sessionId: string, status: SessionStatus) {
    super(
      `session not active: ${sessionId} status=${status} (SESSION_NOT_ACTIVE)`,
    );
    this.name = 'SessionNotActiveError';
  }
}

/** provider 不支持（codex 后续独立，D-002@v3 不 Big Bang）。 */
export class UnsupportedProviderError extends Error {
  readonly code = 'UNSUPPORTED_PROVIDER' as const;
  constructor(provider: string) {
    super(
      `unsupported provider: ${provider}; only 'claude' supported in Wave1/2 (UNSUPPORTED_PROVIDER)`,
    );
    this.name = 'UnsupportedProviderError';
  }
}

// ── task-09 §4.2：pending canUseTool registry handle（收敛/清理类型）─────────
//
// task-08 已落地 PermissionResolver（register / resolve / abortAll / pendingCount /
// AbortSignal / 5min 兜底）。task-09 在此补充收敛语义的类型别名，供 driver/
// session-manager 引用 + 测试断言，避免在多处重复内联字面量类型。

/** canUseTool 回调的决策（与 SDK CanUseTool 签名逐字对齐）。 */
export type CanUseToolDecision =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message?: string };

/**
 * session 终态时 cancelAllPending 的退出原因。
 * 来源：task-09 §4.2 表（interrupt / end / fail / consume query 退出）。
 */
export type CancelPendingReason =
  | 'interrupted'
  | 'ended'
  | 'failed'
  | 'query_exited';

/**
 * task-09 §4.2：driver/sessionManager 内部消费的 pending registry handle。
 *
 * 实际实现是 PermissionResolver（task-08）；本 handle 是结构化契约（鸭子类型），
 * 让 SessionManager.cancelAllPending 调用点不直接依赖 PermissionResolver 具体类，
 * 便于测试注入 mock + 未来替换实现。
 *
 * 语义（task-09 §4.2 约束）：
 *   - cancel 幂等：同 requestId reject 两次不抛；cancelAll 后 pendingCount===0；
 *   - registry 按 session 隔离（SessionManager 每 session 一个 resolver）；
 *   - 不在 SessionState 持久化（内存态，daemon 重启即清）。
 */
export interface PermissionRegistryHandle {
  /** 登记一个 pending canUseTool；返回 SDK 回调应 await 的 promise。 */
  register(input: {
    sessionId: string;
    runId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId?: string;
    signal?: AbortSignal;
    send: (msg: { type: string; payload: unknown }) => boolean;
  }): { requestId: string; promise: Promise<CanUseToolDecision> };
  /** session 终态时调用：reject 全部 pending，返回被取消的条数。 */
  abortAll(reason: string): number;
  /** 测试观察用：当前 pending 数量。 */
  readonly pendingCount: number;
}

/** cancelAllPending 返回（被取消的 requestId 列表 + 数量）。 */
export interface CancelPendingPermissionsResult {
  reason: CancelPendingReason | string;
  cancelledRequestIds: string[];
  cancelledCount: number;
}

// ── task-10 §4.1：持久化元数据 schema（daemon 恢复索引）──────────────────────
//
// daemon 只持久化可恢复的 interactive session 元数据（active|running 且
// agentSessionId 非空）；SDK 自动持久化 ~/.claude/projects/<encoded-cwd>/<sid>.jsonl
//（spike D3），daemon 不读不写该 jsonl，resume 靠 SDK 内部加载。
//
// **白名单**：只写上列字段；禁止写 claim token / API key / credential / prompt
// 内容 / agent 输出 / Query 句柄 / InputQueue（不可序列化且敏感）。

/** sessions.json schema 版本。不支持 → quarantine（不复活半条记录）。 */
export const SESSION_FILE_VERSION = 1 as const;

/**
 * 单条可恢复 session 元数据（task-10 §4.1）。
 *
 * 仅当 session 状态为 active|running 且 agentSessionId 非空时才落盘。
 */
export interface PersistedSessionRecord {
  /** agent_sessions.id（backend 实体）。 */
  sessionId: string;
  /** 长生命周期 interactive lease.id（恢复时 backend 对账用）。 */
  leaseId: string;
  /** SDK session_id（spike D3 resume 用，必需非空；空则不写入）。 */
  agentSessionId: string;
  /** 固定工作目录（resume 按 cwd 分目录，R-cwd）。 */
  cwd: string;
  /** provider（仅 interactive；batch 不进 sessions.json，FR-09）。 */
  provider: 'claude' | 'codex';
  /** 崩溃时可能在执行的 AgentRun.id（恢复对账用；恢复成功后清空再 flush）。 */
  currentRunId?: string;
  /** turn 计数（可观察，恢复 driver 不直接消费）。 */
  turnCount: number;
  /** 最后活动 epoch ms。 */
  lastActiveAt: number;
  /** 恢复 driver 用（可空，空则恢复时重探，D-009）。 */
  model?: string;
  /** 恢复 driver 用（可空，空则恢复时重探，D-009）。 */
  pathToClaudeCodeExecutable?: string;
  /**
   * scan 真阻塞（恢复路径用，generic-wibbling-whisper 改造点 C/B）：是否启用
   * canUseTool（create 时存 enableApproval；恢复时 fallback 到实例级
   * this._manualApproval）。仅 true 时落盘（false 为默认行为，不写）。
   */
  manualApproval?: boolean;
  /**
   * scan 真阻塞（AskUserQuestion-only 策略，恢复路径用，改造点 D）：true 时只
   * AskUserQuestion 走远程人审。create 时存 input.askUserOnly===true；恢复时
   * fallback 到 true（scan 主用场景）。manualApproval=true 时才落盘（false 也写，
   * 否则恢复 fallback 到 true 会把 chat 误当 scan）。
   */
  askUserOnly?: boolean;
}

/** sessions.json 文件结构。 */
export interface PersistedSessionFile {
  version: typeof SESSION_FILE_VERSION;
  /** ISO 时间戳。 */
  savedAt: string;
  sessions: PersistedSessionRecord[];
}

/**
 * task-10 §4.2：持久化端口（鸭子类型，便于测试 mock）。
 *
 * 实现见 JsonSessionPersistence（src/interactive/session-store-persistence.ts）。
 */
export interface SessionStorePersistence {
  /** 加载可恢复记录；文件不存在/损坏/版本不支持 → 返回空数组（不抛）。 */
  load(): Promise<PersistedSessionRecord[]>;
  /** 原子写整批记录（tmp+rename，串行 promise queue，0o600）。 */
  save(records: readonly PersistedSessionRecord[]): Promise<void>;
  /** 损坏/版本不支持的隔离：重命名为 sessions.json.corrupt-<epoch>。 */
  quarantine(reason: string): Promise<void>;
}
