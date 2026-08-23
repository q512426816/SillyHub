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
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
  InteractiveDriverResult,
  McpServerConfigForDriver,
  UserTurnInput,
} from './driver.js';
import { basename, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { InputQueue } from './input-queue.js';
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
import { applyTranscriptConfigDir } from './claude-transcript-dir.js';
// task-04（FR-01 / D-005@v1）：turn 收尾把模型调用失败归类为结构化 ModelError，
// 挂到 result.modelError 透传给 daemon 桥接 → notifyRunResult → backend error_detail。
// 与 stream-json.ts:954 批量路径同源（近源归类，D-005 方案 C 三端标准协议）。
import { classifyModelError } from '../model-error/classifier.js';
import type { ModelError } from '../model-error/types.js';

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
  /** provider（claude / codex）。 */
  provider: 'claude' | 'codex';
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
   * task-10（C-12 / FR-10）：profile 限定的 MCP server name 子集。
   *
   * create 路径从 ``CreateSessionInput.mcpRefs``、restore 路径从
   * ``PersistedSessionRecord.mcpRefs`` 归一化填入。非空时 ``_resolveMainAgentMcp``
   * 对 ``mainAgentMcpConfigProvider`` 返回的配置表按此 ∩ 过滤（mergeMcpConfigs
   * 第三层），只让 profile 引用的 MCP server 被 agent discover。undefined/空 →
   * 不过滤（FR-15）。
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
   * task-05（2026-07-30-daemon-heartbeat-dedup-fix，D-002@v1）：当前累积中的
   * assistant text segment 的 segmentId（`messageId:blockIndex` 或退化
   * `runId:thinking`，同 _resolveSegmentId 口径）。null = 尚未收到 text_delta。
   * 与 currentSegmentId 分桶：thinking 与 assistant text 可能在同一 turn 共存，
   * 各自 segmentId 互不污染。flush 时据此拼 assistant partial 行的 segmentId，
   * 与 task-06 _extractCompletedSegments 的 text block segmentId 严格对齐，
   * 使 _emitOverrideSignals（task-07 扩 assistant）能命中撤回。
   */
  currentAssistantSegmentId: string | null;
  /**
   * task-11：本 turn 已 flush 的 partial segment 列表（供 _emitOverrideSignals 在
   * 完整 message 到达时 emit override 覆盖信号）。turn 边界
   *（_clearPartialBuffer）清空。
   * task-07：扩 `kind` 字段区分 thinking / assistant override——
   * - thinking override → emit `[THINKING_OVERRIDE]`，metadata 带 thinking:true
   * - assistant override → emit `[ASSISTANT_OVERRIDE]`，metadata **严禁** thinking:true（B2）
   * 两者信号前缀 + metadata 不同，必须按 kind 分流。
   */
  flushedSegments: Array<{
    segmentId: string;
    logTimestamp: string;
    kind: 'thinking' | 'assistant';
  }>;
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

/**
 * ql-20260818-009：取消档案的中和指令。仅清 system prompt 不够——fork 继承的
 * 对话历史含此前人格的角色扮演轮，模型会从上下文延续角色（实测复现）；以
 * 显式中和 append 压掉历史角色惯性。
 */
const CLEAR_PERSONA_PROMPT =
  '用户已取消此前设置的智能体档案（人格）。此前对话中出现的任何人格/角色设定均已失效：请停止继续扮演该角色，以默认的 AI 编程助手身份、基于通用能力回答后续问题。';
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
   * 口径 D-009：``input_tokens + output_tokens``（**不含** cache_*）—— 复用现有
   * PartialFlushBuffer.sessionInputTokens / sessionOutputTokens（跨 parentKey 桶求和，
   * 含子代理）。
   */
  private readonly _sessionBudgetTokens = new Map<string, number>();
  private readonly _overBudgetSessions = new Set<string>();

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
    // task-06（D-007@v2 / R-01）：主 agent MCP tool 注入。未注入 = 普通会话零回归。
    this._isMainAgentSession = opts.isMainAgentSession;
    this._mainAgentMcpConfigProvider = opts.mainAgentMcpConfigProvider;
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
  async create(input: CreateSessionInput & {
    /**
     * task-08（D-006 / D-009）：本次 lease 的 token budget 上限（来自
     * ``LeaseCtx.budget_tokens``，daemon ``_startInteractiveSession`` 透传）。
     * undefined / ≤0 / 非有限数 → 检查点短路（FR-07 零回归）。
     */
    budget_tokens?: number;
  }): Promise<void> {
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
      // task-06：lease stage 持久化（snapshotPersistable 输出，恢复用）。
      stage: input.stage,
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
    };
    this._store.set(input.sessionId, state);

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
   * task-06（D-007@v2）：归一化 MainAgentMcpContext + 调谓词/provider 决定主 agent
   * MCP server 配置。
   *
   * create 路径从 ``CreateSessionInput``、restore 路径从 ``PersistedSessionRecord``
   * 各自抽出 sessionId/leaseId/provider/cwd/model 构造 ctx（两者都含这些字段），
   * 再统一调 ``isMainAgentSession`` 判定 + ``mainAgentMcpConfigProvider`` 取配置。
   *
   * 返回 undefined 的三种情况（均不注入，普通会话零回归）：
   *   1. 谓词未注入 / 返回 false（非主 agent session）；
   *   2. provider 未注入；
   *   3. provider 返回 undefined / 空对象。
   */
  private _resolveMainAgentMcp(ctx: MainAgentMcpContext):
    | Record<string, McpServerConfigForDriver>
    | undefined {
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
      const _innerCanUse = driverOpts.canUseTool as CanUseTool | undefined;
      const _roGate: CanUseTool = async (toolName, input, options) => {
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
      //
      // task-10（C-12 / D-013 / FR-11）：profile.effectiveAllowedRoots 存在则替代
      // provider 值，∩ 物理 provider 兜底（防 backend 算的 effective 含已失效/越界路径；
      // backend 服务端已校验 overlay⊆daemon_roots，这里仅防御 stale 缓存）。provider
      // 为空（未注入）时直接信任 effective（backend 已是 daemon∩overlay 的权威交集）。
      // effective undefined/空 → 用原 provider 值（FR-15 行为同今天）。
      const providerRoots = this._allowedRootsProvider?.() ?? [];
      const stateForRoots = this._store.get(sessionId);
      const effectiveRoots = stateForRoots?.effectiveAllowedRoots;
      let roots: string[];
      if (effectiveRoots && effectiveRoots.length > 0) {
        roots =
          providerRoots.length > 0
            ? effectiveRoots.filter((p) => isPathUnderAnyRoot(p, providerRoots))
            : effectiveRoots;
      } else {
        roots = providerRoots;
      }
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
    // c40b1319 / ql-20260806-002），故 oldQuery.close 触发旧 consume 回调时 state.query
    // 已指向新 query，谓词正确判 orphan。两次连续 reload 同理（中间那个 consume 变 orphan）。
    const isAuthoritative = (): boolean => {
      const current =
        state.provider === 'claude' ? state.query : state.driverHandle;
      return current === target;
    };

    const onResult = async (r: SDKResultMessage | InteractiveDriverResult): Promise<void> => {
      if (!isAuthoritative()) return; // orphan：reload 已换 query，旧 result 丢弃
      await this._onResult(state, r);
    };
    const onMessage = async (m: SDKMessage | Record<string, unknown>): Promise<void> => {
      if (!isAuthoritative()) return; // orphan：旧 query 残留消息丢弃
      await this._onMessage(state, m as SDKMessage);
    };
    const onError = (_e: unknown): void => {
      // 边界 2：driver 异常 → fail。fail 内部幂等。
      // orphan（reload 后旧 query.close 触发的 abort 错）静默丢弃，不 fail 新会话。
      if (!isAuthoritative()) return;
      void this.fail(state.sessionId).then(() => undefined, () => undefined);
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
   * task-09：附件落盘——{cwd}/attachments/{safeName}（basename 防穿越，
   * 同名冲突自 1 加序号保留扩展名），子目录递归创建。返回相对路径
   * attachments/xxx（prompt 路径清单用相对形态）。
   */
  private async _writeAttachmentFile(cwd: string, rawName: string, buf: Buffer): Promise<string> {
    const dir = join(cwd, 'attachments');
    await mkdir(dir, { recursive: true });
    const safe = basename(rawName) || 'attachment';
    const dot = safe.lastIndexOf('.');
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const ext = dot > 0 ? safe.slice(dot) : '';
    let rel = 'attachments/' + safe;
    let n = 0;
    // 冲突探测：写入前试目标存在性——用 writeFile 的 exclusive 模式轮试。
    for (;;) {
      try {
        await writeFile(join(cwd, rel), buf, { flag: 'wx' });
        return rel;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
          n += 1;
          rel = 'attachments/' + stem + '(' + n + ')' + ext;
          continue;
        }
        throw err;
      }
    }
  }

  async refreshClaimToken(sessionId: string, claimToken: string): Promise<void> {
    const state = this._store.get(sessionId);
    if (!state || !claimToken) return;
    state.claimToken = claimToken;
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
   * task-08（D-009）：聚合 session 所有 parentKey 桶（主 agent + 各子代理）的
   * input+output 累计 token。无桶 → 0/0。**不含** cache_*（D-009 口径）。
   */
  private _aggregateSessionUsage(sessionId: string): {
    input_tokens: number;
    output_tokens: number;
  } {
    const buckets = this._partialBuffers.get(sessionId);
    if (!buckets) return { input_tokens: 0, output_tokens: 0 };
    let inputTokens = 0;
    let outputTokens = 0;
    for (const buf of buckets.values()) {
      inputTokens += buf.sessionInputTokens || 0;
      outputTokens += buf.sessionOutputTokens || 0;
    }
    return { input_tokens: inputTokens, output_tokens: outputTokens };
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

    // task-07 排队检测：在切换 status 前抓取「前一 turn 是否未 result」。
    // status=running（driver 正在跑 turn）→ 本条 inject 排队到下一 turn（spike S1）。
    const wasRunningBeforeInject = state.status === 'running';

    // spike S1：push 永远进 InputQueue（turn 级串行由 SDK result 边界保证），不拒绝。
    // currentRunId 在前 turn result 收尾前由本 inject 切换（task-04 既有行为，保留）：
    // inject 时 backend 行锁已防重复创建，daemon 侧 currentRunId 反映「即将执行的 run」。
    // task-02（D-009）：push provider-neutral UserTurnInput（不再构造 SDKUserMessage；
    // Claude driver 内部做形态转换，task-03）。
    // 2026-08-20-session-multimodal-attachments task-09：附件消费（deliver 由
    // backend 全权决策）。block=多模态块（内联 data 或经下载闭包回拉）；disk=落盘
    // {cwd}/attachments/（同名加序号）+ text 追加路径清单；单文件失败降级标注不
    // 中断 turn。无附件路径与原 push 逐字一致（零回归）。
    let turnText = prompt;
    let blocks: UserTurnInput['blocks'];
    let filesToFetch: UserTurnInput['filesToFetch'];
    if (attachments && attachments.length > 0) {
      const blockList: NonNullable<UserTurnInput['blocks']> = [];
      const savedPaths: string[] = [];
      const fetched: NonNullable<UserTurnInput['filesToFetch']> = [];
      const failedNames: string[] = [];
      for (const att of attachments) {
        try {
          if (att.deliver === 'block') {
            let b64 = att.data;
            if (!b64 && downloadAttachment) {
              b64 = (await downloadAttachment(att.id)).toString('base64');
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
            const buf = await downloadAttachment(att.id);
            const rel = await this._writeAttachmentFile(state.cwd, att.name, buf);
            savedPaths.push(rel);
            fetched.push({ id: att.id, name: att.name });
          }
        } catch {
          failedNames.push(att.name);
        }
      }
      if (blockList.length > 0) blocks = blockList;
      if (fetched.length > 0) filesToFetch = fetched;
      const lines: string[] = [];
      if (savedPaths.length > 0) {
        lines.push('[附件已落盘，可用 Read/Grep 等工具读取]');
        for (const rel of savedPaths) lines.push('- ' + rel);
      }
      for (const n of failedNames) lines.push('(下载失败: ' + n + ')');
      if (lines.length > 0) {
        turnText = (prompt ? prompt + '\n\n' : '') + lines.join('\n');
      }
    }
    state.inputQueue.push(
      blocks || filesToFetch
        ? { type: 'user', text: turnText, ...(blocks ? { blocks } : {}), ...(filesToFetch ? { filesToFetch } : {}) }
        : { type: 'user', text: turnText },
    );
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

    // 4. ql-20260621-partial：销毁 partial buffer（含 timer），防止 end 后定时器仍
    //    fire 推送到已结束 session。
    this._destroyPartialBuffer(state.sessionId);

    // 5. task-01 新增（D-003 / D-004 / R-01）：接通 driver kill 链。
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

    // 6. close InputQueue（给 stdin EOF；幂等，已 closed 不抛）。
    try {
      state.inputQueue.close();
    } catch {
      /* close 幂等，已 closed 不抛 */
    }

    // 7. 通知 backend 终态（原 end→'ended' / fail→'failed'）。
    //    ql-20260823-006：notifyBackend=false 供 restoreAndReconnect 驱逐内存
    //    残留条目用——backend 正推进 reconnecting→active，回发终态会与之竞态
    //    把刚要恢复的会话误翻 failed。
    if (opts.notifyBackend !== false) {
      await this.deps.onSessionEnd(state.sessionId, isManual ? 'ended' : 'failed');
    }

    // 8. task-10：终态从落盘集合移除后 flush（不复活 ended/failed session）。
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
      // task-06（D-007@v2）：主 agent stage 持久化（恢复后重新注入 MCP tool）。
      // 仅 stage 非空时写（普通 scan/stage/chat session 不写，恢复后不注入 MCP）。
      if (state.stage) {
        rec.stage = state.stage;
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
      subagentDepth: new Map(), // task-02 / D-007@v1：恢复后从空开始（depth 不持久化）。
      // task-06：恢复主 agent stage（重新注入 MCP tool 用）。
      stage: record.stage,
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
        { provider_config: state.providerConfig ?? undefined },
        { credential: restoreCredential },
      );
      await applyTranscriptConfigDir(restoreEnv, state.agentSessionId);
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
      void this.reloadWithProvider(sessionId, providerConfig).catch(() => {
        // reload 失败保留旧 query 不破坏会话（design §5 Wave3 / R-01）；
        // task-08 实现真实错误上报，本处兜底吞错防 unhandled rejection。
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
   *   - ``providerConfig`` 非 null → 切供应商；null → 不切（保持 state.providerConfig
   *     现值；与 reloadWithProvider(null)=「停止回退本机」语义不同）。
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
    const nextProviderConfig =
      payload.providerConfig ?? state.providerConfig ?? null;

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
        { provider_config: providerConfig ?? undefined },
        { credential },
      );
      // ql-20260822-009：reload 的 CLAUDE_CONFIG_DIR 同样按 transcript 实际位置判定
      // （claude-transcript-dir 单一来源，与 restoreAndReconnect 对称）。ql-20260807-002
      // 语义保留：jsonl 在 daemon 隔离目录（create 带供应商 / 停止供应商前创建）→ 仍
      // 强制隔离，防新 claude resume 找不到 jsonl → onError → fail → session ended。
      // 新增：jsonl 仅在宿主机 ~/.claude（create 未配供应商）→ 不隔离，回 ~/.claude 找。
      // 凭证靠 env token（层 2 credentials.json）+ daemon settings.json。
      await applyTranscriptConfigDir(newEnv, state.agentSessionId);

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
          handleOrQuery as import('@anthropic-ai/claude-agent-sdk').Query;
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
        state.query = oldHandle as import('@anthropic-ai/claude-agent-sdk').Query | undefined;
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
    // task-08（D-006 / D-009）：turn 收尾 budget 软切断检查点。在 completedSegments
    // 重置**之后**调用（聚合 usage 不依赖 completedSegments，但放在末尾确保
    // _onResult 主路径全部完成后才发 budget_exceeded，语义清晰）。runId 用本 turn
    // 刚结束的（currentRunId 已清空，但 runId 局部变量仍持有）。
    if (runId) {
      this._checkBudgetCutoff(state, runId);
    }
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
        () => {
          // task-08 实现真实错误上报；本处兜底吞错，不阻塞 _onResult 收尾路径。
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
      // ql-20260818-002：forked reload 的 init 带新 session_id——允许覆盖
      // （forkedInitPending 由 reloadWithConfig 置位、此处消费清除）。
      if (
        sid &&
        !isSubagentInit &&
        (state.agentSessionId === undefined ||
          (state.forkedInitPending === true && sid !== state.agentSessionId))
      ) {
        state.agentSessionId = sid;
        state.forkedInitPending = false;
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
        currentAssistantSegmentId: null,
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
    typeSegment: string,
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
    // task-13修复：segmentId 第 3 段用 block type（thinking/text）而非 stream index。
    // 根因：SDK 把一个 turn 的 thinking+text 拆成多条同 mid message（每条 content 从 0），
    // 但 stream content_block_delta.index 是 turn 级累计 → partial(stream index) 与
    // complete(message content index) 对不上 → override 删不到 partial → 半截+全文双发。
    // 用 type 不受消息拆分影响，partial 与 complete 稳定对齐（thinking 巧合对齐不再依赖）。
    const idx = typeSegment;
    const prefix = buf.parentKey;
    if (mid) {
      return `${prefix}:${mid}:${idx}`;
    }
    // 退化：同 turn 共享 segmentId（接受合并精度损失，边界 6）。
    const runKey = state.currentRunId ?? 'unknown';
    return `${prefix}:${runKey}:thinking`;
  }

  /**
   * task-11 / task-06：从完整 assistant message 提取所有 thinking 与 assistant text
   * block 的 segmentId。
   *
   * 遍历 `msg.message.content` 数组：
   * - `type==='thinking'`（task-11）用其数组下标拼 segmentId；
   * - `type==='text'`（task-06）用同结构 segmentId（`parentKey:mid:i`）。
   * segmentId 与 partial 端 `_resolveSegmentId` 严格同格式（`messageId:blockIndex`，
   * parentKey 前缀由入参提供，与 partial 的 buf.parentKey 同源），使完整 message
   * 到达时 emit 的 [ASSISTANT_OVERRIDE]（task-07）能命中 partial 行的 segmentId 撤回。
   * messageId 优先用 `msg.message.id`；缺失时退化到 currentRunId:thinking
   * （同 _resolveSegmentId 策略，仅 thinking 分支退化，assistant text 不退化见下）。
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
      if (!block) continue;
      if (block.type === 'thinking') {
        // task-03 / D-002：segmentId 带 parentKey 前缀，与 _resolveSegmentId 对齐
        //（partial/complete 同前缀，completedSegments 守卫不跨 agent 误判）。
        segments.add(mid ? `${parentKey}:${mid}:thinking` : `${parentKey}:${runKey}:thinking`);
      } else if (block.type === 'text') {
        // task-06（FR-02 / D-002@v1）：assistant text block completed segmentId，
        // 与 task-05 partial（_resolveSegmentId → `parentKey:mid:idx`，idx=ev.index）
        // 严格同格式（parentKey + mid + content 数组下标 i）。注意 assistant text 不
        // 退化到 runKey:thinking——partial 端 mid 缺失时 idx='thinking' 仍走
        // `prefix:mid:thinking` 不会是 runKey 分支（除非 mid 也缺失），故此处只在 mid
        // 存在时提取（mid 缺失的退化场景由 thinking 分支覆盖，assistant 无独立退化态，
        // 与 partial 退化口径一致：partial assistant 同样 mid 缺失才退化 runKey:thinking）。
        if (mid) {
          segments.add(`${parentKey}:${mid}:text`);
        }
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
          // ql-20260710-001：cache_*_input_tokens 是**会话级累计快照**（非 per-call
          // 增量），改 replace 语义（对齐 batch stream-json.ts:552/1143-1148）。原 +=
          // 会被下方 message_delta 的 delta 再叠加一次 → 翻倍（见
          // session-manager-usage-cache.test.ts）。
          if (startUsage && typeof startUsage['cache_read_input_tokens'] === 'number') {
            buf.sessionCacheReadTokens = startUsage['cache_read_input_tokens'] as number;
          }
          if (startUsage && typeof startUsage['cache_creation_input_tokens'] === 'number') {
            buf.sessionCacheCreationTokens = startUsage['cache_creation_input_tokens'] as number;
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
            const segId = this._resolveSegmentId(state, buf, 'thinking');
            if (buf.completedSegments.has(segId)) {
              return;
            }
            buf.currentSegmentId = segId;
            buf.thinking += delta.thinking;
          } else if (delta.type === 'text_delta' && typeof delta.text === 'string') {
            // task-05（D-002@v1）：assistant text partial segmentId，照搬 thinking_delta
            //（:2571-2576）口径——复用 _resolveSegmentId(state, buf, ev.index)，使 partial
            // segmentId 与 task-06 _extractCompletedSegments 的 text block segmentId
            //（${parentKey}:${mid}:${i}）严格一致，override（task-07 扩 assistant）才能命中。
            // late text_delta 守卫（同 thinking：完整 message 已覆盖该 segment → 丢弃）。
            const textSegId = this._resolveSegmentId(state, buf, 'text');
            if (buf.completedSegments.has(textSegId)) {
              return;
            }
            buf.currentAssistantSegmentId = textSegId;
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

          // ql-20260710-001：cache 两维 replace（会话级累计快照，取最新 cumulative 值覆盖），
          // 不再 delta 累加——message_start 已 replace 设值，此处再 delta 会翻倍。仅当
          // message_delta 携带该字段时覆盖；缺失则保留 message_start 的值不变。对齐
          // batch stream-json.ts:552（message_delta replace 而非 += delta）。
          if (typeof u['cache_read_input_tokens'] === 'number') {
            buf.sessionCacheReadTokens = u['cache_read_input_tokens'] as number;
          }
          if (typeof u['cache_creation_input_tokens'] === 'number') {
            buf.sessionCacheCreationTokens = u['cache_creation_input_tokens'] as number;
          }

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
      const segmentId = buf.currentSegmentId ?? this._resolveSegmentId(state, buf, 'thinking');
      const formatted = {
        event_type: 'text',
        content: `[THINKING] ${thinking}`,
        channel: 'stdout',
        metadata: { thinking: true, segmentId, isPartial: true },
      } as unknown as SDKMessage;
      attachUsage(formatted);
      // 记录已 flush 的 segment（完整 message 到达时据此 emit override 信号）。
      // task-07：标 kind:'thinking'——_emitOverrideSignals 据此选 [THINKING_OVERRIDE] 前缀
      // + thinking:true metadata（与 assistant override 分流）。
      buf.flushedSegments.push({ segmentId, logTimestamp: new Date().toISOString(), kind: 'thinking' });
      await this.deps.onTurnMessage(sessionId, runId, formatted);
      // 清空 currentSegmentId（下批 delta 会重新解析；text_delta 不污染）。
      buf.currentSegmentId = null;
    }
    if (assistant) {
      // task-05（FR-02 / D-002@v1）：assistant partial 行携带 segmentId + isPartial，
      // 照搬 thinking partial（:2718-2733）口径，使完整 message 到达时 _emitOverrideSignals
      //（task-07 扩 assistant）能 emit [ASSISTANT_OVERRIDE] 撤回本 partial 行，
      // 消除「已 flush 半截 + 完整全文」双发（#35）。
      // segmentId 复用 buf.currentAssistantSegmentId（text_delta 累积时由 _resolveSegmentId
      // 解析，:2589-2598），缺失退化到 _resolveSegmentId(state, buf, undefined)——
      // 与 task-06 _extractCompletedSegments 的 text block segmentId（${parentKey}:${mid}:${i}）
      // 严格同格式，override 才能命中。
      // 注意：metadata **不带 thinking:true**（B2，assistant 不是 thinking，否则被 thinking
      // override 链路误撤）。
      const segmentId =
        buf.currentAssistantSegmentId ?? this._resolveSegmentId(state, buf, 'text');
      const formatted = {
        event_type: 'text',
        content: `[ASSISTANT] ${assistant}`,
        channel: 'stdout',
        metadata: { segmentId, isPartial: true },
      } as unknown as SDKMessage;
      attachUsage(formatted);
      // 记录已 flush 的 segment（完整 message 到达时据此 emit override 信号，对齐 thinking）。
      // task-07：标 kind:'assistant'——_emitOverrideSignals 据此选 [ASSISTANT_OVERRIDE]
      // 前缀，metadata **不带 thinking:true**（B2，assistant override 不走 thinking 链路）。
      buf.flushedSegments.push({
        segmentId,
        logTimestamp: new Date().toISOString(),
        kind: 'assistant',
      });
      await this.deps.onTurnMessage(sessionId, runId, formatted);
      // 清空 currentAssistantSegmentId（下批 delta 会重新解析）。
      buf.currentAssistantSegmentId = null;
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
    // task-05：同步清 assistant partial segmentId（对齐 currentSegmentId，turn 边界重置）。
    buf.currentAssistantSegmentId = null;
    // P1 修复：保留 currentMessageId。完整 assistant message 与 message_start
    // 共享同一 message.id，late partial delta（content_block_delta 自身不带 id）
    // 必须据此解析 segmentId 才能与 completedSegments 对齐 → 守卫才能拦截。
    // 下一条 message_start 会自然覆盖；在此清空会让 late delta 退化为
    // runId:thinking → 守卫失效。
  }

  /**
   * task-11：对「已 flush 过 + 完整 message 已覆盖」的 segment emit override 覆盖信号。
   * task-07 扩 assistant：按 kind 分流两种信号（信号前缀 + metadata 不同）：
   * - kind:'thinking'  → `[THINKING_OVERRIDE] <segmentId>`，metadata { thinking:true, segmentId, stale:true }
   * - kind:'assistant' → `[ASSISTANT_OVERRIDE] <segmentId>`，metadata { segmentId, stale:true }
   *   **严禁 thinking:true**（B2：否则被 backend thinking override 链路误撤 assistant partial）。
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
    flushedSnapshot: Array<{
      segmentId: string;
      logTimestamp: string;
      kind: 'thinking' | 'assistant';
    }>,
  ): Promise<void> {
    if (completedSegments.size === 0 || !runId) return;
    const overrides = flushedSnapshot.filter((s) =>
      completedSegments.has(s.segmentId),
    );
    if (overrides.length === 0) return;
    await Promise.all(
      overrides.map((s) => {
        // task-07：按 kind 选信号前缀 + metadata。assistant 分支 metadata 严禁
        // thinking:true（B2），否则被 backend thinking override 链路误撤。
        const isAssistant = s.kind === 'assistant';
        const content = isAssistant
          ? `[ASSISTANT_OVERRIDE] ${s.segmentId}`
          : `[THINKING_OVERRIDE] ${s.segmentId}`;
        const metadata = isAssistant
          ? { segmentId: s.segmentId, stale: true }
          : { thinking: true, segmentId: s.segmentId, stale: true };
        return this.deps.onTurnMessage(sessionId, runId, {
          event_type: 'text',
          content,
          channel: 'stdout',
          metadata,
        } as unknown as SDKMessage);
      }),
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
    // task-08：清理 budget 软切断状态（session 已 end/fail，不再可能 inject）。
    this._sessionBudgetTokens.delete(sessionId);
    this._overBudgetSessions.delete(sessionId);
  }
}
