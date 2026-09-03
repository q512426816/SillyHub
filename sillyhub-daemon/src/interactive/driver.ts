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
 *   - task-06/08（2026-09-03-agent-provider-abstraction / FR-02 / D-002@v1）：
 *     onTurnMessage 契约演进为 TurnMessageEnvelope{events, raw?}（raw 仅
 *     SILLYHUB_DEBUG_RAW_EVENTS=1 携带、下游禁止依赖）且 **envelope-only 收口**
 *     （task-08：Claude/Codex 两 driver 旧键兜底与裸消息分支移除）；
 *     InteractiveDriverResult 增结构化 usage（AgentEventUsage 短名）/session_id。
 *
 * 本文件为纯类型导出，不含任何运行时逻辑；具体 driver 实现见：
 *   - ClaudeSdkDriver（claude-sdk-driver.ts，task-03 让其 implements InteractiveDriver）
 *   - CodexAppServerDriver（codex-app-server-driver.ts，task-04 新增）
 *
 * @module interactive/driver
 */

/**
 * provider 集合（FR-01/FR-10）。
 *
 * task-05（FR-05 / design §5.2）：联合类型单源迁至 providers.ts——由注册表
 * INTERACTIVE_PROVIDERS 推导（`keyof typeof`），新增 provider 只加注册表条目，
 * 本文件不再维护字面量联合。此处 re-export 自 providers.ts（type-only，不
 * 引入运行时依赖），保持既有 `from './driver.js'` 导入路径的调用点零改动；
 * 同时本地 import 供本文件 InteractiveDriverHandle.provider 等引用。
 */
import type { InteractiveProvider } from './providers.js';
import type { AgentEvent, AgentEventUsage } from '../types.js';

export type { InteractiveProvider };

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
  /**
   * 2026-08-20-session-multimodal-attachments task-09：多模态块（可选中）。
   * Claude driver 转 SDK ContentBlockParam 数组；codex driver 不读（D-6 三层
   * 门控兜底）。mediaType 为 MIME；document 固定 application/pdf。
   */
  blocks?: Array<
    | { type: 'image'; mediaType: string; base64: string }
    | { type: 'document'; mediaType: 'application/pdf'; base64: string }
  >;
  /**
   * task-09：已落盘文件清单（SessionManager 在 push 前已下载完成并把路径
   * 追加进 text；此字段供 driver/日志感知附件存在，不参与消息组装）。
   */
  filesToFetch?: Array<{ id: string; name: string }>;
}

/**
 * task-06（2026-09-03-agent-provider-abstraction / FR-02 / D-002@v1）：turn 中间消息信封。
 *
 * driver 归一化产出的 AgentEvent 批次：一帧 provider 原始消息可产 0..N 条事件
 *（Claude 一帧 assistant 多 block → 多事件；partial flush 单事件成批）。
 *
 * `raw` **仅为调试通道**：仅当环境变量 `SILLYHUB_DEBUG_RAW_EVENTS=1` 时 driver
 * 才携带 provider 原始消息（Claude=SDKMessage 原对象），默认 undefined。
 * **下游（SessionManager / daemon.ts / cli.ts）禁止依赖 raw 的形状与存在性**
 *（D-002@v1：raw 降格调试通道，终态消费面 raw 依赖清零）。
 */
export interface TurnMessageEnvelope {
  /** 归一化事件（zod 校验见 agent-event-schema.ts 的 safeParseAgentEvent）。 */
  events: AgentEvent[];
  /** provider 原始消息（仅 SILLYHUB_DEBUG_RAW_EVENTS=1 携带；禁止下游依赖）。 */
  raw?: unknown;
}

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
  /**
   * token 用量。
   *
   * task-06（FR-02）：类型从 `{input_tokens?, output_tokens?}` 扩为 AgentEventUsage
   *（增 cache_read/cache_creation/ctx 维度，宽松可选，现形状兼容）。Claude driver
   * 把 SDKResultMessage.usage 的 Anthropic 全名 `cache_*_input_tokens` 映射为短名
   * `cache_*_tokens`（daemon.ts:3564-3586 lift 同口径，叠加保留原字段），codex
   * driver 从 metadata.usage 提取四字段短名（task-04）。
   */
  usage?: AgentEventUsage;
  /**
   * provider 会话 ID（Claude SDK result.session_id / Codex threadId）。
   * task-06（FR-02）：结构化提升为一等字段（原先仅藏在 Claude 透传对象里），
   * 供 SessionManager/backend resume 指针消费。
   */
  session_id?: string;
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
  /**
   * task-06（D-007@v2）：MCP server 配置表，spawn 主 agent 时注入让其 discover tool。
   *
   * 结构与 ``mcp-config.ts`` ``McpServerConfig`` 对齐（``{ command, args, env? }``），
   * 且兼容 Claude SDK ``McpStdioServerConfig``（``{ type?:'stdio', command, args?, env? }``）
   * —— Claude driver 透传到 SDK ``options.mcpServers``，codex driver 暂存（codex
   * app-server MCP 注入留后续任务）。
   *
   * **主 agent 长生命周期**：主 agent = interactive lease（``lease_expires_at=NULL``，
   * 永不过期），复用现有 SessionManager.create/restoreAndReconnect；driver consume
   * 循环零改，仅 start 时注入 MCP 配置让主 agent discover 5 tool（dispatch_worker /
   * get_worker_result / list_workers / converge_mission / report_progress）。
   *
   * SessionManager 经 ``mainAgentMcpConfigProvider`` 在 create/restore 时为标记为
   * 主 agent 的 session 构造本字段（platform_default + workspace + daemon MCP server
   * 合并后的最终配置）。普通会话（chat/scan/stage）不注入（undefined）。
   *
   * 键名 = server 名（如 ``sillyhub-daemon`` = DAEMON_MCP_SERVER_NAME），值 = 启动配置。
   * 空对象 / undefined → driver 不传 mcpServers（SDK 走默认，无额外 tool）。
   */
  mcpServers?: Record<string, McpServerConfigForDriver>;
}

/**
 * task-06：provider-neutral MCP server 启动配置（driver.ts 契约层，不依赖 SDK 类型）。
 *
 * 结构与 ``mcp-config.ts`` ``McpServerConfig`` + Claude SDK ``McpStdioServerConfig``
 * 兼容：stdio 子进程启动（command + args + env）。driver 实现侧按需透传到 provider
 * SDK（Claude SDK ``options.mcpServers`` / Codex app-server 协议）。
 */
export interface McpServerConfigForDriver {
  /** 启动命令（如 ``'node'``）。 */
  command: string;
  /** 命令行参数（如 ``['dist/mcp-server.js']``）。 */
  args?: string[];
  /** 子进程 env（如 ``{ MCP_SERVER_BACKEND_URL, MCP_SERVER_DAEMON_TOKEN }``）。 */
  env?: Record<string, string>;
}

/**
 * consume 回调集合（SessionManager 注入）。provider-neutral：
 * - Claude driver：SDK 消息流经 ClaudeEventNormalizer 归一化 → onTurnMessage 收
 *   TurnMessageEnvelope{events, raw?}（task-06/08）；SDKResultMessage 经 usage/session_id
 *   短名映射后给 onTurnResult（InteractiveDriverResult）。
 * - Codex driver：flat 事件经 toAgentEvent 映射 → 包装 envelope{events:[单事件]}
 *   给 onTurnMessage（task-08 envelope-only），归一化 result 给 onTurnResult。
 *
 * E4（不改传入参数）：回调由 SessionManager 提供，driver 不得缓存或跨 session 复用。
 * E3（异常不静默）：driver 异常必须经 `onTurnError` 上报，不得吞掉。
 */
export interface InteractiveDriverCallbacks {
  /** turn 收敛结果 → SessionManager 关闭当前 AgentRun（task-02 真接线）。 */
  onTurnResult(result: InteractiveDriverResult): void | Promise<void>;
  /**
   * 中间消息（归一化事件批次）→ submit AgentRunLog（task-02/06/09 接 submitMessages）。
   * 可选。
   *
   * task-08（FR-02 / D-002@v1 收口）：**envelope-only**——入参恒为
   * {@link TurnMessageEnvelope}（`events` 必填；`raw` 仅调试开关携带，下游禁止
   * 依赖）。旧裸消息形态（InteractiveDriverMessage / raw SDK 透传）分支已随
   * Claude/Codex 两 driver 的旧键兜底一并移除。
   */
  onTurnMessage?(envelope: TurnMessageEnvelope): void | Promise<void>;
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
