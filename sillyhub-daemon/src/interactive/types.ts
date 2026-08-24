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
import type { UserTurnInput } from './driver.js';
import type {
  InteractiveDriver,
  InteractiveDriverHandle,
  InteractiveDriverMessage,
  InteractiveDriverResult,
} from './driver.js';
// task-07（provider-switch-live-session / D-002@v1）：SessionState.pendingSwitch
// 字段引用中性 ProviderConfig（与 claim payload 同源，backend 解密后下发；仅在
// daemon 内存态持有，不落盘）。type-only，避免运行时循环依赖。
import type { ProviderConfig } from '../types.js';

// ── task-08（2026-08-14-sessions-portal / D-012@v1）：SESSION_SWITCH_CONFIG 契约 ──

/**
 * task-08（design §7.2 / D-012@v1）：切换档案载荷（SessionSwitchConfigPayload.profile）。
 *
 * 档案只含提示词维度（D-013：不派生引擎/模型/供应商）；mcpRefs/skillRefs 仅透传
 * 承载（NG-03：会话内不裁剪）。systemPrompt 对 Codex 为空（原 D-003：人格不注入）。
 */
export interface SessionSwitchProfilePayload {
  /** 新人格提示词（claude → systemPrompt preset+append；codex 忽略）。 */
  systemPrompt?: string;
  /** profile 引用的 MCP server 子集（透传到 state.mcpRefs）。 */
  mcpRefs?: string[];
  /** profile 引用的技能子集（透传到 state.skillRefs）。 */
  skillRefs?: string[];
}

/**
 * task-08（design §7.2 / D-012@v1 / FR-05）：会话内配置热切换原子 payload。
 *
 * backend inject_session 带新配置 + prompt → WS SESSION_SWITCH_CONFIG 下发
 * （daemon.ts 消息路由归 task-09，本类型只定义契约）。
 *
 * 语义：profile=null 表示不切档案；providerConfig=null 表示不切供应商
 * （与 reloadWithProvider(null)=「停止回退本机」不同——切换消息里 null 恒为
 * 「保持现状」，见 design §7.2 注释）。
 */
export interface SessionSwitchConfigPayload {
  /** agent_sessions.id（目标会话）。 */
  sessionId: string;
  /** 切换轮新 AgentRun.id（turn result 上报用）。 */
  runId: string;
  /** 切换轮 claim_token（刷新 state.claimToken，对齐 refreshClaimToken 语义）。 */
  claimToken: string;
  /** 切换轮用户消息（reload 完成后喂入 inputQueue 触发新 turn）。 */
  prompt: string;
  /** 新档案；null=不切档案（保留现 systemPrompt/mcpRefs/skillRefs）。 */
  profile: SessionSwitchProfilePayload | null;
  /** 新供应商配置（结构同 lease claim payload 的 provider_config）；null=不切。 */
  providerConfig: ProviderConfig | null;
}

/**
 * task-04（FR-01~03）：session-manager 向 backend 上报的会话反馈事件联合。
 *
 * 仅包含 plan/Bash/agent_task 三类事件；其它工具事件不上报。
 * 字段名用 camelCase（session-manager 内部口径），cli.ts 桥接时映射为 snake_case body。
 */
export type SessionEventForBackend =
  | {
      kind: 'plan_mode_entered';
      summary: { objective: string; tasks: string[]; design_snippet?: string };
    }
  | {
      kind: 'bash_status';
      command: string;
      status: 'running' | 'completed' | 'failed';
      exit_code?: number;
      elapsed_ms?: number;
    }
  | {
      kind: 'bash_chunk';
      command: string;
      channel: 'stdout' | 'stderr';
      content: string;
      is_final: boolean;
    }
  | {
      kind: 'agent_task_status';
      task_id: string;
      task_name: string;
      status: 'running' | 'completed' | 'failed';
      progress?: number;
      message?: string;
    };

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
  /**
   * ql-20260818-002：人格热切换 reload 用 forkSession=true 起 fork 会话——fork 的
   * system/init 携带**新** session_id，须更新 state.agentSessionId（否则持久化旧
   * id，下次 resume 回到无新人格的旧会话）。该标记在 reload 前置位、init 消费后
   * 清除。仅内存态（不持久化：重启恢复即终态收敛）。
   */
  forkedInitPending?: boolean;
  /**
   * 2026-06-28-daemon-subagent-transcript task-02 / D-007@v1：子代理深度追踪。
   * key = tool_use block id（即子代理消息的 parent_tool_use_id），value = 该子代理
   * 的 depth（主 agent = 0，子 = 父 + 1）。主 agent 发 tool_use 时预登记
   * `subagentDepth[tool_use.id] = msgDepth + 1`；子代理消息按 parent_tool_use_id 查得
   * depth 注入 msg.depth 透传给 backend 落库。跨 turn 复用（不清）。仅内存态不落盘
   *（归属是日志元数据，非 session 恢复必需；恢复后从空 Map 开始）。
   */
  subagentDepth: Map<string, number>;
  /** SDK Query 句柄，长生命周期跨多 turn（spike H2）。 */
  query?: Query;
  /**
   * per-session 输入队列（driver 订阅一次）。
   *
   * task-01（D-001@v1 / D-009@v1 过渡）：driver 归属由 `state.provider` 决定，
   * task-02 起按 provider 从 `SessionManagerDeps.drivers` 选 driver。InputQueue 已
   * 泛型化（默认 UserTurnInput），但现有 Claude 路径仍 push SDKUserMessage，故此处
   * 显式标注 `<SDKUserMessage>` 保持编译等价（FR-10 不回退）；task-02 provider 化时
   * 改为 `InputQueue<UserTurnInput>` 并由 Claude driver 内部做形态转换。
   */
  inputQueue: import('./input-queue.js').InputQueue<UserTurnInput>;
  /** 当前 turn 的 AgentRun.id（backend 在 inject 时创建并下发）。 */
  currentRunId?: string;
  /** 当前 turn 状态：active=空闲可接 inject，running=turn 执行中。 */
  status: SessionStatus;
  /** 最后活动时间（D-004 空闲 30min 回收，task-07 实现）。 */
  lastActiveAt: number;
  /** 固定 cwd（resume 还原用，spike D3）。driver.start 必须用 state.cwd。 */
  cwd: string;
  /**
   * provider（claude；codex 后续 CodexAppServerDriver 单独）。
   *
   * task-01（D-001@v1）：driver 归属由此字段决定，task-02 起按 provider 从
   * `SessionManagerDeps.drivers` 选 driver（interrupt 路由校验不串 provider，E5）。
   */
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
  /**
   * D-001@v1（task-02）：本 session 归属的 provider driver。create/restore 时由
   * `_getDriver(provider)` 解析后写入。Claude/Codex session 各自持有对应 driver，
   * interrupt/consume 按 `state.driver ?? _drivers.claude` 路由，不串 provider。
   *
   * task-02 前创建的旧内存 state 无此字段 → interrupt/consume fallback `_drivers.claude`
   *（兼容，FR-10 不回退）。
   */
  driver?: InteractiveDriver;
  /**
   * D-001@v1（task-02）：driver 句柄（Codex 用 InteractiveDriverHandle）。
   * Claude 路径仍用 `state.query`（SDK Query）；Codex 路径用本字段。
   * 互斥：claude session 填 query，codex session 填 driverHandle。
   */
  driverHandle?: InteractiveDriverHandle;
  /**
   * D-002/D-006（task-02）：provider-neutral executable path。
   * codex = codex CLI path；claude = claude exe（与 pathToClaudeCodeExecutable 并存）。
   * create 时优先用本字段，缺省回退 pathToClaudeCodeExecutable。落盘时 codex session
   * 写本字段，claude session 继续写 pathToClaudeCodeExecutable（R8）。
   */
  pathToAgentExecutable?: string;
  /**
   * task-06（D-007@v2）：lease stage 标记（来自 CreateSessionInput.stage）。
   * snapshotPersistable 输出到 PersistedSessionRecord.stage；restoreAndReconnect
   * 从 record.stage 恢复。主 agent（stage='orchestrator'）据此重新注入 MCP tool。
   */
  stage?: string;
  /**
   * task-10（C-12 / FR-10）：profile 限定的 MCP server name 子集。
   *
   * 来自 claim payload.mcpRefs（context.py task-07 透传 lease.metadata.mcp_refs，
   * backend 算自 AgentProfile.mcp_refs）。非空时 SessionManager 对主 agent MCP 注入
   *（mainAgentMcpConfigProvider 返回的配置表）按此 ∩ 过滤（经 mergeMcpConfigs 第三层），
   * 只让 profile 引用的 MCP server 被 agent discover。
   *
   * undefined/空 → 不过滤（行为同今天，FR-15 向后兼容）。普通会话（非主 agent）无 MCP
   * 注入，本字段无作用。仅内存态 + 持久化恢复用（snapshotPersistable 输出）。
   */
  mcpRefs?: string[];
  /**
   * task-10（C-12 / FR-10）：profile 限定的技能子集。
   *
   * 来自 claim payload.skillRefs（context.py task-07 透传 lease.metadata.skill_refs）。
   * SessionManager 仅做承载 + 持久化；技能 link 按 skillRefs 取子集的逻辑在 daemon.ts
   * linkSkillsToWorkdir（skill-manager.ts，本任务 allowed_paths 外），由 daemon 侧在
   * spawn 前读取并收紧。undefined/空 → 不过滤（全量链接，FR-15）。
   */
  skillRefs?: string[];
  /**
   * task-10（C-12 / D-013 / FR-11）：profile 收紧后的 allowed_roots。
   *
   * 来自 claim payload.effectiveAllowedRoots（context.py task-07 透传
   * lease.metadata.effective_allowed_roots，backend 算自 daemon_roots ∩ overlay，
   * 服务端校验 overlay⊆daemon_roots 拒超集）。非空时写守卫 fallback 路径
   *（_wrapWithWriteGuard 无 policyEngine 时）用此替代 allowedRootsProvider 值，
   * ∩ 物理 provider 兜底（防 backend 算的 effective 含已失效路径）。
   *
   * undefined/空 → 用原 allowedRootsProvider 值（FR-15 向后兼容）。
   * **注**：policyEngine 注入时（task-14 主路径），写校验走 PolicyEngine.canWrite
   * 按 runtimeId 缓存，本字段不参与（policyEngine 路径的 overlay 收紧由 backend
   * 下推 PolicyCache.update 做，不经 SessionManager）。
   */
  effectiveAllowedRoots?: string[];
  /**
   * task-05（2026-08-13-profile-system-prompt-injection）：profile.system_prompt。
   * create 路径从 CreateSessionInput、restore 从 PersistedSessionRecord 归一化填入。
   * 非空时 _buildDriverOptions 设 SDK systemPrompt preset+append（保留 claude 默认 +
   * 追加档案提示词）。undefined → 不注入（行为同今天）。
   */
  systemPrompt?: string;
  /**
   * task-07（provider-switch-live-session / D-002@v1）：待处理的供应商热切换标记。
   *
   * 来源：backend set/unset_default → WS PROVIDER_CONFIG_CHANGED → daemon →
   * ``SessionManager.markPendingSwitch``。生成中 turn（status=running）收到切换时
   * 仅覆盖写本字段，**严格不中断**当前 turn；turn 收尾（``_onResult``）检测到本字段
   * 非空 → 清标记并调 ``reloadWithProvider`` 在 turn 边界完成切换（D-002@v1 等 turn
   * 边界语义）。空闲 session 收到切换由 markPendingSwitch 立即 reload，**不**写本字段。
   *
   * 结构 ``{ providerConfig }``：providerConfig 为新供应商配置；null 表示停止
   *（回退 daemon 宿主机本机凭证，D-004@v1，第 0 层 env 跳过）。
   *
   * **仅内存态**：不进 snapshotPersistable 白名单（禁止落盘——daemon 重启后由
   * lease/claim 重新注入当前默认供应商，不恢复 pendingSwitch）。覆盖写幂等
   *（WS 重放同一/不同切换均覆盖，不累积，design R-02）。
   */
  pendingSwitch?: { providerConfig: ProviderConfig | null };
  /**
   * task-08（2026-08-14-sessions-portal / D-012@v1）：当前会话级供应商配置。
   *
   * 来源：SESSION_SWITCH_CONFIG 切换供应商后由 reload 内核写入（create 路径沿用
   * claim payload 注 env 的既有链路，不经本字段）。后续 reload（如只切档案）用它
   * 重建 env，保证「切换只影响本会话」且连续切换不回退。null = 显式回退本机默认。
   *
   * 持久化：snapshotPersistable 非空时写入 record.providerConfig（design §5 Wave2
   * 「daemon 重启 resume 不丢配置」）；daemon 重启恢复经 restoreAndReconnect 重建 env。
   * sessions.json 本机 0600（与 credentials.json 同信任域）。
   */
  providerConfig?: ProviderConfig | null;
  /**
   * task-08（2026-08-14-sessions-portal / FR-05 / D-012@v1）：待处理的会话级配置
   * 热切换标记（等 turn 边界）。
   *
   * 来源：backend inject_session → WS SESSION_SWITCH_CONFIG（task-09 daemon.ts 路由）
   * → ``markPendingConfigSwitch``。running turn 收到切换时仅覆盖写本字段，严格不
   * 中断当前 turn；turn 收尾（``_onResult``）检测到本字段非空 → 清标记并调
   * ``reloadWithConfig``（close 旧 query → 新配置 driverOpts → resume → 喂 prompt）。
   * 空闲 session 收到切换由 markPendingConfigSwitch 立即执行，不写本字段。
   *
   * 覆盖写幂等（WS 重放安全，不累积）。仅内存态：daemon 重启由 backend 侧会话三列
   * （agent_sessions.agent_profile_id/llm_provider_id）重新下发，不恢复本标记。
   */
  pendingConfigSwitch?: { payload: SessionSwitchConfigPayload };
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
  /**
   * D-002/D-006（task-02）：provider-neutral executable path。
   * codex session 由 daemon 用 `_agentPaths.get('codex')` 填；claude session 不填
   *（继续用 pathToClaudeCodeExecutable）。create 时优先用本字段，缺省回退
   * pathToClaudeCodeExecutable。
   */
  pathToAgentExecutable?: string;
  /**
   * task-06（D-007@v2）：lease stage 标记（来自 lease.metadata.stage）。
   *
   * daemon ``_startInteractiveSession`` 从 execPayload.stage 透传。SessionManager
   * 注入的 ``isMainAgentSession`` 谓词读本字段判定是否主 agent（``stage==='orchestrator'``）
   * → 主 agent 注入 daemon MCP server 5 tool。普通 scan/stage/chat 不传或其他值 → 不注入。
   */
  stage?: string;
  /**
   * task-10（C-12 / FR-10）：profile 限定的 MCP server name 子集。
   *
   * daemon ``_startInteractiveSession`` 从 execPayload.mcpRefs 透传（claim payload
   * 双写 camelCase+snake_case，daemon 归一化取 camelCase）。非空时主 agent session
   * 的 MCP 注入按此 ∩ 过滤（mergeMcpConfigs 第三层）。undefined/空 → 不过滤（FR-15）。
   */
  mcpRefs?: string[];
  /**
   * task-10（C-12 / FR-10）：profile 限定的技能子集。
   *
   * daemon ``_startInteractiveSession`` 从 execPayload.skillRefs 透传。SessionManager
   * 承载到 state（+持久化）；技能 link 收紧在 daemon.ts spawn 前处理。undefined/空 → FR-15。
   */
  skillRefs?: string[];
  /**
   * task-10（C-12 / D-013 / FR-11）：profile 收紧后的 allowed_roots。
   *
   * daemon ``_startInteractiveSession`` 从 execPayload.effectiveAllowedRoots 透传。
   * 非空时写守卫 fallback 路径用此替代 allowedRootsProvider（∩ 物理兜底）。
   * undefined/空 → 用原 provider 值（FR-15）。
   */
  effectiveAllowedRoots?: string[];
  /** task-05：profile.system_prompt（create 透传，见 SessionState 注释）。 */
  systemPrompt?: string;
}

/** inject 返回值（runId 由 backend 在 inject 时已创建）。 */
export interface InjectResult {
  runId: string;
}

/** SessionManager 持有的依赖（便于注入 mock driver + backend 通知回调）。 */
export interface SessionManagerDeps {
  /**
   * D-001@v1：provider driver registry。SessionManager 按 session.provider 选取。
   * task-02 在 create/restoreAndReconnect/interrupt 接线；本任务（task-01）仅扩字段类型。
   * 缺某 provider 的 create 由 task-02 抛 `UnsupportedProviderError`（E1）。
   *
   * task-01 Reverse Sync：蓝图伪代码标 `drivers`（必填），但 cli.ts/测试 mock 现有
   * 构造只传 `driver`，必填会连锁报缺字段（cli.ts 不在 allowed_paths）。为满足 AC-05
   *（typecheck 全绿）且不动 cli.ts/mock，本任务标 optional；task-02 接线后改必填。
   */
  drivers?: Partial<Record<'claude' | 'codex', InteractiveDriver>>;
  /**
   * @deprecated 兼容入口（task-02 起 SessionManager 构造函数内映射到 drivers.claude）。
   *
   * task-01 Reverse Sync：蓝图伪代码标 `driver?`（optional），但 session-manager.ts
   * 现有 `this.deps.driver.xxx` 调用多处，改 optional 会连锁报 possibly undefined，
   * 需改 session-manager 逻辑（违反"仅类型标注"约束）。为满足 AC-05（typecheck 全绿）
   * 且不动 session-manager 业务逻辑，本任务保持 `driver` 非可选；task-02 接线
   * `drivers` 后将其改 optional 并迁移到 drivers.claude。
   */
  driver: import('./claude-sdk-driver.js').ClaudeSdkDriver;
  /** backend 通知回调：result 触发关闭 AgentRun（task-05 真正实现，本任务用 mock）。
   *
   * task-02（D-008@v1）：参数类型放宽为 provider-neutral 联合。Claude driver 传
   * SDKResultMessage（联合子集）；Codex driver 传 InteractiveDriverResult（flat 契约）。
   * SessionManager 不读 provider 专属字段，透传给 daemon.onTurnResult（daemon 按 provider 解释，task-06）。 */
  onTurnResult: (
    sessionId: string,
    runId: string,
    result: SDKResultMessage | InteractiveDriverResult,
  ) => void | Promise<void>;
  /** 中间消息 → submit AgentRunLog（task-06 SSE，本任务用 mock）。
   *
   * task-02（D-008@v1）：参数类型放宽。Claude driver 透传 SDKMessage 原对象（鸭子
   * 类型满足 Record）；Codex driver 传 flat InteractiveDriverMessage。daemon 按 provider 归一化。 */
  onTurnMessage: (
    sessionId: string,
    runId: string,
    msg: SDKMessage | InteractiveDriverMessage,
  ) => void | Promise<void>;
  /** session 终态通知 backend（end/failed → backend end_session，task-05 实现）。 */
  onSessionEnd: (
    sessionId: string,
    status: SessionStatus,
  ) => void | Promise<void>;
  /**
   * task-04（FR-01~03）：会话反馈事件上报回调（plan/Bash/agent_task）。
   *
   * additive-optional：未注入时 session-manager 内部识别逻辑照常运行，但不上报 backend，
   * 保持测试 mock 与旧构造点零影响。
   */
  onSessionEvent?: (
    sessionId: string,
    runId: string,
    event: SessionEventForBackend,
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
// **白名单**：只写上列字段；禁止写 claim token / credential / prompt 轮次内容 /
// agent 输出 / Query 句柄 / InputQueue（不可序列化且敏感）。
// task-08（sessions-portal）例外：record.systemPrompt（task-05 起的人格提示词快照）
// 与 record.providerConfig（会话级供应商配置，含 api_key）按 design §5 Wave2 落盘
// ——「daemon 重启 resume 不丢配置」；sessions.json 本机 0600，与 credentials.json
// 同信任域。

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
  /** 恢复 driver 用（可空，空则恢复时重探，D-009）。
   *
   * 语义升级（task-02 R8/D-002）：provider executable path。Claude 优先用此字段；
   * Codex 用下方 pathToAgentExecutable。旧字段保留向后兼容已落盘 sessions.json。 */
  pathToClaudeCodeExecutable?: string;
  /**
   * D-002（task-02 R8）：provider-neutral executable path（Codex path 恢复用）。
   * 与 pathToClaudeCodeExecutable 并存；codex session 落盘写本字段。可选，向后兼容。
   */
  pathToAgentExecutable?: string;
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
  /**
   * task-06（D-007@v2）：lease stage 标记（主 agent 恢复用）。
   *
   * create 时从 ``CreateSessionInput.stage`` 写入 state.stage；snapshotPersistable
   * 输出到 record.stage，让 restoreAndReconnect 跨 daemon 重启恢复主 agent 身份
   *（``stage==='orchestrator'`` → 重新注入 daemon MCP server 5 tool）。普通 scan/
   * stage/chat session 不写（undefined）→ 恢复后不注入 MCP（零回归）。
   */
  stage?: string;
  /**
   * task-10（C-12）：profile MCP 子集（恢复后重新过滤主 agent MCP 注入用）。
   * create 时从 ``CreateSessionInput.mcpRefs`` 写入；恢复时 ``_resolveMainAgentMcp``
   * 据此再次 ∩ 过滤。undefined/空 → 恢复后不过滤（FR-15）。
   */
  mcpRefs?: string[];
  /** task-10（C-12）：profile 技能子集（承载透传，恢复后 daemon 侧 link 用）。 */
  skillRefs?: string[];
  /**
   * task-10（C-12 / D-013）：profile 收紧后的 allowed_roots（恢复后续写守卫用）。
   * create 时从 ``CreateSessionInput.effectiveAllowedRoots`` 写入；恢复后写守卫
   * fallback 据此替代 allowedRootsProvider。undefined/空 → 恢复后用 provider 值。
   */
  effectiveAllowedRoots?: string[];
  /** task-05：profile.system_prompt 落盘（resume 时重新注入 systemPrompt）。 */
  systemPrompt?: string;
  /**
   * task-08（2026-08-14-sessions-portal / design §5 Wave2）：会话级供应商配置快照。
   *
   * reloadWithConfig 切换供应商后落盘；restoreAndReconnect 据此重建 env（daemon
   * 重启 resume 不丢配置）。缺省（旧 sessions.json 无此字段）→ 恢复走本机凭证链
   * （向后兼容，design §9）。非 null 才落盘（null=本机默认=缺省语义等价）。
   *
   * 注：含 api_key 明文。sessions.json 是本机 0600 文件（与 credentials.json 同
   * 信任域），且 design §5 Wave2 明确要求重启不丢配置；task-10 白名单的「禁 API
   * key」原指不落 daemon 运行日志 / 回传 backend，本字段是恢复必需的会话配置。
   */
  providerConfig?: ProviderConfig;
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
