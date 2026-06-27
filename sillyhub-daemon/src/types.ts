/**
 * sillyhub-daemon 共享类型定义。
 *
 * 本文件只导出 type / interface，不含任何运行时代码。
 * 字段名与 Python 源 dataclass 1:1 对应（snake_case → snakeCase 不做，
 * 保持 Python 原名以便对照调试；与 server JSON 契约一致）。
 *
 * 来源对照：
 *   - AgentEvent IR:        design.md §7.1（方案B 深化）+ backends/__init__.py:19-31
 *   - TaskResult:           task_runner.py:36-48
 *   - BackendTaskResult:    backends/__init__.py:34-43
 *   - TaskState:            protocol.py:23-27
 *   - DaemonMessage:        daemon.py:239-256
 *   - LeaseCtx / payload:   task_runner.py:77-105 + daemon.py:199-206
 *   - LeaseClaimResult:     daemon.py:280-306
 *   - LeaseMessage:         task_runner.py:285-311
 *   - LeaseCompleteResult:  daemon.py:318-329
 */

// 消息类型字符串字面量 union，来自 protocol.ts（task-03 产出）。
// 仅 type-only import，不引入运行时依赖。
import type { MsgType } from './protocol.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Agent 事件 IR（统一中间表示）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agent 事件类型字面量 union（方案B IR 深化版）。
 *
 * 对应 Python `backends/__init__.py:23` 的 event_type 注释，但收敛为 5 元组：
 *   - Python 原 6 种：text, tool_use, tool_result, thinking, status, error
 *   - Node IR 5 种：text, tool_use, tool_result, error, complete
 * thinking / status 两类事件合入 `type: 'text'` + metadata.status/thinking。
 */
export type AgentEventType =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'complete';

/**
 * 单条 agent 事件 IR。所有协议 adapter 的 parse() 产出此结构。
 *
 * 对照 Python `backends/__init__.py:19-31` 的 AgentEvent dataclass：
 *   event_type      → type（rename，避免与 JS 联想混淆）
 *   content         → content（保留）
 *   tool_name       → metadata.tool_name
 *   call_id         → metadata.call_id
 *   tool_input      → metadata.tool_input
 *   tool_output     → metadata.tool_output
 *   status          → metadata.status
 *   level           → metadata.level
 *   session_id      → metadata.session_id
 */
export interface AgentEvent {
  /** 事件类型，穷举见 AgentEventType。 */
  type: AgentEventType;
  /** 文本内容 / 工具入参 JSON / 工具结果 / 错误信息。空字符串表示无文本。 */
  content: string;
  /**
   * 可选元数据，开放结构。
   * 已知 key（来自 Python dataclass 收敛）：tool_name, call_id, tool_input,
   * tool_output, status, level, session_id, usage, model 等。
   */
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Backend 执行结果（adapter 子进程返回）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * backend 层任务状态字面量。
 * 对照 Python `backends/__init__.py:38` 注释："completed/failed/timeout/aborted"。
 */
export type TaskResultStatus =
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'aborted';

/**
 * Agent 后端（adapter）执行返回的结构化结果。
 *
 * 对照 Python `backends/__init__.py:34-43` 的 TaskResult dataclass：
 *   status, output, error, duration_ms, session_id, events
 * 对应 design.md §7.2 的 BackendExecResult（字段名对齐 Python 原定义）。
 */
export interface BackendTaskResult {
  /** 终态：completed | failed | timeout | aborted。 */
  status: TaskResultStatus;
  /** 累积的文本输出。 */
  output: string;
  /** 错误信息（失败时非空）。Python 默认空串 → 此处可选。 */
  error?: string;
  /** 执行耗时（毫秒）。Python 默认 0。 */
  durationMs?: number;
  /** 会话 ID（多轮续跑用）。Python 默认空串 → 此处可选。 */
  sessionId?: string;
  /** 事件流（若后端保留了完整事件序列）。Python 默认空 list。 */
  events?: AgentEvent[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. TaskRunner 最终结果（提交给 server）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TaskRunner 执行完一个 lease 后产出的最终结果。
 * 被 complete_lease 序列化为 LeaseCompleteResult 提交。
 *
 * 对照 Python `task_runner.py:36-48` 的 TaskResult dataclass 字段 1:1：
 *   success, exit_code, patch, files_changed, insertions, deletions,
 *   output, error, duration_ms, metadata
 */
export interface TaskResult {
  /** 任务是否成功。 */
  success: boolean;
  /** 子进程退出码，0 成功 / 1 失败 / -1 未执行。Python 默认 -1。 */
  exitCode: number;
  /** git diff patch 文本（unified diff）。空串表示无变更。 */
  patch: string;
  /** 变更文件数。 */
  filesChanged: number;
  /** diff 新增行数。 */
  insertions: number;
  /** diff 删除行数。 */
  deletions: number;
  /** 截断后的文本输出（≤ 10000 字符）。 */
  output: string;
  /** 截断后的错误信息（≤ 5000 字符）。 */
  error: string;
  /** 执行耗时（毫秒）。 */
  durationMs: number;
  /** 额外元数据（如 session_id）。Python 默认空 dict。 */
  metadata: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 任务状态
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 任务 / lease 状态字面量 union。
 * 对照 Python `protocol.py:23-27` 的 STATE_* 常量值。
 * （常量值定义在 protocol.ts，此处仅类型。）
 */
export type TaskState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ─────────────────────────────────────────────────────────────────────────────
// 5. WebSocket 消息信封
// ─────────────────────────────────────────────────────────────────────────────

/**
 * daemon ↔ server 之间的通用 WS 消息信封。
 *
 * 对照 Python `daemon.py:239-256` 的 `msg = json.loads(raw_msg)` 结构：
 *   { "type": "daemon:task_available", "payload": { ... } }
 *
 * type 为 MsgType 字面量 union（来自 protocol.ts），
 * payload 为 unknown，由各消息 handler 在使用点用类型守卫/断言收窄。
 */
export interface DaemonMessage<T extends MsgType = MsgType> {
  /** 消息类型字符串，如 "daemon:task_available"。 */
  type: T;
  /** 消息负载，具体形状取决于 type；使用点收窄。 */
  payload: unknown;
}

/**
 * task_available 消息的 payload 形状（DaemonMessage<'daemon:task_available'>）。
 * 对照 Python `daemon.py:259-263` + `_execute_task(payload)`。
 * 实质与 LeasePayload 同构（claim_lease 后再注入 claim_token 等）。
 */
export type TaskAvailablePayload = LeasePayload;

// ─────────────────────────────────────────────────────────────────────────────
// 6. Lease 相关类型
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 凭据占位符配置（tool_config 的形态）。
 * Python `task_runner.py:129` `credential_config = payload.get("tool_config", {})`
 * 传给 credential_manager.build_env，本质是 Record<string, string>。
 */
export type ToolConfig = Record<string, string>;

/**
 * Lease 执行上下文（claim_lease 响应中的 payload 或 task_available 直带）。
 *
 * 对照 Python `task_runner.py:77-150` 的 payload.get(...) 全部字段 +
 * `daemon.py:199-206` 的 poll fallback payload（lease_id, agent_run_id,
 * runtime_id, prompt, provider, cmd_path）。
 *
 * 注：Python 同时出现 `cmd_path`（task_runner:135）和 `cmd`（design §7.5）
 * 两种命名（不同来源/版本），Node 版统一保留双字段可选以兼容。
 */
export interface LeaseCtx {
  /** 服务端 lease 唯一标识。 */
  leaseId: string;
  /** 当前 runtime 标识（注册后由 server 分配）。 */
  runtimeId: string;
  /** agent run 标识（用于 submit_messages 路由）。Python 默认空串。 */
  agentRunId?: string;
  /** workspace 名称（本地 mirror 目录名）。Python 默认 "default"。 */
  workspaceName?: string;
  /**
   * workspace slug（ql-20260617-009）。
   * rootPath 不可访问时作为 mirror 目录名兜底；存在时优先于 workspaceName。
   */
  workspaceSlug?: string;
  /**
   * 真实代码目录（host path，ql-20260617-009）。
   * 存在且本地可访问时优先用作 cwd，跳过 mirror clone；不可访问时回落到 mirror by slug。
   */
  rootPath?: string;
  /** git 仓库 URL。Python 默认 None → null。 */
  repoUrl?: string | null;
  /** git 分支名。Python 默认 "main"。 */
  branch?: string;
  /** 写入 .claude/CLAUDE.md 的内容。Python 默认空串。 */
  claudeMd?: string;
  /** agent provider 名称（claude/codex/...）。Python 默认 "claude"。 */
  provider?: string;
  /** agent CLI 可执行路径（Python 字段名 cmd_path）。 */
  cmdPath?: string;
  /** agent CLI 命令（与 cmdPath 同义，design.md 命名，二选一）。 */
  cmd?: string;
  /** 任务 prompt 文本。 */
  prompt?: string;
  /** 模型名（覆盖 provider 默认）。 */
  model?: string;
  /** 续跑用 session ID。 */
  sessionId?: string;
  /** 恢复指定 session（Python `resume_session_id`）。 */
  resumeSessionId?: string;
  /** 执行超时秒数，0 表示不限。 */
  timeout?: number;
  /**
   * 执行超时秒数（task-10 B2，lease.metadata.timeout_seconds 透传，优先级最高）。
   * 0 = 不限（跳过走 config/兜底），-1 = 显式不限（resolveTimeout 返回 0）。
   * resolveTimeout 优先读 timeoutSeconds，回退 timeout（兼容旧字段）。
   */
  timeoutSeconds?: number;
  /**
   * task-04（D-002@v3）：lease 执行模式分流。
   *   - `batch`（缺省）：现有 TaskRunner 一次性 spawn 路径，零改动（FR-09）。
   *   - `interactive`：SessionManager 同进程多轮（SDK query(AsyncIterable)），不走 TaskRunner。
   * 未定义/未知值一律按 `batch` 兼容（design §9）。
   */
  kind?: 'batch' | 'interactive';
  /**
   * task-04：interactive lease 绑定的 agent_sessions.id（backend 创建并下发）。
   * 仅 kind=interactive 时有意义；batch 路径忽略。daemon 用它做 SessionManager.create 的 sessionId。
   * 兼容 snake_case `agent_session_id`（daemon 在 _runLeaseStateMachine 归一化）。
   */
  agentSessionId?: string;
  /** 凭据/工具配置，渲染成环境变量。 */
  toolConfig?: ToolConfig;
  /**
   * claim_lease 颁发的令牌（WS 流程由 task-20 startLease 前注入；
   * poll 流程由 TaskRunner 内部 _claimTokens map 兜底）。
   * submitMessages / startLease / complete 必须携带，对齐 Python claim_token。
   */
  claimToken?: string;
  /**
   * scan 真阻塞（generic-wibbling-whisper.md 改造点 C/B）：lease/session 是否启用
   * canUseTool 人审（来自 backend lease metadata.manual_approval；scan=true/chat=false）。
   * daemon claim 后透传到 SessionManager.create.manualApproval。
   */
  manualApproval?: boolean;
  /**
   * scan 真阻塞：AskUserQuestion-only 策略（metadata.ask_user_only）。true 时只
   * AskUserQuestion 走人审（歧义决策阻塞），其他工具 allow-through 让 scan 自动跑。
   */
  askUserOnly?: boolean;
  /**
   * ql-20260627：spec 传输模式（tar/shared）。daemon-client workspace → 'tar'（pull/sync）。
   * build_claim_payload 返回，_startInteractiveSession 据此决定是否 pull + set syncCtx。
   */
  transport?: string;
  /**
   * ql-20260627：workspace ID（tar 模式 pullSpecBundle 需要）。
   * build_claim_payload 返回，与 transport 配对使用。
   */
  workspaceId?: string;
}

/**
 * task_available 消息直接携带的 lease 初始 payload。
 * 与 LeaseCtx 同构（task_available 阶段尚无 claim_token）。
 */
export type LeasePayload = LeaseCtx;

/**
 * GET /api/agent-runs/{id}/execution-context 响应（daemon 拉取的完整 bundle 上下文）。
 *
 * 字段名 snake_case 与后端 Pydantic response 一一对齐（task-05 / design §7.3）。
 * daemon 在 claim 之后、startLease 之前用 HubClient.getExecutionContext 拉取，
 * 用本结构覆盖填充 LeaseCtx 的 claudeMd/repoUrl/branch/toolConfig 等字段
 *（当前 ctx 构造时这些字段恒 undefined，需 fetch 后填充）。
 *
 * 注意：本响应与 LeasePayload（camelCase）字段映射：
 *   claude_md       → ctx.claudeMd
 *   repo_url        → ctx.repoUrl
 *   branch          → ctx.branch
 *   provider        → ctx.provider
 *   tool_config     → ctx.toolConfig
 *   resume_session_id → ctx.resumeSessionId
 *   session_id      → ctx.sessionId
 *   prompt          → **不从 fetch 覆盖**（保留 payload.prompt 作最终意图）
 *   allowed_paths   → 暂未消费（task-05 非目标）
 */
export interface ExecutionContextPayload {
  /** 对应 AgentRun id（回显请求路径里的 run_id）。 */
  agent_run_id: string;
  /** 写入 .claude/CLAUDE.md 的完整 bundle 文本。 */
  claude_md: string;
  /** 任务 prompt（dispatch 时传的最终意图，daemon 不覆盖 payload.prompt）。 */
  prompt?: string;
  /** agent provider（claude/codex/...）。 */
  provider?: string;
  /** agent model override. */
  model?: string;
  /** 续跑用 session id（端点是最新源，优先于 payload）。 */
  resume_session_id?: string;
  /** git 远程 URL。 */
  repo_url?: string;
  /** git 分支名。 */
  branch?: string;
  /** 允许访问的路径列表（task-05 非目标，daemon 暂未消费）。 */
  allowed_paths?: string[];
  /** 凭据/工具配置，渲染成环境变量（snake_case Record<string,string>）。 */
  tool_config?: Record<string, string>;
  /** 当前会话 id。 */
  session_id?: string;
  /** ql-20260617-009：workspace 标识 + 真实代码目录（host path）。 */
  workspace_name?: string;
  workspace_slug?: string;
  root_path?: string;
  /** scan 真阻塞：session 是否启用 canUseTool 人审（scan=true/chat=false）。 */
  manual_approval?: boolean;
  /** scan 真阻塞：AskUserQuestion-only 策略。 */
  ask_user_only?: boolean;
}

/**
 * claim_lease 接口的响应结构。
 *
 * 对照 Python `daemon.py:280-306`：
 *   claim_resp.get("claim_token")
 *   claim_resp.get("lease_expires_at")
 *   claim_resp.get("payload")  # 内嵌执行上下文
 */
export interface LeaseClaimResult {
  /** lease 唯一标识（回显）。 */
  leaseId?: string;
  /** 后续 start/messages/complete 必须携带的令牌。 */
  claimToken: string;
  /** claim 过期时间（ISO 字符串或 epoch）。 */
  leaseExpiresAt?: string;
  /** 内嵌的执行上下文（task_available payload 形态）。 */
  payload?: LeasePayload;
}

/**
 * submit_messages 单条消息的序列化结构。
 *
 * 对照 Python `task_runner.py:285-311` 的 _event_to_message 构造：
 *   event_type（必填）, content?, tool_name?, call_id?, status?, level?,
 *   session_id?（条件加入，空值不写）。
 * 此结构与 server `POST /api/daemon/leases/{id}/messages` body.messages 元素对齐。
 */
export interface LeaseMessage {
  /** 事件类型（Python 原始 event_type 字符串，未做 IR 收敛）。 */
  eventType: string;
  /** 文本内容（非空时才序列化）。 */
  content?: string;
  /** 工具名（非空时才序列化）。 */
  toolName?: string;
  /** 工具调用 ID。 */
  callId?: string;
  /** 状态值（status 事件用）。 */
  status?: string;
  /** 日志级别（log/error 事件用）。 */
  level?: string;
  /** 会话 ID（system/result 事件用）。 */
  sessionId?: string;
}

/**
 * complete_lease 提交的 result 字段结构。
 *
 * 对照 Python `daemon.py:318-329` 显式构造的 dict：
 *   success, output, error, patch, files_changed, insertions, deletions,
 *   duration_ms, session_id（从 metadata 取）
 * 即 TaskResult 的「线上序列化形态」。
 */
export interface LeaseCompleteResult {
  success: boolean;
  output: string;
  error?: string;
  patch?: string;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  durationMs?: number;
  /** 从 TaskResult.metadata.session_id 提取。 */
  sessionId?: string;
}
