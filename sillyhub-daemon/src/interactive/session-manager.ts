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

// task-08（2026-09-03-agent-provider-abstraction / FR-02 / D-002@v1）：本文件
// @anthropic-ai/claude-agent-sdk 类型 import 清零——SessionManager 只消费中性
// AgentEvent / TurnMessageEnvelope（driver 归一化后的事件轨），不再解析 raw SDK
// 消息形状。Claude SDK 专属回调类型（CanUseTool/OnUserDialog/UserDialogResult）
// 改经 ClaudeStartOptions 结构性推导（下方局部别名），不直接 import SDK 包。
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
  InteractiveDriverResult,
  InteractiveProvider,
  McpServerConfigForDriver,
  TurnMessageEnvelope,
  UserTurnInput,
} from './driver.js';
import type { ClaudeStartOptions } from './claude-sdk-driver.js';
import type { AgentEvent } from '../types.js';

/** task-08：Claude SDK ``CanUseTool`` 的结构性本地别名（SDK 类型 import 清零）。 */
type CanUseToolFn = NonNullable<ClaudeStartOptions['canUseTool']>;
/** task-08：Claude SDK ``OnUserDialog`` 的结构性本地别名。 */
type OnUserDialogFn = NonNullable<ClaudeStartOptions['onUserDialog']>;
/** task-08：Claude SDK ``UserDialogResult`` 的结构性本地别名。 */
type UserDialogResultFn = Awaited<ReturnType<OnUserDialogFn>>;
// task-05（FR-05 / design §5.2）：provider 注册表（INTERACTIVE_PROVIDERS 单源，
// InteractiveProvider 联合由其推导）。运行时 import——_getDriver 读注册表做
// provider 合法性门控；经 providers.ts 传递引入两 driver 模块（均为纯定义，
// 模块加载无副作用，与 cli.ts 显式 import 等价）。
import { INTERACTIVE_PROVIDERS, type ProviderDescriptor } from './providers.js';
import { basename, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { InputQueue, SessionQueueClosedError } from './input-queue.js';
import { PermissionResolver } from './permission-resolver.js';
import type { PermissionSendFn } from './permission-resolver.js';
import type { CanUseToolDecision } from './types.js';
import type { SessionInjectAttachment } from '../protocol.js';
import type { PolicyEngine } from '../policy/filesystem-policy.js';
import { isPathUnderAnyRoot, resolveRealPath, UNC_REJECTED } from '../policy/path-utils.js';
import {
  extractShellWritePaths,
  type ShellKind,
} from '../policy/shell-paths.js';
// task-10（C-12 / D-017）：主 agent MCP 注入按 profile.mcpRefs 子集过滤（mergeMcpConfigs
// 第三层）。McpConfig 用于把 driver 契约的 MCP 配置表转成 mergeMcpConfigs 入参形态。
import {
  DAEMON_MCP_SERVER_NAME,
  FILE_MCP_SERVER_NAME,
  injectMcpSessionId,
  mergeMcpConfigs,
  WORKER_MCP_SERVER_NAME,
  type McpConfig,
} from '../mcp-config.js';
import type {
  CreateSessionInput,
  InjectResult,
  PersistedSessionRecord,
  SessionManagerDeps,
  SessionState,
  SessionSwitchConfigPayload,
} from './types.js';
import {
  SessionAlreadyExistsError,
  SessionAttachmentTimeoutError,
  SessionBusyError,
  SessionLimitReached,
  SessionNotFoundError,
  SessionNotActiveError,
  UnsupportedProviderError,
} from './types.js';
// task-07（provider-switch-live-session / D-002@v1）：markPendingSwitch /
// reloadWithProvider 签名引用中性 ProviderConfig（backend set/unset_default 经 WS
// 下发；null 表示停止→回退本机凭证）。type-only，与 spawn-env / claim payload 同源。
import type { ProviderConfig } from '../types.js';
// task-08（provider-switch-live-session / FR-05 / D-004@v1）：reloadWithProvider 用
// buildSpawnEnv 构造新 env（provider_config 第 0 层；null 时跳过 + 不隔离 CLAUDE_CONFIG_DIR
// → 回退本机凭证，spawn-env.ts:140-164 已支持）。SpawnCredentialManager 鸭子类型，
// daemon 生产路径注入 daemon._credentialManager，测试 / 未注入时用 noopCredential fallback。
import { buildSpawnEnv, type SpawnCredentialManager } from '../spawn-env.js';
// ql-20260822-009：resume / reload 的 CLAUDE_CONFIG_DIR 按 transcript 实际位置判定
// （隔离目录命中 → 隔离，保 ql-20260807-002 停供应商语义；仅宿主机 ~/.claude 命中 →
// 不隔离，修复未配供应商会话重开被 fail 打回 ended）。
// ql-20260822-001（移植）：home 会话切供应商前把 jsonl 迁移（复制）到隔离目录——
// 仅回 home resume 会把 claude 暴露给用户 ~/.claude/settings.json，其 env 块
//（cc-switch）优先于进程注入的供应商 env，流量串本机网关（E2E 实锤 400[1214]）。
import {
  applyTranscriptConfigDir,
  defaultTranscriptDirs,
  migrateClaudeTranscriptToHost,
  migrateClaudeTranscriptToIsolated,
  type TranscriptDirs,
} from './claude-transcript-dir.js';
// task-04（FR-01 / D-005@v1）：turn 收尾把模型调用失败归类为结构化 ModelError，
// 挂到 result.modelError 透传给 daemon 桥接 → notifyRunResult → backend error_detail。
// 与 stream-json.ts:954 批量路径同源（近源归类，D-005 方案 C 三端标准协议）。
import { classifyModelError } from '../model-error/classifier.js';
import type { ModelError } from '../model-error/types.js';

/**
 * R-10（2026-08-28-daemon-agent-share E2E）：显式写文件工具集——这些工具在
 * spec.allowedTools 白名单内时必须从 SDK 层预批准集（driverOpts.allowedTools，
 * 语义=auto-allowed 不经 canUseTool）摘除，改经 canUseTool 链接受写守卫路径
 * 校验（overlay 交集收紧 / PolicyCache 机器级）。shell 类（Bash 等）从不进
 * 白名单（D-009），无需在此列。
 */
const _SDK_WRITE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit']);

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
interface SessionUsageTotals {
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
interface BackgroundTaskInfo {
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
const DEFAULT_IDLE_TIMEOUT_SEC = 0;

/**
 * ql-20260818-009：取消档案的中和指令。仅清 system prompt 不够——fork 继承的
 * 对话历史含此前人格的角色扮演轮，模型会从上下文延续角色（实测复现）；以
 * 显式中和 append 压掉历史角色惯性。
 */
const CLEAR_PERSONA_PROMPT =
  '用户已取消此前设置的智能体档案（人格）。此前对话中出现的任何人格/角色设定均已失效：请停止继续扮演该角色，以默认的 AI 编程助手身份、基于通用能力回答后续问题。';
/** 默认扫描周期（秒）。 */
const DEFAULT_IDLE_SCAN_SEC = 60;

/**
 * task-04（2026-08-26-team-subsession-recursion / design §5.D / FR-06）：daemon
 * 存活会话总数闸默认上限。env ``SILLYHUB_MAX_ACTIVE_SESSIONS`` 可配（0=不限），
 * 防分身递归派工 + 普通会话叠加触发进程风暴。计数口径 = 内存 ``_store`` 活会话
 * （status 非终态 ended/failed——终态延迟清理条目不计），不查 backend。
 */
const DEFAULT_MAX_ACTIVE_SESSIONS = 20;

/**
 * 坑 subagent-write-channel（2026-09-03 实证）：inject 的 stale-running 自愈
 * （>60s 无 result 强翻 active）误伤仍活着但安静的长 turn 时，写通道宽限窗——
 * 窗内（active + currentRunId 仍在 + staleRunResetAt 新鲜）写类工具调用放行。
 * 60min 覆盖实测事故的 30 分钟封锁全程；误翻源头若真死（SDK query 挂死）本就
 * 不会有工具调用进来，宽限不产生额外风险。
 */
const STALE_RUN_WRITE_GRACE_MS = 60 * 60_000;

export class SessionManager {
  /** 内存 SessionStore。Wave1/2 内存态，daemon 重启丢失（D-003）。 */
  private readonly _store = new Map<string, SessionState>();

  /**
   * ql-20260825-f3#1：终态延迟清理定时器（sessionId → setTimeout 句柄）。
   *
   * `_terminateSession` 收尾链原本不删 `_store` 条目（全文件 `_store.delete` 仅
   * create 失败 / restore 驱逐 / restore 失败三处）→ end/fail 后含凭证 env、
   * subagentDepth Map、inputQueue buffer 的 SessionState 永久滞留，内存只增不减。
   * 「结束后短期内可查」是有意行为（终态对账 / 立即 get 查询窗口，现有测试断言
   * end 后 `get(id).status==='ended'`），故改为延迟 TERMINAL_CLEANUP_DELAY_MS 后
   * 删除 `_store` 与关联 `_pendingInjectCount` 条目，兼顾短期可查与最终回收。
   *
   * 防误删：到点时条目若已被 restoreAndReconnect / create 重建（状态非终态）则
   * 跳过（重建路径同时 `_cancelTerminalCleanup` 主动取消）；stop()（daemon
   * shutdown）clearTimeout 全部。
   */
  private readonly _terminalCleanupTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  /** 终态条目延迟清理时长（ms）：给终态对账 / 立即查询留 10 分钟窗口。 */
  private static readonly TERMINAL_CLEANUP_DELAY_MS = 10 * 60 * 1000;

  /**
   * ql-20260825-f3#2：per-session reload 串行链（sessionId → 上一轮 reload 的
   * settled promise）。
   *
   * `_reloadSession` 原无 per-session 串行化，空闲路径（markPendingSwitch /
   * markPendingConfigSwitch）fire-and-forget 触发两次快速切换时 A/B 并发快照同一
   * oldHandle：后完成者覆盖 `state.query`，先完成者的新句柄永不 close（每轮只
   * close 各自快照的 oldHandle），其 consume `isAuthoritative()` 恒 false，背后
   * 子进程无人 kill → 僵尸 claude 进程沉默烧 token。
   *
   * chain 模式保证 last-wins **顺序**执行而非交错：每轮进入核心段前 await 上一
   * 轮同会话 reload 完成，oldHandle 快照取到上一轮完成后的最新句柄，逐轮 close
   * 无孤儿。Map 存「永不 reject 的链尾」防后续链 await 已 reject 的 promise 重复
   * 触发 unhandled rejection（失败已由各轮调用方 .catch 记日志）。
   */
  private readonly _reloadChains = new Map<string, Promise<void>>();

  /**
   * ql-20260825-f6#4：per-session 终态通知串行链（sessionId → 上一轮通知的
   * settled promise），实现模式对齐 `_reloadChains`。
   *
   * `_onResult` 原先同步段先置 active/清 runId 后才 `await onTurnResult`；该 await
   * 窗口内 end()/fail() 触发 `_terminateSession` → onSessionEnd——backend 收到
   * session end 与 run result 的顺序不保证（end 先到会把刚要上报的 run 误翻终态 /
   * 对账错乱）。本链把**同会话**的 onTurnResult 与 onSessionEnd 排进同一 FIFO：
   * end 的通知必然 await 在飞 turn result 之后（backend 侧恒 result → end）。
   *
   * 范围控制：只串「终态通知对」（onTurnResult / onSessionEnd）；inject /
   * onTurnMessage / reload 等常规路径不进链（inject 与 turn result 本就无顺序承诺，
   * 串入会放大无关延迟）。同会话 turn result 天然顺序到达（consume 逐条 await），
   * 链只新增与 end 通知的相对顺序。超时保护不加：onTurnResult 回调内部已有
   * try/catch 异常隔离（上轮补），reject 语义与改造前一致向上抛。
   * Map 存「永不 reject 的链尾」+ 自愈摘除，同 `_reloadChains` 注释。
   */
  private readonly _notifyChains = new Map<string, Promise<void>>();

  /**
   * ql-20260825-f6#4：把终态通知（onTurnResult / onSessionEnd）排入 per-session
   * 串行链执行。返回值保留原 promise 的 settle 语义（含 rejection，向上传播不变）。
   *
   * 空链时**同步直调** fn（与改造前直调时序逐字一致——consume 逐条 await 下同会话
   * turn result 本就顺序执行，空链排队只多一跳 microtask 无增益，且既有调用方 /
   * 测试依赖 emitResult 后同步可见）；有在飞通知时排队（等其 settle 再执行 fn）。
   */
  private _runNotifyChain<T>(
    sessionId: string,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    const settleTail = (run: Promise<T>): void => {
      // 链尾永不 reject（供下一轮 await；rejection 已由调用方 await run 传播）。
      const tail = run.then(
        () => undefined,
        () => undefined,
      );
      this._notifyChains.set(sessionId, tail);
      void tail.then(() => {
        // 自愈摘除：本轮回 finish 且没有更新一轮入链时删掉链尾（比较引用防误删后轮）。
        if (this._notifyChains.get(sessionId) === tail) {
          this._notifyChains.delete(sessionId);
        }
      });
    };

    const prev = this._notifyChains.get(sessionId);
    if (!prev) {
      // 空链：同步执行（Promise.resolve 容忍 fn 返回非 promise，对齐 await 语义）。
      // fn 同步抛 → 链尾直接放行（空跳，下一轮通知不等错）+ 向上重抛
      //（与直调的同步抛时序一致）。
      let run: Promise<T>;
      try {
        run = Promise.resolve(fn());
      } catch (err) {
        settleTail(Promise.resolve() as Promise<T>);
        throw err;
      }
      settleTail(run);
      return run;
    }
    const run = prev.catch(() => undefined).then(fn);
    settleTail(run);
    return run;
  }

  /**
   * task-07（R-conv 可观察性）：sessionId → 排队中的 inject 计数。
   *
   * 不写入 SessionState（types.ts 是 task-04 范围，本任务只补增量可观察字段，且
   * pendingInjectCount 是纯可观察计数不参与 SDK 行为控制），故维护独立的内部 Map。
   * _onResult 收尾时递减（min 0）。
   */
  private readonly _pendingInjectCount = new Map<string, number>();

  /**
   * ql-20260825-002：sessionId → 挂起中的首句（deferred first prompt）。
   *
   * 根因（长期既有 bug）：create 时把 lease metadata 的 firstPrompt 直接入队提交，
   * 随后 backend 的首条 SESSION_INJECT 又提交同句 → agent 收到两次首句、
   * user_input 双日志（纯文本时两条相同未被发现，带附件后 marker 版 + 裸文本版
   * 视觉差异明显才暴露）。
   *
   * 修复：create 不再直接 push firstPrompt——挂起到本 Map，等首条 SESSION_INJECT
   * 到达时由 inject() 消费（inject 的 prompt/attachments 版本才是权威首句）；
   * PENDING_FIRST_FALLBACK_MS 超时未达（SESSION_INJECT 丢失 / 旧 backend）则
   * fallback 提交 metadata prompt（原设计意图：metadata prompt 是控制消息失败
   * 时的兜底）。同 _pendingInjectCount 范式：独立内部 Map，不写入 SessionState
   * （不持久化——现状 create 的 queue 也不 flush，崩溃丢首句语义与旧版一致）。
   */
  private readonly _pendingFirstPrompt = new Map<
    string,
    { prompt: string; timer: ReturnType<typeof setTimeout> }
  >();

  /**
   * task-08（D-006 / D-009 / FR-05 / FR-07）：interactive budget 软切断状态。
   *
   * 不写入 SessionState（interactive/types.ts 不在本任务 allowed_paths；且 budget
   * 是 lease 级运行期检查点配置，非 SDK 行为参数）—— 同 `_pendingInjectCount`
   * 范式维护独立内部 Map / Set。
   *
   *   - ``_sessionBudgetTokens``：sessionId → 本次 lease 的 token budget 上限（来自
   *     ``LeaseCtx.budget_tokens``，由 daemon ``_startInteractiveSession`` 经
   *     ``create({...,budget_tokens})`` 或 ``setBudgetTokens`` 透传）。无条目 = 未配置
   *     → 检查点短路（FR-07 零回归）。
   *   - ``_overBudgetSessions``：累计 input+output ≥ budget 后置位，幂等防重入；
   *     置位后 ``inject`` 拒绝新 turn（软切断 D-006：当前 turn 自然跑完，**不**调
   *     close/kill），并经现有 ``onTurnMessage`` 回传 ``reason='budget_exceeded'``。
   *
   * 口径 D-009：``input_tokens + output_tokens``（**不含** cache_*）—— task-08 起
   * 数据源改 usage 台账（``_sessionUsageBase`` + ``_turnUsageByParent`` 跨
   * parentKey 求和，含子代理；旧 PartialFlushBuffer.sessionInput/OutputTokens
   * 计数已随 partial 链下沉归一化器而移除）。
   */
  private readonly _sessionBudgetTokens = new Map<string, number>();
  private readonly _overBudgetSessions = new Set<string>();

  /**
   * task-08（2026-09-03-agent-provider-abstraction / FR-02 / D-002@v1）：会话级
   * usage 台账（budget 聚合数据源，取代旧 ``_partialBuffers`` 的
   * sessionInput/OutputTokens 计数）。
   *
   *   - ``_sessionUsageBase``：sessionId → 历史轮折算累计（``_foldTurnUsage``
   *     turn 收尾时把本轮各 parent 值合入）；
   *   - ``_turnUsageByParent``：sessionId → （parentKey → 本轮最新轮级 usage）。
   *     事件轨 partial flush 携带轮级累计（replace 更新），``_aggregateSessionUsage``
   *     = base + Σ 本轮各 parent 最新值（跨 parent 求和含子代理，口径不变）。
   *
   * 数据源守卫（对齐旧语义）：仅 ``is_partial`` 事件与 usage-only 空事件（type=
   * text 且 content=''）喂台账——完整消息 stamp 的 usage 是**单次调用**终值
   *（display 用，daemon lift → backend 实时聚合），混入会把轮级累计覆盖回单次
   * 值造成预算漏计；codex 事件（非 partial、content 非空）天然不喂台账，对齐
   * 旧链路 codex 无 partial 桶 → budget 恒 0/0 的行为。
   */
  private readonly _sessionUsageBase = new Map<string, SessionUsageTotals>();
  private readonly _turnUsageByParent = new Map<
    string,
    Map<string, SessionUsageTotals>
  >();

  /**
   * task-08：turn 内事件 seq 补号计数器（design §7 ``seq?: number``——turn 内
   * 单调递增，SessionManager 补号）。key=sessionId，value=下一号；``_onResult``
   * turn 边界重置为 0（新 turn 的 segment/事件序号空间独立）。
   */
  private readonly _turnEventSeq = new Map<string, number>();

  /**
   * task-09 / D-007@v2（候选 B 主路径）：借用 session 沙箱根目录注册表。
   *
   * key=sessionId，value=该借用 session 的独立沙箱目录绝对路径（daemon
   * ``_startInteractiveSession`` 经 ``prepareWorkspace(slug)`` 创建）。
   * daemon 在 ``sessionManager.create`` 成功后调 ``registerBorrowSandbox`` 登记；
   * ``end``/``fail``/consume 退出时清除。
   *
   * **按 lease 隔离只读 policy 的核心**（R-02）：``_judgeWriteViaPolicyEngine`` 命中
   * 本表时**不走 PolicyEngine 的 runtime 缓存**（缓存键是 lender 的 runtime_id，
   * allowed_roots 是 lender 代码区——借用 agent 命中即继承 lender 写权限，污染开发代码）。
   * 借用 session 改为只校验写路径是否落在 ``[sandboxRoot]`` 下（沙箱外一律 deny），
   * 与 lender 的 allowed_roots 完全解耦。
   *
   * 不写入 SessionState / PersistedSessionRecord（types.ts 不在 task-09 allowed_paths，
   * 且借用标记本就来自 lease metadata，daemon 重启恢复时可由 ``_startInteractiveSession``
   * 重检 marker 重新登记——当前 daemon 恢复路径未接此重检，属 R-09 可选优化，重启后
   * 借用 session 退化为普通 runtime policy，仅影响重启窗口内极少数 in-flight 借用）。
   */
  private readonly _borrowSandboxRoots = new Map<string, string>();

  /**
   * task-08（FR-02 / D-002@v1）：运行中 Bash 命令追踪**下沉归一化器**——
   * ClaudeEventNormalizer.runningBash（tool_use Bash 注册 + tool_result 终态配对
   * + elapsed_ms 计算），SessionManager 只消费 status/bash_chunk、status/
   * bash_status 事件转发 onSessionEvent。旧 ``_runningBashCommands`` 内存索引
   * 及 ``_clearRunningBashCommands`` 随 raw 消息解析一并移除（Claude 轨死代码）。
   */

  /**
   * task-03（design §5 P1.1）：会话级后台任务注册表（BackgroundTaskRegistry）。
   *
   * key = sessionId，value = 该会话的 Map<task_id, BackgroundTaskInfo>。仅内存态
   * 不持久化（后台任务随 SDK 进程消亡，不进 snapshotPersistable——见
   * BackgroundTaskInfo 注释）。会话 end/fail 终态时经 `_clearBackgroundTasks`
   * 清理；interrupt **不**清——后台任务与当轮 turn 解耦，interrupt 终止的是当轮
   * 对话，已派发任务的 task_notification 仍会到达，注册表须存活。
   */
  private readonly _backgroundTasks = new Map<
    string,
    Map<string, BackgroundTaskInfo>
  >();

  /**
   * ql-20260827-007：后台任务终态唤醒的 debounce 合并队列。同 session 短窗口
   * （2s）内多条 task_notification 合并为一次 inject——并行后台任务（如 A/B
   * 同时完成）只唤醒一个 turn，避免连环 turn。fire 后整 entry 移除。
   */
  private readonly _taskWakeupPending = new Map<
    string,
    { timer: NodeJS.Timeout; lines: string[] }
  >();

  /**
   * task-03（design §5 P1.2）：主 agent Task/Agent tool_use 元数据登记。
   *
   * key = tool_use_id，value = { sessionId, taskName, subagentType? }。assistant
   * tool_use 到达时写入，供异步回执兜底把提取的 agentId 关联回该 tool_use 的
   * description / subagent_type（回执文本自身不带任务名）。仅内存态；会话终态
   * 时与任务表同点位清理。
   */
  private readonly _agentToolUseMeta = new Map<
    string,
    { sessionId: string; taskName: string; subagentType?: string }
  >();

  /**
   * task-03（design R-03 定案）：[TASK_PROGRESS] 行同任务落库最小间隔 ms
   * （spike 实测短任务零发射，节流保留默认值——发射稀疏时自然无感）。
   * 仅作用于落行；SSE emit 不节流（实时精度优先）。
   */
  private static readonly TASK_PROGRESS_LINE_THROTTLE_MS = 2000;

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
   * task-04（design §5.D / FR-06）：存活会话总数闸上限（create 前置计数用）。
   * 构造时从 ``process.env.SILLYHUB_MAX_ACTIVE_SESSIONS`` 读（读法对齐
   * SESSION_IDLE_TIMEOUT_SEC 先例）；未配 / 非法（NaN / 负数）→ 默认 20，
   * 0 = 不限。**闸只限 create**——restoreAndReconnect / 重连不读本字段（design
   * §7 风险表「会话闸误伤 restore」）。
   */
  private readonly _maxActiveSessions: number;

  /**
   * ql-20260822-001：resume transcript 目录对（探测 + home→隔离迁移共用）。
   * 缺省 { isolated: CLAUDE_CONFIG_DIR, home: ~/.claude }；测试注入 tmp 对。
   */
  private readonly _resumeDirs: TranscriptDirs;

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
   * task-06（D-007@v2 / R-01）：主 agent 会话判定谓词。未注入 = 永远 false（普通会话，
   * 不注入 daemon MCP server，向后兼容）。
   *
   * 签名用 ``MainAgentMcpContext``（create + restore 共用归一化上下文），与
   * ``SessionManagerOptions.isMainAgentSession`` 对齐。create 路径从
   * ``CreateSessionInput`` 归一化出 ctx 再调本谓词；restore 路径从
   * ``PersistedSessionRecord`` 归一化出 ctx。
   */
  private readonly _isMainAgentSession:
    | ((ctx: MainAgentMcpContext) => boolean)
    | undefined;
  /**
   * task-06：主 agent MCP server 配置构造器。仅主 agent session 调用，返回合并后的
   * MCP 配置表注入 driverOpts.mcpServers。未注入 = 不注入额外 MCP server。
   */
  private readonly _mainAgentMcpConfigProvider:
    | ((
        ctx: MainAgentMcpContext,
      ) => Record<string, McpServerConfigForDriver> | undefined)
    | undefined;
  /**
   * task-06（2026-08-25-team-subsession-governance / FR-03 / D-003@v1）：分身
   * （mission worker）会话判定谓词。未注入 = 永远 false（mission_worker 不注入
   * 任何 server，旧语义零回归）。与 ``SessionManagerOptions.isWorkerSession`` 对齐，
   * 签名同 ``MainAgentMcpContext``（create / restore / reload 三路共用归一化 ctx）。
   */
  private readonly _isWorkerSession:
    | ((ctx: MainAgentMcpContext) => boolean)
    | undefined;
  /**
   * task-06（design §5.C.1）：分身受限 MCP server 配置构造器（sillyhub-worker，
   * 仅 worker_done 单工具）。仅分身 session 调用；未注入 = 不注入受限 server。
   */
  private readonly _workerMcpConfigProvider:
    | ((
        ctx: MainAgentMcpContext,
      ) => Record<string, McpServerConfigForDriver> | undefined)
    | undefined;
  /**
   * task-08（FR-05 / D-004@v1）：本机凭证管理器（reloadWithProvider 构造新 env 用）。
   * 缺省 null：reload 用 noopCredential fallback（层 2 token 自然跳过，层 0 provider_config
   * 仍独立生效，对齐 daemon.ts:3050）。
   */
  private readonly _credentialManager: SpawnCredentialManager | null;

  /**
   * D-001@v1（task-02）：provider driver registry。`drivers.claude` / `drivers.codex`
   * 由调用方注入（task-06 cli.ts 构造时 `drivers: { claude, codex }`）。
   *
   * 兼容（D-009 向后兼容）：构造函数把旧单 driver 入参 `deps.driver`（ClaudeSdkDriver）
   * 映射到 `_drivers.claude`，让 cli.ts 现有 `new SessionManager({ driver, ... })` 零改动。
   * 优先级：`deps.drivers.claude`（显式 registry）> `deps.driver`（兼容入口）。
   */
  private readonly _drivers: Partial<Record<InteractiveProvider, InteractiveDriver>>;

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
    // task-04（design §5.D / FR-06）：会话总数闸 env 读法对齐 SESSION_IDLE_TIMEOUT_SEC
    // 先例。Number(env) 未配/非法 → NaN → 默认 20；显式 0 = 不限（design §5.D）；
    // 负数视为非法同落默认。计数口径 = _store 活会话（非终态），create 前置检查。
    // 审计修复 F1（2026-08-26）：Number('') === 0 —— Compose `${VAR:-}` 缺省展开
    // 为空串时曾被解析为「0=不限」，进程风暴闸静默失效。trim 后空串视为未配置
    // 回落默认；非法/负数同落默认；显式 0 仍为不限（design §5.D）。
    const gateEnv = (process.env.SILLYHUB_MAX_ACTIVE_SESSIONS ?? '').trim();
    const gateRaw = gateEnv === '' ? NaN : Number(gateEnv);
    this._maxActiveSessions =
      Number.isFinite(gateRaw) && gateRaw >= 0 ? gateRaw : DEFAULT_MAX_ACTIVE_SESSIONS;
    // ql-20260822-001：resume transcript 目录对（测试注入 tmp 对，生产取缺省）。
    this._resumeDirs = opts.resumeDirs ?? defaultTranscriptDirs();

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
    // task-06（D-007@v2 / R-01）：主 agent MCP tool 注入。未注入 = 普通会话零回归。
    this._isMainAgentSession = opts.isMainAgentSession;
    this._mainAgentMcpConfigProvider = opts.mainAgentMcpConfigProvider;
    // task-06（2026-08-25-team-subsession-governance / D-003@v1）：分身受限 MCP
    // 注入（design §5.C.1）。未注入 = mission_worker 不注入任何 server（零回归）。
    this._isWorkerSession = opts.isWorkerSession;
    this._workerMcpConfigProvider = opts.workerMcpConfigProvider;
    // task-08（FR-05 / D-004@v1）：reloadWithProvider 构造新 env 的凭证管理器。未注入
    // → null → reload 时 fallback noopCredential（对齐 daemon.ts:3050）。
    this._credentialManager = opts.credentialManager ?? null;
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
   * task-09 / D-007@v2（候选 B 主路径）：登记一个借用 session 的沙箱根目录。
   *
   * daemon ``_startInteractiveSession`` 检测 lease rootPath 上的
   * ``borrow-sandbox:<slug>`` marker 后调本方法：把 daemon 经 ``prepareWorkspace(slug)``
   * 创建的真实沙箱目录绝对路径登记到本 session。
   *
   * 登记后 ``_judgeWriteViaPolicyEngine`` 对本 session 的写校验**只允许落沙箱内**，
   * 不再查 PolicyEngine 的 runtime 缓存（避免命中 lender 的 allowed_roots 继承开发代码
   * 区写权限）。未登记的 session 走原有 runtime policy（开发人员自有任务零回归）。
   *
   * 幂等：重复登记覆盖旧值（daemon WS 重放时安全）。沙箱路径为空 → 不登记（退化到
   * runtime policy，fail-open 不卡 session）。
   */
  registerBorrowSandbox(sessionId: string, sandboxRoot: string): void {
    if (!sessionId || !sandboxRoot) return;
    this._borrowSandboxRoots.set(sessionId, sandboxRoot);
  }

  /** task-09：查询本 session 是否登记为借用沙箱（测试 + 内部写守卫用）。 */
  getBorrowSandboxRoot(sessionId: string): string | undefined {
    return this._borrowSandboxRoots.get(sessionId);
  }

  /** task-09：从借用沙箱注册表移除（end/fail/consume 退出时调，幂等）。 */
  private _clearBorrowSandbox(sessionId: string): void {
    this._borrowSandboxRoots.delete(sessionId);
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
  /**
   * 写通道守卫（坑 subagent-write-channel，2026-09-03 实证 30 分钟写通道封锁）：
   * _requestPermission / _buildCanUseToolCallback 共用的 not-running 判定。
   *
   * 三态：
   *   - null = 放行继续正常审批流（running + currentRunId；或 stale-flip 宽限窗内）；
   *   - deny 对象 = fail-closed（含诊断上下文：status/currentRunId/stale 翻转距今/
   *     lastActiveAt 距今——2026-09-03 事故排查时裸文案零线索，触发条件至今不明）。
   *
   * stale-flip 宽限（误翻不封锁写通道）：inject 的 >60s 无 result 自愈会把仍活着
   * 但安静的长 turn 强翻 active 且保留 currentRunId（正常 result 收尾才清）——
   * 「active + currentRunId + staleRunResetAt 在宽限窗内」时 SDK turn 很可能未死，
   * 写调用放行；误翻是启发式猜测，写通道不该被猜测封锁。SDK 正常结束后不会调
   * canUseTool，正常收尾路径（active + currentRunId=undefined）不受宽限影响。
   */
  /**
   * stale-flip 宽限窗判定（坑 subagent-write-channel + quick-bfec20a6）：
   * 「active + currentRunId 仍在 + staleRunResetAt 在宽限窗内」——turn 很可能
   * 仍活着（>60s 无 result 的强翻是启发式猜测）。写通道守卫与自更新忙屏障
   * （hasRunningTurn）共用：误翻既不该封锁写调用，也不该放行 daemon 自更新
   * 重启杀活轮（事故会话 e148364e：等 AskUserQuestion 作答的安静轮被翻 active
   * 后忙屏障放行自更新，12:39 daemon 重启杀轮）。SDK 真死时本就无调用进来；
   * 窗口 60min 有界，真死 turn 最多推迟升级 1 小时。
   */
  private _withinStaleFlipGrace(state: SessionState): boolean {
    return (
      state.status === 'active' &&
      !!state.currentRunId &&
      !!state.staleRunResetAt &&
      Date.now() - state.staleRunResetAt < STALE_RUN_WRITE_GRACE_MS
    );
  }

  private _writeChannelGuardDeny(
    state: SessionState | undefined,
    toolName: string,
  ): { behavior: 'deny'; message: string } | null {
    if (!state) {
      return {
        behavior: 'deny',
        message: `session state missing (daemon restart?) — tool "${toolName}" denied; retry in a new turn`,
      };
    }
    if (state.status === 'running' && state.currentRunId) return null;
    if (this._withinStaleFlipGrace(state)) return null;
    const parts = [
      `status=${state.status}`,
      `currentRunId=${state.currentRunId ? 'set' : 'unset'}`,
      state.staleRunResetAt
        ? `staleRunReset=${Math.round((Date.now() - state.staleRunResetAt) / 1000)}s ago`
        : null,
      `lastActive=${Math.round((Date.now() - state.lastActiveAt) / 1000)}s ago`,
    ].filter(Boolean);
    return {
      behavior: 'deny',
      message:
        `session not in running turn (${parts.join(', ')}) — tool "${toolName}" denied. ` +
        'If this turn is actually still running (long quiet tool), the >60s-silent auto-reset may have misfired; wait or continue in a new turn.',
    };
  }

  private async _requestPermission(input: {
    sessionId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    signal?: AbortSignal;
    toolUseId?: string;
    isUserInputKind?: boolean;
  }): Promise<CanUseToolDecision> {
    const state = this._store.get(input.sessionId);
    // session 非 running / 无 currentRunId → fail-closed deny（stale-flip 宽限窗内放行）。
    const guardDeny = this._writeChannelGuardDeny(state, input.toolName);
    if (guardDeny) return guardDeny;
    if (!state || !state.currentRunId) {
      // 防御性缩窄：守卫三态已保证走到这里 currentRunId 非空
      return { behavior: 'deny', message: `session not in running turn — tool "${input.toolName}" denied` };
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
   * D-001@v1（task-02）→ task-05（FR-05 / design §5.2）：按 provider 取已注册 driver，
   * 改读 INTERACTIVE_PROVIDERS 注册表。未注册 → 抛 UnsupportedProviderError。
   *
   * 两道门控（纯重构，错误语义/文案与 task-02 完全一致）：
   *   1. 注册表门：provider 不在 INTERACTIVE_PROVIDERS（运行时收到联合外的
   *      串）→ UnsupportedProviderError——provider 合法性以注册表为单源；
   *   2. 实例门：注册表已知但 `deps.drivers` 未注入该实例（含旧 `deps.driver`
   *      → `_drivers.claude` 兼容映射仍未覆盖的 provider）→ 同样抛
   *      UnsupportedProviderError，保持「driver 未注入即不支持」语义（既有
   *      session-manager 测试锚定此行为）。
   *
   * 兼容入口：`deps.driver`（ClaudeSdkDriver）经构造函数已映射到 `_drivers.claude`，
   * 故 claude 路径无论走 `drivers` registry 还是旧 `driver` 入参都能取到 driver。
   * descriptor.createDriver 工厂已在注册表就位（零参构造等价 cli.ts 现行 new），
   * 但本方法不自动构造——注入实例是现行唯一实例来源（cli.ts 单例注入 + 测试
   * mock 注入），让 _getDriver 兜底构造会让未注入 provider 静默落到真实 driver，
   * 属行为变更（既有 UnsupportedProviderError 用例回归），归后续任务决策。
   * 文案保留现有 Wave1/2 模板（codex 未注入时仍抛此错）。
   */
  private _getDriver(provider: InteractiveProvider): InteractiveDriver {
    // 宽化索引：provider 形参类型是注册表联合，但运行时可能收到联合外字符串
    //（daemon/持久层透传），按 Record<string, ...> 查防 noUncheckedIndexedAccess 盲区。
    const descriptor = (INTERACTIVE_PROVIDERS as Record<
      string,
      ProviderDescriptor | undefined
    >)[provider];
    if (descriptor === undefined) {
      throw new UnsupportedProviderError(provider);
    }
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
   * @throws {SessionLimitReached} 活会话数达 SILLYHUB_MAX_ACTIVE_SESSIONS 上限（task-04 会话闸）
   * @throws {ClaudeExecutableNotFoundError} executable 缺失（driver.start 内抛，透传）
   */
  async create(input: CreateSessionInput & {
    /**
     * task-08（D-006 / D-009）：本次 lease 的 token budget 上限（来自
     * ``LeaseCtx.budget_tokens``，daemon ``_startInteractiveSession`` 透传）。
     * undefined / ≤0 / 非有限数 → 检查点短路（FR-07 零回归）。
     */
    budget_tokens?: number;
  }): Promise<void> {
    // task-05（2026-08-29-batch-session-inherit / S4 / FR-04 / D-002@v1）：resume 损伤
    // 自动降级包装。首次走 _createInternal（含 input.resume → spec.resume →
    // driverOpts.resume 透传，续旧 SDK 会话）；启动错误命中 RESUME_DAMAGE_PATTERNS
    // 且本次带 resume → 清 resume 同参 fresh 重建一次（worker 重派链路不因旧会话
    // transcript 损伤死锁）。降级一次为限不循环。
    try {
      await this._createInternal(input);
      return;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (input.resume === undefined || !RESUME_DAMAGE_PATTERNS.test(message)) {
        // 非损伤模式（网络/权限/executable 缺失等）或本次未带 resume：不降级，
        // 原失败路径抛出（损伤判定只认集中正则命中，防误伤）。
        throw e;
      }
      // 披露（D-003 最小闭环：daemon 侧仅日志，不加新上报协议字段）——warn 日志
      // 含原 resume id，供排查 worker 重派链路的降级情况。
      console.warn('[session-manager] resume_downgraded', {
        sessionId: input.sessionId,
        resume: input.resume,
        error: message,
      });
      // 清首轮挂起 timer：首次 _createInternal 已设 pendingFirstPrompt 10s fallback，
      // 不清则旧 timer 到点会 push 首句 + 删掉重建新挂的条目 → 首句双提交
      //（ql-20260825-002 同款回归）；重建会重新挂一个全新 timer。
      const stalePending = this._pendingFirstPrompt.get(input.sessionId);
      if (stalePending) {
        clearTimeout(stalePending.timer);
        this._pendingFirstPrompt.delete(input.sessionId);
      }
      // 清 resume 后同参 fresh 重建（降级一次为限：再失败在本处直接抛出，走普通
      // create 失败路径 → daemon _startInteractiveSession catch → worker failed，
      // 不二次降级）。不 push prompt——首轮由 pendingFirstPrompt 10s fallback 驱动
      //（与首轮派发同构，S3 设计定论，不动该机制）。
      const { resume: _downgradedResume, ...freshInput } = input;
      await this._createInternal(freshInput);
    }
  }

  /**
   * create 的内部实现（原 create 主体；task-05 拆出供降级分支以清 resume 后的
   * 同参重放）。语义与拆出前逐行等价：driver 解析/会话闸/挂起首句/写 store/
   * driver.start/fire consume，失败时清理半建 state 后抛出。
   */
  private async _createInternal(input: CreateSessionInput & {
    budget_tokens?: number;
  }): Promise<void> {
    // D-001：先解析 driver（未注册即抛，在写 store 前，不留孤儿 state）。
    const driver = this._getDriver(input.provider);
    if (this._store.has(input.sessionId)) {
      throw new SessionAlreadyExistsError(input.sessionId);
    }

    // task-04（design §5.D / FR-06）：会话总数闸——create 前置计数内存 _store 活会话
    // （status 非终态 ended/failed；终态延迟清理条目不计，见 _terminalCleanupTimers）。
    // 活会话数 ≥ _maxActiveSessions（SILLYHUB_MAX_ACTIVE_SESSIONS，默认 20，0=不限）→
    // 抛 SessionLimitReached（daemon _startInteractiveSession 既有 P2b catch 回传 run
    // failed）。restoreAndReconnect 不走本闸（design §7「会话闸误伤 restore」）。
    if (this._maxActiveSessions > 0) {
      // P0 修复（2026-08-26，会话 2eac7c91 实证）：restoreAndReconnect 恢复的历史
      // 会话在 idle 回收默认关闭（_idleTimeoutSec=0）时永不释放，占满额度后新派
      // 分身一律 SESSION_LIMIT_REACHED——闸形同全局禁用团队派发。计数口径收窄为
      // **真活跃**：非终态 且（正在跑 turn 或 近期有活动，窗口 30 分钟）。长期
      // idle 的恢复会话不占额度（它们没有进程成本，只是内存态 + 可被 inject 唤醒；
      // 真正的进程风暴防护由"正在跑 turn"承担）。窗口常量与终态清理延迟同量级。
      const GATE_ACTIVE_WINDOW_MS = 30 * 60 * 1000;
      const now = Date.now();
      let activeCount = 0;
      for (const s of this._store.values()) {
        if (s.status === 'ended' || s.status === 'failed') continue;
        const running = s.status === 'running' || this._pendingInjectCount.has(s.sessionId);
        const recent = s.lastActiveAt > 0 && now - s.lastActiveAt < GATE_ACTIVE_WINDOW_MS;
        if (running || recent) activeCount++;
      }
      if (activeCount >= this._maxActiveSessions) {
        throw new SessionLimitReached(activeCount, this._maxActiveSessions);
      }
    }

    // D-009（task-02）：InputQueue 改 provider-neutral UserTurnInput。SessionManager
    // 不再构造 SDKUserMessage；Claude driver 内部做形态转换（task-03）。
    // ql-20260825-002：firstPrompt 不再直接入队（防与首条 SESSION_INJECT 双提交），
    // 挂起等 inject 消费；超时 fallback 提交（见 _pendingFirstPrompt 注释）。
    const inputQueue = new InputQueue<UserTurnInput>();
    const PENDING_FIRST_FALLBACK_MS = 10_000;
    const pendingTimer = setTimeout(() => {
      this._pendingFirstPrompt.delete(input.sessionId);
      const st = this._store.get(input.sessionId);
      if (!st || st.status === 'ended' || st.status === 'failed') return;
      st.inputQueue.push({ type: 'user', text: input.firstPrompt });
    }, PENDING_FIRST_FALLBACK_MS);
    this._pendingFirstPrompt.set(input.sessionId, {
      prompt: input.firstPrompt,
      timer: pendingTimer,
    });

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
      // task-08：depth 状态机已下沉 ClaudeEventNormalizer（事件一等字段 depth 直达），
      // 本字段仅保留满足 SessionState 形状（types.ts 不在本任务 allowed_paths），
      // 恒空 Map、无消费方；types.ts 收口时随字段一并移除。
      subagentDepth: new Map(),
      // task-06：lease stage 持久化（snapshotPersistable 输出，恢复用）。
      stage: input.stage,
      // task-04（2026-08-26-team-subsession-recursion）：分身会话深度承载（来自
      // CreateSessionInput.worker_depth，snapshotPersistable 输出 + restore 保档）。
      // undefined → 旧 lease / 主控 / 普通会话（键穿透，档位判定归 task-05）。
      worker_depth: input.worker_depth,
      // task-10（C-12）：profile 字段承载到 state（写守卫用 effectiveAllowedRoots；
      // mcpRefs/skillRefs 持久化恢复用）。undefined → 不写键（FR-15 行为同今天）。
      ...(input.mcpRefs !== undefined ? { mcpRefs: input.mcpRefs } : {}),
      ...(input.skillRefs !== undefined ? { skillRefs: input.skillRefs } : {}),
      ...(input.effectiveAllowedRoots !== undefined
        ? { effectiveAllowedRoots: input.effectiveAllowedRoots }
        : {}),
      // task-08（sessions-portal）：systemPrompt 写 state（task-05 只透传 driverOpts，
      // state 缺字段致 snapshotPersistable 无法落盘——create 起的档案配置重启会丢，
      // 本任务闭合 config 快照持久化链路）。
      ...(input.systemPrompt !== undefined
        ? { systemPrompt: input.systemPrompt }
        : {}),
      // ql-20260904-017：会话级供应商凭证同款闭合——claim 下发的 provider_config
      // 原本只进 spawn env（内存），daemon 重启后 sessions.json 无凭证、恢复出的
      // SDK 裸起 "Not logged in"（会话 2f08b5da 实证）。记入 state.providerConfig
      // → 既有 snapshotPersistable 落盘 + restore 读回链生效。null/undefined（本机
      // 默认）不写键，与切换供应商链的语义一致。
      ...(input.providerConfig != null
        ? { providerConfig: input.providerConfig }
        : {}),
    };
    this._store.set(input.sessionId, state);
    // ql-20260825-f3#1：同 id 重建（end 后短窗口内 recreate）取消遗留的终态延迟
    // 清理 timer，防到点误删新条目。
    this._cancelTerminalCleanup(input.sessionId);

    // task-08（D-006 / D-009）：登记 session 级 budget_tokens（来自 LeaseCtx）。
    // 复用 _setBudgetTokensInternal 的校验（finite / >0），非法值 → 不登记 = 短路。
    this._setBudgetTokensInternal(input.sessionId, input.budget_tokens);

    // 3. driver.start（若 executable 缺失，这里抛 ClaudeExecutableNotFoundError；
    //    state 已写入 store，但 driver 协程未启动——由 onError 路径不会触发，
    //    daemon 在 _startInteractiveSession 内 try/catch 把 session 收 failed）。
    try {
      // task-08（D-007@v1 / FR-07）：manual_approval=true 时为当前 session 建独立
      // resolver（每 session 一份，互不干扰）+ 构造远程人审 canUseTool 回调；
      // false（默认）时不传，SDK 走内置默认策略（spike H1 行为不变）。
      // _buildDriverOptions 内部按 enableApproval 注入 canUseTool/onUserDialog +
      // 建 resolver（scan 真阻塞，改造点 C/D）；create/restore 复用同一套注入逻辑。
      // task-06：主 agent session 注入 MCP tool（让主 agent discover daemon MCP
      // server 5 tool）。仅 isMainAgentSession 判定为主 agent 时调 provider 取配置；
      // provider 未注入 / 返回 undefined → 不注入（普通会话零回归）。
      //谓词/provider 签名用 MainAgentMcpContext（create + restore 共用），从 input 归一化。
      //task-10（C-12）：profile 字段（mcpRefs/skillRefs/effectiveAllowedRoots）随 ctx
      //传入 _resolveMainAgentMcp 供 mcpRefs 过滤；effectiveAllowedRoots 写 state 供写守卫。
      const mainAgentMcp = this._resolveMainAgentMcp({
        sessionId: input.sessionId,
        leaseId: input.leaseId,
        provider: input.provider,
        cwd: input.cwd,
        model: input.model,
        stage: input.stage,
        // task-04：分身深度随 ctx 传入（受限分支谓词 / provider 消费；本卡只承载，
        // 分档判定归 task-05——非叶 5 工具 / 叶仅 worker_done）。
        worker_depth: input.worker_depth,
        mcpRefs: input.mcpRefs,
        skillRefs: input.skillRefs,
        effectiveAllowedRoots: input.effectiveAllowedRoots,
        systemPrompt: input.systemPrompt,
      });
      const driverOpts = this._buildDriverOptions(state, {
        exePath,
        model: input.model,
        allowedTools: input.allowedTools,
        env: input.env,
        enableApproval,
        effectiveAskUserOnly,
        // task-05（2026-08-29-batch-session-inherit / D-001@v1）：resume 透传——
        // CreateSessionInput.resume（daemon.ts task-04 已从 execPayload.resumeSessionId
        // 归一化传入）→ spec.resume → driverOpts.resume 既有链（worker 重派续旧 SDK
        // 会话）。undefined（旧 backend 无该键）→ 键不写入，全新会话原路径（零回归）。
        resume: input.resume,
        mcpServers: mainAgentMcp,
        systemPrompt: input.systemPrompt,
      });
      // task-02（D-001）：用 session 归属 driver（不再全局 this.deps.driver）。
      // 过渡期 ClaudeSdkDriver.start 同步返回 Query、InteractiveDriver.start 返回
      // Promise<Handle>；统一 await（同步返回值经 await 等价直传）。按 provider 写句柄：
      // claude → state.query（SDK Query）；codex → state.driverHandle。
      const handleOrQuery = (await driver.start(
        inputQueue,
        driverOpts as unknown as Parameters<InteractiveDriver['start']>[1],
      )) as unknown;
      if (input.provider === 'claude') {
        // task-08：经 SessionState['query'] 结构类型断言（SessionManager 内
        // @anthropic-ai/claude-agent-sdk 类型 import 清零；Query 类型由 types.ts 持有）。
        state.query = handleOrQuery as SessionState['query'];
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
      // ql-20260825-f3#7：对称清理 budget 软切断登记——_setBudgetTokensInternal 在
      // try 前已执行（上方第 2 步），失败路径不回收则 _sessionBudgetTokens 条目
      // 只增不减。task-08：_destroyUsageLedger 统一回收 budget/usage 台账，保持
      // 成功/失败清理对称。
      this._destroyUsageLedger(input.sessionId);
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
   * task-06（D-007@v2）：归一化 MainAgentMcpContext + 调谓词/provider 决定主 agent
   * MCP server 配置。
   *
   * create 路径从 ``CreateSessionInput``、restore 路径从 ``PersistedSessionRecord``
   * 各自抽出 sessionId/leaseId/provider/cwd/model 构造 ctx（两者都含这些字段），
   * 再统一调 ``isMainAgentSession`` 判定 + ``mainAgentMcpConfigProvider`` 取配置。
   *
   * task-06（2026-08-25-team-subsession-governance / D-003@v1，design §5.C.1）：
   * 分身分支在最前——``isWorkerSession`` 判定为 mission_worker 时取
   * ``workerMcpConfigProvider`` 的受限配置表（仅 worker_done 单工具的
   * sillyhub-worker server），**不进**主控分支（5 编排工具不进分身，递归闸）。
   * 与主控注入同机制（谓词 + provider）、不同工具集；create / restore / reload
   * 三路共用本方法，一处分支三路生效。
   *
   * 返回 undefined 的三种情况（均不注入，普通会话零回归）：
   *   1. 谓词未注入 / 返回 false（非主 agent session）；
   *   2. provider 未注入；
   *   3. provider 返回 undefined / 空对象。
   */
  private _resolveMainAgentMcp(ctx: MainAgentMcpContext):
    | Record<string, McpServerConfigForDriver>
    | undefined {
    // ── 分身受限分支（task-06 / design §5.C.1，优先于主控判定）──
    if (this._isWorkerSession?.(ctx) === true) {
      const workerConfig = this._workerMcpConfigProvider?.(ctx);
      if (!workerConfig) return undefined;
      // injectMcpSessionId 补写受限 server 名（WORKER_MCP_SERVER_NAME）的
      // MCP_SESSION_ID——受限 server 的 worker_done 调用靠 X-Session-Id 定位分身
      // 子会话（backend 沿 parent 链爬根解析 mission，缺头 400）。浅拷贝语义，
      // provider 闭包持有的配置不被污染（与主控分支同机制）。
      return injectMcpSessionId(
        workerConfig,
        ctx.sessionId,
        WORKER_MCP_SERVER_NAME,
      );
    }
    if (this._isMainAgentSession?.(ctx) !== true) return undefined;
    const config = this._mainAgentMcpConfigProvider?.(ctx);
    if (!config) return undefined;
    // task-10（2026-08-22-team-session-unify / FR-04 / spike-01）：会话上下文注入。
    // MCP server 子进程只继承白名单 + per-server env（spike-01 结论），会话 id 必须
    // 写进 mcpServers['sillyhub-daemon'].env（MCP_SESSION_ID）；cli.ts provider
    // （task-09 定型，不在本任务 allowed_paths）不传 sessionId，故在 provider 返回后
    // 按 ctx.sessionId 补写。create / restore / reload 三路共用本方法——每次 spawn
    // 都重新解析，session id 变化即 env 变化（spike-01 执行指令 1）。
    // task-06（2026-08-23-agent-file-upload-mcp / FR-02）：sillyhub-file server 读
    // 同名 MCP_SESSION_ID env 定位会话（design §6），与 sillyhub-daemon 同管道补写
    // ——调用两次 injectMcpSessionId（serverName 参数已可选，不改其签名），仍仅补
    // 两个 daemon 内置 server 条目，其它 MCP server 不注入（env 卫生）。
    const withDaemonSessionId = injectMcpSessionId(config, ctx.sessionId, DAEMON_MCP_SERVER_NAME);
    const withSessionId = injectMcpSessionId(withDaemonSessionId, ctx.sessionId, FILE_MCP_SERVER_NAME);
    // task-10（C-12 / FR-10 / D-017）：profile.mcpRefs 子集过滤。
    // 非空 mcpRefs 时对 provider 返回的 MCP 配置表按此 ∩ 过滤（mergeMcpConfigs 第三层，
    // 与 batch task-runner 同源逻辑）。cli.ts mainAgentMcpConfigProvider 产出的配置表
    // 已含 daemon 内置 MCP server（sillyhub-daemon / sillyhub-file，task-06）；若
    // profile.mcpRefs 未列入某 server，它会被剔除——这是 profile 收紧语义的正确表现
    // （profile 只允许它声明的子集）。task-06：sillyhub-file 与 sillyhub-daemon 同语义
    // 受过滤、不单独豁免（design §9；需要常驻的 profile 显式列名即可）。
    // 空数组/undefined → 不过滤（FR-15 行为同今天，provider 原样返回）。
    const mcpRefs = ctx.mcpRefs;
    if (!mcpRefs || mcpRefs.length === 0) return withSessionId;
    // 转 McpConfig 入参（补 type:'stdio' + args 默认 []，满足 mergeMcpConfigs 类型 +
    // D-017 stdio 校验）。McpServerConfigForDriver 与 McpServerConfig 结构兼容（command/
    // args/env 同名同义），只是 args 可选 vs 必填、type 缺省——这里归一化补齐。
    const mcpConfigInput: McpConfig = {
      mcpServers: Object.fromEntries(
        Object.entries(withSessionId).map(([name, cfg]) => [
          name,
          {
            type: 'stdio' as const,
            command: cfg.command,
            args: cfg.args ?? [],
            ...(cfg.env ? { env: cfg.env } : {}),
          },
        ]),
      ),
    };
    const merged = mergeMcpConfigs([], mcpRefs, mcpConfigInput);
    // 转回 driver 契约类型（过滤后子集）。
    const result: Record<string, McpServerConfigForDriver> = {};
    for (const [name, cfg] of Object.entries(merged.config.mcpServers)) {
      result[name] = {
        command: cfg.command,
        ...(cfg.args ? { args: cfg.args } : {}),
        ...(cfg.env ? { env: cfg.env } : {}),
      };
    }
    return Object.keys(result).length > 0 ? result : undefined;
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
   *   3. task-06：spec.mcpServers 非空时透传到 driverOpts.mcpServers（主 agent
   *      MCP tool 注入，让主 agent discover daemon MCP server 5 tool）。普通会话
   *      spec.mcpServers 缺省 undefined → 不传 → driver 走默认（零回归）。
   *
   * @param state 当前 session（写 driver 归属、读 provider）
   * @param spec exePath/model/allowedTools/env/enableApproval/effectiveAskUserOnly/resume/mcpServers
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
      mcpServers?: Record<string, McpServerConfigForDriver>;
      /** task-05：profile.system_prompt → driverOpts.systemPrompt preset+append。
       * ql-20260818-004：null=取消档案（preset-only 无人格）。 */
      systemPrompt?: string | null;
      /** ql-20260818-002/004：档案维度切换（含取消）→ fork 新会话使人格生效。 */
      forkSession?: boolean;
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
    // task-06（D-007@v2）：主 agent MCP tool 注入。spec.mcpServers 由 create/
    // restoreAndReconnect 按主 agent 判定 + provider 构造后传入；非空时透传到
    // driverOpts.mcpServers，driver（Claude SDK）把它传给 SDK options.mcpServers
    // 让主 agent discover daemon MCP server 5 tool。普通会话不传（undefined）。
    if (spec.mcpServers !== undefined) {
      driverOpts.mcpServers = spec.mcpServers;
    }
    // task-05（2026-08-13-profile-system-prompt-injection）：profile.system_prompt 注入。
    // preset:claude_code + append：保留 claude 默认能力（编码/工具/use-tool）+ 追加档案
    // 提示词（sdk.d.ts:1911-1918「Default with additions」）。仅 claude driver 消费此字段
    // （codex 等 StartOptions 无 systemPrompt，编译期不让赋，D-005）。
    if (spec.systemPrompt !== undefined) {
      driverOpts.systemPrompt = {
        type: 'preset',
        preset: 'claude_code',
        // ql-20260818-004：null=取消档案 → preset-only（claude 默认人格，无追加）。
        append: spec.systemPrompt ?? undefined,
      };
      // ql-20260818-002/004：SDK 的 systemPrompt 选项在 **resume** 时被 CLI 忽略
      // （会话 jsonl 固化创建时的 system prompt）——SDK 官方机制 forkSession=true
      // 让 resume fork 出新会话 ID，新 system prompt 对 fork 生效且历史完整复制。
      // 由 reloadWithConfig 显式决策（仅档案维度被切时 fork；provider-only 切换
      // 人格已在 jsonl 固化，resume 自然保留，fork 只会白白换 session id）。
      if (spec.forkSession === true) {
        driverOpts.forkSession = true;
      }
    }
    // scan 真阻塞（per-session，generic-wibbling-whisper.md 改造点 C/D）：
    // enableApproval=true 时按 session 建独立 resolver + 注入远程人审 canUseTool +
    // onUserDialog，让 scan 真阻塞等人审（chat=false 不注入 AskUserQuestion 人审，
    // 但见下方 allowed_roots 写拦截：注入 provider 后 chat 也注入 canUseTool 做写校验）。
    // 行为与改造前逐行等价（FR-10）+ allowed_roots 写拦截增量（2026-06-29）。
    // 显式 permissionMode=default（2026-06-30 修 bug：SDK permissionMode 缺失时
    // 可能沿用 session resume 的旧状态，绕过 canUseTool → 写守卫失效）。
    // 2026-07-08 D-002：撤回 635c0d4a 的 bypassPermissions。canUseTool 注入是无条件
    // 的（writeGuardEnabled 即注入），bypassPermissions 下 SDK 仍调 canUseTool，
    // 未生效且语义混淆。5min 超时真实根因是 ask_user_only=false（task-01 修）。
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
    // 2026-08-06-public-mcp-server verify 修复（read_only 物制 layer 3 / G3 / D-005@v2）：
    // read_only worker 的 allowed_tools=[Read,Glob,Grep] 经 create→driverOpts 传到 SDK 的
    // allowedTools 字段，但 SDK allowedTools 非严格白名单（无 canUseTool 时 headless 默认
    // 全批准；有写守卫时写守卫按路径放行 Write/Edit/Bash）→ read_only 实测仍能写。故在
    // canUseTool 最外层包一道白名单拒绝：toolName 不在 allowedTools 直接 deny，先于写守卫
    // /默认批准。absent（非 read_only worker）→ 不包，零回归。
    if (spec.allowedTools !== undefined) {
      const _roWhitelist = new Set(spec.allowedTools);
      const _innerCanUse = driverOpts.canUseTool as CanUseToolFn | undefined;
      // R-10 修复（2026-08-28-daemon-agent-share E2E）：SDK allowedTools 语义是
      // 「auto-allowed without prompting——execute automatically without asking for
      // approval」（sdk.d.ts:1420-1424），成员**不经过 canUseTool**。平台共享会话
      // 白名单含 Write/Edit → 写调用被 SDK 直接自动执行，写守卫（overlay 交集收紧/
      // PolicyCache 机器级）从未被调用 → 目录外写放行且零审计（E2E 实证）。修法：
      // 写守卫链存在时把**写类工具从 SDK 层预批准集摘除**（读/mcp 保留预批准，免每
      // 读一次过回调），写工具改经 canUseTool 链——gate 白名单仍用完整 spec 列表
      // （Write 在其中过 gate）→ 写守卫路径校验。read_only worker 列表无写工具，
      // filter 后不变，行为逐字节不变（G3 零回归）。
      if (_innerCanUse) {
        const sdkPreapproved = spec.allowedTools.filter((t) => !_SDK_WRITE_TOOLS.has(t));
        if (sdkPreapproved.length > 0) {
          driverOpts.allowedTools = sdkPreapproved;
        } else {
          delete driverOpts.allowedTools;
        }
      }
      const _roGate: CanUseToolFn = async (toolName, input, options) => {
        if (!_roWhitelist.has(toolName)) {
          return {
            behavior: 'deny',
            message: `read_only: tool '${toolName}' not in allowed_tools whitelist [${[..._roWhitelist].join(',')}]`,
          };
        }
        return _innerCanUse ? _innerCanUse(toolName, input, options) : { behavior: 'allow' };
      };
      driverOpts.canUseTool = _roGate;
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
   *   - task-12（D-011）：state.effectiveAllowedRoots 非空时先做 session 级
   *     overlay 交集收紧（`_judgeWriteViaPolicyEngine` 内判定）；
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
    provider: InteractiveProvider,
    inner: CanUseToolFn,
  ): CanUseToolFn {
    return async (
      toolName: string,
      toolInput: Record<string, unknown>,
      options: Parameters<CanUseToolFn>[2],
    ): ReturnType<CanUseToolFn> => {
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
      //
      // task-10（C-12 / D-013 / FR-11）：profile.effectiveAllowedRoots 存在则替代
      // provider 值，∩ 物理 provider 兜底（防 backend 算的 effective 含已失效/越界路径；
      // backend 服务端已校验 overlay⊆daemon_roots，这里仅防御 stale 缓存）。provider
      // 为空（未注入）时直接信任 effective（backend 已是 daemon∩overlay 的权威交集）。
      // effective undefined/空 → 用原 provider 值（FR-15 行为同今天）。roots 计算已抽
      // _sessionOverlayRoots 共享 helper（task-12，policyEngine 分支同判定）。
      const providerRoots = this._allowedRootsProvider?.() ?? [];
      const overlayRoots = this._sessionOverlayRoots(sessionId);
      const roots = overlayRoots ?? providerRoots;
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
   * task-12（2026-08-28-daemon-agent-share / D-011）：解析 session 级 overlay 写
   * roots——写守卫两个分支（policyEngine 主路径 / allowedRootsProvider fallback）
   * 的共享判定，从 task-10（C-12 / D-013）fallback 块原样抽出。
   *
   * 语义：``state.effectiveAllowedRoots`` 非空时返回 overlay roots = effective ∩
   * 物理 provider 兜底（``allowedRootsProvider`` 未注入/为空 → 直接信任 effective，
   * backend 已是权威交集；注入则滤掉越出物理边界的 stale 路径）。
   *
   * @returns null = 会话无 effectiveAllowedRoots（undefined/空数组，FR-15 用物理
   *   provider 值，行为同今天）；非 null = overlay 生效的 roots（可能为空数组 =
   *   effective 全被 provider 兜底滤掉——fallback 沿用「空 = 未启用」跳过检查，
   *   policyEngine 路径按交集语义任何路径都不命中 → deny，只收紧）。
   */
  private _sessionOverlayRoots(sessionId: string): string[] | null {
    const stateForRoots = this._store.get(sessionId);
    const effectiveRoots = stateForRoots?.effectiveAllowedRoots;
    if (!effectiveRoots || effectiveRoots.length === 0) return null;
    const providerRoots = this._allowedRootsProvider?.() ?? [];
    return providerRoots.length > 0
      ? effectiveRoots.filter((p) => isPathUnderAnyRoot(p, providerRoots))
      : effectiveRoots;
  }

  /**
   * task-14（design §5.1.3 / §5.2）：经 PolicyEngine 校验一次工具调用的写路径。
   *
   * 提取写目标路径（Write/Edit/MultiEdit 取 file_path/path；Bash/PowerShell/CMD
   * 经 extractShellWritePaths），逐条 `canWrite(runtimeId, path, provider, tool)`。
   * 任一 deny 即返回首个 deny 的 reason（统一中文文案）；全 allow / 无写路径返回 null。
   *
   * task-12（D-011 / spike-02 结论 B 修复）：借用沙箱分支之后、PolicyCache 循环
   * 之前插入 session 级 overlay 交集收紧——effectiveAllowedRoots 非空的会话写路径
   * 必须同时落 session roots 与 PolicyCache roots（见 `_sessionOverlayRoots`）。
   * 无该字段的会话零行为变化。
   *
   * runtimeId 由 runtimeIdProvider 闭包解析（daemon._registeredRuntimes.get(provider)）；
   * 解析为空串时 PolicyCache 未命中 → fail-closed deny（design D-007）。
   *
   * @returns deny 的 reason 字符串；null = 放行（交内层）。
   */
  private _judgeWriteViaPolicyEngine(
    sessionId: string,
    provider: InteractiveProvider,
    toolName: string,
    toolInput: Record<string, unknown>,
  ): string | null {
    const engine = this._policyEngine;

    // 提取写目标路径。
    const writePaths = this._extractWritePathsForTool(toolName, toolInput);
    if (writePaths.length === 0) return null; // 非写工具 / 提取不到 → 放行

    // task-09 / D-007@v2（候选 B 主路径）：借用 session 按 lease 隔离只读沙箱 root。
    // **不查 PolicyEngine runtime 缓存**——缓存键是 lender runtime_id，allowed_roots 是
    // lender 代码区，借用 agent 命中即继承 lender 写权限（R-02 核心坑）。借用 session
    // 只允许写沙箱目录内，沙箱外（含 lender 代码区）一律 deny。登记见
    // ``registerBorrowSandbox``（daemon _startInteractiveSession 检测 marker 后调）。
    const borrowRoot = this._borrowSandboxRoots.get(sessionId);
    if (borrowRoot) {
      for (const p of writePaths) {
        const np = resolveRealPath(p);
        if (np === UNC_REJECTED) {
          return (
            `借用任务沙箱隔离拒绝写入。\n` +
            `Agent：${provider}\n` +
            `目标路径：${p}\n` +
            `原因：UNC 路径（\\\\server\\share）不允许写入。`
          );
        }
        if (!isPathUnderAnyRoot(np, [borrowRoot])) {
          return (
            `借用任务沙箱隔离拒绝写入。\n` +
            `Agent：${provider}\n` +
            `目标路径：${np}\n` +
            `原因：借用 agent 仅可写沙箱目录（${borrowRoot}），不可写开发代码区。`
          );
        }
      }
      return null; // 全部落沙箱内 → 放行（交内层 allow / 审批）
    }

    // task-12（2026-08-28-daemon-agent-share / D-011 / spike-02 结论 B 修复）：
    // session 级 overlay 交集收紧——state.effectiveAllowedRoots 非空时（platform
    // 共享会话 backend 注入 [writable_dir]，沿 _borrowSandboxRoots per-session 先例），
    // 写路径必须**同时**满足：① 落在 session roots（_sessionOverlayRoots 共享
    // helper，与 fallback 块同判定）② 下方 PolicyCache canWrite 不 deny。只收紧
    // 不放宽：session roots 不命中 → deny（本块新增强制）；命中但 PolicyCache
    // deny → 仍 deny（下方循环，session roots 不得绕过机器级边界）。无该字段的
    // 会话 overlay=null → 跳过本块，行为逐字节不变（D-011 Non-Goal 边界）。
    const overlayRoots = this._sessionOverlayRoots(sessionId);
    if (overlayRoots !== null) {
      const outsideOverlay = writePaths.find(
        (p) => !isPathUnderAnyRoot(p, overlayRoots),
      );
      if (outsideOverlay !== undefined) {
        return `path outside allowed_roots: ${outsideOverlay}`;
      }
    }

    if (!engine) return null;

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
  private _buildWriteOnlyCanUseToolCallback(_sessionId: string): CanUseToolFn {
    return async (
      _toolName: string,
      toolInput: Record<string, unknown>,
      _options: Parameters<CanUseToolFn>[2],
    ): ReturnType<CanUseToolFn> => {
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
  private _buildCanUseToolCallback(sessionId: string, askUserOnly: boolean): CanUseToolFn {
    return async (
      toolName: string,
      toolInput: unknown,
      options?: { signal?: AbortSignal },
    ): ReturnType<CanUseToolFn> => {
      const state = this._store.get(sessionId);
      // state 不存在 / 非 running turn / 无 currentRunId → fail-closed deny（stale-flip
      // 宽限窗内放行——见 _writeChannelGuardDeny，坑 subagent-write-channel）。
      const guardDeny = this._writeChannelGuardDeny(state, toolName);
      if (guardDeny) return guardDeny;
      if (!state || !state.currentRunId) {
        // 防御性缩窄：守卫三态已保证走到这里 currentRunId 非空
        return { behavior: 'deny', message: `session not in running turn — tool "${toolName}" denied` };
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
      // Plan 审批升级为 dialog（docs/sillyspec/2026-08-24-platform-session-shell-
      // plan-feedback-gaps 收口）：ExitPlanMode 的 canUseTool 原走下方普通审批——
      // 前端把无 dialog_kind 的审批卡分流到 /runtimes 面板（会话页无卡）+ backend
      // 5min 自动 deny（ephemeral 无 DB 行），用户侧表现正是「plan 发起后没响应」。
      // 复用 AskUserQuestion dialog 基建：dialog_kind='plan_approval' → backend 持久化
      // session_dialog_requests（刷新存活）+ 前端会话页按 dialog_kind 存在性渲染问答卡
      //（长驻可答，无 5min 超时）。答案映射：选「批准计划」→ allow 放行 SDK 退出计划
      // 模式；其他答案/自定义文本 → deny.message 回喂用户反馈，Claude 据此修订计划后
      // 重新提交。scan（askUserOnly）不受影响——上方分支已 allow-through。
      if (toolName === 'ExitPlanMode') {
        const planApproveLabel = '批准计划';
        const planRaw = updatedInput['plan'];
        const planText =
          typeof planRaw === 'string' && planRaw.length > 0 ? planRaw : '';
        // preview 有界：计划全文可能很长，卡片只带前 1500 字预览防巨型 payload
        const planPreview = planText.slice(0, 1500);
        const planResolver = this._resolversBySession.get(sessionId);
        const planWsClient = this._permissionWsClient;
        if (!planResolver || !planWsClient) {
          return {
            behavior: 'deny',
            message: `Plan approval channel unavailable (session=${sessionId}, run=${runId}); revise and resubmit.`,
          };
        }
        try {
          const { promise } = planResolver.register({
            sessionId,
            runId,
            toolName,
            toolInput: updatedInput,
            signal: options?.signal,
            send: (msg) => planWsClient.send(msg),
            dialogKind: 'plan_approval',
            dialogPayload: {
              questions: [
                {
                  question: planPreview
                    ? 'Agent 提交了执行计划等待审批（长驻等待，不会自动超时）：'
                    : 'Agent 提交了执行计划等待审批（长驻等待，不会自动超时）。',
                  header: 'Plan 审批',
                  options: [
                    {
                      label: planApproveLabel,
                      description: '批准该计划，Agent 按计划开始执行',
                      ...(planPreview ? { preview: planPreview } : {}),
                    },
                    {
                      label: '需要修改',
                      description:
                        '拒绝执行；可在输入框填写修改意见，Agent 会据此修订计划后重新提交',
                      ...(planPreview ? { preview: planPreview } : {}),
                    },
                  ],
                },
              ],
            },
          });
          const decision = await promise;
          if (decision.behavior === 'allow') {
            // 问答卡提交语义 = allow + dialog_result.answers；单选答案为选中 label，
            // 填了自定义文本时为文本本身（卡片逻辑：custom 非空时替换选中项）。
            const dialogResult = (decision as { dialogResult?: unknown })
              .dialogResult;
            const answers = (
              dialogResult as { answers?: unknown } | undefined
            )?.answers;
            const first = Array.isArray(answers) ? answers[0] : undefined;
            const raw = first && typeof first === 'object'
              ? (first as { answer?: unknown }).answer
              : undefined;
            const answer = Array.isArray(raw)
              ? raw.join('；')
              : typeof raw === 'string'
                ? raw
                : '';
            if (answer === planApproveLabel) {
              return { behavior: 'allow', updatedInput };
            }
            return {
              behavior: 'deny',
              message: `计划未批准。用户反馈：${answer || '（无）'}。请根据反馈修订计划后重新提交（ExitPlanMode）。`,
            };
          }
          // deny / abort（dialog 无超时）→ 带默认可读原因 deny，让 Claude 收敛。
          return {
            behavior: 'deny',
            message: `Plan approval not completed (${decision.message ?? 'no response'}). Revise the plan or ask the user in chat.`,
          };
        } catch (err) {
          const reason =
            err instanceof Error ? err.message : String(err ?? 'unknown error');
          return {
            behavior: 'deny',
            message: `Plan approval channel error (${reason}). Revise the plan or ask the user in chat.`,
          };
        }
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
  private _buildOnUserDialogCallback(sessionId: string): OnUserDialogFn {
    return async (
      request: {
        dialogKind: string;
        payload: Record<string, unknown>;
        toolUseID?: string;
      },
      options?: { signal?: AbortSignal },
    ): Promise<UserDialogResultFn> => {
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
   * task-08（2026-09-03-agent-provider-abstraction / FR-02 / D-002@v1）：回调
   * **envelope-only**——只提供 InteractiveDriverCallbacks 新键（onTurnResult/
   * onTurnMessage/onTurnError），ClaudeSdkDriver 的旧键兜底（onResult/onMessage/
   * onError，raw SDK 消息透传）已随本任务收口移除；onTurnMessage 收
   * TurnMessageEnvelope{events}，经 _onMessage 逐事件分发。 */
  private async _runConsume(state: SessionState): Promise<void> {
    const driver = state.driver ?? this._drivers.claude;
    if (!driver) return;
    // 按 provider 选 consume target：claude=Query，codex=InteractiveDriverHandle。
    const target = state.provider === 'claude' ? state.query : state.driverHandle;
    if (!target) return;
    // ql-20260807-001 根因修复（orphan consume 守卫）：
    // reloadWithProvider 替换 state.query 后，本协程持有的 target 变成 orphan。
    // oldQuery.close() 让 SDK 迭代器抛 abort 错（"Claude Code process aborted by user"，
    // sdk.mjs close→spawnAbort(Error) + process exit 设 exitError）→ driver consume
    // catch → onError。旧实现无条件 fail(sessionId)：reload 后 status=active，fail 守卫
    // 只挡 ended/failed → 放行 → _terminateSession 把刚 reload 的 session 打成 failed +
    // close 掉新 query（state.query 已替换为新引用）+ onSessionEnd（backend ended）。
    // 此谓词判定本 consume 是否仍是 session 当前活跃消费者；reload 换 query 后返回 false，
    // 终态回调（onError/catch/onResult/onMessage）静默丢弃，不误杀新会话。
    // 成立前提：reloadWithProvider 已保证先替换 state.query 再 close oldQuery（commit
    // c401319 / ql-20260806-002），故 oldQuery.close 触发旧 consume 回调时 state.query
    // 已指向新 query，谓词正确判 orphan。两次连续 reload 同理（中间那个 consume 变 orphan）。
    const isAuthoritative = (): boolean => {
      const current =
        state.provider === 'claude' ? state.query : state.driverHandle;
      return current === target;
    };

    const onResult = async (r: InteractiveDriverResult): Promise<void> => {
      if (!isAuthoritative()) return; // orphan：reload 已换 query，旧 result 丢弃
      await this._onResult(state, r);
    };
    const onMessage = async (envelope: TurnMessageEnvelope): Promise<void> => {
      if (!isAuthoritative()) return; // orphan：旧 query 残留事件丢弃
      await this._onMessage(state, envelope);
    };
    const onError = (_e: unknown): void => {
      // 边界 2：driver 异常 → fail。fail 内部幂等。
      // orphan（reload 后旧 query.close 触发的 abort 错）静默丢弃，不 fail 新会话。
      if (!isAuthoritative()) return;
      void this.fail(state.sessionId).then(() => undefined, () => undefined);
    };
    // task-08：envelope-only（旧键 onResult/onMessage/onError 兜底分支已删）。
    const callbacks: InteractiveDriverCallbacks = {
      onTurnResult: onResult,
      onTurnMessage: onMessage,
      onTurnError: onError,
    };
    try {
      await driver.consume(
        target as InteractiveDriverHandle,
        callbacks,
      );
    } catch {
      // consume 自身不应抛（driver.consume 内 try/catch），防御性标 failed。
      // orphan（reload 后旧 query.close 触发迭代器抛错）静默丢弃，不 fail 新会话。
      if (!isAuthoritative()) return;
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
  /**
   * task-09 / ql-20260827-010-e472：附件落盘——内容寻址命名
   * ``{cwd}/attachments/{sha256}.{白名单ext}``（与 backend MinIO 端
   * ``attachments/{user_id}/{sha256}.{ext}`` 同哲学：同内容必同路径）。
   *
   * - 扩展名取展示名后缀白名单化（字母数字 1-8 位；非法/无后缀回退 ``bin``，
   *   对齐 backend storage 的 ``_EXT_RE``）；展示名不进键路径（防穿越 +
   *   消灭同名歧义——旧的同名 (n) 序号机制已废弃）。
   * - 同哈希已存在（``wx`` 独占探测 EEXIST）即跳过写入直接复用：内容寻址
   *   不可变，agent 从路径即可唯一锁定本次发送的文件，无需读目录比对。
   * - 返回相对路径 ``attachments/xxx``（prompt 路径清单用相对形态）。
   */
  private static readonly ATTACHMENT_EXT_RE = /^[A-Za-z0-9]{1,8}$/;

  private async _writeAttachmentFile(cwd: string, rawName: string, buf: Buffer): Promise<string> {
    const dir = join(cwd, 'attachments');
    await mkdir(dir, { recursive: true });
    const safe = basename(rawName) || 'attachment';
    const dot = safe.lastIndexOf('.');
    const rawExt = dot > 0 ? safe.slice(dot + 1).trim().toLowerCase() : '';
    const ext = SessionManager.ATTACHMENT_EXT_RE.test(rawExt) ? rawExt : 'bin';
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const rel = `attachments/${sha256}.${ext}`;
    try {
      await writeFile(join(cwd, rel), buf, { flag: 'wx' });
    } catch (err) {
      // EEXIST = 同内容对象已落盘（不可变）→ 跳过写入直接复用；其余照抛。
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    return rel;
  }

  async refreshClaimToken(sessionId: string, claimToken: string): Promise<void> {
    const state = this._store.get(sessionId);
    if (!state || !claimToken) return;
    state.claimToken = claimToken;
  }

  /**
   * ql-20260825-f6#3：附件下载超时（ms）。downloadAttachment 闭包由 backend WS 注入，
   * 无信号参数可传，后端 / 网络挂起时 inject 会永久卡在 await——60s 强制收口，
   * 超时抛 SessionAttachmentTimeoutError（带会话 id），由 inject 的单附件 catch
   * 降级为「下载失败: <name>」标注（不中断 turn）。
   */
  private static readonly ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 60_000;

  /**
   * ql-20260825-f6#3：带超时的附件下载。Promise.race 输家（超时后到达的下载
   * settle）由 race 已安装的 handler 吞掉，不产生 unhandled rejection。
   */
  private _downloadAttachmentWithTimeout(
    sessionId: string,
    downloadAttachment: (id: string) => Promise<Buffer>,
    attachmentId: string,
  ): Promise<Buffer> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      downloadAttachment(attachmentId),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new SessionAttachmentTimeoutError(
                sessionId,
                attachmentId,
                SessionManager.ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
              ),
            ),
          SessionManager.ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
        );
        // node 标准：超时定时器不阻塞 daemon 退出。
        if (typeof timer.unref === 'function') {
          timer.unref();
        }
      }),
    ]).finally(() => {
      // 下载先到（成功 / 失败）：取消等待中的超时定时器。
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    });
  }

  // ── task-08（D-006 / D-009）：interactive budget 软切断 ─────────────────────

  /**
   * task-08：设置 session 级 budget_tokens（外部显式注入，供 daemon ``_startInteractiveSession``
   * 在 ``create({...,budget_tokens})`` 之外补登记 / 测试直接驱动）。
   *
   * 校验：number 且 finite 且 >0 才登记；非法 / undefined / ≤0 → 删除条目（= 检查点
   * 短路，FR-07 零回归）。session 不存在 → 静默 no-op（与 refreshClaimToken 同策略）。
   *
   * D-009 口径由内部检查点负责（input+output，不含 cache）；此处只存阈值。
   */
  setBudgetTokens(sessionId: string, budgetTokens: number | undefined): void {
    this._setBudgetTokensInternal(sessionId, budgetTokens);
  }

  /** task-08 内部共享：create + setBudgetTokens 复用的登记逻辑（带校验）。 */
  private _setBudgetTokensInternal(
    sessionId: string,
    budgetTokens: number | undefined,
  ): void {
    if (!this._store.has(sessionId)) return;
    if (
      typeof budgetTokens !== 'number' ||
      !Number.isFinite(budgetTokens) ||
      budgetTokens <= 0
    ) {
      this._sessionBudgetTokens.delete(sessionId);
      return;
    }
    this._sessionBudgetTokens.set(sessionId, budgetTokens);
  }

  /**
   * task-08：查询某 session 是否已因 budget 超限进入软切断态。
   * session 不存在 / 未配置 budget → false。供 daemon / 测试观测。
   */
  isOverBudget(sessionId: string): boolean {
    return this._overBudgetSessions.has(sessionId);
  }

  /**
   * task-08（D-009；2026-09-03-agent-provider-abstraction 改造）：聚合 session
   * 会话级 usage（历史轮折算 base + 本轮各 parentKey 最新值求和，主 agent + 各
   * 子代理）。无台账 → 0/0。**不含** cache_*（D-009 口径）。
   *
   * 对齐旧跨 ``_partialBuffers`` 桶求和口径：本轮各 parent（'main'/子代理
   * tool_use_id）的轮级累计逐一相加，再加历史轮 base。
   */
  private _aggregateSessionUsage(sessionId: string): SessionUsageTotals {
    const base = this._sessionUsageBase.get(sessionId);
    let inputTokens = base?.input_tokens ?? 0;
    let outputTokens = base?.output_tokens ?? 0;
    const turn = this._turnUsageByParent.get(sessionId);
    if (turn) {
      for (const latest of turn.values()) {
        inputTokens += latest.input_tokens || 0;
        outputTokens += latest.output_tokens || 0;
      }
    }
    return { input_tokens: inputTokens, output_tokens: outputTokens };
  }

  /**
   * task-08：事件 usage → 会话级台账更新（``_liftSessionUsage`` 的写侧）。
   *
   * 数据源守卫见 ``_turnUsageByParent`` 字段注释：仅轮级累计来源（``is_partial``
   * 事件 / usage-only 空事件）replace 更新本轮对应 parentKey 条目；其余携带
   * usage 的事件（完整消息 stamp 的单次调用终值、codex usage_update）不进台账
   * （display 用途，经上报 dict 顶层 usage 透传 daemon lift）。
   */
  private _liftSessionUsage(state: SessionState, ev: AgentEvent): void {
    const usage = ev.usage;
    if (!usage) return;
    const isTurnCumulative =
      ev.is_partial === true || (ev.type === 'text' && ev.content === '');
    if (!isTurnCumulative) return;
    const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
    const output =
      typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
    const parentKey =
      typeof ev.parent_tool_use_id === 'string' && ev.parent_tool_use_id
        ? ev.parent_tool_use_id
        : 'main';
    let turn = this._turnUsageByParent.get(state.sessionId);
    if (!turn) {
      turn = new Map<string, SessionUsageTotals>();
      this._turnUsageByParent.set(state.sessionId, turn);
    }
    turn.set(parentKey, { input_tokens: input, output_tokens: output });
  }

  /**
   * task-08：turn 收尾折算（``_onResult`` 在 ``_checkBudgetCutoff`` **之后**调，
   * 对齐旧 ``_shrinkSubagentBuffers`` 的时序——预算聚合先看到本轮各 parent 值，
   * 再合入 base）。本轮各 parent 最新值累加进 ``_sessionUsageBase`` 后清空
   * 本轮表；seq 补号计数器同步归零（新 turn 事件序号空间独立）。
   */
  private _foldTurnUsage(state: SessionState): void {
    const turn = this._turnUsageByParent.get(state.sessionId);
    if (turn) {
      if (turn.size > 0) {
        const base = this._sessionUsageBase.get(state.sessionId) ?? {
          input_tokens: 0,
          output_tokens: 0,
        };
        for (const latest of turn.values()) {
          base.input_tokens += latest.input_tokens || 0;
          base.output_tokens += latest.output_tokens || 0;
        }
        this._sessionUsageBase.set(state.sessionId, base);
      }
      this._turnUsageByParent.delete(state.sessionId);
    }
    this._turnEventSeq.delete(state.sessionId);
  }

  /**
   * task-08（D-006 / D-009）：turn 收尾后的 budget 检查点（在 ``_onResult`` 末尾调）。
   *
   * 软切断 D-006：累计 input+output ≥ budget → 置 ``_overBudgetSessions``（幂等）
   * + 经现有 ``onTurnMessage`` 回传 ``reason='budget_exceeded'`` + usage。**不**调
   * close / kill / fail —— 当前 turn 已自然 result 完成，后续 ``inject`` 由置位拦截
   *（见 ``inject`` 头部检查）。budget_tokens 未配置 → 短路（FR-07 零回归）。
   */
  private _checkBudgetCutoff(state: SessionState, runId: string): void {
    const budget = this._sessionBudgetTokens.get(state.sessionId);
    if (budget === undefined) return; // FR-07 brownfield 短路
    if (this._overBudgetSessions.has(state.sessionId)) return; // 幂等
    const usage = this._aggregateSessionUsage(state.sessionId);
    const total = usage.input_tokens + usage.output_tokens;
    if (total >= budget) {
      this._overBudgetSessions.add(state.sessionId);
      // 经现有 onTurnMessage 回传 budget_exceeded 事件（fire-and-forget，对齐 _onMessage
      // 转发策略）。msg 形态用 Codex flat message 鸭子类型（= Record<string, unknown>，
      // daemon onTurnMessage duck-types 按顶层 event_type / usage 处理），与 batch
      // task-runner.ts ``_emitBudgetExceeded`` 输出**同构**：
      //   - event_type: 'system' / content: '[BUDGET_EXCEEDED] ...'
      //   - reason: 'budget_exceeded'（backend 据此识别软切断事件）
      //   - usage: {input_tokens, output_tokens}（D-009：仅 input+output，不含 cache）
      //   - budget_tokens: 阈值（透传便于 backend / 前端展示）
      const msg = {
        event_type: 'system',
        content: `[BUDGET_EXCEEDED] input=${usage.input_tokens} output=${usage.output_tokens} budget=${budget}`,
        reason: 'budget_exceeded',
        usage: {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
        },
        budget_tokens: budget,
      } as unknown as Parameters<
        NonNullable<SessionManagerDeps['onTurnMessage']>
      >[2];
      try {
        const ret = this.deps.onTurnMessage(state.sessionId, runId, msg);
        // fire-and-forget（对齐 _onMessage 的 void 包装）；异常不阻塞 turn 收尾。
        if (ret && typeof (ret as Promise<unknown>).catch === 'function') {
          (ret as Promise<unknown>).catch((e) => {
            console.warn(
              '[session-manager] budget_exceeded message forward failed',
              e,
            );
          });
        }
      } catch (e) {
        console.warn(
          '[session-manager] budget_exceeded message throw',
          e,
        );
      }
    }
  }

  async inject(
    sessionId: string,
    prompt: string,
    runId: string,
    attachments?: SessionInjectAttachment[],
    downloadAttachment?: (id: string) => Promise<Buffer>,
  ): Promise<InjectResult> {
    const state = this._store.get(sessionId);
    if (!state) {
      throw new SessionNotFoundError(sessionId);
    }
    if (state.status === 'ended' || state.status === 'failed' || state.status === 'reconnecting') {
      throw new SessionNotActiveError(sessionId, state.status);
    }
    // task-08（D-006 软切断）：已超 budget 的 session 拒绝新 turn。当前 turn 已由
    // _onResult → _checkBudgetCutoff 自然 result 完成（不硬杀），后续 inject 在此拦截，
    // 防止「累计再涨」。session 仍 active（不进 ended/failed），budget_exceeded 事件
    // 已在 _checkBudgetCutoff 发出；此处用 SessionNotActiveError（status='ended'）
    // 表达「不再接 inject」语义，与 ended 等价拒绝。
    if (this._overBudgetSessions.has(sessionId)) {
      throw new SessionNotActiveError(sessionId, 'ended');
    }

    // ql-20260825-002：消费挂起的首句——本条 inject 即权威首句（prompt/attachments
    // 版本），清除 create 挂起的 metadata fallback（防双提交）。
    const pendingFirst = this._pendingFirstPrompt.get(sessionId);
    if (pendingFirst) {
      clearTimeout(pendingFirst.timer);
      this._pendingFirstPrompt.delete(sessionId);
    }

    // task-07 排队检测：在切换 status 前抓取「前一 turn 是否未 result」。
    // status=running（driver 正在跑 turn）→ 本条 inject 排队到下一 turn（spike S1）。
    // P0 修复（2026-08-27，服务器重启死锁）：running 态超时（60s 无 result）→
    // 前一 turn 可能已被 backend 终态化（service restart cleanup），SDK query
    // 挂死或 WS 断后 result 永远不会到达 → 排队消息永远不被消费（死锁）。
    // 超时阈值 60s：正常 turn 可跑几分钟，但 result 事件（含长时间思考的
    // heartbeat）不会间隔 60s 无任何回调——超时说明 SDK 通道已断。
    // 强制重置为 active 让本条 inject 直接消费，自愈死锁。
    //
    // 坑 subagent-write-channel（2026-09-03 实证）：该启发式会误伤「仍活着但安静」
    // 的长 turn（长时间无流式回调的工具执行）——翻转后旧 turn 的写类工具调用全撞
    // "session not in running turn"（30 分钟级封锁，turn 真正结束才恢复）。翻转时
    // 记 staleRunResetAt 且不清 currentRunId（正常 result 收尾才清）：写通道守卫据此
    // 在宽限窗内放行（见 _writeChannelGuardDeny）。
    if (
      state.status === 'running' &&
      Date.now() - state.lastActiveAt > 60_000
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        '[session-manager] inject: stale running state detected (>60s no result), ' +
          'resetting to active. Possible backend restart while turn was running. ' +
          '(write-channel grace armed: staleRunResetAt recorded; quiet long turns stay writable)',
        { sessionId, lastActiveAt: state.lastActiveAt },
      );
      state.status = 'active';
      state.staleRunResetAt = Date.now();
      // 清理可能挂起的 pending 计数（旧 turn 的排队消息已无意义）。
      this._pendingInjectCount.delete(sessionId);
    }
    const wasRunningBeforeInject = state.status === 'running';

    // spike S1：push 永远进 InputQueue（turn 级串行由 SDK result 边界保证），不拒绝。
    // currentRunId 在前 turn result 收尾前由本 inject 切换（task-04 既有行为，保留）：
    // inject 时 backend 行锁已防重复创建，daemon 侧 currentRunId 反映「即将执行的 run」。
    // task-02（D-009）：push provider-neutral UserTurnInput（不再构造 SDKUserMessage；
    // Claude driver 内部做形态转换，task-03）。
    // 2026-08-20-session-multimodal-attachments task-09：附件消费（deliver 由
    // backend 全权决策）。block=多模态块（内联 data 或经下载闭包回拉）；disk=落盘
    // {cwd}/attachments/{sha256}.{ext}（ql-20260827-010-e472 内容寻址，同内容复用）
    // + text 追加路径清单（注原文件名，明确无需浏览比对其他文件）；单文件失败
    // 降级标注不中断 turn。无附件路径与原 push 逐字一致（零回归）。
    // ql-20260825-f6#3：下载闭包 60s 超时（挂起不卡死 inject）；下载 await 窗口内
    // 会话被 end/fail 收口（queue 已 close）→ push 抛 SessionQueueClosedError，
    // 此处转译为 SessionNotActiveError（不把队列内部错误类泄漏给 WS 调用方）。
    let turnText = prompt;
    let blocks: UserTurnInput['blocks'];
    let filesToFetch: UserTurnInput['filesToFetch'];
    if (attachments && attachments.length > 0) {
      const blockList: NonNullable<UserTurnInput['blocks']> = [];
      // ql-20260827-010-e472：rel → 展示名列表（内容寻址后同内容附件并入同一行，
      // 原文件名并列注记）。
      const savedRelNames = new Map<string, string[]>();
      const fetched: NonNullable<UserTurnInput['filesToFetch']> = [];
      const failedNames: string[] = [];
      for (const att of attachments) {
        try {
          if (att.deliver === 'block') {
            let b64 = att.data;
            if (!b64 && downloadAttachment) {
              // ql-20260825-f6#3：60s 超时（后端挂起不卡死 inject），超时抛
              // SessionAttachmentTimeoutError → 下方 catch 降级标注。
              b64 = (
                await this._downloadAttachmentWithTimeout(
                  sessionId,
                  downloadAttachment,
                  att.id,
                )
              ).toString('base64');
            }
            if (!b64) {
              failedNames.push(att.name);
              continue;
            }
            if (att.media_type === 'application/pdf') {
              blockList.push({ type: 'document', mediaType: 'application/pdf', base64: b64 });
            } else {
              blockList.push({ type: 'image', mediaType: att.media_type, base64: b64 });
            }
          } else {
            if (!downloadAttachment) {
              failedNames.push(att.name);
              continue;
            }
            const buf = await this._downloadAttachmentWithTimeout(
              sessionId,
              downloadAttachment,
              att.id,
            );
            const rel = await this._writeAttachmentFile(state.cwd, att.name, buf);
            const names = savedRelNames.get(rel);
            if (names) {
              if (!names.includes(att.name)) names.push(att.name);
            } else {
              savedRelNames.set(rel, [att.name]);
            }
            fetched.push({ id: att.id, name: att.name });
          }
        } catch {
          failedNames.push(att.name);
        }
      }
      if (blockList.length > 0) blocks = blockList;
      if (fetched.length > 0) filesToFetch = fetched;
      const lines: string[] = [];
      if (savedRelNames.size > 0) {
        // ql-20260827-010-e472：清单行 = 内容寻址路径 + 原文件名注记；头部明确
        // 「只读列出的路径」，消除旧 (1)(2) 序号下 agent 全目录读比对的歧义。
        lines.push(
          '[附件已落盘，直接读取以下列出的路径即可；attachments/ 下其他文件与本次发送无关，无需浏览比对]',
        );
        for (const [rel, names] of savedRelNames) {
          lines.push('- ' + rel + '（原文件名: ' + names.join('、') + '）');
        }
      }
      for (const n of failedNames) lines.push('(下载失败: ' + n + ')');
      if (lines.length > 0) {
        turnText = (prompt ? prompt + '\n\n' : '') + lines.join('\n');
      }
    }
    try {
      state.inputQueue.push(
        blocks || filesToFetch
          ? { type: 'user', text: turnText, ...(blocks ? { blocks } : {}), ...(filesToFetch ? { filesToFetch } : {}) }
          : { type: 'user', text: turnText },
      );
    } catch (err) {
      if (err instanceof SessionQueueClosedError) {
        // ql-20260825-f6#3：附件下载 await 窗口内 end()/fail() 已收口（inputQueue
        // 被 close）→ 转译为既有「会话已结束」语义错误（WS 调用方按
        // SessionNotActiveError 统一处理），不把队列内部错误类泄漏给上层。
        // status 此刻已是终态（queue 仅 terminate 链会 close），如实透传。
        throw new SessionNotActiveError(sessionId, state.status);
      }
      throw err;
    }
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
   * task-02 verify P0 返工（FR-02 / D-001@v1）：用户 plan 决策送达当前会话。
   *
   * daemon 收到 WS ``daemon:plan_response``（用户在 Web 端 PlanApprovalCard 选择
   * confirm/revise/cancel，backend 落库后推送）后经此方法把决策注入 turn：
   * 决策格式化为用户消息，复用 inject 进 InputQueue——当前 turn 在跑则排队到
   * 下一 turn（spike S1 语义），turn 已结束则直接开新 turn，Agent 据此继续执行 /
   * 修订计划 / 终止。
   *
   * 新旧校验：run_id 与 state.currentRunId 不一致（决策属于更早的 plan 轮，会话
   * 已推进到后续 turn）→ warn 丢弃返回 false，不回注旧消息（inject 会把
   * currentRunId 切回旧 run，污染日志归属）。currentRunId 为空（恢复后尚未有
   * turn）时放行——inject 会顺带回填。
   *
   * 全部失败路径（session 不存在 / 已终态 / inject 抛错）只 warn 返回 false，
   * 不向上抛——决策已在 backend session.config 落库，可经 UI 重发。
   */
  async resolvePlanResponse(
    sessionId: string,
    runId: string,
    decision: 'confirm' | 'revise' | 'cancel',
    feedback?: string | null,
  ): Promise<boolean> {
    const state = this._store.get(sessionId);
    if (!state) {
      // eslint-disable-next-line no-console
      console.warn('[session-manager] plan_response_session_not_found', { sessionId });
      return false;
    }
    if (state.status === 'ended' || state.status === 'failed' || state.status === 'reconnecting') {
      // eslint-disable-next-line no-console
      console.warn('[session-manager] plan_response_session_inactive', {
        sessionId,
        status: state.status,
      });
      return false;
    }
    if (state.currentRunId && state.currentRunId !== runId) {
      // eslint-disable-next-line no-console
      console.warn('[session-manager] plan_response_stale_run', {
        sessionId,
        planRunId: runId,
        currentRunId: state.currentRunId,
      });
      return false;
    }
    const trimmed = (feedback ?? '').trim();
    let message: string;
    if (decision === 'confirm') {
      message = '【计划确认】用户已确认当前计划，请按计划继续执行。';
    } else if (decision === 'revise') {
      message =
        '【计划修订】用户要求修改计划后再执行。修改意见：' +
        (trimmed || '（未填写）') +
        '。请据此调整计划；如需再次确认，请重新提交计划摘要。';
    } else {
      message =
        '【计划取消】用户已取消当前计划。原因：' +
        (trimmed || '（未填写）') +
        '。请停止执行该计划的后续步骤，并简要总结当前进展。';
    }
    try {
      await this.inject(sessionId, message, runId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[session-manager] plan_response_inject_failed', {
        sessionId,
        runId,
        decision,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
    return true;
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
      // task-08（FR-02）：运行中 Bash 追踪已下沉归一化器（随 SDK 进程消亡），
      // 此处不再清 daemon 侧索引（旧 _clearRunningBashCommands 已移除）。
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
    // ql-20260825-f3#1：清终态延迟清理定时器（进程即将退出，_store 内存随进程
    // 消亡；不让 unref'd timer 在退出途中 fire 触发已销毁状态的访问）。
    for (const timer of this._terminalCleanupTimers.values()) {
      clearTimeout(timer);
    }
    this._terminalCleanupTimers.clear();
    // ql-20260621-partial（task-08 改造）：partial flush 定时器已随缓冲链下沉
    // 归一化器（driver.consume finally dispose），daemon 侧无 timer 需清；此处仅
    // 清会话级 usage 台账（纯内存 Map，防退出途中残留引用）。
    for (const sid of Array.from(this._sessionUsageBase.keys())) {
      this._destroyUsageLedger(sid);
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
   * 结束 session：经 `_terminateSession` 统一收口（task-01 起接入 driverHandle.close
   * 接通 SDK kill 链 + InputQueue.close + abort resolver + 清 partial buffer + 设 status）。
   * 幂等：已 ended/failed 直接返回。
   */
  async end(sessionId: string): Promise<void> {
    const state = this._store.get(sessionId);
    if (!state) return;
    if (state.status === 'ended' || state.status === 'failed') return;
    await this._terminateSession(state, 'manual');
  }

  /**
   * 标 failed（driver onError / 不可恢复异常）：经 `_terminateSession` 统一收口。幂等。
   */
  async fail(sessionId: string): Promise<void> {
    const state = this._store.get(sessionId);
    if (!state) return;
    if (state.status === 'ended' || state.status === 'failed') return;
    await this._terminateSession(state, 'driver_error');
  }

  /**
   * task-01（D-001@v2 / D-003 / D-004 / R-01）：统一 interactive session 终止收口。
   *
   * 收敛 end()/fail() 的既有清理步骤（**保留原始顺序**，design §12 自审唯一遗留项），
   * 仅新增 `driverHandle.close?.()` 这一步接通 SDK kill 链（stdin EOF → 2s → SIGTERM →
   * 5s → SIGKILL），止血 P0「当前 turn 卡死（如 hang 死的 bash）→ claude 不退 → consume
   * 永久挂起 → 僵尸进程持续烧 token」。原 end/fail 只 inputQueue.close（stdin EOF）+
   * q.interrupt（控制消息），均不 kill；SDK 内部已有的强制 kill 链由本次 close 触发。
   *
   * reason 语义（沿用原 end/fail 各自语义）：
   *   - 'manual'       → status='ended'（用户/空闲主动结束，对应原 end()）
   *   - 'driver_error' → status='failed'（driver onError/不可恢复异常，对应原 fail()）
   *
   * close 是可选契约（FR-07 brownfield，base InteractiveDriverHandle.close 已声明可选）：
   *   - Claude：运行时 state.query 实为 ClaudeDriverHandle（task-01 已补 close → query.close()）；
   *   - Codex ：state.driverHandle.close 经 _close（SIGTERM + 2s SIGKILL）已可达
   *     （codex-app-server-driver.ts:531）；
   *   - 其他/旧 driver 不实现 close → `?.()` no-op，不报错。
   * close 异常 try/catch 包裹不阻塞 terminate（R-01；SDK 内部已有 SIGTERM→SIGKILL 升级兜底）。
   *
   * **interrupt() 不调本方法**（守 D-001@v2：「打断本轮」按钮保持软 q.interrupt，
   * session 仍 active 可续轮；只有 end/fail/cancel 走硬杀终止链）。
   */
  private async _terminateSession(
    state: SessionState,
    reason: 'manual' | 'driver_error',
    opts: { notifyBackend?: boolean } = {},
  ): Promise<void> {
    const isManual = reason === 'manual';

    // 保留原 end()/fail() 步骤的原始顺序（design §12 铁律，不得丢弃任何既有步骤）：

    // 0. ql-20260825-002：清挂起首句的 fallback timer（终态会话不再提交）。
    const _pf = this._pendingFirstPrompt.get(state.sessionId);
    if (_pf) {
      clearTimeout(_pf.timer);
      this._pendingFirstPrompt.delete(state.sessionId);
    }

    // 1. 设终态 status（原 end→'ended' / fail→'failed'）。
    state.status = isManual ? 'ended' : 'failed';

    // 2. task-08（AC-08.7）：abort 当前 session 的 pending 审批 resolver + 移除
    //    （session 终态，resolver 无存在意义）。
    this._abortPermissionResolver(
      state.sessionId,
      isManual ? 'session_ended' : 'session_failed',
    );

    // 3. task-09：清借用沙箱登记（session 已终态，写守卫注册表不再需要本条）。
    this._clearBorrowSandbox(state.sessionId);

    // 4. task-08（FR-02）：运行中 Bash 追踪已下沉归一化器（随 SDK 进程消亡），
    //    daemon 侧不再持索引（旧 _clearRunningBashCommands 移除）。

    // 4b. task-03（2026-08-27-background-subagent-progress）：清后台任务注册表 +
    //     Task/Agent tool_use 元数据（session 终态 SDK 进程已 kill，后台任务随之
    //     消亡，task_* 不会再到达；防 Map 泄漏）。
    this._clearBackgroundTasks(state.sessionId);

    // ql-20260827-007：取消未 fire 的唤醒 debounce（会话已终态，注入无处可去）。
    const pendingWakeup = this._taskWakeupPending.get(state.sessionId);
    if (pendingWakeup) {
      clearTimeout(pendingWakeup.timer);
      this._taskWakeupPending.delete(state.sessionId);
    }

    // 5. task-08：销毁会话级 usage 台账 + budget 软切断登记（旧 _destroyPartialBuffer
    //    的清理职责收口；partial 定时器已随缓冲链下沉归一化器，由 driver.dispose 兜底）。
    this._destroyUsageLedger(state.sessionId);

    // 6. task-01 新增（D-003 / D-004 / R-01）：接通 driver kill 链。
    //    Claude 句柄运行时存在 state.query（实为 ClaudeDriverHandle，经 task-01 已补
    //    close）；Codex 句柄存在 state.driverHandle（_close 已存在）。按 provider 取
    //    目标（同 _interruptInternal 的 provider 分流模式，line 1803-1805）。
    //    可选契约 close?.()：其他/旧 driver 不实现也不报错。try/catch 不阻塞（R-01）。
    const terminateTarget: InteractiveDriverHandle | undefined =
      state.provider === 'claude'
        ? (state.query as unknown as InteractiveDriverHandle | undefined)
        : state.driverHandle;
    try {
      terminateTarget?.close?.();
    } catch {
      /* R-01: close 异常不阻塞 terminate 流程（SDK 内部已有 SIGTERM→SIGKILL 升级兜底）。 */
    }

    // 7. close InputQueue（给 stdin EOF；幂等，已 closed 不抛）。
    try {
      state.inputQueue.close();
    } catch {
      /* close 幂等，已 closed 不抛 */
    }

    // 8. 通知 backend 终态（原 end→'ended' / fail→'failed'）。
    //    ql-20260825-f6#4：onSessionEnd 入 per-session 终态通知链——若同会话有
    //    在飞的 onTurnResult（_onResult 的 await 窗口），本通知必排在其后，
    //    backend 侧顺序恒 result → end。
    //    ql-20260823-006：notifyBackend=false 供 restoreAndReconnect 驱逐内存
    //    残留条目用——backend 正推进 reconnecting→active，回发终态会与之竞态
    //    把刚要恢复的会话误翻 failed。
    if (opts.notifyBackend !== false) {
      await this._runNotifyChain(state.sessionId, () =>
        this.deps.onSessionEnd(
          state.sessionId,
          isManual ? 'ended' : 'failed',
        ),
      );
    }

    // 9. task-10：终态从落盘集合移除后 flush（不复活 ended/failed session）。
    this._scheduleFlush();

    // 10. ql-20260825-f3#1：终态延迟清理——到点删 _store + _pendingInjectCount 条目
    //     （含凭证 env / subagentDepth / inputQueue buffer 的 SessionState 不再永久
    //     滞留）。到点时条目若已被重建（状态非终态）则跳过；stop() 时 clearTimeout。
    this._scheduleTerminalCleanup(state.sessionId);
  }

  /**
   * ql-20260825-f3#1：安排终态条目延迟删除（幂等：同 session 已有待清理 timer
   * 不叠加——end→fail 重入、restore 驱逐后再 terminate 均复用同一 timer）。
   */
  private _scheduleTerminalCleanup(sessionId: string): void {
    if (this._terminalCleanupTimers.has(sessionId)) return;
    const timer = setTimeout(() => {
      this._terminalCleanupTimers.delete(sessionId);
      const current = this._store.get(sessionId);
      if (!current) return;
      // 重建守卫：restoreAndReconnect / create 重建的新条目（reconnecting/active/
      // running）不动。重建路径正常会先 _cancelTerminalCleanup，此处状态守卫兜底
      // 同 id 重建的时序竞态。
      if (current.status !== 'ended' && current.status !== 'failed') return;
      this._store.delete(sessionId);
      this._pendingInjectCount.delete(sessionId);
    }, SessionManager.TERMINAL_CLEANUP_DELAY_MS);
    // node 标准：定时器不阻塞 daemon 退出。
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this._terminalCleanupTimers.set(sessionId, timer);
  }

  /**
   * ql-20260825-f3#1：取消终态延迟清理（restoreAndReconnect / create 重建同 id
   * 条目时调用，防到点误删新条目——时间窗内新条目可能恰好又进入终态，但那次
   * terminate 会重新 schedule，语义不受影响）。
   */
  private _cancelTerminalCleanup(sessionId: string): void {
    const timer = this._terminalCleanupTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this._terminalCleanupTimers.delete(sessionId);
    }
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

  /**
   * task-01（2026-08-29-daemon-selfupdate-safety / FR-01 / D-001@v1）：是否存在
   * 进行中的 interactive turn——任一 session ``status === 'running'`` 即 true。
   *
   * 空闲屏障的忙判定查询口，供 daemon 升级编排器（tryUpdate，task-04）判定是否
   * 推迟升级。口径仅 'running' 算忙：'active'（空闲可接 inject）/ 'reconnecting'
   * 可经挂起/恢复链路无损穿越升级窗口；'ended'/'failed' 终态延迟清理残留条目
   * （_terminalCleanupTimers 窗口内，见 ql-20260825-f3#1）同样不算。遍历口径照
   * create 内活会话计数先例（本文件 for..of _store.values()）。
   *
   * quick-bfec20a6 例外臂：stale-flip 宽限窗内（active + currentRunId 仍在 +
   * staleRunResetAt 新鲜，见 _withinStaleFlipGrace）也算忙——等 AskUserQuestion
   * 作答等安静长 turn 被 >60s 启发式误翻 active 后，忙屏障若只认 running 会放行
   * 自更新重启杀掉活轮（事故会话 e148364e，12:39 daemon 自更新重启杀等答轮）。
   * 正常 result 收尾清 currentRunId，active+currentRunId ⟺ stale-flip 态；窗口
   * 有界（60min），真死 turn 不会永久阻塞升级。
   *
   * 零副作用纯查询：不修改 _store 生命周期、不触发挂起/取消。
   */
  hasRunningTurn(): boolean {
    for (const state of this._store.values()) {
      if (state.status === 'running') return true;
      if (this._withinStaleFlipGrace(state)) return true;
    }
    return false;
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
      // task-06（D-007@v2）：主 agent stage 持久化（恢复后重新注入 MCP tool）。
      // 仅 stage 非空时写（普通 scan/stage/chat session 不写，恢复后不注入 MCP）。
      if (state.stage) {
        rec.stage = state.stage;
      }
      // task-04（design §5.C / Grill M3）：分身深度保档——非 undefined 才写
      //（0 合法）；缺键（旧 lease / 主控 / 普通会话）不落盘，恢复后 undefined
      // 穿透不伪造默认值（防重启后非叶分身静默降级叶档）。
      if (state.worker_depth !== undefined) {
        rec.worker_depth = state.worker_depth;
      }
      // task-10（C-12）：profile 字段持久化（恢复后重新过滤 MCP / 写守卫继续收紧）。
      // 仅对应字段非 undefined 时写（profile=None 的 session 不写，FR-15）。
      if (state.mcpRefs !== undefined) {
        rec.mcpRefs = state.mcpRefs;
      }
      if (state.skillRefs !== undefined) {
        rec.skillRefs = state.skillRefs;
      }
      if (state.effectiveAllowedRoots !== undefined) {
        rec.effectiveAllowedRoots = state.effectiveAllowedRoots;
      }
      // task-08（2026-08-14-sessions-portal / design §5 Wave2）：会话级配置快照落盘，
      // daemon 重启 resume 不丢配置。systemPrompt 补齐 task-05 预留的 record 字段
      // （restoreAndReconnect 早已读 record.systemPrompt，此处补写闭合链路）；
      // providerConfig 非 null 才写（null=本机默认=缺省语义等价，design §9 容错）。
      if (state.systemPrompt !== undefined) {
        rec.systemPrompt = state.systemPrompt;
      }
      if (state.providerConfig != null) {
        rec.providerConfig = state.providerConfig;
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
   *   0. ql-20260823-006：store 已有同 id 残留条目（backend 未通知 SESSION_END
   *      的活僵尸 / end() 留下的终态条目）→ 先静默驱逐（_terminateSession 全套
   *      清理，notifyBackend=false），不再抛 SessionAlreadyExistsError。
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
    // ql-20260823-006：内存残留条目不再拒绝恢复。旧行为（_store.has() 即抛
    // SessionAlreadyExistsError）让两类残留把 reopen 打成死循环：① backend 翻
    // 终态但未通知 SESSION_END 的活僵尸（2026-08-23 会话 bdec91a4 事故，4 次
    // reopen 全撞死）；② end()/fail() 收口留下的终态条目（_terminateSession 不
    // 删 store）。backend 下发 SESSION_RESUME 本身就断言 daemon 侧副本已死，
    // 这里先静默驱逐（terminate 清理链全套但不回发 onSessionEnd——backend 正
    // 推进 reconnecting→active，回发终态会与之竞态误翻 failed），再走正常恢复。
    const stale = this._store.get(record.sessionId);
    if (stale) {
      // ql-20260831-001-6dde：活会话守卫——本地仍在跑 turn（status=running）或
      // 有待处理输入（附件下载中，pendingInjectCount>0）时拒绝驱逐重建：驱逐
      // 会 terminate 在途 driver，正在执行的 agent 工作被静默杀掉。恢复链
      // 触发瞬间的忙检只覆盖当时；恢复在途期间新起的 turn 只能靠本守卫兜底
      //（调用方按 SESSION_BUSY 重试/跳过）。终态/空闲条目不受影响，维持
      // ql-20260823-006 的静默驱逐语义。检查与 terminate 调用之间无 await，
      // 单线程事件循环下无 TOCTOU。
      // ql-20260831-008：守卫只护「同 lease」的在途工作——SESSION_RESUME /
      // reopen 记录带的必是 backend rotate 后的新 lease（backend reopen_session
      // 恒建新 lease 并以新 lease_id 下发；claim_token 亦重置，防旧 claim 重放），
      // 与本地条目 lease 不一致即旧 lease 已被 backend 判死的僵尸（ql-20260823-006
      // 事故形态：内存仍 running 但其 turn 结果永远不再被收），在途工作属孤儿，
      // 维持静默驱逐；lease 一致才可能是恢复在途期间新起的真 turn（inject 随新
      // lease 下发），抛 SessionBusyError 交调用方重试/跳过。
      const sameLease = stale.leaseId === record.leaseId;
      if (
        sameLease &&
        (stale.status === 'running' ||
          (this._pendingInjectCount.get(stale.sessionId) ?? 0) > 0)
      ) {
        throw new SessionBusyError(stale.sessionId, stale.status);
      }
      await this._terminateSession(stale, 'driver_error', { notifyBackend: false });
      this._store.delete(record.sessionId);
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
      // task-08：同 create——depth 已下沉归一化器，恒空 Map 仅满足形状。
      subagentDepth: new Map(),
      // task-06：恢复主 agent stage（重新注入 MCP tool 用）。
      stage: record.stage,
      // task-04：恢复分身深度（snapshot 保档链，M3——非叶不静默降级叶档）。
      // 旧 sessions.json 无此字段 → undefined 穿透（档位判定归 task-05）。
      worker_depth: record.worker_depth,
      // task-10（C-12）：恢复 profile 字段（mcpRefs 重新过滤主 agent MCP；skillRefs
      // 承载；effectiveAllowedRoots 写守卫继续收紧）。undefined → 不写键（FR-15）。
      ...(record.mcpRefs !== undefined ? { mcpRefs: record.mcpRefs } : {}),
      ...(record.skillRefs !== undefined ? { skillRefs: record.skillRefs } : {}),
      ...(record.effectiveAllowedRoots !== undefined
        ? { effectiveAllowedRoots: record.effectiveAllowedRoots }
        : {}),
      // task-05：恢复 profile.system_prompt（resume 时重新注入 systemPrompt preset+append）。
      ...(record.systemPrompt !== undefined ? { systemPrompt: record.systemPrompt } : {}),
      // task-08（2026-08-14-sessions-portal）：恢复会话级供应商配置（design §5 Wave2
      // 重启不丢配置）。旧 sessions.json 无此字段 → 缺省容错（undefined，恢复走本机
      // 凭证链，design §9 零回归）。
      ...(record.providerConfig !== undefined
        ? { providerConfig: record.providerConfig }
        : {}),
    };
    this._store.set(state.sessionId, state);
    // ql-20260825-f3#1：重建条目取消上方驱逐可能遗留的终态延迟清理 timer（驱逐
    // 的 _terminateSession 会 schedule，若不取消，timer 到点时新条目虽因状态守卫
    // 不被删，但守卫前提是状态非终态——显式取消消除对时序的依赖）。
    this._cancelTerminalCleanup(state.sessionId);

    try {
      // task-02（R7）：复用 _buildDriverOptions（含 canUseTool/onUserDialog 注入，
      // 与 create 对齐，FR-10 行为不变）。resume = agentSessionId（Codex thread id / Claude session_id）。
      // task-06（D-007@v2）：主 agent session 恢复后仍需重新注入 MCP tool（让主 agent
      // discover daemon MCP server 5 tool）。从 record 归一化 ctx 调同一 _resolveMainAgentMcp，
      // 与 create 路径单一来源；普通会话返回 undefined 不注入（零回归）。
      const mainAgentMcp = this._resolveMainAgentMcp({
        sessionId: record.sessionId,
        leaseId: record.leaseId,
        provider: record.provider,
        cwd: record.cwd,
        model: record.model,
        stage: record.stage,
        // task-04：恢复时分身深度随 ctx 传入（保档，谓词/provider 分档判定归 task-05）。
        worker_depth: record.worker_depth,
        // task-10（C-12）：恢复时重新按 profile.mcpRefs 过滤主 agent MCP 注入。
        mcpRefs: record.mcpRefs,
        skillRefs: record.skillRefs,
        effectiveAllowedRoots: record.effectiveAllowedRoots,
      });
      // ql-20260822-009：resume 的 CLAUDE_CONFIG_DIR 按 transcript 实际位置判定
      // （claude-transcript-dir 单一来源）。历史两轮修复的语义都保留：
      //   - 隔离目录有 jsonl（create 带供应商 / ql-20260807-002 停止供应商场景）
      //     → 仍强制隔离，防「重启 daemon 后 active session 变 ended」回归；
      //   - 仅宿主机 ~/.claude 有 jsonl（create 未配供应商，ql-20260729-002 不隔离）
      //     → 删除 env 让 claude 回 ~/.claude 找——原先无条件强制隔离导致 resume
      //     找不到 jsonl → claude 报错退出 → fail → 会话被打回 ended（重开失效）。
      // 恢复路径 provider_config：task-08（sessions-portal）起 sessions.json 落盘会话级
      // 供应商配置快照——重启 resume 不丢配置（design §5 Wave2）。旧 sessions.json 无
      // 该字段（undefined）→ 第 0 层自然跳过（本机凭证链，零回归）；凭证靠 process.env
      // （与 create 同源）+ credentials.json（层 2，若有）。
      const restoreCredential: SpawnCredentialManager = this._credentialManager ?? {
        get: () => undefined,
        buildEnv: () => ({}),
      };
      const restoreEnv = buildSpawnEnv(
        {
          provider_config: state.providerConfig ?? undefined,
          // task-02（2026-08-23-agent-activity-sessions / D-008）：restore 从零重建
          // env（不回放 state.env，Grill P1-4）→ 平台会话身份须重注入。
          // state.sessionId 是平台 agent_sessions.id（注意区别于 agent 侧 resume
          // key state.agentSessionId——后者是 SDK jsonl 恢复键，非平台身份）。
          agentSessionId: state.sessionId,
        },
        { credential: restoreCredential },
      );
      // ql-20260822-001：home 会话带供应商 → 先迁移 jsonl 到隔离目录，让下方
      // applyTranscriptConfigDir 命中 isolated 回隔离 env（daemon 重启自愈：
      // 迁移前的存量 home 会话在此补迁移）。仅回 home 会把 claude 暴露给用户
      // ~/.claude/settings.json，其 env 块优先于进程注入的供应商 env → 流量串
      // 本机网关。无供应商（本机凭证链）不迁移；迁移失败降级 home（R-01）。
      if (
        state.providerConfig != null &&
        state.provider === 'claude' &&
        state.agentSessionId
      ) {
        // ql-20260825-f3#5：迁移已异步化（同步 copyFileSync 阻塞事件循环）。
        await migrateClaudeTranscriptToIsolated(state.agentSessionId, this._resumeDirs);
      }
      await applyTranscriptConfigDir(
        restoreEnv,
        state.agentSessionId,
        this._resumeDirs,
      );
      const driverOpts = this._buildDriverOptions(state, {
        exePath: exe,
        model: record.model,
        env: restoreEnv,
        enableApproval: restoreManualApproval,
        effectiveAskUserOnly: restoreAskUserOnly,
        resume: record.agentSessionId, // spike D3 跨进程 resume。
        mcpServers: mainAgentMcp,
        systemPrompt: state.systemPrompt, // task-05：resume 重注入 systemPrompt preset+append
      });
      // task-02（D-001）：用归属 driver，按 provider 写句柄。
      const handleOrQuery = (await driver.start(
        inputQueue,
        driverOpts as unknown as Parameters<InteractiveDriver['start']>[1],
      )) as unknown;
      if (record.provider === 'claude') {
        state.query = handleOrQuery as SessionState['query'];
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
   * ql-20260831-003-3c87：不刷新 lastActiveAt——恢复（重启恢复 / SESSION_RESUME）
   * 是系统动作非用户活动；刷成 now 会击穿 create 闸「30 分钟窗口」真活跃口径
   * （2026-08-26 P0 语义），daemon 重启后 30 分钟内满额必拒新会话（实机 21
   * active >= 20 max 实证）。活跃时间由真实用户活动路径维护（inject/_onResult/
   * interrupt/reload）。
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
    this._scheduleFlush();
  }

  /**
   * task-07（provider-switch-live-session / D-002@v1）：标记待处理的供应商热切换。
   *
   * backend set/unset_default → WS PROVIDER_CONFIG_CHANGED → daemon 分发调本方法：
   *   - session 空闲（status=active 且无 currentRunId）→ 立即 fire-and-forget
   *     ``reloadWithProvider``，**不**写 pendingSwitch 标记（无需等 turn 边界）。
   *   - session 生成中（status=running，turn in-flight）/ reconnecting 等 → 仅覆盖写
   *     ``state.pendingSwitch``，**严格不中断**当前 turn；turn 收尾（``_onResult``）
   *     检测到标记后清标记并触发 reload（D-002@v1 等 turn 边界语义）。
   *
   * 幂等：WS 重放同一/不同切换均覆盖写 state.pendingSwitch，不累积（design R-02）。
   * 同步返回（void）：reload 走 fire-and-forget，不阻塞 WS 分发路径。
   *
   * @param sessionId 目标会话
   * @param providerConfig 新供应商配置；null 表示停止（回退本机凭证，D-004@v1）
   * @throws {SessionNotFoundError} session 不存在
   */
  markPendingSwitch(sessionId: string, providerConfig: ProviderConfig | null): void {
    const state = this._store.get(sessionId);
    if (!state) {
      throw new SessionNotFoundError(sessionId);
    }
    // 空闲：无在跑 turn（status=active 且 currentRunId 空）→ 立即 reload，不写标记。
    if (state.status === 'active' && !state.currentRunId) {
      void this.reloadWithProvider(sessionId, providerConfig).catch((err) => {
        // reload 失败保留旧 query 不破坏会话（design §5 Wave3 / R-01）。
        // ql-20260825-f3#2：静默吞错曾让「切换 toast 成功但实际没生效」无从排查
        //（config switch 路径 ql-20260818-002 同款教训）——必须留 error 日志。
        // eslint-disable-next-line no-console
        console.error(
          '[session-manager] idle provider switch reload failed',
          sessionId,
          err,
        );
      });
      return;
    }
    // 生成中 / reconnecting：仅覆盖写标记，不中断当前 turn（constraints）。
    // 覆盖写幂等（WS 重放安全，不累积）。
    state.pendingSwitch = { providerConfig };
  }

  /**
   * task-07（provider-switch-live-session / D-002@v1）：用新供应商凭证受控重启
   * claude 子进程并 resume 对话历史（保留完整上下文，design G1/G2）。
   *
   * 真实方法体由 **task-08 实现**（参考现有 ``restoreAndReconnect``：close 旧 query
   * → buildSpawnEnv(providerConfig) 构造新 env（null 时第 0 层跳过 → 本机凭证）→
   * driver.start({ resume: state.agentSessionId, env, ...原 opts }) 从 jsonl 重新
   * 加载对话历史 → 替换 state.query/state.env → 重启 consume 协程）。
   *
   * 步骤（design §5 Wave3 + constraints）：
   *   ① ``handle.close?.()`` 优雅终止旧子进程（走 SDK kill 链：close → stdin EOF →
   *      2s 宽限 → SIGTERM → 5s → SIGKILL），与 ``_terminateSession`` 同源 close 入口；
   *      **不**调 ``_terminateSession``（那是终态收口会 onSessionEnd + 改 status + close
   *      InputQueue），reload 仅重启子进程，session 仍 active 可续轮。**不 close
   *      InputQueue**（复用同一队列给新 driver.start，reload 短窗口内 inject 走排队语义）。
   *   ② ``buildSpawnEnv({ provider_config }, { credential })`` 构造新 env：
   *      provider_config 非 null → 第 0 层 injector 产 ANTHROPIC_* env 盖过下层 +
   *      隔离 CLAUDE_CONFIG_DIR；null → 第 0 层跳过 + 不隔离 CLAUDE_CONFIG_DIR（回退
   *      本机 ~/.claude/settings.json，D-004@v1 停止场景对称覆盖）。credential 缺失
   *      （未注入 / 测试）用 noopCredential（对齐 daemon.ts:3050 同款 fallback）。
   *   ③ 校验 ``state.agentSessionId`` 必需——它是 SDK jsonl 恢复 key（首 turn system/init
   *      写入），缺失说明首 turn 未完成 → 无可恢复 jsonl → 抛错（不启动新会话替换语义）。
   *   ④ ``_buildDriverOptions`` 透传 cwd / canUseTool / mcpServers / permissionMode +
   *      ``resume: state.agentSessionId`` + 新 env（原 opts 透传；model/allowedTools 不在
   *      SessionState 仅 CreateSessionInput/PersistedSessionRecord 持有，reload 不传 → SDK
   *      走 env 默认，reload 场景 env 已含 ANTHROPIC_DEFAULT_*_MODEL 等）。
   *   ⑤ ``await driver.start(state.inputQueue, driverOpts)`` —— SDK spawn 新 claude 子进程
   *      并从 ``~/.claude/projects/<encoded-cwd>/<sid>.jsonl`` 重载完整对话历史。复用
   *      ``state.inputQueue``（reload 不 close 队列，新 query 订阅同一队列吃后续 inject）。
   *   ⑥ 替换 ``state.query``（claude）/ ``state.driverHandle``（codex，本任务未支持）+
   *      ``state.env``，重启 ``_runConsume`` 协程，清 ``state.pendingSwitch``（幂等兜底：
   *      markPendingSwitch 空闲路径不写标记 / _onResult 路径已清，此处防状态机遗漏）。
   *   ⑦ reload 失败（spawn 失败 / jsonl 缺失 / cwd 不一致）→ catch 回滚保留旧 query/env
   *      + ``console.error`` 上报 + **重新抛**（调用方 markPendingSwitch / _onResult 的
   *      ``.catch`` 兜底已吞错防 unhandled rejection）。**不破坏会话**（R-01 降级）：
   *      不改 status、不从 store 移除、不清 pendingSwitch（留待重试或人工介入）。
   *
   * **reload 与 inject 并发**（待细化点① 收口，不引入新锁）：reload 期间 status 保持
   * active（markPendingSwitch 空闲路径 + _onResult 收尾后触发都满足此条件），inject
   * 走 ``state.inputQueue.push`` 不拒绝（spike S1 turn 级串行）；新 query 启动后从队列
   * 消费后续 inject，不丢消息。若 inject 在 reload step⑤ await 期间到达，push 进队列
   * 后由新 query 启动后立即消费（自然排队，无需 _pendingInjectCount 计数——counter 仅
   * 在 status=running 时递增做可观察性，reload 期间 status=active 不递增但消息不丢）。
   *
   * @param sessionId 目标会话
   * @param providerConfig 新供应商配置；null 表示停止（回退本机凭证，第 0 层 env 跳过）
   * @throws {SessionNotFoundError} session 不存在
   * @throws {Error} provider 非 claude（codex reload 未支持）/ agentSessionId 缺失 /
   *         spawn 失败 / jsonl 缺失 / cwd 不一致（catch 回滚保留旧 query 后重新抛）
   */
  async reloadWithProvider(
    sessionId: string,
    providerConfig: ProviderConfig | null,
  ): Promise<void> {
    const state = this._store.get(sessionId);
    if (!state) {
      throw new SessionNotFoundError(sessionId);
    }
    // task-08：仅 claude provider 支持（既有契约零语义漂移，回归测试锁死）。
    // codex 的配置切换走 reloadWithConfig（内核支持 codex，只切配置不注人格）。
    // 不抛 UnsupportedProviderError（那是 driver 注册缺失语义）；用普通 Error 上报。
    if (state.provider !== 'claude') {
      throw new Error(
        `reloadWithProvider: provider ${state.provider} not yet supported (session ${sessionId})`,
      );
    }
    // 共享 reload 内核：行为与重构前内联实现逐字节等价（provider_config null/非 null
    // env 构造、agentSessionId 守卫、resetForResubscribe、close 后置、失败回滚）。
    await this._reloadSession(sessionId, { providerConfig });
  }

  // ── task-08（2026-08-14-sessions-portal / FR-05 / D-012@v1）：会话级配置热切换 ──

  /**
   * task-08（design §7.3 / FR-05 / D-012@v1）：标记待处理的会话级配置切换。
   *
   * backend inject_session（带新配置 + prompt）→ WS SESSION_SWITCH_CONFIG
   * （daemon.ts 路由归 task-09）→ 本方法：
   *   - session 空闲（status=active 且无 currentRunId）→ 立即 fire-and-forget
   *     ``reloadWithConfig``，不写 pendingConfigSwitch 标记（无需等 turn 边界）。
   *   - session 生成中（status=running，turn in-flight）/ reconnecting 等 → 仅覆盖写
   *     ``state.pendingConfigSwitch``，严格不中断当前 turn；turn 收尾（``_onResult``）
   *     检测到标记后清标记并触发 reload（等 turn 边界语义，对齐 markPendingSwitch）。
   *
   * 幂等：WS 重放同一/不同切换均覆盖写，不累积。同步返回（void）：reload 走
   * fire-and-forget，不阻塞 WS 分发路径（task-09 daemon.ts 同款消费姿势）。
   *
   * @throws {SessionNotFoundError} session 不存在
   */
  markPendingConfigSwitch(
    sessionId: string,
    payload: SessionSwitchConfigPayload,
  ): void {
    const state = this._store.get(sessionId);
    if (!state) {
      throw new SessionNotFoundError(sessionId);
    }
    // 空闲：无在跑 turn → 立即 reload + 喂切换轮 prompt，不写标记。
    if (state.status === 'active' && !state.currentRunId) {
      void this.reloadWithConfig(sessionId, payload).catch((err) => {
        // reload 失败保留旧 query 不破坏会话（R-01）。
        // ql-20260818-002：静默吞错曾致「切换 toast 成功但实际没生效」无从排查
        // ——必须留 error 日志（真实 log 在 daemon 层，此处 console 兜底同款惯例）。
        console.error(
          '[session-manager] idle config switch reload failed',
          sessionId,
          err,
        );
      });
      return;
    }
    // 生成中 / reconnecting：仅覆盖写标记，不中断当前 turn。覆盖写幂等（WS 重放安全）。
    state.pendingConfigSwitch = { payload };
  }

  /**
   * task-08（design §7.3 / FR-05 / D-012@v1）：会话内配置热切换——关旧 query →
   * 按 payload 重建 driverOpts（新 systemPrompt / providerConfig）→ ``driver.start
   * ({resume})`` 从 jsonl 重载历史 → 喂入切换轮 prompt。
   *
   * payload 语义（design §7.2）：
   *   - ``profile`` 非 null → 切档案：state.systemPrompt/mcpRefs/skillRefs 更新为
   *     payload 值（systemPrompt 仅 claude 注入 preset+append；codex 只切配置不注
   *     人格，原 D-003 / NG-02）；null → 不切档案（保留现值）。
   *   - ``providerConfig`` 非 null → 切供应商；**null → 切回本机默认**（清掉
   *     state.providerConfig，第 0 层 env 跳过；ql-20260824-016 修正——原「null=
   *     不切」语义与后端契约冲突：service.py 切回本机时正是下发 null，?? 塌缩导致
   *     旧供应商 env 永远清不掉）；undefined（字段缺席）→ 不切（保持现值，
   *     reloadWithProvider(null) 的「停止」与显式 null 同为切本机）。
   *   - ``claimToken`` 非空 → 刷新 state.claimToken（切换轮新 token）。
   *   - ``prompt`` 非空 → reload 成功后 push 进 inputQueue + currentRunId=runId +
   *     status=running（对齐 inject 语义，onTurnMessage/onTurnResult 据此路由）。
   *
   * 失败不破坏会话（R-01）：内核回滚旧 query/env/config，session 维持原状（constraints：
   * 切换不改会话状态机——成功路径 status 由「喂 prompt」推进到 running，属正常 turn）。
   *
   * @throws {SessionNotFoundError} session 不存在
   * @throws {SessionNotActiveError} session 已 ended/failed（终态不可切）
   * @throws {Error} agentSessionId 缺失 / spawn 失败（回滚保留旧 query 后重新抛）
   */
  async reloadWithConfig(
    sessionId: string,
    payload: SessionSwitchConfigPayload,
  ): Promise<void> {
    const state = this._store.get(sessionId);
    if (!state) {
      throw new SessionNotFoundError(sessionId);
    }
    if (state.status === 'ended' || state.status === 'failed') {
      throw new SessionNotActiveError(sessionId, state.status);
    }
    // 切换轮 claim_token 刷新（对齐 refreshClaimToken 语义；空串不覆盖）。
    if (payload.claimToken) {
      state.claimToken = payload.claimToken;
    }
    // 计算生效配置（null = 切到无人格（内核清空）；undefined = 不参与保持现状）。
    // ql-20260818-009：取消档案 → backend 发空串 systemPrompt——仅清 system prompt
    // 不够：fork 继承的对话历史里有此前人格的角色扮演轮，模型会从上下文延续角色
    // （实测「取消后仍自称设计师」）。归一为**中和指令**（append 压掉历史角色惯性），
    // 而非 null（preset-only）。
    const nextSystemPrompt =
      payload.profile !== null && payload.profile !== undefined
        ? ((payload.profile.systemPrompt ?? '').trim()
            ? payload.profile.systemPrompt
            : CLEAR_PERSONA_PROMPT)
        : (state.systemPrompt ?? null);
    // ql-20260824-016：显式区分 undefined 与 null——后端切回本机默认下发
    // providerConfig:null，字段缺席才是「不切该维度」。原 ?? 写法把 null 塌缩成
    // 沿用 state.providerConfig（旧供应商），「切回本机」永不生效（实测切回后
    // /model 仍显示 glm-5.1、流量仍走旧供应商）。daemon.ts 路由层已同步保留
    // undefined/null 区别（不再 ?? null 归一）。
    const nextProviderConfig =
      payload.providerConfig !== undefined
        ? payload.providerConfig
        : (state.providerConfig ?? null);

    // ql-20260818-002/004：切档案（含取消）的 reload 走 forkSession（resume 时
    // systemPrompt 选项被 CLI 忽略，fork 新会话才生效）——置位 forkedInitPending
    // 让新 session_id 能经 system/init 更新 state（否则持久化旧 id 下次 resume
    // 回旧会话）。provider-only 切换不 fork（人格已在 jsonl 固化，resume 自然保留）。
    const profileSwitched = payload.profile != null;
    if (profileSwitched) {
      state.forkedInitPending = true;
    }

    await this._reloadSession(sessionId, {
      systemPrompt: nextSystemPrompt,
      providerConfig: nextProviderConfig,
      forkSession: profileSwitched,
    });

    // reload 成功：同步 profile 承载字段（mcpRefs/skillRefs 透传；systemPrompt 已由
    // 内核写入 state）。profile=null 不动（保留现值）。
    if (payload.profile) {
      state.mcpRefs = payload.profile.mcpRefs;
      state.skillRefs = payload.profile.skillRefs;
    }

    // 喂入切换轮 prompt（内核已 resetForResubscribe + 新 query 订阅同一 inputQueue）。
    if (payload.prompt) {
      state.inputQueue.push({ type: 'user', text: payload.prompt });
      state.currentRunId = payload.runId;
      state.status = 'running';
    }
    state.lastActiveAt = Date.now();
    this._scheduleFlush();
  }

  /**
   * task-08（design §5 Wave2 / Grill C-07）：共享 reload 内核——受控重启 driver
   * 子进程并 resume 对话历史。``reloadWithProvider``（供应商热切换）与
   * ``reloadWithConfig``（会话级配置热切换）复用，保留三次实战修复语义：
   * CLAUDE_CONFIG_DIR 隔离（ql-20260807-002）/ close 后置（ql-20260806-002）/
   * resetForResubscribe（ql-20260807-001 orphan consume 守卫配套）。
   *
   * 步骤（沿用原 reloadWithProvider 内联实现，零语义漂移）：
   *   ① 快照旧句柄/env/config 供失败回滚（R-01）。claude 句柄=state.query；
   *      codex=state.driverHandle（reloadWithConfig 的 Codex 路径：只切 providerConfig，
   *      不注人格——systemPrompt 仅 claude 消费，原 D-003 / NG-02）。
   *   ② ``buildSpawnEnv`` 构造新 env：provider_config 非 null → 第 0 层 injector 产
   *      ANTHROPIC_* env + 隔离 CLAUDE_CONFIG_DIR；null → 第 0 层跳过（本机凭证）。
   *      随后 ``applyTranscriptConfigDir`` 按 transcript 实际位置覆盖（ql-20260822-009）：
   *      jsonl 在隔离目录 → 强制隔离（ql-20260807-002 停供应商语义）；仅在宿主机
   *      ~/.claude → 不隔离（create 未配供应商的会话）；都没有 → 维持隔离默认。
   *   ③ 校验 ``state.agentSessionId`` 必需（SDK jsonl 恢复 key；缺失=首 turn 未完成
   *      → 无可恢复 jsonl → 抛错，不启动全新会话替换语义）。
   *   ④ ``_buildDriverOptions`` 透传 cwd / canUseTool / mcpServers / permissionMode +
   *      ``resume: state.agentSessionId`` + 新 env；``opts.systemPrompt`` 提供且
   *      provider=claude 时注入 systemPrompt preset+append（codex 忽略）。
   *   ⑤ ``state.inputQueue.resetForResubscribe()``（InputQueue 单订阅；不 reset 则新
   *      query 二次订阅抛 SessionQueueDoubleSubscribeError → session ended）+
   *      ``await driver.start(state.inputQueue, driverOpts)``。
   *   ⑥ 替换 state.query（claude）/ state.driverHandle（codex）+ state.env +
   *      state.providerConfig +（opts.systemPrompt 提供时）state.systemPrompt →
   *      **close 旧句柄**（必须在替换之后，ql-20260806-002）→ 清 pendingSwitch /
   *      pendingConfigSwitch（幂等兜底）→ 重启 consume 协程 → 排队 flush。
   *   ⑦ 失败（spawn 失败 / jsonl 缺失 / cwd 不一致）→ catch 回滚旧句柄/env/config +
   *      ``console.error`` + 重新抛（调用方 .catch 兜底已吞错）。不破坏会话
   *      （R-01 降级：不改 status、不从 store 移除）。
   *
   * @param sessionId 目标会话
   * @param opts.providerConfig 新供应商配置。undefined → 沿用 state.providerConfig
   *        现值（缺省 null）；null → 本机凭证（第 0 层跳过）。
   * @param opts.systemPrompt 新人格提示词。undefined → 不参与（reloadWithProvider
   *        既有路径，零语义漂移：不注入、不动 state）；string 且 provider=claude →
   *        注入 preset+append 并写 state.systemPrompt；null → 显式清空（切到无人格，
   *        不注入 + state.systemPrompt=undefined）。codex 任何值都不注入不写（原 D-003）。
   * @throws {SessionNotFoundError} session 不存在
   * @throws {Error} agentSessionId 缺失 / spawn 失败 / jsonl 缺失 / cwd 不一致
   */
  private async _reloadSession(
    sessionId: string,
    opts: {
      systemPrompt?: string | null;
      providerConfig?: ProviderConfig | null;
      /** ql-20260818-002/004：档案维度切换（含取消）→ fork 新会话使人格生效。 */
      forkSession?: boolean;
    },
  ): Promise<void> {
    // ql-20260825-f3#2：per-session 串行化（chain 模式）。等上一轮同会话 reload 完成
    // 再开始本轮核心段——上一轮失败不阻塞本轮（错误已由其调用方 .catch 记日志，
    // 这里只保证顺序），本轮失败照常向上抛给本调用方。state 查询移入核心段
    //（_reloadSessionNow）：排队期间 session 可能已被删（终态清理 / restore 驱逐），
    // 排队前查询会拿到陈旧 state 造成孤儿句柄。
    const prev = this._reloadChains.get(sessionId);
    const run = (
      prev ? prev.catch(() => undefined) : Promise.resolve()
    ).then(() => this._reloadSessionNow(sessionId, opts));
    // 链尾永不 reject：存入 Map 供下一轮 await（下一轮 .catch(() => undefined) 兜底，
    // 但 settled-with-rejection 的 promise 若无人 await 会在 Node 报 unhandled——
    // 直接吞掉再存，安全且语义等价）。
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this._reloadChains.set(sessionId, tail);
    void tail.then(() => {
      // 自愈摘除：本轮回 finish 且没有更新一轮入链时，删掉链尾（有更新一轮则保留，
      // 由那一轮负责删除——比较引用防误删后轮的 entry）。
      if (this._reloadChains.get(sessionId) === tail) {
        this._reloadChains.delete(sessionId);
      }
    });
    await run;
  }

  /** `_reloadSession` 的串行化核心段（由 chain 包装器保证同会话顺序执行）。 */
  private async _reloadSessionNow(
    sessionId: string,
    opts: {
      systemPrompt?: string | null;
      providerConfig?: ProviderConfig | null;
      /** ql-20260818-002/004：档案维度切换（含取消）→ fork 新会话使人格生效。 */
      forkSession?: boolean;
    },
  ): Promise<void> {
    const state = this._store.get(sessionId);
    if (!state) {
      throw new SessionNotFoundError(sessionId);
    }

    // 生效 provider_config：undefined=沿用会话当前配置（reloadWithConfig 不切供应商
    // 路径）；null=本机凭证（buildSpawnEnv 第 0 层跳过）。
    const providerConfig =
      opts.providerConfig !== undefined
        ? opts.providerConfig
        : (state.providerConfig ?? null);

    // 进入时快照旧句柄/env/config 供失败回滚（R-01）。句柄是引用，旧对象本身会被
    // close，但保留引用让 catch 区分「reload 失败 → 用旧引用占位，不 nil」。
    const oldHandle =
      state.provider === 'claude' ? state.query : state.driverHandle;
    const oldEnv = state.env;
    const oldProviderConfig = state.providerConfig;
    const oldSystemPrompt = state.systemPrompt;

    try {
      // ── buildSpawnEnv 构造新 env（provider_config null 时第 0 层跳过 → 本机凭证）──
      // credential 缺失（测试 / daemon 未注入）用 noopCredential：layer 2 token 读取
      // 自然跳过（get→undefined），layer 1 tool_config 渲染返回 {} ；layer 0 provider_config
      // 仍独立生效（对齐 daemon.ts:3050 同款 fallback，避免未注入 credentialManager 时
      // reload 第 0 层失效）。provider_config null/undefined 均走 layer 0 跳过路径。
      const credential: SpawnCredentialManager = this._credentialManager ?? {
        get: () => undefined,
        buildEnv: () => ({}),
      };
      const newEnv = buildSpawnEnv(
        {
          provider_config: providerConfig ?? undefined,
          // task-02（2026-08-23-agent-activity-sessions / D-008）：reload 与 restore
          // 同理从零重建 env → SILLYHUB_SESSION_ID 用 state.sessionId（平台会话 id，
          // 非 agent 侧 resume key）重注入，切供应商/人格后 CLI 上报身份不丢。
          agentSessionId: state.sessionId,
        },
        { credential },
      );
      // ql-20260822-009：reload 的 CLAUDE_CONFIG_DIR 同样按 transcript 实际位置判定
      // （claude-transcript-dir 单一来源，与 restoreAndReconnect 对称）。ql-20260807-002
      // 语义保留：jsonl 在 daemon 隔离目录（create 带供应商 / 停止供应商前创建）→ 仍
      // 强制隔离，防新 claude resume 找不到 jsonl → onError → fail → session ended。
      // 新增：jsonl 仅在宿主机 ~/.claude（create 未配供应商）→ 不隔离，回 ~/.claude 找。
      // 凭证靠 env token（层 2 credentials.json）+ daemon settings.json。
      // ql-20260822-001：home 会话切供应商（provider_config 非空）→ 先迁移 jsonl
      // 到隔离目录，让 applyTranscriptConfigDir 命中 isolated 回隔离 env。仅回
      // home 会把 claude 暴露给用户 ~/.claude/settings.json，其 env 块
      //（cc-switch）优先于进程注入的供应商 env，切了供应商流量仍串本机网关
      //（E2E 实锤 BigModel 400[1214]）。迁移失败降级 home（会话可用，R-01）。
      // ql-20260824-016：对称补反向——切回本机默认（null）迁移 jsonl 回宿主机
      // ~/.claude。否则隔离目录命中 → 强制隔离 env → claude 读不到本机
      // settings.json（cc-switch / OpenCode Go），「本机默认」名不副实（原注释
      // 「不迁移」的假设只对 jsonl 本就在 home 的会话成立）。迁移失败降级
      // isolated resume（会话可用，R-01 同款）。
      if (
        providerConfig != null &&
        state.provider === 'claude' &&
        state.agentSessionId
      ) {
        // ql-20260825-f3#5：迁移已异步化（同步 copyFileSync 阻塞事件循环）。
        await migrateClaudeTranscriptToIsolated(state.agentSessionId, this._resumeDirs);
      } else if (
        providerConfig == null &&
        state.provider === 'claude' &&
        state.agentSessionId
      ) {
        await migrateClaudeTranscriptToHost(state.agentSessionId, this._resumeDirs);
      }
      await applyTranscriptConfigDir(
        newEnv,
        state.agentSessionId,
        this._resumeDirs,
      );

      // ── ③ 校验 resume key 必需 ──
      // agentSessionId 来自首 turn system/init（Claude）或 thread_started（Codex），
      // 是 SDK jsonl 恢复 key。缺失说明首 turn 未完成，无可恢复 jsonl → 拒绝 reload
      //（避免 SDK 拿空 resume 启动全新会话替换语义——那是 end + create 流程，不是 reload）。
      if (!state.agentSessionId) {
        throw new Error(
          `_reloadSession: missing agentSessionId (session ${sessionId} 首 turn system/init 未完成,无 jsonl 可 resume)`,
        );
      }

      // ── ④ _buildDriverOptions 构造 driverOpts（透传 cwd / canUseTool / mcpServers / resume / env）──
      const driver = state.driver ?? this._drivers.claude;
      if (!driver) {
        throw new Error(
          `_reloadSession: no driver available (session ${sessionId})`,
        );
      }
      const exePath =
        state.pathToAgentExecutable ?? state.pathToClaudeCodeExecutable ?? '';
      // 主 agent MCP 重新解析（create / restoreAndReconnect 同款路径，单一来源）。
      // MainAgentMcpContext 字段从 state 归一化提取（model 不在 state，省略 → ctx.model
      // undefined → 谓词/provider 自行 fallback）。
      const mainAgentMcp = this._resolveMainAgentMcp({
        sessionId: state.sessionId,
        leaseId: state.leaseId,
        provider: state.provider,
        cwd: state.cwd,
        ...(state.stage !== undefined ? { stage: state.stage } : {}),
        // task-04：reload（人格/供应商热切换重建 query）时分身深度随 ctx 补字段，
        // 保持 create / restore / reload 三路同一归一化口径（分档判定归 task-05）。
        ...(state.worker_depth !== undefined ? { worker_depth: state.worker_depth } : {}),
        ...(state.mcpRefs !== undefined ? { mcpRefs: state.mcpRefs } : {}),
        ...(state.skillRefs !== undefined ? { skillRefs: state.skillRefs } : {}),
        ...(state.effectiveAllowedRoots !== undefined
          ? { effectiveAllowedRoots: state.effectiveAllowedRoots }
          : {}),
        ...(state.systemPrompt !== undefined ? { systemPrompt: state.systemPrompt } : {}),
      });
      const driverOpts = this._buildDriverOptions(state, {
        exePath,
        env: newEnv,
        enableApproval: state.manualApproval ?? false,
        effectiveAskUserOnly: state.askUserOnly ?? false,
        resume: state.agentSessionId,
        mcpServers: mainAgentMcp,
        // task-08：会话级配置切换路径注入新人格（claude preset+append；codex 忽略——
        // provider!==claude 时不传，Codex 只切配置不注人格，原 D-003 / NG-02）。
        // undefined（reloadWithProvider 既有路径）→ 不传 → 与重构前行为逐字节一致。
        // ql-20260818-004：null（取消档案）也传——preset-only 即无人格。
        ...(state.provider === 'claude' && opts.systemPrompt !== undefined
          ? { systemPrompt: opts.systemPrompt }
          : {}),
        // ql-20260818-002/004：档案维度切换 → fork（resume 下人格仅对 fork 生效）。
        ...(opts.forkSession === true ? { forkSession: true } : {}),
      });

      // ── ⑤ driver.start(state.inputQueue, driverOpts) → 新句柄 ──
      // SDK spawn 新子进程并从 ~/.claude/projects/<encoded-cwd>/<sid>.jsonl
      // 重载完整对话历史（非内存态；jsonl 由 SDK 自动持久化）。复用 state.inputQueue
      //（reload 不 close 队列；新 query 订阅同一队列吃后续 inject，不丢消息）。
      // ql-20260807-002：reload 复用 inputQueue，但 InputQueue 单订阅（create 时 SDK 已
      // 订阅 _subscribed=true）。不 reset 则新 query 第二次订阅抛 SessionQueueDoubleSubscribeError
      // → SDK query abort（onError "Operation aborted"）→ fail → session ended（实测 reload
      // 后 ended 的真正根因，非 close 旧 query）。resetForResubscribe 重置订阅标记 + 清旧
      // waiter，保留 buffer（pending inject 不丢），让新 query 合法订阅同一队列。
      state.inputQueue.resetForResubscribe();
      const handleOrQuery = (await driver.start(
        state.inputQueue,
        driverOpts as unknown as Parameters<InteractiveDriver['start']>[1],
      )) as unknown;

      // ── ⑥ 替换句柄（claude=query / codex=driverHandle）+ env + config 快照 ──
      if (state.provider === 'claude') {
        state.query =
          handleOrQuery as NonNullable<SessionState['query']>;
      } else {
        state.driverHandle = handleOrQuery as InteractiveDriverHandle;
      }
      state.env = newEnv;
      state.providerConfig = providerConfig;
      // 仅 claude 写 state.systemPrompt（codex 人格不注入，原 D-003 / NG-02——payload
      // 对 codex 本就不带人格，防御性不写避免持久化快照携带无效配置）。
      // string → 写新值；null → 显式清空（切到无人格）；undefined → 不参与（零漂移）。
      if (state.provider === 'claude') {
        if (typeof opts.systemPrompt === 'string') {
          state.systemPrompt = opts.systemPrompt;
        } else if (opts.systemPrompt === null) {
          state.systemPrompt = undefined;
        }
      }
      state.lastActiveAt = Date.now();

      // ── close 旧句柄（ql-20260806-002：必须在替换为新句柄之后）──
      // 新句柄已就位、即将由 _runConsume 订阅；此时 close 旧句柄，旧 consume
      // for-await 退出是「正常 query 结束」而非 session 收尾，不触发 session ended。
      // 旧实现 close 在 driver.start 之前 → 新 query 未就位时旧 consume 退出 → session
      // 收尾 ended（实测 45723d1d/9eed466e reload 后 ended）。
      try {
        (oldHandle as unknown as { close?: () => void } | undefined)?.close?.();
      } catch {
        /* R-01: close 异常不阻塞（SDK 内部已有 SIGTERM→SIGKILL 升级兜底）。 */
      }
      // 清 pendingSwitch / pendingConfigSwitch（幂等兜底：markPendingSwitch /
      // markPendingConfigSwitch 空闲路径不写标记；_onResult 路径已清；此处防状态机
      // 遗漏的边界，多清一次无副作用）。
      state.pendingSwitch = undefined;
      state.pendingConfigSwitch = undefined;

      // 重启 consume 协程（void fire-and-forget；失败由 consume 内部 fail 路径收敛）。
      void this._runConsume(state);
      // 排队 flush（snapshotPersistable 落盘；env / providerConfig / systemPrompt 已替换）。
      this._scheduleFlush();
    } catch (err) {
      // ── ⑦ reload 失败保留旧句柄 + 上报错误，不破坏会话（R-01 降级）──
      // ql-20260806-002：driver.start 失败时 oldHandle 尚未 close（close 已移到替换
      // 之后），catch 保留的 oldHandle 仍可用，会话可真正恢复（旧 consume 继续）。
      // session 不从 store 移除、status 不改（避免 active→failed 硬降级）。
      if (state.provider === 'claude') {
        state.query = oldHandle as SessionState['query'];
      } else {
        state.driverHandle = oldHandle as InteractiveDriverHandle | undefined;
      }
      state.env = oldEnv;
      state.providerConfig = oldProviderConfig;
      state.systemPrompt = oldSystemPrompt;
      // eslint-disable-next-line no-console
      console.error(
        `[session-manager] _reloadSession failed (session=${sessionId}), 保留旧句柄降级`,
        err,
      );
      // 重新抛：调用方（markPendingSwitch / markPendingConfigSwitch / _onResult）均
      // .catch 兜底吞错，不会 unhandled。
      throw err;
    }
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
  private async _onResult(state: SessionState, result: InteractiveDriverResult): Promise<void> {
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
      // task-04（FR-01 / D-005@v1）：turn 失败时近源归类模型错误，挂到 result.modelError
      // 透传给 daemon.onTurnResult → notifyRunResult payload.error → backend error_detail。
      // - interactive 路径不经 stream-json adapter（claude-sdk-driver 直接消费 SDK），
      //   故在此归类（与批量 stream-json.ts:954 同源逻辑，输入用 result.result 文本）。
      // - 仅 is_error=true 调 classifier（成功路径不产出 ModelError，D-008 不回归）；
      //   classifier 对 is_error=true 恒返回非空 ModelError（claude 按规则，codex 兜底 unknown）。
      // - 挂载用 duck-type（对齐 _onMessage 挂 msg.depth 模式），daemon 侧 resultMeta 读取。
      const resultRecord = result as Record<string, unknown>;
      if (resultRecord['is_error'] === true) {
        const rawResult = resultRecord['result'];
        const resultText =
          typeof rawResult === 'string'
            ? rawResult
            : rawResult === undefined
              ? ''
              : JSON.stringify(rawResult);
        const subtype =
          typeof resultRecord['subtype'] === 'string'
            ? (resultRecord['subtype'] as string)
            : undefined;
        const modelError: ModelError | null = classifyModelError({
          agent: state.provider,
          isError: true,
          subtype,
          resultText,
        });
        if (modelError) {
          resultRecord['modelError'] = modelError;
        }
      }
      // ql-20260831-002（task-08 改造注）：轮末补发未 flush pendingUsage 的职责
      // 已随 partial 链下沉归一化器——ClaudeEventNormalizer 在 message_stop 消息
      // 边界 flush 残留缓冲（含最终 message_delta usage），driver 在 onTurnEnd 前
      // 已把整轮最后一次 usage 以事件送达（claude-events.ts _flushBucket 的
      // usage-only 分支），消息→result 顺序天然保持。daemon 侧不再补发。
      // ql-20260825-f6#4：onTurnResult 入 per-session 终态通知链——同会话后续的
      // onSessionEnd（end/fail 收口）必 await 在本通知之后，backend 侧顺序恒
      // result → end。settle 语义（含 rejection 向上抛）与直调一致。
      await this._runNotifyChain(state.sessionId, () =>
        this.deps.onTurnResult(state.sessionId, runId, result),
      );
    }
    // task-10：turn result 收尾后排队 flush（currentRunId 已清空）。
    this._scheduleFlush();
    // task-11（边界 7）注：completedSegments 跨 turn 重置已随 partial 链下沉归一化器
    //（driver 在 result 前调 normalizer.onTurnEnd，session-manager 不再持有桶）。
    // task-08（D-006 / D-009）：turn 收尾 budget 软切断检查点。放在 _onResult 主路径
    // 完成后（聚合 usage = base + 本轮各 parent 值，含子代理）。runId 用本 turn
    // 刚结束的（currentRunId 已清空，但 runId 局部变量仍持有）。
    if (runId) {
      this._checkBudgetCutoff(state, runId);
    }
    // task-08：turn 收尾折算 usage 台账（在 _checkBudgetCutoff **之后**——对齐旧
    // _shrinkSubagentBuffers 时序：预算聚合先看到本轮各 parent 值再合入 base，
    // 先折算会丢子代理 token 造成漏计）+ seq 补号计数器归零（替代旧 subagentDepth/
    // 子代理桶收缩——子代理 parent 条目随本轮表整体清空，无跨轮膨胀）。
    this._foldTurnUsage(state);
    // task-07（provider-switch-live-session / D-002@v1）：turn 边界检测 pendingSwitch。
    // 生成中 turn 收到切换时 markPendingSwitch 仅覆盖写 state.pendingSwitch 不中断；
    // 此处 turn 已收尾（status→active / currentRunId 清空），安全触发受控 reload。
    // 先取后清（幂等，防 _onResult 重入或 WS 重放叠加致双 reload）；fire-and-forget
    // reload（task-08 实现方法体：close 旧 query → 新 env → driver.start resume），
    // .catch 兜底吞错防 unhandled rejection（reload 失败保留旧 query 不破坏会话，R-01）。
    const pendingSwitch = state.pendingSwitch;
    if (pendingSwitch) {
      state.pendingSwitch = undefined;
      void this.reloadWithProvider(state.sessionId, pendingSwitch.providerConfig).catch(
        (err) => {
          // reload 失败保留旧 query 不破坏会话（R-01）；不阻塞 _onResult 收尾路径。
          // ql-20260825-f3#2：补 error 日志（原静默吞错，reload 失败无从排查）。
          // eslint-disable-next-line no-console
          console.error(
            '[session-manager] turn-boundary provider switch reload failed',
            state.sessionId,
            err,
          );
        },
      );
    }
    // task-08（2026-08-14-sessions-portal / D-012@v1）：turn 边界检测 pendingConfigSwitch。
    // 生成中 turn 收到 SESSION_SWITCH_CONFIG 时 markPendingConfigSwitch 仅覆盖写
    // state.pendingConfigSwitch 不中断；此处 turn 已收尾（status→active / currentRunId
    // 清空），安全触发受控 reload + 喂切换轮 prompt。先取后清（幂等，防 _onResult 重入
    // 或 WS 重放叠加致双 reload）；fire-and-forget（reloadWithConfig 内部调 _reloadSession
    // 失败回滚保留旧句柄，R-01），.catch 兜底吞错防 unhandled rejection。
    // 与 pendingSwitch 顺序：provider 级全局切换先收敛，再消费会话级配置切换（后者
    // reloadWithConfig 会按 state.providerConfig 现值重建 env，天然吸收前者结果）。
    const pendingConfigSwitch = state.pendingConfigSwitch;
    if (pendingConfigSwitch) {
      state.pendingConfigSwitch = undefined;
      void this.reloadWithConfig(
        state.sessionId,
        pendingConfigSwitch.payload,
      ).catch((err) => {
        // reload 失败保留旧句柄不破坏会话（R-01）。
        console.error(
          '[session-manager] turn-boundary config switch reload failed',
          state.sessionId,
          err,
        );
      });
    }
  }

  /**
   * task-08（2026-09-03-agent-provider-abstraction / FR-02 / D-002@v1）：onTurnMessage
   * 消费侧收口——输入 ``TurnMessageEnvelope{events}``（driver 归一化后的 AgentEvent
   * 批次，一帧 provider 消息可产 0..N 条），逐事件分发；SessionManager 不再解析
   * provider raw 消息形状（raw 依赖清零，envelope.raw 仅调试通道禁止依赖）。
   *
   * ── 对账表（R-02：旧 _onMessage 每类消费 → 新分发项一一映射）────────────
   * | # | 旧 _onMessage 消费（raw SDK 形状解析） | 新分发项（事件字段消费） |
   * |---|---|---|
   * | 1 | depth 计算 + assistant tool_use 预登记 subagentDepth + 挂 msg.depth | 下沉 ClaudeEventNormalizer（depth 状态机）；事件一等字段 depth 随 dict 透传（_eventToReportDict） |
   * | 2 | assistant tool_use=Bash → _runningBashCommands 注册 + emit bash_status(running) | status/bash_status 事件 → _emitSessionEvent（Bash 追踪/elapsed 归一化器内配对） |
   * | 3 | assistant tool_use=Enter/ExitPlanMode → emit plan_mode_entered | status/plan_mode 事件 → _emitSessionEvent（kind plan_mode_entered，summary 自 metadata） |
   * | 4 | assistant tool_use=Task/Agent → emit agent_task_status(running) + _agentToolUseMeta 登记 | status/agent_task_status → _emitSessionEvent；meta 登记改由 tool_use 事件（call_id 键 + args JSON 解析，_registerAgentToolUseMeta） |
   * | 5 | system/init → agentSessionId 提取（fork/子代理守卫）+ _scheduleFlush + 透传 | status/session_started → 同守卫提取 + 透传（backend resume 指针 pin，design §7.5） |
   * | 6 | codex flat thread_started → agentSessionId（resume key，只写一次） | codex driver 映射表 #1 已产 status/session_started → 与 #5 同分支统一消费 |
   * | 7 | stream_event / system:thinking_tokens partial 缓冲节流（500ms flush [THINKING]/[ASSISTANT]/[SYSTEM:thinking_tokens]） | 下沉归一化器（_bufferPartial/_flushBucket 节流 flush）；partial 以 is_partial+segment_id 事件直达本方法透传 |
   * | 8 | system/task_* 拦截 → _onBackgroundTaskSystemMessage（注册表/节流/唤醒/[TASK_*] 行） | status/agent_task_status + status/task_notification → _handleAgentTaskStatusEvent / _handleTaskNotificationEvent（语义不变，输入改事件 metadata） |
   * | 9 | 完整 assistant → 清 partial buffer + emit [*_OVERRIDE] 撤回信号 + 透传 | 下沉归一化器（override:true + segment_id 事件原位替换，D-004@v1）；SessionManager 仅透传 |
   * |10 | user tool_result 配对 Bash 终态 → bash_chunk(终块) + bash_status(completed/failed) | 归一化器（runningBash 配对）→ status/bash_chunk + status/bash_status 事件 → _emitSessionEvent |
   * |11 | user tool_result 异步回执（"Async agent launched successfully"）→ _registerAsyncReceiptTask 兜底 | tool_result 事件 content 扫描 + call_id 关联 → _maybeRegisterAsyncReceipt |
   * |12 | 尾部默认 onTurnMessage 透传（currentRunId 守卫） | 内容事件逐条 _eventToReportDict 透传（seq 补号 + v2 一等字段平铺，task-09 直接可用） |
   * |13 | usage：partial flush attachUsage（轮级累计注入 flat 消息顶层） | usage lift：事件 usage 一等字段平铺进 dict（daemon lift → backend 实时聚合）+ 会话级台账 _liftSessionUsage（budget 数据源） |
   *
   * status subtype 路由两路（design §5.1 Grill 复核）：bash_chunk/bash_status/
   * plan_mode/agent_task_status/task_notification 属瞬时会话 UI 信号 → 现
   * onSessionEvent 独立通道（WS/REST 既有链路，不落 AgentRunLog、不经
   * submitMessages）；session_started 随 submitMessages 上报（backend resume
   * 指针 pin）；thinking_tokens（D-005@v1 补遗）经 submitMessages 透传（backend
   * _persist_agent_event 对 status 不产文本行，仅事件 JSON 落 metadata_.agent_event）。
   */
  private async _onMessage(
    state: SessionState,
    envelope: TurnMessageEnvelope,
  ): Promise<void> {
    const events = Array.isArray(envelope?.events) ? envelope.events : [];
    // 对账表 #4 前置判定：本 envelope 是否含 Task/Agent tool_use 事件——归一化器把
    // 同一 assistant message 的 tool_use 派生会话信号（agent_task_status running）
    // 与 tool_use 内容事件放在**同一 envelope**（statusEvents 先行 + contentEvents
    // 随后）。该派生信号只 emit（旧 _onMessage toolUse 分支口径：不注册后台任务
    // 表、不落 [TASK_STARTED] 行——注册/落行由 system/task_started 帧承载），经
    // 此标志与 system 帧事件（独立 envelope 到达）区分。
    const envelopeHasTaskToolUse = events.some(
      (ev) =>
        ev.type === 'tool_use' &&
        (ev.tool_name === 'Task' || ev.tool_name === 'Agent'),
    );
    for (const ev of events) {
      // usage lift 先行（D-003@v1：任意型事件可携带；台账只收轮级累计来源，
      // 见 _liftSessionUsage 守卫注释）。
      this._liftSessionUsage(state, ev);
      if (ev.type === 'status') {
        await this._dispatchStatusEvent(state, ev, envelopeHasTaskToolUse);
        continue;
      }
      // 内容事件（text/thinking/tool_use/tool_result/error/turn_result/complete）：
      // - tool_use(Task/Agent) → _agentToolUseMeta 登记（对账表 #4，异步回执兜底关联键）；
      // - tool_result → 异步回执兜底（对账表 #11）；
      // - 全部经 _eventToReportDict 透传（对账表 #12/#13）。
      if (ev.type === 'tool_use') {
        this._registerAgentToolUseMeta(state, ev);
      } else if (ev.type === 'tool_result') {
        await this._maybeRegisterAsyncReceipt(state, ev);
      }
      const runId = state.currentRunId;
      if (!runId) continue; // 无 active turn → 丢弃（对齐旧尾部守卫）
      await this.deps.onTurnMessage(
        state.sessionId,
        runId,
        this._eventToReportDict(state, ev),
      );
    }
  }

  /**
   * task-08：status 事件按 subtype 分发（D-002@v1 会话级信号事件化）。输入从
   * raw SDK 形状改为事件一等字段（session_id）+ metadata 开放容器（command/
   * channel/status/exit_code/elapsed_ms/summary/task_*），会话级语义零变化。
   *
   * @param envelopeHasTaskToolUse 本 envelope 含 Task/Agent tool_use 事件（见
   *   _onMessage 前置判定）——agent_task_status 据此走 tool_use 派生口径（仅 emit，
   *   不注册/不落行）。
   */
  private async _dispatchStatusEvent(
    state: SessionState,
    ev: AgentEvent,
    envelopeHasTaskToolUse: boolean,
  ): Promise<void> {
    switch (ev.subtype) {
      case 'session_started': {
        const sid =
          typeof ev.session_id === 'string' && ev.session_id
            ? ev.session_id
            : undefined;
        // 守卫等价迁移（旧 _onMessage system/init 分支，2026-06-28-daemon-
        // subagent-transcript task-04 / D-003@v1）：
        // - 子代理 init（parent_tool_use_id 非空）不得覆盖主 session 的
        //   agentSessionId（resume key）——归一化器对 Claude 子代理 init 已守卫
        //   丢弃，此处对事件字段再防御（codex 无该形态）；
        // - forkedInitPending（reloadWithConfig 置位）：fork 后 init 带新
        //   session_id 允许覆盖（消费清除）。
        const isSubagentInit =
          typeof ev.parent_tool_use_id === 'string' &&
          ev.parent_tool_use_id !== '';
        if (
          sid &&
          !isSubagentInit &&
          (state.agentSessionId === undefined ||
            (state.forkedInitPending === true && sid !== state.agentSessionId))
        ) {
          state.agentSessionId = sid;
          state.forkedInitPending = false;
          // task-10：拿到 agentSessionId 后才可恢复 → 排队 flush。
          this._scheduleFlush();
        }
        // design §7.5：session_started 随 submitMessages 上报（backend resume
        // 指针 pin；旧轨 init 消息透传后 backend _extract_sdk_messages 对 system
        // 类静默丢弃，新轨由 _persist_agent_event 提取 session_id 更新指针）。
        const startedRunId = state.currentRunId;
        if (startedRunId) {
          await this.deps.onTurnMessage(
            state.sessionId,
            startedRunId,
            this._eventToReportDict(state, ev),
          );
        }
        return;
      }
      case 'bash_chunk': {
        const runId = state.currentRunId;
        if (!runId) return; // 信号门控对齐旧 toolUse 分支（runId 存在才 emit）
        const meta = eventMetaOf(ev);
        this._emitSessionEvent(state.sessionId, runId, {
          kind: 'bash_chunk',
          command: strOf(meta?.['command']),
          channel: meta?.['channel'] === 'stderr' ? 'stderr' : 'stdout',
          content: ev.content,
          is_final: meta?.['is_final'] === true,
        });
        return;
      }
      case 'bash_status': {
        const runId = state.currentRunId;
        if (!runId) return;
        const meta = eventMetaOf(ev);
        const rawStatus = strOf(meta?.['status']);
        const status =
          rawStatus === 'failed'
            ? 'failed'
            : rawStatus === 'completed'
              ? 'completed'
              : 'running';
        const exitCode = numOf(meta?.['exit_code']);
        const elapsedMs = numOf(meta?.['elapsed_ms']);
        this._emitSessionEvent(state.sessionId, runId, {
          kind: 'bash_status',
          command: strOf(meta?.['command']),
          status,
          ...(exitCode !== undefined ? { exit_code: exitCode } : {}),
          ...(elapsedMs !== undefined ? { elapsed_ms: elapsedMs } : {}),
        });
        return;
      }
      case 'plan_mode': {
        const runId = state.currentRunId;
        if (!runId) return;
        const meta = eventMetaOf(ev);
        const summary = meta?.['summary'] as
          | { objective?: unknown; tasks?: unknown; design_snippet?: unknown }
          | undefined;
        const objective =
          typeof summary?.objective === 'string' ? summary.objective : '';
        const tasks = Array.isArray(summary?.tasks)
          ? summary.tasks.filter((t): t is string => typeof t === 'string')
          : [];
        const designSnippet = strOf(summary?.['design_snippet']);
        this._emitSessionEvent(state.sessionId, runId, {
          kind: 'plan_mode_entered',
          summary: {
            objective,
            tasks,
            ...(designSnippet ? { design_snippet: designSnippet } : {}),
          },
        });
        return;
      }
      case 'agent_task_status':
        if (envelopeHasTaskToolUse) {
          // tool_use 派生信号（对账表 #4 的 emit 半边，旧 _onMessage toolUse 分支
          // 口径）：仅 emit running（不注册后台任务表、不落行——[TASK_*] 行由
          // system/task_started 帧或异步回执路径承载，防双行）。
          const deriveRunId = state.currentRunId;
          if (!deriveRunId) return;
          const deriveMeta = eventMetaOf(ev);
          this._emitSessionEvent(state.sessionId, deriveRunId, {
            kind: 'agent_task_status',
            task_id: strOf(deriveMeta?.['task_id']),
            task_name: strOf(deriveMeta?.['task_name']),
            status: 'running',
          });
          return;
        }
        await this._handleAgentTaskStatusEvent(state, ev);
        return;
      case 'task_notification':
        await this._handleTaskNotificationEvent(state, ev);
        return;
      case 'thinking_tokens': {
        // D-005@v1：thinking token 计数信号（旧轨 [SYSTEM:thinking_tokens] 行的
        // 事件等价——该行前端默认隐藏 ql-20260709-003，非渲染依赖）。经
        // submitMessages 透传（backend 对 status 不产文本行，仅事件 JSON 落
        // metadata_.agent_event，task-13 双路径等价覆盖该信号）。
        const runId = state.currentRunId;
        if (!runId) return; // 旧轨 flush 无 runId 时丢弃残留，口径一致
        await this.deps.onTurnMessage(
          state.sessionId,
          runId,
          this._eventToReportDict(state, ev),
        );
        return;
      }
      default:
        // 未知 subtype 防御丢弃（schema 闭合枚举外的运行时漂移）。
        return;
    }
  }

  /**
   * task-08：Task/Agent tool_use 事件的元数据登记（对账表 #4 的 meta 半边）。
   *
   * 旧实现从 assistant message 的 tool_use block 原生 input 对象读
   * description/subagent_type；事件轨 tool_use 事件 content = 入参 JSON
   *（归一化器 service.py:3581 json.dumps 口径），此处解析回对象（失败退化空
   * 对象，对齐旧 toolInput 非对象守卫）。关联键 = call_id（= 旧 tool_use.id）。
   * agent_task_status(running) 的 emit 由归一化器产事件、_dispatchStatusEvent
   * 转发，此处不再 emit（防双发）。
   */
  private _registerAgentToolUseMeta(state: SessionState, ev: AgentEvent): void {
    if (ev.tool_name !== 'Task' && ev.tool_name !== 'Agent') return;
    const callId = ev.call_id;
    if (typeof callId !== 'string' || !callId) return;
    let input: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(ev.content || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        input = parsed as Record<string, unknown>;
      }
    } catch {
      // 非法 JSON 退化空对象（对齐旧 toolInput 非对象守卫）。
    }
    const taskName = strOf(input['description'] ?? input['name']) || ev.tool_name;
    const rawSubagentType = input['subagent_type'];
    const subagentType =
      typeof rawSubagentType === 'string' && rawSubagentType
        ? rawSubagentType
        : undefined;
    this._agentToolUseMeta.set(callId, {
      sessionId: state.sessionId,
      taskName,
      ...(subagentType ? { subagentType } : {}),
    });
  }

  /**
   * task-03（design §5 P1.2，FR-01）+ task-08 迁移：异步 Agent 启动回执兜底——
   * tool_result 事件正文含 "Async agent launched successfully" 且正则提取到
   * agentId 时调 _registerAsyncReceiptTask（CLI 不发 task_* 的旧版/异常场景，
   * secondary 路径）。call_id = 旧 tool_use_id 关联键。
   */
  private async _maybeRegisterAsyncReceipt(
    state: SessionState,
    ev: AgentEvent,
  ): Promise<void> {
    const text = ev.content;
    if (
      typeof text !== 'string' ||
      !text.includes('Async agent launched successfully')
    ) {
      return;
    }
    const agentIdMatch = /agentId:\s*([0-9a-f]+)/i.exec(text);
    const agentId = agentIdMatch?.[1];
    if (!agentId) return;
    const callId = typeof ev.call_id === 'string' ? ev.call_id : '';
    if (!callId) return;
    await this._registerAsyncReceiptTask(
      state,
      state.currentRunId,
      agentId,
      callId,
    );
  }

  /**
   * task-08：AgentEvent → 上报消息 dict（对账表 #12/#13）。
   *
   * v2 一等字段（parent 三列 / segment_id / edit_patch / usage / session_id /
   * is_partial / override / tool_name / call_id / subtype / depth / seq / metadata）
   * 蛇形命名平铺 dict 顶层，task-09 接线时直接包 ``{"kind":"agent_event",
   * "event": {...}}``；legacy 兼容键 ``event_type``（= type 别名）保留给
   * daemon dedupKeyFor / 旧消费轨（对齐 codex driver toAgentEvent 的双键形态）。
   * seq 缺号由 SessionManager 补（design §7：turn 内单调递增，_foldTurnUsage
   * turn 边界重置；事件自带 seq（provider 自产）则透传不覆盖）。
   */
  private _eventToReportDict(
    state: SessionState,
    ev: AgentEvent,
  ): Record<string, unknown> {
    const seq =
      typeof ev.seq === 'number' ? ev.seq : this._nextEventSeq(state.sessionId);
    const dict: Record<string, unknown> = {
      event_type: ev.type,
      type: ev.type,
      content: ev.content,
      seq,
    };
    if (ev.subtype !== undefined) dict['subtype'] = ev.subtype;
    if (ev.tool_name !== undefined) dict['tool_name'] = ev.tool_name;
    if (ev.call_id !== undefined) dict['call_id'] = ev.call_id;
    if (ev.session_id !== undefined) dict['session_id'] = ev.session_id;
    if (ev.usage !== undefined) dict['usage'] = ev.usage;
    if (ev.parent_tool_use_id !== undefined) {
      dict['parent_tool_use_id'] = ev.parent_tool_use_id;
    }
    if (ev.subagent_type !== undefined) dict['subagent_type'] = ev.subagent_type;
    if (ev.depth !== undefined) dict['depth'] = ev.depth;
    if (ev.segment_id !== undefined) dict['segment_id'] = ev.segment_id;
    if (ev.is_partial !== undefined) dict['is_partial'] = ev.is_partial;
    if (ev.override !== undefined) dict['override'] = ev.override;
    if (ev.edit_patch !== undefined) dict['edit_patch'] = ev.edit_patch;
    if (
      ev.metadata !== undefined &&
      Object.keys(ev.metadata as Record<string, unknown>).length > 0
    ) {
      dict['metadata'] = ev.metadata;
    }
    return dict;
  }

  /** task-08：turn 内事件 seq 补号（1 起单调递增；turn 边界 _foldTurnUsage 重置）。 */
  private _nextEventSeq(sessionId: string): number {
    const next = (this._turnEventSeq.get(sessionId) ?? 0) + 1;
    this._turnEventSeq.set(sessionId, next);
    return next;
  }

  // ── ql-20260621-partial：streaming delta 缓冲节流 ──────────────────────────

  /**
   * task-04（FR-01~03）：fire-and-forget 上报会话反馈事件。
   *
   * 异常吞掉不阻塞 turn 主流程与 onTurnMessage 转发；仅 console.error 记日志。
   */
  private _emitSessionEvent(
    sessionId: string,
    runId: string,
    event: import('./types.js').SessionEventForBackend,
  ): void {
    const cb = this.deps.onSessionEvent;
    if (!cb) return;
    void (async () => { await cb(sessionId, runId, event); })().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[session-manager] onSessionEvent failed', {
        sessionId,
        runId,
        kind: event.kind,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // ── task-03（2026-08-27-background-subagent-progress）+ task-08 事件化：后台任务生命周期消费 ──

  /**
   * task-08（对账表 #8）：status/agent_task_status 统一处理器。
   *
   * 归一化器把 task_started/task_progress/task_updated 三类 system 帧都映射为
   * subtype='agent_task_status'（metadata.status running/终态六值映射，design §7 枚举
   * 无独立 started/progress subtype），消费侧按注册状态统一分派（注册表/
   * 节流/唤醒/[TASK_*] 行语义不变，SDK 契约依据同旧 _handleTask* 系列：
   *   - 终态（completed/failed/stopped）：对齐旧 _handleTaskUpdated——仅 emit 轻量事件
   *     （无行/无注销/无唤醒；权威终态走 task_notification）；任务表无记录时丢弃
   *     （轻量信号无从挂靠，对齐旧口径）；
   *   - running + 未注册：对齐旧 _handleTaskStarted——注册 + emit + [TASK_STARTED]
   *     行（skip_transcript ambient 任务归一化器已丢弃；重复 task_started 仅补关联键）。
   *     覆盖旧 _handleTaskProgress 的懒注册路径——差异：懒注册现也落
   *     [TASK_STARTED] 行（旧仅静默注册）；该路径仅在 task_started 丢失/daemon
   *     重启窗口触发，交付报告已列明）；
   *   - running + 已注册：对齐旧 _handleTaskProgress——emit（不节流）+
   *     [TASK_PROGRESS] 行 ≥2000ms 节流（R-03）。已知差异（task_name 键判别的
   *     固有模糊）：重复 task_started（SDK 重放，注册后到达）走本分支会多一次
   *     running emit（旧实现静默 return）——注册/落行仍幂等（单一注册表条目 +
   *     单一 [TASK_STARTED] 行），交付报告已列明。
   *   - running 态 task_updated（metadata 无 task_name 键）：对齐旧
   *     _handleTaskUpdated——仅 emit 轻量事件，不落行、不动节流锚点。
   */
  private async _handleAgentTaskStatusEvent(
    state: SessionState,
    ev: AgentEvent,
  ): Promise<void> {
    const meta = eventMetaOf(ev);
    const taskId = strOf(meta?.['task_id']);
    if (!taskId) return; // 无 task_id 无法注册/关联（归一化器已过滤，防御运行时异常形态）
    const toolUseId = strOf(meta?.['tool_use_id']) || undefined;
    const status = strOf(meta?.['status']);

    // 终态（task_updated patch 映射）：仅 emit（任务表条目仍在——权威终态由
    // task_notification 注销）。
    if (status === 'completed' || status === 'failed' || status === 'stopped') {
      const terminalInfo = this._getOrCreateTaskMap(state.sessionId).get(taskId);
      if (!terminalInfo) {
        // 任务表无记录（未注册 / 已注销）→ 轻量信号无从挂靠。
        return;
      }
      const terminalRunId = terminalInfo.runId ?? state.currentRunId;
      if (!terminalRunId) return;
      const errorText = strOf(meta?.['summary']) || undefined;
      this._emitSessionEvent(state.sessionId, terminalRunId, {
        kind: 'agent_task_status',
        task_id: taskId,
        task_name: terminalInfo.taskName,
        status,
        ...(terminalInfo.toolUseId
          ? { tool_use_id: terminalInfo.toolUseId }
          : {}),
        ...(errorText ? { summary: errorText } : {}),
      });
      return;
    }

    const tasks = this._getOrCreateTaskMap(state.sessionId);
    const info = tasks.get(taskId);
    // task_updated 判别：归一化器的 task_updated 事件 metadata 只带
    // {task_id, status, summary?}（不带 task_name 键）；task_started/task_progress
    // 恒带 task_name 键（description || '后台任务'）。据此区分 updated 轻量信号
    //（emit-only，不落行）与 started/progress 家族（注册 + 落行）。
    const isUpdatedSignal =
      !meta || !('task_name' in (meta as Record<string, unknown>));
    if (isUpdatedSignal && info) {
      // running 态 task_updated（patch.status 映射 running/killed 前的中间态）：
      // 对齐旧 _handleTaskUpdated——仅 emit 轻量事件，不落行、不动节流锚点。
      const updatedRunId = info.runId ?? state.currentRunId;
      if (!updatedRunId) return;
      const updatedSummary = strOf(meta?.['summary']) || undefined;
      this._emitSessionEvent(state.sessionId, updatedRunId, {
        kind: 'agent_task_status',
        task_id: taskId,
        task_name: info.taskName,
        status: 'running',
        ...(info.toolUseId ? { tool_use_id: info.toolUseId } : {}),
        ...(updatedSummary ? { summary: updatedSummary } : {}),
      });
      return;
    }
    if (!info) {
      // running + 未注册：注册 + emit + [TASK_STARTED] 行。
      const taskName = strOf(meta?.['task_name']) || '后台任务';
      const subagentType = strOf(meta?.['subagent_type']) || undefined;
      // 捕获派发 runId（task_notification 常在本 turn 收尾后到达，届时
      // currentRunId 已清空——注册表是唯一带 runId 的地方）。
      const runId = state.currentRunId;
      tasks.set(taskId, {
        ...(toolUseId ? { toolUseId } : {}),
        taskName,
        ...(subagentType ? { subagentType } : {}),
        async: true,
        startedAt: Date.now(),
        ...(runId ? { runId } : {}),
      });
      // 无 runId（极端时序）→ emit/落行双双跳过；注册表仍在，后续
      // progress/notification 用 info.runId ?? currentRunId 兜住。
      if (!runId) return;
      this._emitSessionEvent(state.sessionId, runId, {
        kind: 'agent_task_status',
        task_id: taskId,
        task_name: taskName,
        status: 'running',
        ...(toolUseId ? { tool_use_id: toolUseId } : {}),
      });
      await this._writeTaskLine(state.sessionId, runId, '[TASK_STARTED]', {
        task_id: taskId,
        ...(toolUseId ? { tool_use_id: toolUseId } : {}),
        task_name: taskName,
        ...(subagentType ? { subagent_type: subagentType } : {}),
        async: true,
      }, toolUseId);
      return;
    }

    // running + 已注册：进度（emit 不节流 + [TASK_PROGRESS] 行 ≥2000ms 节流）。
    if (toolUseId && !info.toolUseId) {
      // 重复信号补全缺失关联键（对齐旧 _handleTaskStarted 幅边）。
      info.toolUseId = toolUseId;
    }
    info.lastProgressAt = Date.now();
    const runId = info.runId ?? state.currentRunId;
    if (!runId) return;
    const lastToolName = strOf(meta?.['last_tool_name']) || undefined;
    const summary = strOf(meta?.['summary']) || undefined;
    const elapsedMs = numOf(meta?.['elapsed_ms']);
    const totalTokens = numOf(meta?.['total_tokens']);
    const toolUses = numOf(meta?.['tool_uses']);
    // emit 不节流（SSE 实时精度优先；R-03 节流只作用于落行）。
    this._emitSessionEvent(state.sessionId, runId, {
      kind: 'agent_task_status',
      task_id: taskId,
      task_name: info.taskName,
      status: 'running',
      ...(info.toolUseId ? { tool_use_id: info.toolUseId } : {}),
      ...(lastToolName ? { last_tool_name: lastToolName } : {}),
      ...(summary ? { summary } : {}),
      ...(elapsedMs !== undefined ? { elapsed_ms: elapsedMs } : {}),
      ...(totalTokens !== undefined ? { total_tokens: totalTokens } : {}),
      ...(toolUses !== undefined ? { tool_uses: toolUses } : {}),
    });
    // R-03：[TASK_PROGRESS] 行同任务 ≥2000ms 节流合并；首行（lastLineAt 未设）必落。
    const now = Date.now();
    if (
      now - (info.lastLineAt ?? 0) <
      SessionManager.TASK_PROGRESS_LINE_THROTTLE_MS
    ) {
      return;
    }
    info.lastLineAt = now;
    await this._writeTaskLine(state.sessionId, runId, '[TASK_PROGRESS]', {
      task_id: taskId,
      ...(elapsedMs !== undefined ? { elapsed_ms: elapsedMs } : {}),
      ...(totalTokens !== undefined ? { total_tokens: totalTokens } : {}),
      ...(toolUses !== undefined ? { tool_uses: toolUses } : {}),
      ...(lastToolName ? { last_tool_name: lastToolName } : {}),
      ...(summary ? { summary } : {}),
    }, info.toolUseId);
  }

  /**
   * task-08（对账表 #8）：status/task_notification 消费——emit 终态 +
   * 落 [TASK_NOTIFICATION] 行（不节流）+ 任务表注销 + 完成/失败触发主代理
   * 唤醒（对齐旧 _handleTaskNotification，elapsed_ms 服务端权威值经归一化器
   * 从 usage.duration_ms 提升 metadata；缺失时不发，前端本地走秒兜底）。
   */
  private async _handleTaskNotificationEvent(
    state: SessionState,
    ev: AgentEvent,
  ): Promise<void> {
    const meta = eventMetaOf(ev);
    const taskId = strOf(meta?.['task_id']);
    if (!taskId) return;
    const rawStatus = strOf(meta?.['status']);
    const tasks = this._getOrCreateTaskMap(state.sessionId);
    const info = tasks.get(taskId);
    const elapsedMs = numOf(meta?.['elapsed_ms']);
    const summary = strOf(meta?.['summary']) || strOf(ev.content);
    // 任务表注销（终态即注销——先删后 emit，防重复消费；后续同
    // task_id 的迟到 progress 会走懒注册兜底而非挂死条目）。
    tasks.delete(taskId);
    if (
      rawStatus !== 'completed' &&
      rawStatus !== 'failed' &&
      rawStatus !== 'stopped'
    ) {
      // 非法终态（归一化器已过滤，防御运行时异常形态）：
      // 已注销，不再 emit/落行。
      return;
    }
    const toolUseId = strOf(meta?.['tool_use_id']) || undefined;
    const taskName =
      info?.taskName ??
      (toolUseId
        ? this._agentToolUseMeta.get(toolUseId)?.taskName
        : undefined) ??
      '后台任务';
    const runId = info?.runId ?? state.currentRunId;
    if (!runId) {
      // 注册表缺失且无在跑 turn（如 daemon 重启后孤儿终态）：无处可归，
      // 跳过（会话 end 收敛兜底）。
      return;
    }
    const effectiveToolUseId = info?.toolUseId ?? toolUseId;
    this._emitSessionEvent(state.sessionId, runId, {
      kind: 'agent_task_status',
      task_id: taskId,
      task_name: taskName,
      status: rawStatus,
      ...(effectiveToolUseId ? { tool_use_id: effectiveToolUseId } : {}),
      ...(summary ? { summary } : {}),
      ...(elapsedMs !== undefined ? { elapsed_ms: elapsedMs } : {}),
    });
    // 终态行不节流（task_log_line_format 契约）。
    await this._writeTaskLine(state.sessionId, runId, '[TASK_NOTIFICATION]', {
      task_id: taskId,
      status: rawStatus,
      ...(elapsedMs !== undefined ? { elapsed_ms: elapsedMs } : {}),
      ...(summary ? { summary } : {}),
    }, effectiveToolUseId);

    // ql-20260827-007：completed/failed 触发主代理唤醒（stopped 多为用户/系统主动
    // 停止，结果无需汇报，不唤醒防噪）。
    if (rawStatus === 'completed' || rawStatus === 'failed') {
      this._scheduleTaskWakeup(state.sessionId, {
        taskId,
        taskName,
        status: rawStatus,
        elapsedMs,
        summary,
      });
    }
  }

  /**
   * ql-20260827-007：后台任务终态唤醒调度——2s debounce 合并同会话多条通知后，
   * 经 deps.onTaskWakeupInject 注入一条「后台任务通知」user 消息（backend inject
   * 创建新 turn 唤醒主代理汇报；忙态由 queue_when_busy 排队）。未注入回调
   * （测试/旧构造点）时静默跳过。防环：prompt 明示「汇报后结束本轮、勿重执行」；
   * 每次唤醒都由真实终态触发，无自持循环。
   */
  private _scheduleTaskWakeup(
    sessionId: string,
    info: {
      taskId: string;
      taskName: string;
      status: string;
      elapsedMs?: number;
      summary?: string;
    },
  ): void {
    const cb = this.deps.onTaskWakeupInject;
    if (!cb) return;
    const mm = Math.floor((info.elapsedMs ?? 0) / 60000);
    const ss = Math.floor(((info.elapsedMs ?? 0) % 60000) / 1000);
    const dur = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    const summaryClip = (info.summary ?? '').slice(0, 300);
    const line =
      `- 任务「${info.taskName}」已${info.status === 'completed' ? '完成' : '失败'}`
      + `（用时 ${dur}）`
      + (summaryClip ? `。结果摘要：${summaryClip}` : '')
      + `（task_id: ${info.taskId}，如需完整输出可调用 TaskOutput 查询，block=false）`;
    let entry = this._taskWakeupPending.get(sessionId);
    if (!entry) {
      const timer = setTimeout(() => {
        const e = this._taskWakeupPending.get(sessionId);
        this._taskWakeupPending.delete(sessionId);
        if (!e || e.lines.length === 0) return;
        // ql-20260827-008：头部明示总数+全部结束、尾部强制逐条核对——实证主代理
        // 曾只读第一行漏报后续任务、并凭历史执念声称"仍在等待"（会话 2fe664d9）。
        const prompt =
          `[后台任务通知] 以下 ${e.lines.length} 个后台子代理任务已全部结束` +
          '（列表中的每一个都已终止，没有仍在运行的任务）：\n' +
          e.lines.join('\n') +
          `\n请逐条核对上述每个任务（共 ${e.lines.length} 个）的名称与结果，一次性向用户完整汇报（综合归纳，不要逐字照抄，不要遗漏任何一个任务）；` +
          '禁止声称仍在等待任何任务；汇报完即结束本轮；不要重复执行这些任务；此消息为系统通知，无需向用户复述本通知本身。';
        void (async () => {
          try {
            await cb(sessionId, prompt);
          } catch (err) {
            console.error('[session-manager] task wakeup inject failed', {
              sessionId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
      }, 2000);
      timer.unref?.();
      entry = { timer, lines: [line] };
      this._taskWakeupPending.set(sessionId, entry);
    } else {
      entry.lines.push(line);
    }
  }

  /**
   * task-03（design §5 P1.2）：异步启动回执兜底注册——user tool_result 文本含
   * "Async agent launched successfully" 且正则提取到 agentId 时调用。
   *
   * 以 tool_use_id 为关联键注册（task_id=agentId，async:true）；查重：CLI 已发
   * task_started 注册过同 tool_use_id（spike 结论 primary 路径）或同 agentId
   * 已注册 → 跳过（避免双 [TASK_STARTED] 行 + 双 running emit）。emit 的 extra
   * 必带 tool_use_id + async:true（design §8：「async 回执兜底路径必发」）——
   * 前端据此不再把 0.1s 配对的 tool_result 当完成信号（FR-01 假完成根因）。
   */
  private async _registerAsyncReceiptTask(
    state: SessionState,
    runId: string | undefined,
    agentId: string,
    toolUseId: string,
  ): Promise<void> {
    const tasks = this._getOrCreateTaskMap(state.sessionId);
    for (const info of tasks.values()) {
      if (info.toolUseId === toolUseId) {
        return; // task_started 已注册（primary 路径），回执仅是佐证。
      }
    }
    if (tasks.has(agentId)) {
      return; // 同 agentId 重复回执（理论不至），幂等跳过。
    }
    const meta = this._agentToolUseMeta.get(toolUseId);
    const taskName = meta?.taskName ?? '后台任务';
    tasks.set(agentId, {
      toolUseId,
      taskName,
      ...(meta?.subagentType ? { subagentType: meta.subagentType } : {}),
      async: true,
      startedAt: Date.now(),
      ...(runId ? { runId } : {}),
    });
    if (!runId) {
      return;
    }
    this._emitSessionEvent(state.sessionId, runId, {
      kind: 'agent_task_status',
      task_id: agentId,
      task_name: taskName,
      status: 'running',
      tool_use_id: toolUseId,
      async: true,
    });
    await this._writeTaskLine(state.sessionId, runId, '[TASK_STARTED]', {
      task_id: agentId,
      tool_use_id: toolUseId,
      task_name: taskName,
      ...(meta?.subagentType ? { subagent_type: meta.subagentType } : {}),
      async: true,
    }, toolUseId);
  }

  /**
   * task-03（design §5 P1.3 / §8 契约）：[TASK_*] 持久行落库。
   *
   * 形状照抄 `_flushPartial` 先例——flat 消息 `{event_type:'text', content,
   * channel:'stdout'}`（backend submit_messages 顶层有 event_type/content 即
   * 原样透传，不走 _extract_sdk_messages 展开）；行级带**顶层**
   * parent_tool_use_id=tool_use_id（backend 落库读 msg.parent_tool_use_id 写
   * AgentRunLog 归属列 + P2.2 跨轮归位用，与 SDK 消息顶层字段同位）。
   * JSON.stringify 输出恒为单行（字符串内换行转义为 `\n` 字面量），满足
   * 「单行 JSON」契约；键名统一 task_name（不用 name，task-03 约束）。
   */
  private async _writeTaskLine(
    sessionId: string,
    runId: string,
    prefix: '[TASK_STARTED]' | '[TASK_PROGRESS]' | '[TASK_NOTIFICATION]',
    payload: Record<string, unknown>,
    parentToolUseId?: string,
  ): Promise<void> {
    const line: Record<string, unknown> = {
      event_type: 'text',
      content: `${prefix} ${JSON.stringify(payload)}`,
      channel: 'stdout',
      ...(parentToolUseId ? { parent_tool_use_id: parentToolUseId } : {}),
    };
    // task-08：SessionManager 内 SDK 类型清零——legacy flat 形态按 Record dict
    // 直传（原 InteractiveDriverMessage 别名已随 task-09 消费面清理退役删除）。
    await this.deps.onTurnMessage(sessionId, runId, line);
  }

  /** task-03：取或建会话级后台任务表（二级 Map 内层懒建）。 */
  private _getOrCreateTaskMap(
    sessionId: string,
  ): Map<string, BackgroundTaskInfo> {
    let tasks = this._backgroundTasks.get(sessionId);
    if (!tasks) {
      tasks = new Map();
      this._backgroundTasks.set(sessionId, tasks);
    }
    return tasks;
  }

  /**
   * task-03：清理指定 session 的后台任务表 + Task/Agent tool_use 元数据。
   * 会话终态（end/fail）调用——SDK 进程已 kill，后台任务随进程消亡，后续
   * task_* 不会再到达；防 Map 泄漏（对齐 _clearRunningBashCommands 语义）。
   */
  private _clearBackgroundTasks(sessionId: string): void {
    this._backgroundTasks.delete(sessionId);
    for (const [toolUseId, meta] of this._agentToolUseMeta) {
      if (meta.sessionId === sessionId) {
        this._agentToolUseMeta.delete(toolUseId);
      }
    }
  }

  /**
   * task-08（FR-02 / D-002@v1）：销毁会话级 usage 台账 + seq 补号计数器
   *（取代旧 ``_destroyPartialBuffer`` 的清理职责：budget 登记由调用方
   * 额外显式清理，对齐创建失败/终态/shutdown 三处调用点；partial
   * 定时器已随缓冲链下沉归一化器，由 driver.consume 的 finally
   * dispose 兜底）。
   */
  private _destroyUsageLedger(sessionId: string): void {
    this._sessionUsageBase.delete(sessionId);
    this._turnUsageByParent.delete(sessionId);
    this._turnEventSeq.delete(sessionId);
    // budget 软切断登记同点位回收（对齐旧 _destroyPartialBuffer 的 F3 修复口径：
    // 无 usage 台账的会话 end 后同样回收，防只增不减）。
    this._sessionBudgetTokens.delete(sessionId);
    this._overBudgetSessions.delete(sessionId);
  }

  // ── 以下为 task-08 移除的旧机制归因清单（R-02 对账）─────────────────────────────────────────
  // 随 partial 缓冲链下沉 ClaudeEventNormalizer（claude-events.ts，task-03 移植）
  // 而从本文件删除的死代码：
  //   - _parentKeyOf / _getOrCreateBuffer / _bufferPartial / _flushPartial /
  //     _resolveSegmentId / _extractCompletedSegments / _clearPartialBufferSync /
  //     _emitOverrideSignals / _usageEqual / _hasPendingTerminalUsage /
  //     _flushTerminalUsage / _shrinkSubagentBuffers / _destroyPartialBuffer
  //     （对应归一化器 _parentKeyOf / _getOrCreateBucket / _bufferPartial /
  //     _flushBucket / _resolveSegmentId / _extractCompletedSegments /
  //     _clearBucketSync / normalizeOverrideSignal / usageEqual / onTurnEnd /
  //     dispose，行为等价由 tests/interactive/claude-events.test.ts 锚定）；
  //   - _emitOverrideSignals（[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] 文本信号发射）：
  //     事件化为单条 override:true + segment_id 事件（D-004@v1），由归一化器
  //     在完整消息展开时产出；旧双行（完整行 + 尾随信号行）合并为单事件；
  //   - subagentDepth 内联状态机：归一化器实例字段维护，事件以 depth 一等字段直达；
  //   - _runningBashCommands Bash 追踪索引：归一化器 runningBash 内置（含
  //     elapsed_ms 计算），事件以 status/bash_chunk + status/bash_status 直达。


}

// ── task-08：事件字段 duck-type 读取辅助（对齐 claude-events.ts 同款口径） ──────

/** 取事件 metadata 开放容器（非对象/缺失 → undefined）。 */
function eventMetaOf(ev: AgentEvent): Record<string, unknown> | undefined {
  const meta = ev.metadata;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    return meta as Record<string, unknown>;
  }
  return undefined;
}

/** String 化读取（null/undefined/非 string → ''）。 */
function strOf(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** number 守卫读取（bool 排除；非 number → undefined）。 */
function numOf(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
