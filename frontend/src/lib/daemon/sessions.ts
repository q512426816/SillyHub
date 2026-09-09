/**
 * Daemon API client —— 会话 CRUD/查询/权限/dialog 域。列表/历史只读查询族在
 * ./session-lists；SSE 流在 ./session-stream 与 ./group-shadow-stream
 * （类型核心 ./session-sse），排队消息在 ./session-queue。
 *
 * 2026-09-07-arch-large-file-split task-15：自原 lib/daemon.ts 按资源域原样搬移，
 * @/lib/daemon 导入面经 ./index 全量再导出保持零变化。
 */
import { apiFetch } from "@/lib/api";
import type { AgentRunLogEntry } from "@/lib/agent";
import type { components } from "@/lib/api-types";
import type { AgentSessionRead } from "./session-lists";
/* ---------- Session permission approval (task-08 / FR-07 / D-007@v1) ---------- */

/**
 * task-08：canUseTool 远程人审请求事件（SSE event=permission_request）。
 * 对齐 backend permission_service.handle_permission_request publish 的 payload。
 *
 * task-09（FR-09 / D-006@v1 / D-010@v1）：该结构 provider 无关，Codex
 * requestUserInput / 可归一化 MCP elicitation 经 daemon 归一化后复用同一形态。
 */
export interface SessionPermissionRequest {
  session_id: string;
  run_id: string;
  request_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  tool_use_id?: string;
  /**
   * 对话类型标识（provider-neutral dialog 标记）。存在时前端渲染
   * AskUserDialogCard（结构化问答），否则渲染普通 PermissionApprovalCard
   *（allow/deny 二选一）。前端只按是否存在 kind 收卡，不区分具体取值。
   *
   * 取值来源（design §5.3 第5点 / D-010@v1）：
   *   - Claude Code canUseTool AskUserQuestion → "ask_user"
   *   - Codex app-server item/tool/requestUserInput → "codex_request_user_input"
   *   - Codex app-server mcpServer/elicitation/request（可归一化） → "mcp_elicitation"
   * 复杂 MCP elicitation 由 daemon fail-closed，不会产生此 kind 的卡片。
   */
  dialog_kind?: string;
  /**
   * 对话载荷，含 questions 数组
   *（question / header / multiSelect / options[{label,description,preview}]）。
   * 仅当 dialog_kind 存在时有意义。
   *
   * provider 无关（D-010@v1 双向归一化）：daemon（task-05）负责把 Codex
   * requestUserInput / 可归一化 MCP elicitation 归一化成与 Claude AskUserQuestion
   * 同构的 {questions,options}；前端 AskUserDialogCard.parseQuestions 零分支复用，
   * 不识别 Codex 原生 schema。响应回写时 Codex {answers:{[id]:{answers:string[]}}}
   * 的 schema 还原也是 daemon 职责，前端只产出同构的 answers 数组。
   */
  dialog_payload?: Record<string, unknown>;
  /**
   * 2026-07-09-ask-user-question-approval task-05（design §4.4 C4）来源上下文：
   * 查询路（listWorkspaceDialogs）齐全，SSE 路（parseSessionPermissionEvent）
   * 缺省 undefined→前端占位「加载中」，由下一次查询刷新（≤10s）回填。
   *
   * workspace_name 由 task-06 page 侧用已知 workspaceId 本地补，
   * session_type / run_summary 走查询回填。
   */
  /** 工作区名（查询路齐全；SSE 缺省，task-06 page 本地补全）。 */
  workspace_name?: string;
  /** scan / chat / stage（design D-003，backend 推导）。SSE 路缺省。 */
  session_type?: "scan" | "chat" | "stage";
  /** 任务 prompt 派生的上下文一句话（design D-003，可空→前端占位）。SSE 路缺省。 */
  run_summary?: string | null;
  /**
   * 请求创建时间（来源上下文条的「时间」字段，task-08）。
   * 查询路（listWorkspaceDialogs）由 WorkspaceDialogRead.created_at 填充；
   * SSE 路缺省→DialogContextBar 显示「刚刚」占位。
   */
  created_at?: string;
}

/**
 * task-08：审批已 resolve 事件（SSE event=permission_resolved）。
 * reason: 'manual'（用户操作） | 'timeout'（5min 超时 deny）。
 */
export interface SessionPermissionResolved {
  session_id: string;
  request_id: string;
  decision: "allow" | "deny";
  reason?: string;
  /**
   * 2026-09-09-askuser-pi-cursor task-11：实际答题人 user_id（backend task-09
   * 契约字段——影子会话=答题群成员，普通单聊=会话属主）。SSE 事件缺省时无此键
   * （旧后端/普通审批），消费方缺失降级（答题卡关闭态不带名）。
   */
  answered_by_actual_user?: string;
}

/**
 * task-08：POST /api/daemon/sessions/{id}/permissions/{request_id}/response。
 * 用户对一条 permission_request 给 allow/deny，backend 转发 daemon + 取消 5min 定时器。
 *
 * 成功返回 {accepted: true}；失败抛 ApiError（404 已超时/未知 / 504 daemon 离线 / 409 manual=false）。
 */
export async function respondSessionPermission(
  sessionId: string,
  requestId: string,
  decision: "allow" | "deny",
  message?: string,
  /**
   * 对话结果（{answers: [{question, header?, answer}]}）。仅当原 request 携带
   * dialog_kind 时有意义；普通审批不传。
   *
   * task-09（D-010@v1）：answers 结构 provider 无关，与 Claude AskUserQuestion
   * 同构；Codex {answers:{[questionId]:{answers:string[]}}} 的 schema 还原在
   * daemon 侧完成，前端不感知 provider 差异。
   */
  dialog_result?: Record<string, unknown>,
): Promise<{ accepted: boolean }> {
  const body: Record<string, unknown> = { decision };
  if (message !== undefined) body.message = message;
  if (dialog_result !== undefined) body.dialog_result = dialog_result;
  return apiFetch<{ accepted: boolean }>(
    `/api/daemon/sessions/${sessionId}/permissions/${requestId}/response`,
    {
      method: "POST",
      json: body,
    },
  );
}

/**
 * task-05：提交用户对 plan 的决策（confirm / revise / cancel）。
 * POST /api/daemon/sessions/{sessionId}/plan-response，body 字段 snake_case。
 * revise / cancel 时 feedback 必填（调用方应保证，本函数兜底抛 Error）。
 */
export async function submitPlanResponse(
  sessionId: string,
  runId: string,
  decision: "confirm" | "revise" | "cancel",
  feedback?: string,
): Promise<void> {
  if (decision !== "confirm" && (!feedback || feedback.trim() === "")) {
    throw new Error("plan 决策为 revise/cancel 时必须提供 feedback");
  }
  const body: Record<string, unknown> = {
    session_id: sessionId,
    run_id: runId,
    decision,
  };
  if (feedback !== undefined) {
    body.feedback = feedback;
  }
  await apiFetch(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/plan-response`,
    { method: "POST", json: body },
  );
}

/**
 * GET /api/daemon/sessions/{id}/dialogs — 恢复刷新前未回答的 AskUserQuestion
 * 对话（dialog_kind 待答 permission_request）。
 *
 * SSE 只推送实时新事件，页面刷新后已 pending 的对话不会重放，需通过此 REST
 * 端点恢复。返回的 SessionPermissionRequest[] 与 SSE permission_request 同构，
 * 父组件可直接合并到现有 permissionRequests 状态（按 request_id 去重）。
 *
 * 非 AskUserQuestion 的普通 canUseTool 审批不在此端点返回（它们 5min 自动超时）。
 */
export async function fetchPendingDialogs(
  sessionId: string,
): Promise<SessionPermissionRequest[]> {
  return apiFetch<SessionPermissionRequest[]>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/dialogs`,
  );
}

/** GET /dialogs/history 返回的问答记录（与 pending 端点同 schema，含 status/answer）。 */
export type SessionDialogRead = components["schemas"]["SessionDialogRead"];

/**
 * GET /api/daemon/sessions/{id}/dialogs/history — 会话的 AskUserQuestion 完整问答历史
 * (pending + answered)。交互式会话面板用来渲染历史问答：实时卡片回答后即移除
 *（onPermissionResolved）、failed/ended 会话不渲染卡片（该门控原在已删除的
 * interactive-session-panel，现于 session-panel），
 * 已答/历史问答只能靠此 REST 恢复展示。返回 api-types 的 SessionDialogRead。
 */
export async function fetchSessionDialogHistory(
  sessionId: string,
): Promise<SessionDialogRead[]> {
  return apiFetch<SessionDialogRead[]>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/dialogs/history`,
  );
}

/**
 * GET /api/workspaces/{id}/dialogs — workspace 维度 pending AskUserQuestion
 * 对话查询（task-03 端点，design §4.1）。返回 SessionPermissionRequest[]，
 * 含来源上下文（workspace_name/session_type/run_summary），作为 SSE 实时增量
 * 的数据库兜底（刷新不丢，design FR-5）。父组件按 request_id 与 SSE 合并，
 * 查询回填字段覆盖 SSE 占位（design §4.4 C4）。
 *
 * 响应类型用 SessionPermissionRequest[]（task-03 的 WorkspaceDialogRead 字段
 * 是其超集，结构兼容；与 SSE 同构便于父组件直接合并，无需 DTO 映射）。
 */
export async function listWorkspaceDialogs(
  workspaceId: string,
): Promise<SessionPermissionRequest[]> {
  return apiFetch<SessionPermissionRequest[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/dialogs`,
  );
}

/* ---------- Interactive session REST + SSE (task-11 / FR-10 / D-006@v1) ----------
 *
 * 接口签名对齐 design.md §7.4 + task-05 REST 契约，签名固化为搬砖契约。
 * SSE envelope 对齐 task-06 session channel 聚合（事件含 run_id 区分 turn）。
 */

export type InteractiveProvider = "claude" | "codex";

/**
 * task-17（规则 20）：已迁 api-types 生成版 SessionCreateRequest（design §5 Wave1）。
 * manual_approval/ask_user_only 在后端 pydantic 有 default → OpenAPI 标记为必填，
 * 但客户端允许省略（省略即走后端默认 true），故 Omit 后放宽为可选——
 * 字段集合/命名仍锚定生成 schema，漂移会在 gen:types 时暴露。
 *
 * task-13（2026-08-24-session-team-mission-context / FR-05 / D-009@v2）：可选
 * team_mission 块（预会话弹层确认后暂存、首句随 create 上送；后端 create 路径
 * 预建已由 task-09 落地）。task-14 gen:types 后生成版 SessionCreateRequest 已
 * 自带 team_mission?: TeamMissionCreateBlock——本类型的 team_mission 局部扩展
 * 已收敛（不再覆写，直接继承生成字段），漂移由 tsc 暴露。
 *
 * 2026-08-25-session-spec-binding task-09 / FR-06：可选 quicklog_id 短码
 * （创建即落 quicklog 绑定），同为生成版自带字段（本卡 gen:types 引入），
 * 直接继承不覆写。
 *
 * 2026-08-28-session-ppm-task-binding task-04 / FR-01：可选 ppm_item_kind +
 * ppm_item_id 成对绑定（创建即落 ppm_item_session_links），同为生成版自带
 * 字段（本卡 gen:types 引入），直接继承不覆写。
 */
export type SessionCreateRequest = Omit<
  components["schemas"]["SessionCreateRequest"],
  "manual_approval" | "ask_user_only"
> & {
  /** 省略 = 后端默认 true。 */
  manual_approval?: boolean;
  /** 省略 = 后端默认 true。 */
  ask_user_only?: boolean;
};

/**
 * 2026-08-28-session-ppm-task-binding task-04 / FR-01：PPM 条目类型——
 * ``plan_task``=个人计划任务（ppm_plan_task）、``problem``=问题清单
 * （ppm_problem_list）。从生成版 SessionCreateRequest.ppm_item_kind 派生
 * （NonNullable 去掉 null/undefined），单一来源，后端 Literal 变更时
 * gen:types + tsc 即暴露。
 */
export type PpmItemKind = NonNullable<
  components["schemas"]["SessionCreateRequest"]["ppm_item_kind"]
>;

/**
 * task-13（FR-05 / D-010@v1）→ task-14 收敛：createSession 的 team_mission 块。
 * 字段集合 = 后端 TeamMissionCreateBlock 七字段（objective/scope_workspace_ids/
 * project_id/budget_usd/worker_preset/main_agent_config/orchestrator_workspace_id）。
 * gen:types（task-14）后不再手写交集，直接别名生成版——单一来源，后端改字段
 * 时 gen + tsc 即暴露。弹层侧构造用更精确的组件内类型（WorkerPresetItem[] 等），
 * 精确 → 宽松结构安全，见 team-trigger-popover.tsx TeamTriggerPayload 注释。
 */
export type SessionCreateTeamMission = components["schemas"]["TeamMissionCreateBlock"];

export interface SessionCreateResponse {
  session_id: string;
  run_id: string;
  lease_id: string;
  status: string;
  stream_url: string;
}

export interface SessionInjectResponse {
  session_id: string;
  /** ql-20260825-011：忙轮入队时为 null（消息进服务端排队，run 终态后派发）。 */
  run_id: string | null;
  status: string;
  /** ql-20260825-011：true = 已入服务端排队（刷新页面不丢）。 */
  queued?: boolean;
  queue_entry_id?: string | null;
}

export interface SessionControlResponse {
  session_id: string;
  status: string;
  current_run_id: string | null;
}

/**
 * POST /api/daemon/sessions — 创建交互式会话（首 turn）。
 * 对齐 task-05 create_session REST。
 */
export async function createSession(
  input: SessionCreateRequest,
): Promise<SessionCreateResponse> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
  };
  if (input.provider !== undefined) body.provider = input.provider;
  if (input.runtime_id !== undefined) body.runtime_id = input.runtime_id;
  if (input.agent_profile_id !== undefined) {
    body.agent_profile_id = input.agent_profile_id;
  }
  if (input.llm_provider_id !== undefined) {
    body.llm_provider_id = input.llm_provider_id;
  }
  if (input.manual_approval !== undefined) {
    body.manual_approval = input.manual_approval;
  }
  if (input.ask_user_only !== undefined) {
    body.ask_user_only = input.ask_user_only;
  }
  if (input.change_id !== undefined) body.change_id = input.change_id;
  // 2026-08-25-session-spec-binding task-09 / FR-06：快速修复短码绑定
  // （对齐 change_id 先例：有值才带；后端创建落库点写 quicklog_session_links）。
  if (input.quicklog_id !== undefined) body.quicklog_id = input.quicklog_id;
  // 2026-08-28-session-ppm-task-binding task-04 / FR-01：PPM 条目成对绑定
  // （对齐 quicklog_id 先例：有值才带；kind+id 成对上送——半对由后端
  // _require_ppm_item_pair 422 兜底，item 不存在降级普通会话仅 warning）。
  if (input.ppm_item_kind !== undefined) body.ppm_item_kind = input.ppm_item_kind;
  if (input.ppm_item_id !== undefined) body.ppm_item_id = input.ppm_item_id;
  if (input.workspace_id !== undefined) body.workspace_id = input.workspace_id;
  // task-13（FR-05）：预会话团队任务块透传（有值才带；后端 create 路径预建
  // 归 task-09——flush-only 同事务，失败整体回滚）。
  if (input.team_mission !== undefined) body.team_mission = input.team_mission;
  // 2026-08-25-unified-floating-session（FR-5）：悬浮入口页面上下文透传（有值
  // 才带；后端服务端回查注入【页面上下文】前导，缺省零回归）。
  if (input.page_context !== undefined) body.page_context = input.page_context;
  // ql-20260825-001：预会话首句附件透传（有值才带；校验/标记行/组装归后端
  // create 路径，对齐 inject 的 attachment_ids 语义）。
  if (input.attachment_ids !== undefined && input.attachment_ids.length > 0) {
    body.attachment_ids = input.attachment_ids;
  }
  return apiFetch<SessionCreateResponse>("/api/daemon/sessions", {
    method: "POST",
    json: body,
  });
}

/**
 * injectSession 切换参数（2026-08-14-sessions-portal task-16 / FR-02 / D-012@v1）。
 * task-17（规则 20）：迁 api-types 生成版 SessionInjectRequest；prompt 是
 * injectSession 的独立入参（不进 options），故 Omit 掉。
 *
 * 2026-08-29-usage-by-provider-model task-10（FR-03-2）：扩 model——会话级模型
 * 覆盖，空串=跟随供应商配置（与 llm_provider_id 空串=本机默认同语义）。生成版
 * SessionInjectRequest 扩 model 归并行 task-11（gen:types 同提交），落地前先在
 * 此补前端契约；落地后此 Omit+交叉窄化 string，与生成版并存不冲突。
 */
export type SessionInjectOptions = Omit<
  components["schemas"]["SessionInjectRequest"],
  "prompt" | "model"
> & {
  model?: string;
};

/**
 * POST /api/daemon/sessions/{id}/inject — 同一 session 下创建下一 turn（新 AgentRun）。
 * 业务含义是"新一轮追问"，不是写入长驻进程 stdin。
 * options 携带 agent_profile_id/llm_provider_id 时触发轮次配置热切换（FR-02）；
 * model（task-10 / FR-03-2）为会话级模型覆盖，随供应商同请求下发（空串=跟随
 * 供应商配置）。
 */

/** inject 发送超时毫秒数（ql-20260831-006-6d67，见 injectSession 内注释）。 */
const INJECT_TIMEOUT_MS = 30_000;

export async function injectSession(
  sessionId: string,
  prompt: string,
  options?: SessionInjectOptions,
): Promise<SessionInjectResponse> {
  const body: Record<string, unknown> = { prompt };
  // 注意 llm_provider_id === ""（切回本机默认）必须下发，故判 undefined 而非真值。
  if (options?.agent_profile_id !== undefined) {
    body.agent_profile_id = options.agent_profile_id;
  }
  if (options?.llm_provider_id !== undefined) {
    body.llm_provider_id = options.llm_provider_id;
  }
  // 2026-08-29-usage-by-provider-model task-10（FR-03-2）：会话级模型覆盖——
  // model === ""（切回跟随供应商配置）必须下发，判 undefined 同 llm_provider_id。
  if (options?.model !== undefined) {
    body.model = options.model;
  }
  // 2026-08-20-session-multimodal-attachments task-12：附件引用（D-7 豁免空
  // prompt 由 backend DTO 校验；空数组不下发保持既有 payload 形态）。
  if (options?.attachment_ids && options.attachment_ids.length > 0) {
    body.attachment_ids = options.attachment_ids;
  }
  // ql-20260825-004：每轮注入携带当前页面上下文。
  if (options?.page_context !== undefined) {
    body.page_context = options.page_context;
  }
  // 2026-08-26-session-input-mention task-08（FR-06 / D-003）：@ 关联的会话绑定
  // 字段透传（仿 page_context 有值才带，缺省零变化；后端 binder 幂等写 M:N
  // link，不注入 prompt）。bind 业务接线归 task-05（7 发送点位）。
  if (options?.bind_change_key !== undefined) {
    body.bind_change_key = options.bind_change_key;
  }
  if (options?.bind_quick_id !== undefined) {
    body.bind_quick_id = options.bind_quick_id;
  }
  // 2026-08-28-session-ppm-task-binding task-04 / FR-02：@ 联想选中 PPM 任务/
  // 问题时的成对追问绑定（对齐 bind_change_key/bind_quick_id 先例：有值才带，
  // 缺省零变化；后端 binder 幂等写 ppm_item_session_links，不注入 prompt 前导，
  // 半对由后端 _require_ppm_item_pair 422 兜底）。组件接线归 task-05/06。
  if (options?.bind_ppm_item_kind !== undefined) {
    body.bind_ppm_item_kind = options.bind_ppm_item_kind;
  }
  if (options?.bind_ppm_item_id !== undefined) {
    body.bind_ppm_item_id = options.bind_ppm_item_id;
  }
  return apiFetch<SessionInjectResponse>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/inject`,
    {
      method: "POST",
      json: body,
      // ql-20260831-006-6d67：inject 发送超时兜底——后端劣化/网络挂起时请求无限
      // pending，page/dialog 两模式的占位轮永远「排队中」且消息无任何痕迹（刷新
      // 即丢）。30s 超时抛 code="timeout"，两模式既有 catch 消费 message：撤占位
      // 轮 + 错误横幅提示（草稿在失败路径天然保留在输入框，可改后重发）。
      timeoutMs: INJECT_TIMEOUT_MS,
      timeoutMessage: `发送超时（${INJECT_TIMEOUT_MS / 1000}秒）：消息未发出，草稿已保留，请重试`,
    },
  );
}

/**
 * POST /api/daemon/sessions/{id}/interrupt — 只收敛 currentRun，session 保持 active。
 * 返回 current_run_id（null 表示当前无可打断 run）。
 */
export async function interruptSession(
  sessionId: string,
): Promise<SessionControlResponse> {
  return apiFetch<SessionControlResponse>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/interrupt`,
    { method: "POST" },
  );
}

/**
 * POST /api/daemon/sessions/{id}/end — 结束整个 session。
 */
export async function endSession(
  sessionId: string,
): Promise<SessionControlResponse> {
  return apiFetch<SessionControlResponse>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/end`,
    { method: "POST" },
  );
}

/* ---------- Session reopen + detail (task-09 / FR-2 / D-002@v1) ---------- */

/**
 * task-09：reopen 返回体。status 通常为 "active"（已恢复）。
 * 409 业务码（ApiError.code）：
 *   DAEMON_SESSION_RESUME_UNSUPPORTED / DAEMON_SESSION_NO_AGENT_SESSION
 *   / DAEMON_SESSION_NOT_ACTIVE / DAEMON_OFFLINE
 */
export interface SessionReopenResponse {
  session_id: string;
  status: string;
}

/**
 * POST /api/daemon/sessions/{id}/reopen — 恢复已结束的会话（task-05/06 端点）。
 * 错误统一走 apiFetch → ApiError（含 409 业务码）。
 */
export async function reopenSession(
  sessionId: string,
): Promise<SessionReopenResponse> {
  return apiFetch<SessionReopenResponse>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/reopen`,
    { method: "POST" },
  );
}

/**
 * GET /api/daemon/sessions/{id} — 单会话详情（task-06 端点）。
 * reopen 后用于轮询 status，确认会话已恢复 active。
 */
export async function getAgentSession(
  sessionId: string,
): Promise<AgentSessionRead> {
  return apiFetch<AgentSessionRead>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}`,
  );
}

/* ---------- Session usage stats (2026-08-29-session-usage-stats task-03) ---------- */

/**
 * 会话用量按模型聚合行（与 backend daemon/schema.py SessionUsageModelItemRead
 * 同构，task-01 DTO）。model 为桶名（兜底桶 =「未记录」，run.model NULL 归并）；
 * api_requests 仅明细段有来源，「未记录」桶恒 0（诚实值，design R-01，前端脚注声明）。
 */
export interface SessionUsageModelItem {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  api_requests: number;
}

/**
 * 会话累计用量聚合响应（2026-08-29-session-usage-stats，与 backend
 * SessionUsageRead 同构）：totals 五指标 = 明细 + 兜底两段之和（totals.model
 * 为占位值，前端不消费）；by_model 按 input+output 总量降序，「未记录」桶恒末位。
 *
 * api-types 生成物同步说明（D-004 收口）：本类型暂为手写过渡终态——生成版
 * components["schemas"]["SessionUsageRead"] 归 task-05（pnpm gen:types 同步
 * api-types.ts + backend/openapi.json）；落地后消费方改引生成版，后端 schema
 * 漂移届时由 gen:types + tsc 暴露。
 */
export interface SessionUsageRead {
  totals: SessionUsageModelItem;
  by_model: SessionUsageModelItem[];
}

/**
 * GET /api/daemon/sessions/{id}/usage — 会话累计用量聚合（task-02 端点：
 * agent_run_model_usage GROUP BY model 明细段为主源 + 无明细 run 的
 * AgentRun 四维列兜底；归属不符 404 resource-hiding）。仿 getAgentSession
 * 的 GET 封装写法。消费方：SessionUsageBar（自取数，refreshSignal 触发重取）。
 */
export async function getSessionUsage(
  sessionId: string,
): Promise<SessionUsageRead> {
  return apiFetch<SessionUsageRead>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/usage`,
  );
}

/**
 * GET /api/daemon/sessions/{id}/logs — 跨 AgentRun 的只读历史回看。
 * 日志按 run_id 分组返回，run_id 完整保留以便前端区分 turn 边界（D-005@V1）。
 * F7（2026-08-25）：opts.signal 透传 apiFetch（AbortSignal）——仅 resync 重连路径
 * 传入超时信号（TCP 挂起防卡死），其余调用方缺省不设超时，行为不变。
 *
 * 群聊体验 quick（2026-09-02）新增可选查询参数（后端已就绪，语义见
 * openapi get_session_logs 注释）：
 *   - before：向上加载游标（只返回 timestamp 严格更早的日志，与 limit 组合取
 *     「游标之前的最新 N 条」升序返回）；
 *   - q：内容搜索（content ILIKE %q%，可与 after/before 组合）；
 *   - limit：最新 N 条语义（按 timestamp desc 取 N 再反转升序；缺省=旧全量行为，
 *     不传参数的既有调用方零影响）。
 */
export async function getAgentSessionLogs(
  sessionId: string,
  opts?: {
    after?: string;
    before?: string;
    q?: string;
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<AgentRunLogEntry[]> {
  const params = new URLSearchParams();
  if (opts?.after) params.set("after", opts.after);
  if (opts?.before) params.set("before", opts.before);
  if (opts?.q) params.set("q", opts.q);
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const paramStr = params.toString();
  const qs = paramStr ? `?${paramStr}` : "";
  return apiFetch<AgentRunLogEntry[]>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/logs${qs}`,
    { signal: opts?.signal },
  );
}

/**
 * ql-20260827-018：logs 的最大 timestamp（ISO 字典序比较，后端返回 asc 序但
 * 不依赖排序兜底）。作为 streamSession 首连缺口同步的 cursor——历史回灌后
 * SSE 只需增量拉取该点之后的日志。空数组 → undefined（不启用增量同步）。
 */
export function maxLogTimestamp(logs: AgentRunLogEntry[]): string | undefined {
  let max: string | undefined;
  for (const log of logs) {
    if (log.timestamp && (!max || log.timestamp > max)) max = log.timestamp;
  }
  return max;
}

/**
 * GET /api/daemon/sessions/{id}/runs 返回项（对齐后端 SessionRunRead，task-07 / FR-02）。
 * 每项含 ``error_detail``（模型层 ModelError 序列化值；成功/无错误为 null），
 * 供前端在 run 失败时拉取结构化错误原因（change 2026-07-29-model-error-visibility）。
 *
 * gap-fix（FR-07 whoLine / FR-08 历史 usage）：追加轮次配置快照与 usage 字段
 * （对齐后端 gap-fix 扩列，均 nullable——未配置轮/老 run 行为 null）：
 *   - agent_profile_snapshot：dispatch 冻结的档案快照（name/provider/model/
 *     system_prompt/...），供 whoLine 取档案名；
 *   - llm_provider_id：本轮生效供应商 id（null = 本机默认）；
 *   - input_tokens / output_tokens：daemon 关单写入，供历史回看累计 usage；
 *   - ctx_tokens：REST 历史回填路径的上下文环分子（task-07 补录，见字段注释）。
 */
export interface SessionRunRead {
  id: string;
  /** quick（2026-09-02 本地会话信息折叠）：CLI 上报轮 platform-managed / 用户交互 interactive。 */
  spec_strategy?: string | null;
  status: string | null;
  error_code: string | null;
  /**
   * 调度层/系统层失败原因（ql-20260831-004）：后端映射 AgentRun.output_redacted
   * （撞闸 SESSION_LIMIT_REACHED、inject 过期联动、lease 超时等 daemon/GC 写入的
   * 可读原因）。仅 status=failed 时消费——成功轮该字段是 agent 输出摘要，勿当
   * 失败原因展示。与 error_detail（模型层 ModelError）正交。
   */
  failure_summary: string | null;
  /** 模型层 ModelError（type/code/message/retryable/hint/raw），与 error_code 正交（D-009）。 */
  error_detail: { [key: string]: unknown } | null;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  /** 轮次配置快照（D-008@v1）：档案名读 snapshot.name；null = 该轮未绑定档案。 */
  agent_profile_snapshot: { [key: string]: unknown; name?: string | null } | null;
  /** 本轮生效供应商 id；null = 本机默认供应商。 */
  llm_provider_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  /**
   * 2026-08-27-session-token-usage-fix task-07 补录 / FR-01：该 run 期间最近
   * 一次 API 调用的提示词大小（input+cache_read+cache_creation，REST 历史
   * 回填路径：AgentRun.ctx_tokens 列 → GET /sessions/{id}/runs → 前端
   * runsMeta 回填 turn.ctxTokens，环逆序取最新非 null 值）。daemon 经 usage
   * 管线实时写入（last-write-wins），close 终态不覆盖；仅 main 桶上报。
   * 历史 run 行 / 老 daemon 无上报为 null（环未知态，design §9）。
   */
  ctx_tokens?: number | null;
  /** ql-20260817-003：轮次发送者（旧 run 行为 null → 前端不显示发送行）。 */
  user_id: string | null;
  sender_name: string | null;
}

/**
 * GET /api/daemon/sessions/{id}/runs — 列出 session 的 AgentRun，每项含 error_detail。
 * 会话页 run 失败时拉取，按 run_id 匹配取结构化错误详情（task-07 端点）。
 * F7（2026-08-25）：opts.signal 透传 apiFetch（AbortSignal）——仅 resync 重连路径
 * 传入超时信号，其余调用方缺省不设超时，行为不变。
 */
export async function listSessionRuns(
  sessionId: string,
  opts?: { signal?: AbortSignal },
): Promise<SessionRunRead[]> {
  return apiFetch<SessionRunRead[]>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/runs`,
    { signal: opts?.signal },
  );
}

/**
 * GET /api/daemon/sessions/{id}/tasks 返回行（2026-09-04-session-task-execution-panel
 * task-06 / FR-02）：后端 AgentSessionTaskRead 读侧 DTO——agent_session_task
 * 持久化行（AgentTaskStatusEvent 事件契约字段一一对应，事件名 ``async`` 落
 * DTO 为 ``is_async``，D-006@v1）。类型经 type 别名引用 api-types 生成产物
 * （写法对齐 SharedAgentView 先例，禁手写——CLAUDE.md 规则 21，后端 schema
 * 漂移在下次 gen:types + tsc 时暴露）。
 */
export type AgentSessionTaskRead = components["schemas"]["AgentSessionTaskRead"];

/**
 * GET /api/daemon/sessions/{id}/tasks — 会话任务清单快照（task-06 / FR-02 /
 * FR-07）：agent_session_task 持久化行按 updated_at 倒序取最近 200 条；不上报
 * 任务的会话（多引擎差异 / D-003@v1 空态降级）返回 []。鉴权与 runs 端点同款
 * （get_agent_session + TaskRunAgentUser 读端口径）。形态对齐 listSessionRuns：
 * opts.signal 透传 apiFetch（AbortSignal，调用方按需注入）。
 */
export async function listSessionTasks(
  sessionId: string,
  opts?: { signal?: AbortSignal },
): Promise<AgentSessionTaskRead[]> {
  return apiFetch<AgentSessionTaskRead[]>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/tasks`,
    { signal: opts?.signal },
  );
}

/* 2026-09-07-session-pin-rename-scheduled-send task-05：会话置顶/重命名/定时消息
 * 六 API——端点由 task-02/03 落地（backend/app/modules/daemon/router 包 session_crud
 * 与 session_queue 子模块），照 archive/unarchive/ctx-window 模板（apiFetch +
 * encodeURIComponent）。类型经 gen:types 从 openapi.json 生成
 * （components["schemas"] 引用，禁止手写）；错误不在本 client 本地处理，统一由
 * apiFetch 抛 ApiError（401 refresh + 403/404/409/422 业务码透传）。
 * （D-010 第二回合移植注：main 单文件原锚在 updateSessionCtxWindow 之后——该
 * 函数拆分后居 ./session-lists，本块按和解指示落 sessions.ts 会话域。）
 */

/** PATCH /api/daemon/sessions/{id}/pin — 置顶会话（置顶优先排序，幂等，204）。 */
export async function pinAgentSession(sessionId: string): Promise<void> {
  await apiFetch(`/api/daemon/sessions/${encodeURIComponent(sessionId)}/pin`, {
    method: "PATCH",
  });
}

/** PATCH /api/daemon/sessions/{id}/unpin — 取消置顶（回最近活动排序，幂等，204）。 */
export async function unpinAgentSession(sessionId: string): Promise<void> {
  await apiFetch(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/unpin`,
    { method: "PATCH" },
  );
}

/**
 * PATCH /api/daemon/sessions/{id}/title — 重命名会话（title strip 后非空
 * ≤255，非法 422 不落库；成功 204 空响应）。
 */
export async function renameAgentSession(
  sessionId: string,
  title: string,
): Promise<void> {
  await apiFetch(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/title`,
    { method: "PATCH", json: { title } },
  );
}

/** 定时消息读体（POST 201 响应 / GET 列表项；api-types 生成版，禁止手写）。 */
export type ScheduledMessageRead =
  components["schemas"]["ScheduledMessageRead"];
/** 定时消息创建请求体（prompt + dispatch_at + 可选附件/配置快照，api-types 生成版）。 */
export type ScheduledMessageCreateRequest =
  components["schemas"]["ScheduledMessageCreateRequest"];

/**
 * POST /api/daemon/sessions/{id}/scheduled — 预约一条一次性定时消息（201 返回
 * ScheduledMessageRead，status=pending）。空 prompt / dispatch_at 距今 <60s
 * 422、终态或软删会话 409 均由后端 service 校验；到点派发归后端 sweeper。
 */
export async function createScheduledMessage(
  sessionId: string,
  body: ScheduledMessageCreateRequest,
): Promise<ScheduledMessageRead> {
  return apiFetch<ScheduledMessageRead>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/scheduled`,
    { method: "POST", json: body },
  );
}

/**
 * GET /api/daemon/sessions/{id}/scheduled — 列出该会话全部定时消息（全状态
 * 审计留档，dispatch_at 升序）。
 */
export async function listScheduledMessages(
  sessionId: string,
): Promise<ScheduledMessageRead[]> {
  return apiFetch<ScheduledMessageRead[]>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/scheduled`,
  );
}

/**
 * DELETE /api/daemon/sessions/{id}/scheduled/{message_id} — 取消一条 pending
 * 定时消息（204；非 pending 409，终态不可回退）。
 */
export async function cancelScheduledMessage(
  sessionId: string,
  messageId: string,
): Promise<void> {
  await apiFetch(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/scheduled/${encodeURIComponent(messageId)}`,
    { method: "DELETE" },
  );
}
