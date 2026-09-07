/**
 * interactive/session-manager/types.ts —— SessionManager 拆包的类型/常量层。
 *
 * task-02（2026-09-07-arch-large-file-split / D-004@v1 / D-005@v3）：原
 * session-manager.ts（5438 行）拆为 session-manager/ 包 13 子模块 + 瘦 facade。
 * 本文件原样承接原文件头部的全部模块级 interface / type / 常量（零改写），
 * 并新增 ``SessionManagerCore``——子模块函数第一参数（原 ``this``）的类型桥。
 *
 * @module interactive/session-manager/types
 */

// task-08（2026-09-03-agent-provider-abstraction / FR-02 / D-002@v1）：本包
// @anthropic-ai/claude-agent-sdk 类型 import 清零——SessionManager 只消费中性
// AgentEvent / TurnMessageEnvelope（driver 归一化后的事件轨），不再解析 raw SDK
// 消息形状。Claude SDK 专属回调类型（CanUseTool/OnUserDialog/UserDialogResult）
// 改经 ClaudeStartOptions 结构性推导（下方局部别名），不直接 import SDK 包。
import type { ClaudeStartOptions } from '../claude-sdk-driver.js';
import { PermissionResolver } from '../permission-resolver.js';
import type { PermissionSendFn } from '../permission-resolver.js';
import type { PolicyEngine } from '../../policy/filesystem-policy.js';
import type { SpawnCredentialManager } from '../../spawn-env.js';
import type { TranscriptDirs } from '../claude-transcript-dir.js';
import type {
  InteractiveDriver,
  InteractiveDriverResult,
  InteractiveProvider,
  McpServerConfigForDriver,
  TurnMessageEnvelope,
} from '../driver.js';
import type {
  AgentEvent,
  ProviderConfig,
} from '../../types.js';
import type {
  CanUseToolDecision,
  InjectResult,
  PersistedSessionRecord,
  SessionEventForBackend,
  SessionManagerDeps,
  SessionState,
  SessionSwitchConfigPayload,
} from '../types.js';
import type { SessionInjectAttachment } from '../../protocol.js';
import type { ShellKind } from '../../policy/shell-paths.js';

/** task-08：Claude SDK ``CanUseTool`` 的结构性本地别名（SDK 类型 import 清零）。 */
export type CanUseToolFn = NonNullable<ClaudeStartOptions['canUseTool']>;
/** task-08：Claude SDK ``OnUserDialog`` 的结构性本地别名。 */
export type OnUserDialogFn = NonNullable<ClaudeStartOptions['onUserDialog']>;
/** task-08：Claude SDK ``UserDialogResult`` 的结构性本地别名。 */
export type UserDialogResultFn = Awaited<ReturnType<OnUserDialogFn>>;

/**
 * R-10（2026-08-28-daemon-agent-share E2E）：显式写文件工具集——这些工具在
 * spec.allowedTools 白名单内时必须从 SDK 层预批准集（driverOpts.allowedTools，
 * 语义=auto-allowed 不经 canUseTool）摘除，改经 canUseTool 链接受写守卫路径
 * 校验（overlay 交集收紧 / PolicyCache 机器级）。shell 类（Bash 等）从不进
 * 白名单（D-009），无需在此列。
 */
export const _SDK_WRITE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit']);

/**
 * task-05（2026-08-29-batch-session-inherit / S4 / FR-04 / D-002@v1）：resume 损伤
 * 判定正则——单点维护，实现与测试（session-manager-resume-fallback.test.ts）共用。
 *
 * create 带 resume 启动时 SDK 报这些模式 = 目标会话 transcript 缺失/损坏（旧 daemon
 * 掉线期间 jsonl 被清理等），语义为「这个 resume 目标续不上了」。命中才触发降级
 * （清 resume 以同参 fresh 重建一次，见 create）；网络/权限/executable 缺失等普通
 * 启动错误不命中 → 不降级走原失败路径（防误伤）。
 */
export const RESUME_DAMAGE_PATTERNS =
  /session not found|no conversation found|unable to resume/i;

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
   * ql-20260822-001：resume transcript 目录对（探测 + home→隔离迁移共用）。
   * 缺省 daemon 隔离目录 + 宿主机 ~/.claude；测试经此注入 tmp 目录对，
   * 完整覆盖「home jsonl → 切供应商 → 迁移隔离」链路而不触碰真实 ~/.claude。
   */
  resumeDirs?: TranscriptDirs;
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
  /**
   * task-06（D-007@v2 / R-01）：是否主 agent（orchestrator）会话。
   *
   * daemon 生产路径注入谓词：根据会话上下文判定本 session 是否 team 主 agent
   *（role=orchestrator）。主 agent = interactive lease（永不过期，
   * ``lease_expires_at=NULL``，复用现有 lease 机制零新续期）+ MCP tool 注入
   *（让主 agent discover 5 tool 反向调 backend 派 worker / 读产出 / 收敛）。
   *
   * 判定依据由 daemon 决定（如读 lease metadata.stage==='orchestrator' 或
   * ``main_agent_config`` 标记）。未注入（undefined）→ 所有 session 都按普通
   * 会话处理（不注入 daemon MCP server，零回归，向后兼容）。
   *
   * 与 ``mainAgentMcpConfigProvider`` 配对：仅当本谓词返回 true 时才调 provider
   * 取 MCP 配置注入 ``driverOpts.mcpServers``。谓词在 create + restoreAndReconnect
   * 都调用（主 agent session 重启后恢复仍需重新注入 MCP tool）。
   */
  isMainAgentSession?: (ctx: MainAgentMcpContext) => boolean;
  /**
   * task-06（D-007@v2）：主 agent MCP server 配置构造器。
   *
   * daemon 生产路径注入闭包：返回主 agent spawn 时要注入的 MCP server 配置表
   *（已合并 platform_default + workspace + daemon 内置 MCP server）。调
   * ``buildDaemonMcpServerConfig`` + ``mergeMcpConfigs`` 构造，token 用 daemon
   * apiKey（映射到 WORKSPACE_WRITE 用户，详见 task-06 偏离记录）。
   *
   * 仅 ``isMainAgentSession`` 判定为主 agent 的 session 才调本 provider；普通会话
   * 不调（不注入额外 MCP server，向后兼容）。返回 undefined / 空对象 → 不注入。
   *
   * provider 接收 ``MainAgentMcpContext``（sessionId / leaseId / provider / cwd /
   * model）供闭包按需读（如 codex 主 agent 需要不同 server 配置，未来扩展）。
   */
  mainAgentMcpConfigProvider?: (
    ctx: MainAgentMcpContext,
  ) => Record<string, McpServerConfigForDriver> | undefined;
  /**
   * task-06（2026-08-25-team-subsession-governance / FR-03 / D-003@v1，design
   * §5.C.1）：是否分身（mission worker）会话。
   *
   * daemon 生产路径注入谓词：``ctx.provider === 'claude' && ctx.stage ===
   * 'mission_worker'``（lease metadata.stage 由 backend 派发写入，claim payload
   * 透传）。分身会话**不走**主控注入（``isMainAgentSession`` 对 mission_worker
   * 返回 false 不变——5 编排工具不进分身，递归闸），改走 ``workerMcpConfigProvider``
   * 注入仅含 worker_done 单工具的受限 server（sillyhub-worker）。
   *
   * 判定优先于主控谓词（``_resolveMainAgentMcp`` 分身分支在前）；未注入
   * （undefined）= 所有 session 按原逻辑处理（mission_worker 不注入任何 server，
   * 旧行为零回归，向后兼容）。create / restore / reload 三路共用点生效。
   */
  isWorkerSession?: (ctx: MainAgentMcpContext) => boolean;
  /**
   * task-06（design §5.C.1）：分身受限 MCP server 配置构造器。
   *
   * daemon 生产路径注入闭包：``buildWorkerMcpServerConfig`` 组装 sillyhub-worker
   * 条目（env MCP_TOOLSET=mission_worker + backend URL + apiKey 优先 token 回落）。
   * 仅 ``isWorkerSession`` 判定为分身的 session 调用；返回 undefined / 空对象 /
   * provider 未注入 → 不注入（容错）。工具集硬编码 worker_done 单工具——递归闸
   * 保持，禁含派发 / 编排工具（design §3 非目标，P2 独立决策才开闸）。
   */
  workerMcpConfigProvider?: (
    ctx: MainAgentMcpContext,
  ) => Record<string, McpServerConfigForDriver> | undefined;
  /**
   * task-08（provider-switch-live-session / FR-05 / D-004@v1）：本机凭证管理器
   *（鸭子类型 ``SpawnCredentialManager``，仅用 ``get`` / ``buildEnv``）。
   *
   * ``reloadWithProvider`` 构造新 env 时调 ``buildSpawnEnv`` 读 credentials.json 的
   * ANTHROPIC token（层 2）+ 渲染 tool_config 占位符（层 1）。缺省 undefined：reload
   * 用 noopCredential（``get→undefined`` / ``buildEnv→{}``，层 2 自然跳过），平台下发
   * 的 provider_config 第 0 层仍独立生效（对齐 daemon.ts:3050 同款 fallback，避免
   * daemon 未注入 credentialManager 时 reload 第 0 层失效）。
   *
   * daemon 生产路径（cli.ts / daemon.ts）构造 SessionManager 时注入同一
   * ``daemon._credentialManager``，让 reload 后的子进程也能读 credentials.json 的本机
   * token（与 create 路径 parity，gap-8 凭证对齐）。本任务 allowed_paths 仅含
   * session-manager.ts，daemon 接线留给后续任务（不影响本任务测试用 noop 即可覆盖）。
   */
  credentialManager?: SpawnCredentialManager | null;
}

/**
 * task-06：主 agent MCP 注入上下文（create + restoreAndReconnect 共用）。
 *
 * 字段从 ``CreateSessionInput``（create 路径）或 ``PersistedSessionRecord``
 *（restore 路径）归一化提取——两者都含 sessionId/leaseId/provider/cwd，model 可选。
 * daemon 注入的 ``isMainAgentSession`` / ``mainAgentMcpConfigProvider`` 据本上下文
 * 判定 + 构造 MCP 配置，无需区分 create vs restore 来源。
 */
export interface MainAgentMcpContext {
  /** agent_sessions.id（backend 实体）。 */
  sessionId: string;
  /** 长生命周期 interactive lease.id（主 agent lease 永不过期）。 */
  leaseId: string;
  /** provider（claude / codex；task-05 改注册表推导联合）。 */
  provider: InteractiveProvider;
  /** 固定 cwd（resume 还原用）。 */
  cwd: string;
  /** 模型覆盖（可空，主 agent configured provider/model 透传）。 */
  model?: string;
  /**
   * task-06：lease stage 标记（来自 lease.metadata.stage）。
   *
   * daemon 注入的 ``isMainAgentSession`` 谓词读本字段判定主 agent
   *（``stage==='orchestrator'``）。create 路径从 ``CreateSessionInput.stage``、
   * restore 路径从 ``PersistedSessionRecord.stage`` 归一化填入。
   */
  stage?: string;
  /**
   * task-04（2026-08-26-team-subsession-recursion / design §5.C / FR-04）：
   * 分身会话深度（来自 lease.metadata.worker_depth）。
   *
   * create 路径从 ``CreateSessionInput.worker_depth``、restore 路径从
   * ``PersistedSessionRecord.worker_depth`` 归一化填入。本卡只承载不分层——
   * daemon 注入的 ``isWorkerSession`` 等谓词 / provider 据此分档（非叶
   * depth < MAX_DISPATCH_DEPTH 拿派工五件、叶仅 worker_done）的判定归 task-05。
   * undefined → 旧 lease / 主控 / 普通会话（缺键穿透不伪造默认值）。
   */
  worker_depth?: number;
  /**
   * task-10（C-12 / FR-10）：profile 限定的 MCP server name 子集。
   *
   * create 路径从 ``CreateSessionInput.mcpRefs``、restore 路径从
   * ``PersistedSessionRecord.mcpRefs`` 归一化填入。非空时 ``_resolveMainAgentMcp``
   * 对 ``mainAgentMcpConfigProvider`` 返回的配置表按此 ∩ 过滤（mergeMcpConfigs
   * 第三层），只让 profile 引用的 MCP server 被 agent discover。undefined/空 →
   * 不过滤（FR-15 向后兼容）。普通会话（非主 agent）无 MCP 注入，本字段无作用。
   */
  mcpRefs?: string[];
  /** task-10（C-12）：profile 限定的技能子集（承载，daemon 侧 link 收紧用）。 */
  skillRefs?: string[];
  /**
   * task-10（C-12 / D-013）：profile 收紧后的 allowed_roots（写守卫 fallback 用）。
   * create/restore 路径归一化填入。非空时 ``_wrapWithWriteGuard`` fallback 用此替代
   * provider 值（∩ 物理兜底）。undefined/空 → 用 provider 值（FR-15）。
   */
  effectiveAllowedRoots?: string[];
  /**
   * task-05（2026-08-13-profile-system-prompt-injection）：profile.system_prompt。
   * create/restore 路径填入；非空时 _buildDriverOptions 设 SDK systemPrompt
   * preset+append（保留 claude 默认能力 + 追加档案提示词）。undefined → 不注入。
   */
  systemPrompt?: string;
}

/**
 * task-07 onTurnQueued 回调类型（R-conv / spike S1 可观察性）。
 *
 * 不写入 types.ts 的 SessionManagerDeps（避免越界 task-04 的接口签名）；SessionManager
 * 通过 `(deps as SessionManagerDepsWithQueued).onTurnQueued` 探测消费——deps 注入方
 *（task-05/11）按需附带该回调，未注入则只做内部计数，不报错。
 */
export type OnTurnQueuedCallback = (
  sessionId: string,
  runId: string,
  queuePosition: number,
) => void | Promise<void>;

/** 内部类型：SessionManagerDeps + 可选 onTurnQueued（结构探测）。 */
export interface SessionManagerDepsWithQueued extends SessionManagerDeps {
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
 *
 * task-08（2026-09-03-agent-provider-abstraction / FR-02 / D-002@v1）：本机制
 * **整体下沉 ClaudeEventNormalizer**（claude-events.ts，task-03 移植），SessionManager
 * 不再持有 partial 缓冲——stream_event 帧、节流 flush、segmentId、override 撤回、
 * thinking_tokens 缓冲全部在归一化器内完成，事件轨以 is_partial/segment_id/
 * override 一等字段到达。下列旧接口随之删除；仅保留会话级 usage 台账（budget
 * 聚合职责，归一化器不持有会话级累计——见其文件尾「契约缺口记录」）。
 */
/**
 * task-08：会话级 usage 台账条目（input+output 两维，**不含** cache_*——D-009
 * 预算口径）。
 *
 * 取代旧 PartialFlushBuffer 的会话级计数职责（sessionInputTokens /
 * sessionOutputTokens + turn 级计数器）：事件轨上 usage 以 AgentEvent.usage
 * 一等字段到达（partial flush 事件携带**轮级累计** input/output + cache 快照
 * + ctx_tokens）。SessionManager 只维护两级台账：
 *   - `_sessionUsageBase`：历史轮折算累计（turn 收尾 fold）；
 *   - `_turnUsageByParent`：本轮各 parentKey（'main'/子代理 tool_use_id）最新
 *     轮级值（replace 语义——轮内单调递增）。
 * 会话累计 = base + Σ 本轮各 parent 最新值（对齐旧 `_aggregateSessionUsage`
 * 跨桶求和口径，含子代理）。
 */
export interface SessionUsageTotals {
  input_tokens: number;
  output_tokens: number;
}

/**
 * task-03（2026-08-27-background-subagent-progress / design §5 P1.1 + §6 契约表）：
 * 后台异步任务注册表条目（仅内存态，**不持久化**）。
 *
 * 数据源二选一：
 *   1. CLI system/task_started（primary——spike 实测 0.3.181 确实发射，design §10）；
 *   2. 异步启动回执兜底（user tool_result 文本含 "Async agent launched successfully"
 *      时正则提取 agentId，防旧版 CLI 不发 task_*，secondary）。
 *
 * 终态（task_notification）到达后注销；会话 end/fail 终态统一清理。后台任务随 SDK
 * 子进程消亡，daemon 重启后无从恢复 → **不进 snapshotPersistable**（对齐
 * subagentDepth「日志元数据非恢复必需」口径）；且 types.ts 不在本任务 allowed_paths
 * （SessionState 定义于 types.ts），故落位类级 Map 而非 SessionState 字段——先例
 * 见 `_borrowSandboxRoots`（task-09 同款 allowed_paths 受限处理）。
 */
export interface BackgroundTaskInfo {
  /** 关联的主 agent Task/Agent tool_use id（[TASK_*] 行 parent_tool_use_id + SSE tool_use_id 关联键）。 */
  toolUseId?: string;
  /** 任务名（task_started.description；回执路径用同 tool_use 的 description，兜底 '后台任务'）。 */
  taskName: string;
  /** 子代理类型（subagent_type 透传，[TASK_STARTED] 行可选字段）。 */
  subagentType?: string;
  /** 异步派发标记（回执路径恒 true；task_started 路径按 true 记——SDK 任务生命周期系统即后台机制，见 _handleTaskStarted 注释）。 */
  async: boolean;
  /** 注册时刻 epoch ms（task_updated 轻量事件的观察口径，非权威时长）。 */
  startedAt: number;
  /** 最近一次 task_progress 到达时刻（「最后活跃」观察口径，本层仅记录）。 */
  lastProgressAt?: number;
  /** 上次 [TASK_PROGRESS] 行落库时刻（R-03 ≥2000ms 节流锚点）。 */
  lastLineAt?: number;
  /**
   * 注册时捕获的派发 runId。后台任务的 progress/notification 常在派发 turn 收尾
   * （_onResult 清空 state.currentRunId）之后到达——落行/emit 必须用捕获的派发
   * runId 兜住跨 turn 场景（与 backend P2.2 跨轮归位「行归派发 run」同向）。
   */
  runId?: string;
}

/**
 * 默认空闲阈值（秒）。D-001@v1（2026-06-25-interactive-idle-timeout-fix）：默认 0 = 禁用
 * idle 自动回收。scan/stage 完成由 backend 主动 end_session 收口（D-002@v1），session 不再
 * 因假性空闲被误杀。env SESSION_IDLE_TIMEOUT_SEC 显式设 >0 可恢复旧行为（逃生口）。
 */
export const DEFAULT_IDLE_TIMEOUT_SEC = 0;

/**
 * ql-20260818-009：取消档案的中和指令。仅清 system prompt 不够——fork 继承的
 * 对话历史含此前人格的角色扮演轮，模型会从上下文延续角色（实测复现）；以
 * 显式中和 append 压掉历史角色惯性。
 */
export const CLEAR_PERSONA_PROMPT =
  '用户已取消此前设置的智能体档案（人格）。此前对话中出现的任何人格/角色设定均已失效：请停止继续扮演该角色，以默认的 AI 编程助手身份、基于通用能力回答后续问题。';
/** 默认扫描周期（秒）。 */
export const DEFAULT_IDLE_SCAN_SEC = 60;

/**
 * task-04（2026-08-26-team-subsession-recursion / design §5.D / FR-06）：daemon
 * 存活会话总数闸默认上限。env ``SILLYHUB_MAX_ACTIVE_SESSIONS`` 可配（0=不限），
 * 防分身递归派工 + 普通会话叠加触发进程风暴。计数口径 = 内存 ``_store`` 活会话
 * （status 非终态 ended/failed——终态延迟清理条目不计），不查 backend。
 */
export const DEFAULT_MAX_ACTIVE_SESSIONS = 20;

/**
 * 坑 subagent-write-channel（2026-09-03 实证）：inject 的 stale-running 自愈
 * （>60s 无 result 强翻 active）误伤仍活着但安静的长 turn 时，写通道宽限窗——
 * 窗内（active + currentRunId 仍在 + staleRunResetAt 新鲜）写类工具调用放行。
 * 60min 覆盖实测事故的 30 分钟封锁全程；误翻源头若真死（SDK query 挂死）本就
 * 不会有工具调用进来，宽限不产生额外风险。
 */
export const STALE_RUN_WRITE_GRACE_MS = 60 * 60_000;

/** ``_buildDriverOptions`` 的 spec 入参（create / restore / reload 三路共用形状）。 */
export interface DriverOptionsSpec {
  exePath: string;
  model?: string;
  allowedTools?: string[];
  env?: NodeJS.ProcessEnv;
  enableApproval: boolean;
  effectiveAskUserOnly: boolean;
  resume?: string;
  mcpServers?: Record<string, McpServerConfigForDriver>;
  /** task-05：profile.system_prompt → driverOpts.systemPrompt preset+append。
   * ql-20260818-004：null=取消档案（preset-only 无人格）。 */
  systemPrompt?: string | null;
  /** ql-20260818-002/004：档案维度切换（含取消）→ fork 新会话使人格生效。 */
  forkSession?: boolean;
}

/**
 * task-02（2026-09-07-arch-large-file-split / D-004@v1）：子模块函数的 ``this``
 * 上下文桥——SessionManager 的方法体下沉到子模块函数后，原 ``this`` 引用改经
 * 第一参数 ``mgr`` 传递。本接口按子模块实际消费面声明所需字段与方法（与类成员
 * 一一同名同型）；facade 侧经 ``this as unknown as SessionManagerCore`` 类型桥
 * 传入（私有成员在类型层不可结构比较，运行时即同一实例，行为零变化）。
 */
export interface SessionManagerCore {
  // ── 实例状态（原类私有字段，字段本体仍留在 facade 类里）─────────────────
  readonly deps: SessionManagerDeps;
  readonly _store: Map<string, SessionState>;
  readonly _notifyChains: Map<string, Promise<void>>;
  readonly _pendingInjectCount: Map<string, number>;
  readonly _pendingFirstPrompt: Map<
    string,
    { prompt: string; timer: ReturnType<typeof setTimeout> }
  >;
  readonly _drivers: Partial<Record<InteractiveProvider, InteractiveDriver>>;
  readonly _manualApproval: boolean;
  readonly _permissionResolverFactory: (() => PermissionResolver) | undefined;
  readonly _permissionWsClient: PermissionWsSender | undefined;
  readonly _resolversBySession: Map<string, PermissionResolver>;
  readonly _supportedDialogKinds: string[] | undefined;
  readonly _allowedRootsProvider: (() => string[]) | undefined;
  readonly _policyEngine: PolicyEngine | null | undefined;
  readonly _runtimeIdProvider: ((sessionId: string) => string) | undefined;
  readonly _isMainAgentSession:
    | ((ctx: MainAgentMcpContext) => boolean)
    | undefined;
  readonly _mainAgentMcpConfigProvider:
    | ((ctx: MainAgentMcpContext) => Record<string, McpServerConfigForDriver> | undefined)
    | undefined;
  readonly _isWorkerSession:
    | ((ctx: MainAgentMcpContext) => boolean)
    | undefined;
  readonly _workerMcpConfigProvider:
    | ((ctx: MainAgentMcpContext) => Record<string, McpServerConfigForDriver> | undefined)
    | undefined;
  readonly _borrowSandboxRoots: Map<string, string>;
  readonly _backgroundTasks: Map<string, Map<string, BackgroundTaskInfo>>;
  readonly _taskWakeupPending: Map<
    string,
    { timer: NodeJS.Timeout; lines: string[] }
  >;
  readonly _agentToolUseMeta: Map<
    string,
    { sessionId: string; taskName: string; subagentType?: string }
  >;
  readonly _sessionBudgetTokens: Map<string, number>;
  readonly _overBudgetSessions: Set<string>;
  readonly _sessionUsageBase: Map<string, SessionUsageTotals>;
  readonly _turnUsageByParent: Map<string, Map<string, SessionUsageTotals>>;
  readonly _turnEventSeq: Map<string, number>;
  _idleTimer: ReturnType<typeof setInterval> | null;
  readonly _idleTimeoutSec: number;
  readonly _idleScanSec: number;
  readonly _resumeDirs: TranscriptDirs;
  readonly _credentialManager: SpawnCredentialManager | null;
  readonly _terminalCleanupTimers: Map<string, ReturnType<typeof setTimeout>>;
  _flushScheduled: Promise<void> | null;

  // ── 跨簇协作方法（facade 同名方法一行委托到对应子模块 / 类内保留实现）─────
  /** notify-chain.ts */
  _runNotifyChain<T>(sessionId: string, fn: () => T | Promise<T>): Promise<T>;
  /** facade 类内保留（create/restore/reload 编排） */
  _runConsume(state: SessionState): Promise<void>;
  /** persistence.ts */
  _scheduleFlush(): void;
  /** driver-factory.ts */
  _getDriver(provider: InteractiveProvider): InteractiveDriver;
  /** driver-factory.ts */
  _resolveMainAgentMcp(ctx: MainAgentMcpContext):
    | Record<string, McpServerConfigForDriver>
    | undefined;
  /** driver-factory.ts */
  _buildDriverOptions(state: SessionState, spec: DriverOptionsSpec): Record<string, unknown>;
  /** permission.ts */
  getPermissionResolver(sessionId: string): PermissionResolver | undefined;
  /** permission.ts */
  requestPermission(
    sessionId: string,
    input: {
      toolName: string;
      toolInput: Record<string, unknown>;
      signal?: AbortSignal;
      toolUseId?: string;
      isUserInputKind?: boolean;
    },
  ): Promise<CanUseToolDecision>;
  /** permission.ts */
  requestUserDialog(
    sessionId: string,
    input: {
      dialogKind: string;
      dialogPayload: Record<string, unknown>;
      toolUseId?: string;
      signal?: AbortSignal;
    },
  ): Promise<
    { behavior: 'completed'; result: unknown } | { behavior: 'cancelled' }
  >;
  /** permission.ts */
  _withinStaleFlipGrace(state: SessionState): boolean;
  /** permission.ts */
  _writeChannelGuardDeny(
    state: SessionState | undefined,
    toolName: string,
  ): { behavior: 'deny'; message: string } | null;
  /** permission.ts */
  _buildCanUseToolCallback(sessionId: string, askUserOnly: boolean): CanUseToolFn;
  /** permission.ts */
  _buildOnUserDialogCallback(sessionId: string): OnUserDialogFn;
  /** write-guard.ts */
  registerBorrowSandbox(sessionId: string, sandboxRoot: string): void;
  /** write-guard.ts */
  getBorrowSandboxRoot(sessionId: string): string | undefined;
  /** write-guard.ts */
  _clearBorrowSandbox(sessionId: string): void;
  /** write-guard.ts */
  _wrapWithWriteGuard(
    sessionId: string,
    provider: InteractiveProvider,
    inner: CanUseToolFn,
  ): CanUseToolFn;
  /** write-guard.ts */
  _sessionOverlayRoots(sessionId: string): string[] | null;
  /** write-guard.ts */
  _judgeWriteViaPolicyEngine(
    sessionId: string,
    provider: InteractiveProvider,
    toolName: string,
    toolInput: Record<string, unknown>,
  ): string | null;
  /** write-guard.ts */
  _extractWritePathsForTool(toolName: string, toolInput: Record<string, unknown>): string[];
  /** write-guard.ts */
  _shellKindOfTool(toolName: string): ShellKind | undefined;
  /** write-guard.ts */
  _buildWriteOnlyCanUseToolCallback(_sessionId: string): CanUseToolFn;
  /** usage.ts */
  setBudgetTokens(sessionId: string, budgetTokens: number | undefined): void;
  /** usage.ts */
  _setBudgetTokensInternal(sessionId: string, budgetTokens: number | undefined): void;
  /** usage.ts */
  isOverBudget(sessionId: string): boolean;
  /** usage.ts */
  _aggregateSessionUsage(sessionId: string): SessionUsageTotals;
  /** usage.ts */
  _liftSessionUsage(state: SessionState, ev: AgentEvent): void;
  /** usage.ts */
  _foldTurnUsage(state: SessionState): void;
  /** usage.ts */
  _checkBudgetCutoff(state: SessionState, runId: string): void;
  /** usage.ts */
  _destroyUsageLedger(sessionId: string): void;
  /** turn-control.ts */
  refreshClaimToken(sessionId: string, claimToken: string): Promise<void>;
  /** turn-control.ts */
  _writeAttachmentFile(cwd: string, rawName: string, buf: Buffer): Promise<string>;
  /** turn-control.ts */
  _downloadAttachmentWithTimeout(
    sessionId: string,
    downloadAttachment: (id: string) => Promise<Buffer>,
    attachmentId: string,
  ): Promise<Buffer>;
  /** turn-control.ts */
  inject(
    sessionId: string,
    prompt: string,
    runId: string,
    attachments?: SessionInjectAttachment[],
    downloadAttachment?: (id: string) => Promise<Buffer>,
  ): Promise<InjectResult>;
  /** turn-control.ts */
  resolvePlanResponse(
    sessionId: string,
    runId: string,
    decision: 'confirm' | 'revise' | 'cancel',
    feedback?: string | null,
  ): Promise<boolean>;
  /** turn-control.ts */
  interrupt(sessionId: string): Promise<boolean>;
  /** turn-control.ts */
  _interruptInternal(state: SessionState): Promise<boolean>;
  /** turn-control.ts */
  getPendingInjectCount(sessionId: string): number;
  /** lifecycle.ts */
  getIdleTimeoutSec(): number;
  /** lifecycle.ts */
  start(): void;
  /** lifecycle.ts */
  stop(): void;
  /** lifecycle.ts */
  scanOnce(): Promise<void>;
  /** lifecycle.ts */
  _scanIdle(): Promise<void>;
  /** lifecycle.ts */
  end(sessionId: string): Promise<void>;
  /** lifecycle.ts */
  fail(sessionId: string): Promise<void>;
  /** lifecycle.ts */
  _terminateSession(
    state: SessionState,
    reason: 'manual' | 'driver_error',
    opts?: { notifyBackend?: boolean },
  ): Promise<void>;
  /** lifecycle.ts */
  _scheduleTerminalCleanup(sessionId: string): void;
  /** lifecycle.ts */
  _cancelTerminalCleanup(sessionId: string): void;
  /** lifecycle.ts */
  _abortPermissionResolver(sessionId: string, reason: string): void;
  /** lifecycle.ts */
  get(sessionId: string): Readonly<SessionState> | undefined;
  /** lifecycle.ts */
  hasRunningTurn(): boolean;
  /** persistence.ts */
  snapshotPersistable(): PersistedSessionRecord[];
  /** persistence.ts */
  restoreAndReconnect(record: PersistedSessionRecord): Promise<void>;
  /** persistence.ts */
  markReconnected(sessionId: string): Promise<void>;
  /** persistence.ts */
  flush(): Promise<void>;
  /** events.ts */
  _onResult(state: SessionState, result: InteractiveDriverResult): Promise<void>;
  /** events.ts */
  _onMessage(state: SessionState, envelope: TurnMessageEnvelope): Promise<void>;
  /** events.ts */
  _dispatchStatusEvent(
    state: SessionState,
    ev: AgentEvent,
    envelopeHasTaskToolUse: boolean,
  ): Promise<void>;
  /** events.ts */
  _registerAgentToolUseMeta(state: SessionState, ev: AgentEvent): void;
  /** events.ts */
  _maybeRegisterAsyncReceipt(state: SessionState, ev: AgentEvent): Promise<void>;
  /** events.ts */
  _eventToReportDict(state: SessionState, ev: AgentEvent): Record<string, unknown>;
  /** events.ts */
  _nextEventSeq(sessionId: string): number;
  /** events.ts */
  _emitSessionEvent(
    sessionId: string,
    runId: string,
    event: SessionEventForBackend,
  ): void;
  /** background-tasks.ts */
  _handleAgentTaskStatusEvent(state: SessionState, ev: AgentEvent): Promise<void>;
  /** background-tasks.ts */
  _handleTaskNotificationEvent(state: SessionState, ev: AgentEvent): Promise<void>;
  /** background-tasks.ts */
  _scheduleTaskWakeup(
    sessionId: string,
    info: {
      taskId: string;
      taskName: string;
      status: string;
      elapsedMs?: number;
      summary?: string;
    },
  ): void;
  /** background-tasks.ts */
  _registerAsyncReceiptTask(
    state: SessionState,
    runId: string | undefined,
    agentId: string,
    toolUseId: string,
  ): Promise<void>;
  /** background-tasks.ts */
  _writeTaskLine(
    sessionId: string,
    runId: string,
    prefix: '[TASK_STARTED]' | '[TASK_PROGRESS]' | '[TASK_NOTIFICATION]',
    payload: Record<string, unknown>,
    parentToolUseId?: string,
  ): Promise<void>;
  /** background-tasks.ts */
  _getOrCreateTaskMap(sessionId: string): Map<string, BackgroundTaskInfo>;
  /** background-tasks.ts */
  _clearBackgroundTasks(sessionId: string): void;
  /** facade 类内保留（reload 簇编排） */
  reloadWithProvider(sessionId: string, providerConfig: ProviderConfig | null): Promise<void>;
  /** facade 类内保留（reload 簇编排） */
  reloadWithConfig(sessionId: string, payload: SessionSwitchConfigPayload): Promise<void>;
}
