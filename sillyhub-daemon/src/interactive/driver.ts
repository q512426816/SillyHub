/**
 * interactive/driver.ts —— provider-neutral interactive driver 契约（D-001@v1, D-009@v1）。
 *
 * 设计来源：design.md §5.1。SessionManager 只依赖本契约，provider 差异
 *（Claude SDK query / Codex app-server JSON-RPC）封装在各自 driver 内部。
 * 本文件不 import 任何 provider SDK，保持 SessionManager 层 provider-neutral。
 *
 * 覆盖决策：
 *   - D-001@v1：provider driver registry（`SessionManagerDeps.drivers`），
 *     SessionManager 按 `state.provider` 从 registry 选取 driver；未注册 provider
 *     抛 `UnsupportedProviderError`（types.ts，code `UNSUPPORTED_PROVIDER`，
 *     由 task-02 在 create/restore 路径接线，本契约仅注释引用）。
 *   - D-009@v1：输入队列脱离 Claude Agent SDK。SessionManager 只
 *     push `UserTurnInput`；SDK 类型（SDKUserMessage）只能出现在 Claude driver 内部。
 *
 * 本文件为纯类型导出，不含任何运行时逻辑；具体 driver 实现见：
 *   - ClaudeSdkDriver（claude-sdk-driver.ts，task-03 让其 implements InteractiveDriver）
 *   - CodexAppServerDriver（codex-app-server-driver.ts，task-04 新增）
 *
 * @module interactive/driver
 */

/** provider 集合（与 types.ts provider union 对齐，FR-01/FR-10）。 */
export type InteractiveProvider = 'claude' | 'codex';

/**
 * D-009@v1：provider-neutral 用户输入单元。SessionManager.create/inject 只 push 此形态。
 * - Claude driver 内部转换为 SDKUserMessage `{ type:'user', message:{ role:'user', content:[{type:'text', text}] } }`。
 * - Codex driver 内部转换为 app-server `turn/start` 的 input 字段。
 */
export interface UserTurnInput {
  /** 固定 'user'，标识这是一轮用户输入（未来可扩展 tool_result 注入，但本任务仅 user）。 */
  type: 'user';
  /**
   * 用户文本。空串允许入队（队列不校验语义，E1），由 driver 自行决定是否跳过；
   * SessionManager 层不在此做校验。
   */
  text: string;
}

/**
 * driver 上报给 SessionManager 的中间消息（onTurnMessage 回调入参）。
 * provider-neutral：Claude driver 透传 SDKMessage 原对象（鸭子类型满足 Record），
 * Codex driver 上报 flat message `{ event_type, content, metadata?, session_id? }`。
 * SessionManager 不假设具体字段，由 daemon.onTurnMessage 按 provider 归一化（task-02/06）。
 */
export type InteractiveDriverMessage = Record<string, unknown>;

/**
 * driver 上报给 SessionManager 的 turn 结果（onTurnResult 回调入参）。
 * 字段宽松：Claude driver 透传 SDKResultMessage（含 subtype/total_cost_usd/usage 等），
 * Codex driver 用 `{ subtype, is_error, result?, usage? }` 归一化（D-004@v1 flat 契约，task-04）。
 * 所有字段可选，SessionManager 只在 is_error/subtype 上做收敛判断（task-02）。
 */
export interface InteractiveDriverResult {
  /** result 子类型（Claude SDK: success/error_during_execution/...；Codex: success/error）。 */
  subtype?: string;
  /** turn 是否出错（收敛 AgentRun 为 failed 的判据之一）。 */
  is_error?: boolean;
  /** result 主体（error 时为错误信息/堆栈，success 时为最终输出）。 */
  result?: unknown;
  /** 累计花费（Claude SDK 字段，Codex 可选透传）。 */
  total_cost_usd?: number;
  /** turn 数（Claude SDK 字段）。 */
  num_turns?: number;
  /** turn 耗时（ms）。 */
  duration_ms?: number;
  /** API 耗时（ms，Claude SDK 字段）。 */
  duration_api_ms?: number;
  /** token 用量。 */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

/**
 * driver 启动后返回的会话句柄。SessionManager 持有，用于 interrupt/end/close。
 * - Claude driver：包装 SDK Query（processId 可选）。
 * - Codex driver：包装 app-server child + threadId/turnId（task-04）。
 *
 * `close()` 释放子进程/句柄资源；缺省无需显式 close 的 driver 不实现。
 *
 * E7（持久化隔离）：本句柄含子进程/底层资源，**不可序列化、禁止落盘**
 *（task-10 PersistedSessionRecord 白名单不含 handle）。
 */
export interface InteractiveDriverHandle {
  /** 该句柄所属 provider（用于 interrupt 路由校验，D-001@v1 / E5）。 */
  readonly provider: InteractiveProvider;
  /** 底层子进程 pid（可观测/日志用，可空）。 */
  readonly processId?: number;
  /** 释放底层资源（关 stdin / kill child）。幂等。 */
  close?(): Promise<void> | void;
}

/**
 * driver 启动选项（design §5.1）。provider-neutral 公共字段；provider 专属字段
 *（如 pathToClaudeCodeExecutable / canUseTool）通过 provider 专属 StartOptions
 * 由各 driver 自行定义并 extends 本接口的扩展类型（task-03/04）。
 *
 * 本接口只列 provider 无关的会话级控制字段，避免 SessionManager 依赖 SDK 类型。
 */
export interface InteractiveDriverStartOptions {
  /** 固定 cwd（resume 还原用；driver 必须用此 cwd 启动子进程）。 */
  cwd: string;
  /** resume 用（Claude SDK session_id / Codex threadId）；首 turn 不传。 */
  resume?: string;
  /** 模型覆盖（可空）。 */
  model?: string;
  /** 是否启用远程人工审批（D-006@v1 策略入口；driver 读取并据此决定审批行为）。 */
  manualApproval?: boolean;
  /** AskUserQuestion-only 策略（D-006@v1；true 时只阻塞用户提问类请求）。 */
  askUserOnly?: boolean;
  /** 子进程 env（凭证/配置注入；仅内存，禁止持久化）。 */
  env?: NodeJS.ProcessEnv;
}

/**
 * consume 回调集合（SessionManager 注入）。provider-neutral：
 * - Claude driver：把 SDKMessage 透传给 onTurnMessage，SDKResultMessage 给 onTurnResult。
 * - Codex driver：flat message 给 onTurnMessage，归一化 result 给 onTurnResult。
 *
 * E4（不改传入参数）：回调由 SessionManager 提供，driver 不得缓存或跨 session 复用。
 * E3（异常不静默）：driver 异常必须经 `onTurnError` 上报，不得吞掉。
 */
export interface InteractiveDriverCallbacks {
  /** turn 收敛结果 → SessionManager 关闭当前 AgentRun（task-02 真接线）。 */
  onTurnResult(result: InteractiveDriverResult): void | Promise<void>;
  /** 中间消息 → submit AgentRunLog（task-02/06 接 submitMessages）。可选。 */
  onTurnMessage?(msg: InteractiveDriverMessage): void | Promise<void>;
  /** driver 异常（spawn 失败/进程退出/网络）→ session failed。可选。 */
  onTurnError?(err: unknown): void | Promise<void>;
}

/**
 * D-001@v1 provider-neutral interactive driver 契约。
 *
 * 生命周期：
 *   start(input, opts) → handle（启动子进程 + 订阅 input 队列）
 *   consume(handle, cb) → 遍历 provider 输出流，逐条回调（阻塞直到流结束/出错）
 *   interrupt(handle|null) → turn 级打断；无 active turn 返回 false
 *   handle.close?() → 释放资源（end/stop 时调用）
 *
 * 实现：ClaudeSdkDriver（task-03）、CodexAppServerDriver（task-04）。
 * SessionManager 通过 `drivers[provider]` 选取；未注册 provider 抛
 * `UnsupportedProviderError`（types.ts，code `UNSUPPORTED_PROVIDER`，task-02 接线）。
 *
 * 边界：
 *   - E3：`interrupt` no-op 返回 false 不冒泡（与现有 ClaudeSdkDriver.interrupt 一致）；
 *     其余 driver 异常必须经 `onTurnError` 上报。
 *   - E4：`start` 接收的 `input` AsyncIterable 由 SessionManager 拥有，driver 不得
 *     mutate/close 它（只能消费）。
 *   - E5：`InteractiveDriverHandle.provider` 必须与启动它的 driver 一致（实现侧自填），
 *     SessionManager/task-02 据此校验 interrupt 路由不串 provider。
 */
export interface InteractiveDriver {
  /**
   * 启动 provider 会话，订阅 input AsyncIterable（长生命周期跨多 turn）。
   * @returns 会话句柄（供 consume/interrupt/close）
   */
  start(
    input: AsyncIterable<UserTurnInput>,
    options: InteractiveDriverStartOptions,
  ): Promise<InteractiveDriverHandle>;

  /**
   * 消费 provider 输出流直到自然结束或出错。SessionManager 在 create/inject 后
   * 作为 session 协程一次启动；每条消息/结果触发对应回调。
   */
  consume(
    handle: InteractiveDriverHandle,
    callbacks: InteractiveDriverCallbacks,
  ): Promise<void>;

  /**
   * turn 级打断（FR-03）。
   * @returns true=已发出打断信号；false=无 active turn / handle 无效 / 打断抛错（no-op 不冒泡，E3）。
   */
  interrupt(handle: InteractiveDriverHandle | null): Promise<boolean>;
}
