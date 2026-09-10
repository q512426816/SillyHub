/**
 * Daemon API client —— 会话列表/历史只读查询族（AgentSession* 类型 + 列表
 * 拉取/删除/归档/上下文窗口覆盖）。权限/dialog/生命周期 CRUD 在 ./sessions。
 *
 * 2026-09-07-arch-large-file-split task-15：自原 lib/daemon.ts 按资源域原样搬移，
 * @/lib/daemon 导入面经 ./index 全量再导出保持零变化。
 */
import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";
import type { PpmItemKind } from "./sessions";
/* ---------- Session list + history (task-12 / FR-10 / D-005@v1) ----------
 *
 * 只读查询：GET /api/daemon/sessions（当前用户所有会话）+ GET /sessions/{id}/logs
 * （跨 AgentRun 历史回看，聚合键为 agent_runs.agent_session_id，见后端 service）。
 * permission 通道复用 task-08（respondSessionPermission 在 ./sessions /
 * parseSessionPermissionEvent 在 ./session-sse），不新增第二套。
 */

export type AgentSessionStatus =
  | "pending"
  | "active"
  | "reconnecting"
  | "ended"
  | "failed";

/**
 * 会话当前生效配置摘要（agent_sessions.config_snapshot，2026-08-14-sessions-portal
 * task-02 / design §5 Wave1）。列表 chips 直显免二次查询（Grill C-12）。
 *
 * task-17（规则 20）：后端 config_snapshot 是 JSON dict（生成版只给出
 * `{[key:string]: unknown}`），具名字段结构无法从 OpenAPI 表达，此接口是
 * 该 JSON blob 的消费端结构声明，保留手写；其余 AgentSessionRead 字段已迁生成版。
 */
export interface AgentSessionConfigSnapshot {
  profile_name?: string | null;
  provider_name?: string | null;
  model?: string | null;
  engine?: string | null;
  machine_name?: string | null;
  agent_name?: string | null;
}

/**
 * task-17（规则 20）：AgentSessionRead 主体迁 api-types 生成版（含本变更三新字段
 * agent_profile_id / llm_provider_id / config_snapshot）。以下字段在后端是
 * string/JSON dict，生成版无法表达窄化语义，Omit 后保留前端窄化：
 * - status：后端枚举收窄为 AgentSessionStatus（调用方依赖判别联合）；
 * - config：消费端只读 manual_approval/model 两个键；
 * - config_snapshot：具名结构见 AgentSessionConfigSnapshot；
 * - title：后端响应恒带该键（router 注入，缺省 null），生成版误标可选，收窄回必填。
 */
export type AgentSessionRead = Omit<
  components["schemas"]["AgentSessionRead"],
  "status" | "config" | "config_snapshot" | "title"
> & {
  status: AgentSessionStatus;
  config: { manual_approval?: boolean; model?: string | null } | null;
  config_snapshot: AgentSessionConfigSnapshot | null;
  /** FR-08: 首条 user_input 摘要前 30 字（router 注入，缺省 null，键恒存在）。 */
  title: string | null;
};

export type AgentSessionListResponse = Omit<
  components["schemas"]["AgentSessionListResponse"],
  "items"
> & {
  items: AgentSessionRead[];
};

/**
 * 工作区树一次拉取上限（2026-08-23-sessions-workspace-hub task-05 / D-103@v1）。
 * 后端 router le=500 已放宽（task-01），列表组件用它做单次全量拉取后客户端按
 * workspace_id 分组；超出部分由组件层「组内 50 截断 + 显示全部」兜底（R-03）。
 * 收口在 API client 侧，避免调用方各写一个魔数。
 */
export const AGENT_SESSIONS_TREE_FETCH_LIMIT = 500;

/** GET /api/daemon/sessions 过滤参数（分页 + 2026-08-14-sessions-portal FR-02 筛选）。 */
export interface AgentSessionListParams {
  limit?: number;
  offset?: number;
  status?: AgentSessionStatus;
  /** 按运行时（=机器+智能体组合）过滤。 */
  runtime_id?: string;
  /** 按机器（daemon instance）过滤（后端 join daemon_runtimes）。 */
  machine_id?: string;
  /** 按引擎 provider 过滤（claude/codex...）。 */
  provider?: string;
  /** 标题模糊搜索（title ilike）。 */
  q?: string;
  /**
   * 按工作区过滤（2026-08-22-workspace-sessions-portal task-10 / D-003@v2）：
   * workspace 级门户复用全局端点做 scope 过滤，后端 SQL 层精确匹配。
   */
  workspace_id?: string;
  /**
   * 按变更过滤（D-003@v2）：change 级门户复用全局端点（调用方同时传
   * workspace_id，change 隐含 workspace），后端 SQL 层精确匹配。
   */
  change_id?: string;
  /**
   * 按快速修复过滤（2026-08-25-session-spec-binding task-09 / FR-05）：ql_id
   * 短码（``ql-YYYYMMDD-NNN-后缀``，非 UUID），后端走 quicklog_session_links
   * M:N 子查询命中；纯透传不做本地过滤（命中集全在服务端，D-001@v1）。
   */
  ql_id?: string;
  /**
   * 按 PPM 条目过滤（2026-08-28-session-ppm-task-binding task-04 / FR-01）：
   * kind + item_id 成对（后端 ppm_item_session_links M:N 子查询命中，半对 422；
   * 对齐 ql_id 先例：真值才下发，命中集全在服务端）。
   */
  ppm_item_kind?: PpmItemKind;
  ppm_item_id?: string;
  /** 2026-08-24：按归档状态过滤（true=已归档，false=未归档）。 */
  archived?: boolean;
}

/**
 * GET /api/daemon/sessions — 列出当前用户的会话（active/历史）。
 * 越权隔离在后端 SQL 层（user_id），前端只展示。D-003@v2：可选
 * workspace_id/change_id 过滤参供 workspace/change 级门户复用（scope 模式
 * 与全局同一端点，仅多传过滤参）。
 */
export async function listAgentSessions(
  options?: AgentSessionListParams,
): Promise<AgentSessionListResponse> {
  const query: Record<string, string | number> = {};
  if (options?.limit !== undefined) query.limit = options.limit;
  if (options?.offset !== undefined) query.offset = options.offset;
  if (options?.status) query.status = options.status;
  if (options?.runtime_id) query.runtime_id = options.runtime_id;
  if (options?.machine_id) query.machine_id = options.machine_id;
  if (options?.provider) query.provider = options.provider;
  if (options?.q) query.q = options.q;
  // D-003@v2：scope 过滤参照 runtime_id 模式（真值才下发，缺省零回归）。
  if (options?.workspace_id) query.workspace_id = options.workspace_id;
  if (options?.change_id) query.change_id = options.change_id;
  // 2026-08-25-session-spec-binding task-09 / FR-05：快速修复短码过滤参
  // （对齐 change_id 先例：真值才下发，缺省零回归）。
  if (options?.ql_id) query.ql_id = options.ql_id;
  // 2026-08-28-session-ppm-task-binding task-04 / FR-01：PPM 条目成对过滤参
  // （对齐 ql_id 先例：真值才下发，缺省零回归；命中集全在服务端 M:N 子查询）。
  if (options?.ppm_item_kind) query.ppm_item_kind = options.ppm_item_kind;
  if (options?.ppm_item_id) query.ppm_item_id = options.ppm_item_id;
  // 2026-08-24：archived 过滤参（布尔→字符串 "true"/"false"）。
  if (options?.archived !== undefined) query.archived = options.archived ? "true" : "false";
  return apiFetch<AgentSessionListResponse>("/api/daemon/sessions", { query });
}

/* ---------- Change-level session list (task-11 / FR-04 / D-005@v1) ----------
 *
 * 2026-07-09-change-detail-session：变更详情页按 change_id 聚合会话列表，
 * 跨成员可见（D-005@v1），调用后端 task-09 端点。
 */

/** 变更级会话列表项作者（D-005@v1 跨成员可见）。 */
export interface ChangeSessionAuthor {
  user_id: string;
  display_name: string | null;
}

/** GET /workspaces/{wid}/changes/{cid}/sessions 列表项（对齐后端 AgentSessionListItem）。 */
export interface AgentSessionListItem {
  id: string;
  provider: string;
  status: string;
  turn_count: number;
  mode: string | null;
  author: ChangeSessionAuthor;
  last_active_at: string | null;
  title: string | null;
}

/**
 * GET /api/workspaces/{wid}/changes/{cid}/sessions — 变更级会话列表（跨成员，D-005@v1）。
 * 2026-07-09-change-detail-session task-11 / FR-04。
 */
export async function listChangeSessions(
  workspaceId: string,
  changeId: string,
): Promise<AgentSessionListItem[]> {
  return apiFetch<AgentSessionListItem[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/changes/${encodeURIComponent(changeId)}/sessions`,
  );
}

/**
 * GET /api/workspaces/{wid}/quicklog-entries/{ql_id}/sessions — 快速修复级
 * 会话列表（2026-08-25-session-spec-binding task-07 端点 / FR-04 数据源，
 * task-09 客户端封装）。与 listChangeSessions 同源 schema（AgentSessionListItem
 * 数组，标题经共享 helper 同源提取）；无绑定返回空列表不 404（D-001@v1：
 * 条目行允许后到），跨成员可见。
 */
export async function listQuicklogSessions(
  workspaceId: string,
  qlId: string,
): Promise<AgentSessionListItem[]> {
  return apiFetch<AgentSessionListItem[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/quicklog-entries/${encodeURIComponent(qlId)}/sessions`,
  );
}

/**
 * GET /api/ppm/item-sessions?kind=&item_id= — PPM 条目（任务/问题）级会话列表
 * （2026-08-28-session-ppm-task-binding task-01 端点 / task-04 客户端封装 /
 * FR-01）。与 listChangeSessions/listQuicklogSessions 同源 schema
 * （AgentSessionListItem 数组，design §5 Phase 1 响应同构）；平台级端点无
 * workspace scope（跨成员可见）；无关联返回空列表不 404（任务刚建尚无会话
 * 是常态）；kind 非法值由后端 Literal 校验 422。
 */
export async function listItemSessions(
  kind: PpmItemKind,
  itemId: string,
): Promise<AgentSessionListItem[]> {
  return apiFetch<AgentSessionListItem[]>("/api/ppm/item-sessions", {
    query: { kind, item_id: itemId },
  });
}

/**
 * GET /api/workspaces/{wid}/agent-sessions — 工作区级会话列表
 * （2026-08-14-change-center-conversation-driven task-06 / D-002@v1）。
 * include_ended=true 时返回含已结束会话的完整 AgentSessionListItem[]
 * （字段对齐后端 daemon/schema.py AgentSessionListItem，排序 coalesce(last_active_at, created_at) desc）。
 * include_ended 缺省 false 保持 active-only 最小字段行为（供 approvals 页聚合用）。
 */
export async function listWorkspaceAgentSessions(
  workspaceId: string,
  options?: { include_ended?: boolean; mode?: string },
): Promise<AgentSessionListItem[]> {
  const query: Record<string, string | boolean> = {};
  if (options?.include_ended !== undefined) query.include_ended = options.include_ended;
  if (options?.mode) query.mode = options.mode;
  return apiFetch<AgentSessionListItem[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agent-sessions`,
    { query },
  );
}

/** DELETE /api/daemon/sessions/{id} — 删除已结束的会话记录。 */
export async function deleteAgentSession(sessionId: string): Promise<void> {
  await apiFetch(`/api/daemon/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}

// 2026-08-24：会话归档/取消归档 API。

/** PATCH /api/daemon/sessions/{id}/archive — 归档会话（从默认列表隐藏）。 */
export async function archiveAgentSession(sessionId: string): Promise<void> {
  await apiFetch(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/archive`,
    { method: "PATCH" },
  );
}

/** PATCH /api/daemon/sessions/{id}/unarchive — 取消归档（恢复到默认列表）。 */
export async function unarchiveAgentSession(sessionId: string): Promise<void> {
  await apiFetch(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/unarchive`,
    { method: "PATCH" },
  );
}

// ql-20260831-002：会话级上下文窗口覆盖（上下文环分母可编辑；null = 清除覆盖
// 回自动派生链：供应商 one_m → 模型常量表 → 1M 兜底）。

// 2026-09-10-auto-resume-interrupted-turn / FR-06：会话级「daemon 重启自动
// 续跑」开关（缺省开；false = recover 守卫 G2 不再自动入队续跑）。

/** PATCH /api/daemon/sessions/{id}/auto-resume — 开/关自动续跑。 */
export async function updateSessionAutoResume(
  sessionId: string,
  enabled: boolean,
): Promise<void> {
  await apiFetch(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/auto-resume`,
    { method: "PATCH", json: { enabled } },
  );
}

/** PATCH /api/daemon/sessions/{id}/ctx-window — 设置/清除上下文窗口覆盖。 */
export async function updateSessionCtxWindow(
  sessionId: string,
  ctxWindowTokens: number | null,
): Promise<void> {
  await apiFetch(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/ctx-window`,
    { method: "PATCH", json: { ctx_window_tokens: ctxWindowTokens } },
  );
}
