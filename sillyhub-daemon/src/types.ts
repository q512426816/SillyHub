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
 * task-08（D-006@v1）：平台下发的 LLM 供应商配置（中性 snake_case 结构）。
 *
 * backend `build_claim_payload` 按 lease→user 解析默认 provider 后解密 api_key，
 * 经 lease 字段下发；daemon spawn-env 第 0 层调 `CredentialInjector.toEnv` 翻译成
 * 各 agent 认得的 env（design §7 注入器 TS 块）。
 *
 * 字段与 task-06 后端 provides 完全一致（8 字段 snake_case，对齐
 * ExecutionContextPayload 风格）；缺省 / absent → daemon 走现有三层 env 兜底（D-007 零回归）。
 * api_key 为明文（backend 已解密），严禁入 submitMessages / complete_lease / 日志（R-02）。
 */
export interface ProviderConfig {
  /** agent 种类（如 'claude'），决定用哪个 CredentialInjector（D-006）。 */
  agent_kind: string;
  /** API 接口地址 → ANTHROPIC_BASE_URL（claude）。 */
  base_url?: string;
  /** API 密钥（明文，backend 已解密）→ env[auth_field]。 */
  api_key?: string;
  /** 认证 env 名：'ANTHROPIC_AUTH_TOKEN' | 'ANTHROPIC_API_KEY'（缺省前者，X-13）。 */
  auth_field?: string;
  /** 默认模型简写（= default_fallback_model 兼容）→ ANTHROPIC_MODEL 兜底。 */
  model?: string;
  /**
   * 角色映射 {sonnet/opus/fable/haiku: {display?, model?, one_m?}}
   * → ANTHROPIC_DEFAULT_{ROLE}_MODEL（仅 model 非空注入；D-011）。
   * one_m=true 时模型名追加 [1m] 后缀触发 1M 上下文（X-12）。
   */
  model_role_mappings?: Record<string, {
    display?: string;
    model?: string;
    one_m?: boolean;
  }>;
  /** 默认兜底模型 → ANTHROPIC_MODEL（优先于 model，D-010）。 */
  default_fallback_model?: string;
  /** 自定义 env {KEY:VALUE}（Object.assign 注入，可覆盖角色 env，design §7）。 */
  extra_env?: Record<string, string>;
  /**
   * task-05（D-007@v2 / D-009）：高级配置片段（backend `llm_providers.settings_config` 透传）。
   *
   * daemon `toEnv` 仅消费 `settings_config.env`（在 extra_env 之后最后 Object.assign，
   * 覆盖优先级最高，D-007）；其余顶层键（attribution / enabledPlugins /
   * skipDangerousModePermissionPrompt / model）由 daemon 生成 Claude settings.json 处
   * 合并（归 task-06）。**api_key 永不从 settings_config 取**（只走 c.api_key + c.auth_field）。
   * absent / undefined → toEnv `c.settings_config?.env ?? {}` 安全跳过（零回归）。
   */
  settings_config?: {
    env?: Record<string, string>;
    attribution?: { commit?: string; pr?: string };
    enabledPlugins?: Record<string, unknown>;
    model?: string;
    skipDangerousModePermissionPrompt?: boolean;
  };
}

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
   * task-08 / task-09（D-004@v1 / D-005@v1）：平台下发的 LLM 供应商配置。
   * backend `build_claim_payload` 按 lease→user 解析默认 provider 解密后下发；
   * daemon `spawn-env.ts buildSpawnEnv` 第 0 层调 `CredentialInjector.toEnv` 注入
   * ANTHROPIC_* env（最高优先级，盖过三层）。absent / agent_kind 未注册 → 第 0 层
   * 跳过，走现有三层兜底（D-007 零回归）。interactive 经 execPayload 直读（daemon.ts:2817），
   * batch 经 ctx 透传（daemon.ts:3318 → task-runner.ts:549）。
   */
  provider_config?: ProviderConfig;
  /**
   * task-02（2026-07-07-daemon-skill-execution / D-007）：stage 投递元数据。
   * StageDispatchMeta：{change_id, stage, skill_name, workspace_id, spec_root_ref}。
   * backend build_stage_bundle 构造，经 execution-context 下发。daemon 注入 STAGE_META
   * 环境变量（skill 从 process.env 读）+ stage_dispatch 且 prompt 空时构造 skill 调用指令。
   * 保留 snake_case 与 backend/execution-context 一致（task-runner duck typing 读）。
   */
  stage_meta?: Record<string, unknown>;
  /** task-02：是否 stage 投递（控制 skill prompt 构造分支）。 */
  stage_dispatch?: boolean;
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
  /**
   * ql-20260628：spec 同步策略（platform-managed/repo-mirrored/repo-native）。
   * daemon-client workspace 经 build_claim_payload 透传；daemon pullSpecBundle 据此
   * 三分支初始化缓存（platform-managed 拉bundle / repo-mirrored 单次fs.cp / repo-native 建junction）。
   * 缺省/未传 → daemon 按 platform-managed 兼容（D-004）。
   */
  specStrategy?: string;
  /**
   * ql-20260711（init lease 接线修复）：lease mode（init/scan/...）。
   * backend build_claim_payload init 分支下发 mode='init'。task-runner.runLease 据此
   * 走 _runInitLease（不 spawn agent，写 .sillyspec-platform.json + pullSpecBundle）。
   * 历史 bug：daemon._runLeaseStateMachine ctx 构造从未透传 mode → leaseMode==='init'
   * 不命中 → init lease 落入完整 agent spawn 但无 prompt → Claude 等待（从未 work）。
   */
  mode?: string;
  /** ql-20260711：平台配置（init lease 下发，写 .sillyspec-platform.json）。 */
  platformConfig?: Record<string, unknown>;
  /** ql-20260711：最新 spec 版本（init lease 拉取基准，pullSpecBundle 用）。 */
  latestSpecVersion?: number;
  /**
   * task-06（D-007@v2）：lease stage 标记。backend ``dispatch_to_daemon(stage=...)``
   * 写入 lease.metadata.stage，主 agent run 用 ``stage='orchestrator'``（backend
   * ``orchestrator.py:162``）。daemon 侧据此判定本 interactive session 是否 team
   * 主 agent（注入 daemon MCP server 5 tool）。普通 scan/stage/chat session 不传或
   * 传其他值 → 不注入（零回归）。归一化见 daemon ``_runLeaseStateMachine`` execPayload
   * 构造 + ``_startInteractiveSession`` 透传到 ``CreateSessionInput.stage``。
   */
  stage?: string;
  /**
   * task-10（C-12 / FR-10）：profile 限定的 MCP server name 子集。
   *
   * 来自 claim payload（context.py task-07 双写 ``mcpRefs``/``mcp_refs``，源 backend
   * 算自 AgentProfile.mcp_refs）。interactive 路径经 execPayload 归一化透传给
   * ``CreateSessionInput.mcpRefs``，SessionManager 据此对主 agent MCP 注入 ∩ 过滤
   *（mergeMcpConfigs 第三层）；batch 路径经 ctx 透传给 task-runner。undefined/空 →
   * 不过滤（行为同今天，FR-15 向后兼容）。
   */
  mcpRefs?: string[];
  /**
   * task-10（C-12 / FR-10）：profile 限定的技能子集。
   *
   * 来自 claim payload（context.py task-07 双写 ``skillRefs``/``skill_refs``，源
   * AgentProfile.skill_refs）。daemon 承载透传；技能 link 按此取子集的逻辑在
   * spawn 前处理。undefined/空 → 不过滤（全量链接，FR-15）。
   */
  skillRefs?: string[];
  /**
   * task-10（C-12 / D-013 / FR-11）：profile 收紧后的 allowed_roots。
   *
   * 来自 claim payload（context.py task-07 双写 ``effectiveAllowedRoots``/
   * ``effective_allowed_roots``，backend 算自 daemon_roots ∩ overlay，服务端校验
   * overlay⊆daemon_roots 拒超集）。非空时 interactive 写守卫 fallback 路径用此替代
   * allowedRootsProvider（∩ 物理兜底），batch frozenAllowedRoots 采用下推值。
   * undefined/空 → 用原 provider 值（FR-15）。
   */
  effectiveAllowedRoots?: string[];
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
  /**
   * task-08 / task-09（D-004@v1）：平台下发的 LLM 供应商配置（execution-context 端点
   * 是 task-05 之后的最新源，优先覆盖 execPayload）。daemon 在 ctx 构造时
   * `provider_config: execCtx?.provider_config ?? execPayload.provider_config`。
   * 字段形态同 LeaseCtx.provider_config（ProviderConfig 8 字段 snake_case）。
   */
  provider_config?: ProviderConfig;
  /**
   * task-02（2026-07-07-daemon-skill-execution / D-007）：stage 投递元数据。
   * StageDispatchMeta snake_case：{change_id, stage, skill_name, workspace_id, spec_root_ref}。
   * daemon 透传到 ctx.stage_meta，注入 STAGE_META 环境变量 + 构造 skill 调用 prompt。
   */
  stage_meta?: Record<string, unknown>;
  /** task-02：是否 stage 投递。 */
  stage_dispatch?: boolean;
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
