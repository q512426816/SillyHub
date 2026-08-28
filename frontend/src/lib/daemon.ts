/**
 * Daemon runtime API client.
 */
import { apiFetch, getApiBaseUrl } from "@/lib/api";
import { useSession } from "@/stores/session";
import type {
  AgentRunLogEntry,
  MainAgentConfig,
  WorkerPresetItem,
} from "@/lib/agent";
import type { components } from "@/lib/api-types";
import { fetchSse, type FetchSseConnection } from "@/lib/fetch-sse";

export interface OwnerRead {
  user_id: string | null;
  email: string | null;
  display_name: string | null;
}

export interface DaemonRuntimeRead {
  id: string;
  display_alias?: string | null;
  name: string | null;
  provider: string | null;
  version: string | null;
  os: string | null;
  arch: string | null;
  status: string | null; // online, offline, maintenance, disabled
  last_heartbeat_at: string | null;
  capabilities: Record<string, any> | null;
  allowed_roots: string[];
  owner?: OwnerRead | null;
  /** 所属守护进程实例 ID（daemon-entity-binding task-11）。 */
  daemon_instance_id?: string | null;
  /** daemon 进程版本（2026-07-04-daemon-version-management D-005）。区别于 version（provider CLI 版本）。 */
  daemon_version?: string | null;
  daemon_build_id?: string | null;
  created_at: string;
  updated_at: string;
}

export async function listDaemonRuntimes(): Promise<DaemonRuntimeRead[]> {
  return apiFetch<DaemonRuntimeRead[]>("/api/daemon/runtimes");
}

/**
 * 2026-07-03-daemon-entity-binding task-10：守护进程实体（daemon_instance）的前端 DTO。
 *
 * 由 workspace-daemon-switcher 使用，展示当前用户在线守护进程列表。
 * providers 为该 daemon 实体下已启用的运行时列表（用于渲染 provider 徽标）。
 */
export interface DaemonInstanceProviderItem {
  provider: string;
  status: string;
  version?: string | null;
}

export interface DaemonInstanceRead {
  id: string;
  hostname: string;
  display_alias: string | null;
  status: string;
  /** daemon 进程版本（2026-07-04-daemon-version-management D-005）。 */
  version?: string | null;
  build_id?: string | null;
  providers: DaemonInstanceProviderItem[];
}

/**
 * GET /api/daemon/instances — 列出当前用户在线的守护进程实体。
 * 返回包含各 daemon 已启用 provider 列表，用于 workspace-daemon-switcher
 * 下拉显示 hostname/display_alias + provider 徽标（task-10 / FR-09）。
 */
export async function listDaemonInstances(): Promise<DaemonInstanceRead[]> {
  return apiFetch<DaemonInstanceRead[]>("/api/daemon/instances");
}

// ── Daemon machines（machine→runtime 两级）──
// 2026-07-07-daemon-machine-runtime-hierarchy task-05：machine 作为一级资源，
// 字段对齐 design §5.1 / 后端 task-01 DTO（蛇形），与 runtime 级类型并列。

/**
 * machine（守护进程实例）视图 DTO，对齐 design §5.1 DaemonMachineRead。
 * owner 复用既有 OwnerRead，runtimes 复用既有 DaemonRuntimeRead（含各自
 * capabilities/allowed_roots）。runtime_count / online_runtime_count 由后端派生。
 */
export interface DaemonMachineRead {
  id: string;
  hostname: string;
  display_alias: string | null;
  os: string | null;
  arch: string | null;
  status: string; // online/offline/maintenance/disabled
  last_heartbeat_at: string | null;
  /** daemon 语义版本（区别于 runtime.version 的 provider CLI 版本）。 */
  version: string | null;
  /** daemon 构建 SHA。 */
  build_id: string | null;
  /**
   * daemon 进程启动时间（task-07 / FR-03，后端 task-04 新增）。
   * 旧 daemon 未上报时为 null，前端机器头显「—」。
   */
  started_at: string | null;
  created_at: string;
  owner?: OwnerRead | null;
  /** 该 instance 下 runtime 总数。 */
  runtime_count: number;
  /** status=='online' 的 runtime 数。 */
  online_runtime_count: number;
  /** 该机器全部 runtime。0-runtime 机器为 []。 */
  runtimes: DaemonRuntimeRead[];
}

/** GET /api/daemon/machines 查询参数（design §5.1）。 */
export interface DaemonMachineListParams {
  q?: string;
  status?: string;
  provider?: string;
  user_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * GET /api/daemon/machines 响应体（机器级分页）。
 *
 * 2026-08-28-daemon-agent-share task-07/task-09：后端 machines 响应末位附加
 * ``shared_to_me``（「共享给我的」机器行，grants.queries 五字段契约）；旧后端
 * / 无授权数据时字段缺省，前端按可选消费（?? []）。
 */
export interface DaemonMachineListResponse {
  items: DaemonMachineRead[];
  total: number;
  limit: number;
  offset: number;
  /** 「共享给我的」机器行（workspace grant 装配；空/缺省 = 无共享）。 */
  shared_to_me?: SharedMachineView[];
}

/** PATCH /api/daemon/machines/{id} 请求体（省略=不变，显式 null/空白=清空）。 */
export interface DaemonMachineUpdate {
  display_alias?: string | null;
}

/**
 * GET /api/daemon/machines — machine 级分页列表（admin 全局 / 普通用户仅自己）。
 * 仿 listDaemonRuntimesPage 的 query 写法。
 */
export async function listDaemonMachines(
  params?: DaemonMachineListParams,
): Promise<DaemonMachineListResponse> {
  return apiFetch<DaemonMachineListResponse>("/api/daemon/machines", {
    query: params as Record<string, string | number | undefined> | undefined,
  });
}

/**
 * PATCH /api/daemon/machines/{instance_id} — 直写机器别名（0-runtime 机器也能改）。
 * 返回重新聚合的 DaemonMachineRead。仿 updateDaemonRuntime。
 */
export async function updateDaemonMachine(
  instanceId: string,
  input: DaemonMachineUpdate,
): Promise<DaemonMachineRead> {
  return apiFetch<DaemonMachineRead>(
    `/api/daemon/machines/${encodeURIComponent(instanceId)}`,
    { method: "PATCH", json: input },
  );
}

/**
 * POST /api/daemon/machines/{instance_id}/self-update — 按 instance 路由 daemon 升级。
 * 不再借道 runtime_id（design §5.3）。返回 {sent, latest_version}，仿 triggerDaemonSelfUpdate。
 */
export async function triggerMachineSelfUpdate(
  instanceId: string,
): Promise<{ sent: boolean; latest_version: string }> {
  return apiFetch(
    `/api/daemon/machines/${encodeURIComponent(instanceId)}/self-update`,
    { method: "POST" },
  );
}

/**
 * POST /api/daemon/machines/{instance_id}/cleanup — 按 instance 路由 daemon 缓存清理。
 * daemon 收到后清理 specs/、会话日志、备份等本地缓存。返回 {sent}。
 */
export async function triggerMachineCleanup(
  instanceId: string,
): Promise<{ sent: boolean }> {
  return apiFetch(
    `/api/daemon/machines/${encodeURIComponent(instanceId)}/cleanup`,
    { method: "POST" },
  );
}

/**
 * DELETE /api/daemon/machines/{instance_id} — 物理删除机器条目
 * （ql-20260829-006-6a9e）。级联清除该机全部 runtimes 及其会话/任务记录；
 * 后端守卫：daemon 心跳新鲜（在线）/ 工作区绑定 / 共享授权 / 借用审计红线 /
 * in-flight 任务 → 409；daemon 之后重新启动会以同一 daemon_local_id 重建。
 */
export async function deleteDaemonMachine(instanceId: string): Promise<void> {
  await apiFetch(`/api/daemon/machines/${encodeURIComponent(instanceId)}`, {
    method: "DELETE",
  });
}

/* ---------- 平台共享智能体 + 共享给我的机器（2026-08-28-daemon-agent-share task-09） ----------
 *
 * 端点对齐 /api/daemon/shared-agents 系列（grants/router.py）：
 *   - GET    /shared-agents          管理（require_platform_admin）全量列表，含停用行；
 *   - POST   /shared-agents          创建（五重校验：runtime 归属 admin 且在线 /
 *                                    writable_dir ⊆ allowed_roots / 源码工作区存在 /
 *                                    R-05 档案显式升级 / D-008 唯一防重复）；
 *   - GET    /shared-agents/active   生效摘要（任意登录用户，仅 enabled 行）；
 *   - PATCH  /shared-agents/{id}     仅改 enabled（停用 = false / 启用 = true 软开关）；
 *   - DELETE /shared-agents/{id}     物理删除（204，管理卡删除按钮）。
 *
 * 类型一律取 api-types 生成版（task-08 gen:types），禁止手写 DTO——后端 schema
 * 变更会在下次 gen:types + tsc 时暴露漂移。
 */

/** 管理端完整视图（platform 行四绑定列由 service 强制非空）。 */
export type SharedAgentView = components["schemas"]["SharedAgentView"];
/** active 生效摘要（任意登录用户可见）。 */
export type SharedAgentActiveView = components["schemas"]["SharedAgentActiveView"];
/** POST /daemon/shared-agents 请求体（design §7）。 */
export type SharedAgentCreateRequest = components["schemas"]["SharedAgentCreateRequest"];
/** 创建响应：View + 档案升级提示（R-05）。 */
export type SharedAgentCreateResponse =
  components["schemas"]["SharedAgentCreateResponse"];
/** 「共享给我的」机器行（grants.queries 五字段契约：machine_id/display_name/
 *  lender_display_name/source_workspace_id/online）。 */
export type SharedMachineView = components["schemas"]["SharedMachineView"];

/** GET /api/daemon/shared-agents — 管理端全量列表（含停用行，platform admin）。 */
export async function fetchSharedAgents(): Promise<SharedAgentView[]> {
  return apiFetch<SharedAgentView[]>("/api/daemon/shared-agents");
}

/** GET /api/daemon/shared-agents/active — 生效摘要（任意登录用户，仅 enabled 行）。 */
export async function fetchSharedAgentsActive(): Promise<SharedAgentActiveView[]> {
  return apiFetch<SharedAgentActiveView[]>("/api/daemon/shared-agents/active");
}

/**
 * POST /api/daemon/shared-agents — 创建平台共享智能体（platform admin）。
 * 返回 SharedAgentCreateResponse（含 visibility_promoted 升级提示，R-05）。
 */
export async function createSharedAgent(
  input: SharedAgentCreateRequest,
): Promise<SharedAgentCreateResponse> {
  return apiFetch<SharedAgentCreateResponse>("/api/daemon/shared-agents", {
    method: "POST",
    json: input,
  });
}

/**
 * PATCH /api/daemon/shared-agents/{grant_id} — 停用/启用共享智能体软开关
 * （enabled 真假双向；停用后 active 不再返回该行，会话选择器即不再呈现）。
 * 返回更新后的 SharedAgentView。
 */
export async function setSharedAgentEnabled(
  grantId: string,
  enabled: boolean,
): Promise<SharedAgentView> {
  return apiFetch<SharedAgentView>(
    `/api/daemon/shared-agents/${encodeURIComponent(grantId)}`,
    { method: "PATCH", json: { enabled } },
  );
}

/**
 * DELETE /api/daemon/shared-agents/{grant_id} — 物理删除共享智能体
 * （204 无响应体；档案 visibility 不回滚——升级是独立管理动作）。
 */
export async function deleteSharedAgent(grantId: string): Promise<void> {
  await apiFetch(`/api/daemon/shared-agents/${encodeURIComponent(grantId)}`, {
    method: "DELETE",
  });
}

// task-06 / FR-04 / D-006@v1：平台管理员全局分页视图。旧 listDaemonRuntimes()
// 仍请求 /api/daemon/runtimes 返回数组（FR-06 兼容）。
export interface DaemonRuntimeListParams {
  q?: string;
  type?: string;
  status?: string;
  user_id?: string;
  limit?: number;
  offset?: number;
}

export interface DaemonRuntimeListResponse {
  items: DaemonRuntimeRead[];
  total: number;
  limit: number;
  offset: number;
}

export interface UpdateDaemonRuntimeInput {
  display_alias?: string | null;
}

export async function listDaemonRuntimesPage(
  params?: DaemonRuntimeListParams,
): Promise<DaemonRuntimeListResponse> {
  return apiFetch<DaemonRuntimeListResponse>("/api/daemon/runtimes/page", {
    query: params as Record<string, string | number | undefined>,
  });
}

export async function updateDaemonRuntime(
  runtimeId: string,
  input: UpdateDaemonRuntimeInput,
): Promise<DaemonRuntimeRead> {
  return apiFetch<DaemonRuntimeRead>(
    `/api/daemon/runtimes/${encodeURIComponent(runtimeId)}`,
    { method: "PATCH", json: input },
  );
}

/**
 * 2026-06-29-runtime-allowed-roots-config task-06：
 * PUT runtime allowed_roots（admin 配置可访问目录沙箱）。
 */
export async function updateRuntimeAllowedRoots(
  runtimeId: string,
  allowedRoots: string[],
): Promise<DaemonRuntimeRead> {
  return apiFetch<DaemonRuntimeRead>(
    `/api/daemon/runtimes/${encodeURIComponent(runtimeId)}/allowed-roots`,
    { method: "PUT", json: { allowed_roots: allowedRoots } },
  );
}

/**
 * 目录条目（task-11 list_dir RPC 响应，FR-03 / D-005@v1）。
 */
export interface DirEntry {
  name: string;
  type: "dir" | "file";
}

export interface ListDirResponse {
  entries: DirEntry[];
}

/**
 * 经 backend 转发的 daemon list_dir RPC（task-04 端点）。
 * 受 daemon allowed_roots 白名单限制（D-002@v1），越界 403。
 */
export async function listDir(
  runtimeId: string,
  path: string,
): Promise<ListDirResponse> {
  return apiFetch<ListDirResponse>(
    `/api/daemon/runtimes/${runtimeId}/list-dir`,
    { method: "POST", json: { path } },
  );
}

/**
 * task-07 / FR-2：经 backend 转发的 daemon list_roots RPC（task-04 端点）。
 * 返回 daemon 主机可枚举的根锚点：Windows 盘符（如 C:\）或 Unix 根（/）。
 * RemoteFolderPicker 打开时调用，作为目录树的初始根节点。
 */
export interface ListRootsResponse {
  roots: string[];
}

export async function listRoots(
  runtimeId: string,
): Promise<ListRootsResponse> {
  return apiFetch<ListRootsResponse>(
    `/api/daemon/runtimes/${runtimeId}/list-roots`,
    { method: "POST", json: {} },
  );
}

export async function getDaemonRuntime(
  runtimeId: string,
): Promise<DaemonRuntimeRead> {
  return apiFetch<DaemonRuntimeRead>(`/api/daemon/runtimes/${runtimeId}`);
}

export async function disableDaemonRuntime(
  runtimeId: string,
): Promise<DaemonRuntimeRead> {
  return apiFetch<DaemonRuntimeRead>(
    `/api/daemon/runtimes/${runtimeId}/disable`,
    { method: "POST" },
  );
}

export async function enableDaemonRuntime(
  runtimeId: string,
): Promise<DaemonRuntimeRead> {
  return apiFetch<DaemonRuntimeRead>(
    `/api/daemon/runtimes/${runtimeId}/enable`,
    { method: "POST" },
  );
}

/**
 * DELETE /api/daemon/runtimes/{id} — 物理删除运行时（ql-20260621-012）。
 * 级联清除该 runtime 下的 leases / agent_sessions；daemon 下次心跳重新注册。
 */
export async function deleteDaemonRuntime(
  runtimeId: string,
): Promise<void> {
  await apiFetch(`/api/daemon/runtimes/${encodeURIComponent(runtimeId)}`, {
    method: "DELETE",
  });
}

/**
 * GET /api/daemon/version — daemon 分发元数据（公开端点）。
 * 2026-07-04-daemon-version-management D-004：返回 latest_version（语义）+
 * latest_build_id（SHA）供前端版本比对与升级入口。旧 latest/minRequired/
 * downloadUrl 保留（install.sh 兼容）。
 */
export interface DaemonVersionInfo {
  latest: string;
  minRequired: string;
  downloadUrl: string;
  latest_version: string;
  latest_build_id: string;
}

export async function getDaemonVersion(): Promise<DaemonVersionInfo> {
  return apiFetch<DaemonVersionInfo>("/api/daemon/version");
}

/**
 * POST /api/daemon/runtimes/{id}/self-update — 推送 daemon 自更新指令（admin）。
 * 2026-07-04-daemon-version-management D-007：复用现有 self-update 端点（runtime_id
 * 维度，升级整个 daemon 进程）。后端经 WS 下发 daemon:self_update，daemon 下载新
 * bundle 替换并 exit 重启；前端经心跳/re-register 看到新版本。返回 {sent, latest_version}。
 * 失败抛 ApiError（504 daemon 离线 / WS 发送失败）。
 */
export async function triggerDaemonSelfUpdate(
  runtimeId: string,
): Promise<{ sent: boolean; latest_version: string }> {
  return apiFetch(
    `/api/daemon/runtimes/${encodeURIComponent(runtimeId)}/self-update`,
    { method: "POST" },
  );
}

/* ---------- Provider display metadata ---------- */

/** Provider display name, icon emoji, and Tailwind color classes. */
export const PROVIDER_META: Record<
  string,
  { label: string; icon: string; color: string }
> = {
  claude: { label: "Claude Code", icon: "🟣", color: "bg-purple-100 text-purple-800" },
  codex: { label: "Codex", icon: "🟢", color: "bg-green-100 text-green-800" },
  copilot: { label: "Copilot", icon: "🔵", color: "bg-blue-100 text-blue-800" },
  opencode: { label: "OpenCode", icon: "🔷", color: "bg-teal-100 text-teal-800" },
  openclaw: { label: "OpenClaw", icon: "🟠", color: "bg-orange-100 text-orange-800" },
  hermes: { label: "Hermes", icon: "🟣", color: "bg-indigo-100 text-indigo-800" },
  gemini: { label: "Gemini", icon: "💎", color: "bg-cyan-100 text-cyan-800" },
  pi: { label: "Pi", icon: "🩷", color: "bg-pink-100 text-pink-800" },
  cursor: { label: "Cursor", icon: "🟡", color: "bg-amber-100 text-amber-800" },
  kimi: { label: "Kimi", icon: "🔴", color: "bg-red-100 text-red-800" },
  kiro: { label: "Kiro", icon: "🟩", color: "bg-emerald-100 text-emerald-800" },
  antigravity: { label: "Antigravity", icon: "⚫", color: "bg-slate-100 text-slate-800" },
};

/** Frontend-known minimum version requirements (UI warning only). */
export const MIN_VERSIONS: Record<string, string> = {
  claude: "2.0.0",
  codex: "0.100.0",
  copilot: "1.0.0",
};

/**
 * Simple semver comparison.
 * Returns true when `version` is strictly less than `minVersion`.
 * Handles optional "v" prefix and non-standard suffixes (e.g. "v2.1.0-beta").
 */
export function isVersionBelow(version: string, minVersion: string): boolean {
  const parse = (v: string): number[] => {
    const stripped = v.replace(/^v/, "");
    const parts = stripped.split(".");
    const nums: number[] = [];
    for (let i = 0; i < 3; i++) {
      const segment = (parts[i] ?? "").replace(/\D.*$/, "");
      nums.push(Number.parseInt(segment, 10) || 0);
    }
    return nums;
  };
  const v = parse(version);
  const m = parse(minVersion);
  for (let i = 0; i < 3; i++) {
    if ((v[i] ?? 0) < (m[i] ?? 0)) return true;
    if ((v[i] ?? 0) > (m[i] ?? 0)) return false;
  }
  return false; // equal
}

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
 * task-08：解析 SSE 事件数据为 SessionPermissionRequest / SessionPermissionResolved。
 *
 * backend 在 agent_session:{session_id} channel publish 的 payload 形如：
 *   { event: "permission_request", session_id, run_id, request_id, tool_name, input, tool_use_id? }
 *   { event: "permission_resolved", session_id, request_id, decision, reason? }
 *   { event: "session_ended", ... }
 *
 * 非 permission_* 事件返回 null（让上层 SSE 订阅按其它事件类型自行处理）。
 */
export function parseSessionPermissionEvent(
  data: unknown,
): SessionPermissionRequest | SessionPermissionResolved | null {
  if (!data || typeof data !== "object") return null;
  const evt = data as Record<string, unknown>;
  if (evt.event === "permission_request") {
    const req: SessionPermissionRequest = {
      session_id: String(evt.session_id ?? ""),
      run_id: String(evt.run_id ?? ""),
      request_id: String(evt.request_id ?? ""),
      tool_name: String(evt.tool_name ?? ""),
      input:
        evt.input && typeof evt.input === "object"
          ? (evt.input as Record<string, unknown>)
          : {},
    };
    if (typeof evt.tool_use_id === "string") {
      req.tool_use_id = evt.tool_use_id;
    }
    // AskUserQuestion 对话变体：dialog_kind 存在即渲染结构化问答卡。
    if (typeof evt.dialog_kind === "string") {
      req.dialog_kind = evt.dialog_kind;
    }
    if (evt.dialog_payload && typeof evt.dialog_payload === "object") {
      req.dialog_payload = evt.dialog_payload as Record<string, unknown>;
    }
    return req;
  }
  if (evt.event === "permission_resolved") {
    const decision = evt.decision === "allow" ? "allow" : "deny";
    return {
      session_id: String(evt.session_id ?? ""),
      request_id: String(evt.request_id ?? ""),
      decision,
      ...(typeof evt.reason === "string" ? { reason: evt.reason } : {}),
    };
  }
  return null;
}

/**
 * task-05 / 2026-08-24-platform-session-feedback-fix：把 SSE payload 归一化为
 * PlanModeEnteredEvent。dispatch 已校验 session_id / run_id，本函数只做字段兜底。
 */
function parsePlanModeEnteredEvent(
  data: unknown,
  sessionId: string,
): PlanModeEnteredEvent {
  const evt = data as Record<string, unknown>;
  const rawSummary =
    evt.summary && typeof evt.summary === "object"
      ? (evt.summary as Record<string, unknown>)
      : {};
  const summary: PlanSummary = {
    objective: typeof rawSummary.objective === "string" ? rawSummary.objective : "",
    tasks: Array.isArray(rawSummary.tasks)
      ? rawSummary.tasks.filter((t): t is string => typeof t === "string")
      : [],
    design_snippet:
      typeof rawSummary.design_snippet === "string"
        ? rawSummary.design_snippet
        : null,
  };
  return {
    event: "plan_mode_entered",
    session_id: sessionId,
    run_id: String(evt.run_id),
    summary,
    requested_at: typeof evt.requested_at === "string" ? evt.requested_at : "",
  };
}

/** 把 SSE payload 归一化为 BashStatusEvent。 */
function parseBashStatusEvent(
  data: unknown,
  sessionId: string,
): BashStatusEvent {
  const evt = data as Record<string, unknown>;
  const status =
    evt.status === "running" ||
    evt.status === "completed" ||
    evt.status === "failed"
      ? evt.status
      : "running";
  return {
    event: "bash_status",
    session_id: sessionId,
    run_id: String(evt.run_id),
    command: typeof evt.command === "string" ? evt.command : "",
    status,
    exit_code: typeof evt.exit_code === "number" ? evt.exit_code : null,
    elapsed_ms: typeof evt.elapsed_ms === "number" ? evt.elapsed_ms : null,
  };
}

/** 把 SSE payload 归一化为 BashChunkEvent。 */
function parseBashChunkEvent(
  data: unknown,
  sessionId: string,
): BashChunkEvent {
  const evt = data as Record<string, unknown>;
  return {
    event: "bash_chunk",
    session_id: sessionId,
    run_id: String(evt.run_id),
    command: typeof evt.command === "string" ? evt.command : "",
    channel: evt.channel === "stderr" ? "stderr" : "stdout",
    content: typeof evt.content === "string" ? evt.content : "",
    is_final: Boolean(evt.is_final),
  };
}

/**
 * 把 SSE payload 归一化为 AgentTaskStatusEvent（verify P1 返工 / FR-03）。
 * 2026-08-27-background-subagent-progress task-10（FR-04）：status 增补 stopped，
 * 透传异步子代理生命周期扩展字段（全可选——旧 daemon 不下发时归一为 null，
 * 消费方按可选语义兜底）。
 */
function parseAgentTaskStatusEvent(
  data: unknown,
  sessionId: string,
): AgentTaskStatusEvent {
  const evt = data as Record<string, unknown>;
  const status =
    evt.status === "completed" ||
    evt.status === "failed" ||
    evt.status === "stopped"
      ? evt.status
      : "running";
  return {
    event: "agent_task_status",
    session_id: sessionId,
    run_id: String(evt.run_id),
    task_id: typeof evt.task_id === "string" ? evt.task_id : "",
    task_name: typeof evt.task_name === "string" ? evt.task_name : "",
    status,
    progress: typeof evt.progress === "number" ? evt.progress : null,
    message: typeof evt.message === "string" ? evt.message : null,
    // FR-04 扩展字段（旧 daemon 缺字段 → null）：
    tool_use_id: typeof evt.tool_use_id === "string" ? evt.tool_use_id : null,
    summary: typeof evt.summary === "string" ? evt.summary : null,
    last_tool_name:
      typeof evt.last_tool_name === "string" ? evt.last_tool_name : null,
    elapsed_ms: typeof evt.elapsed_ms === "number" ? evt.elapsed_ms : null,
    total_tokens:
      typeof evt.total_tokens === "number" ? evt.total_tokens : null,
    tool_uses: typeof evt.tool_uses === "number" ? evt.tool_uses : null,
    async: typeof evt.async === "boolean" ? evt.async : null,
  };
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

/** ql-20260825-011：服务端排队消息条目（GET /sessions/{id}/queue）。 */
export interface SessionQueueEntry {
  id: string;
  prompt: string;
  attachment_ids?: string[];
  agent_profile_id?: string | null;
  llm_provider_id?: string | null;
  status: string;
  error_msg?: string | null;
  created_at: string;
}

/** ql-20260825-011：列出会话排队消息（created_at 升序 = 派发顺序）。 */
export async function fetchSessionQueue(sessionId: string): Promise<SessionQueueEntry[]> {
  const resp = await apiFetch<{ items: SessionQueueEntry[] }>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/queue`,
  );
  return resp.items ?? [];
}

/** ql-20260825-011：删除一条排队消息（队列条上的 ×）。 */
export async function deleteSessionQueueEntry(
  sessionId: string,
  entryId: string,
): Promise<void> {
  await apiFetch(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/queue/${encodeURIComponent(entryId)}`,
    { method: "DELETE" },
  );
}

/** ql-20260825-011：failed 条目重试（翻 pending 并立即尝试派发，忙则留队）。 */
export async function retrySessionQueueEntry(
  sessionId: string,
  entryId: string,
): Promise<SessionQueueEntry> {
  return apiFetch<SessionQueueEntry>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/queue/${encodeURIComponent(entryId)}/retry`,
    { method: "POST" },
  );
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
    { method: "POST", json: body },
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

/* ---------- session SSE (streamSession) ---------- */

export type SessionEventKind =
  | "turn_started"
  | "log"
  | "turn_completed"
  | "session_status"
  | "session_ended"
  | "tokens"
  | "plan_mode_entered"
  | "bash_status"
  | "bash_chunk"
  | "agent_task_status";

/** Plan 模式摘要（plan_mode_entered 事件 payload）。 */
export interface PlanSummary {
  objective: string;
  tasks: string[];
  design_snippet?: string | null;
}

/** plan_mode_entered 事件：Agent 进入 plan 模式，需用户确认/修改/取消。 */
export interface PlanModeEnteredEvent {
  event: "plan_mode_entered";
  session_id: string;
  run_id: string;
  summary: PlanSummary;
  requested_at: string;
}

/** bash_status 事件：Bash 命令开始/结束/失败。 */
export interface BashStatusEvent {
  event: "bash_status";
  session_id: string;
  run_id: string;
  command: string;
  status: "running" | "completed" | "failed";
  exit_code: number | null;
  elapsed_ms: number | null;
}

/** bash_chunk 事件：Bash 命令实时 stdout/stderr 片段。 */
export interface BashChunkEvent {
  event: "bash_chunk";
  session_id: string;
  run_id: string;
  command: string;
  channel: "stdout" | "stderr";
  content: string;
  is_final: boolean;
}

/**
 * agent_task_status 事件：后台 Agent 任务（Task/Agent 工具派发的子代理）状态。
 * verify P1 返工（FR-03）：daemon 在 Task/Agent tool_use 时上报，前端渲染任务卡片。
 * 2026-08-27-background-subagent-progress task-10（FR-04，对齐 api-types 生成类型）：
 * status 增补 stopped 终态，透传异步子代理生命周期扩展字段
 * （tool_use_id/summary/last_tool_name/elapsed_ms/total_tokens/tool_uses/async）。
 * 新字段均可选——旧 daemon 只发 running + task_id/task_name 载荷不受影响
 * （解析侧缺字段归一为 null）。
 */
export interface AgentTaskStatusEvent {
  event: "agent_task_status";
  session_id: string;
  run_id: string;
  task_id: string;
  task_name: string;
  status: "running" | "completed" | "failed" | "stopped";
  progress: number | null;
  message: string | null;
  /** FR-04：以下扩展字段全可选（旧 daemon 事件解析为 null）。 */
  tool_use_id?: string | null;
  summary?: string | null;
  last_tool_name?: string | null;
  elapsed_ms?: number | null;
  total_tokens?: number | null;
  tool_uses?: number | null;
  /** 后端 DTO 字段名 async_ + alias async，daemon 下发键名为 async。 */
  async?: boolean | null;
}

export interface SessionStreamEnvelope {
  event: SessionEventKind;
  session_id: string;
  run_id: string | null;
  turn: number | null;
  log_id: string | null;
  timestamp: string | null;
  channel: string | null;
  content: string | null;
  status: string | null;
  exit_code: number | null;
  reason: string | null;
  /**
   * task-05 / 2026-08-24-platform-session-feedback-fix：plan 模式进入事件携带的
   * 计划摘要与请求时间。
   */
  summary?: PlanSummary | null;
  requested_at?: string | null;
  /**
   * task-05：Bash 进度事件携带的命令行、运行时长。
   * status / channel / content / exit_code 已复用既有同名字段。
   */
  command?: string | null;
  elapsed_ms?: number | null;
  is_final?: boolean;
  /**
   * agent task 状态事件字段（task-05 引入；2026-08-27-background-subagent-progress
   * FR-04 task-10 已接线）：dispatch 经 parseAgentTaskStatusEvent 归一后交给
   * onAgentTaskStatus 回调消费。扩展字段（stopped 终态 / tool_use_id / summary /
   * last_tool_name / elapsed_ms / total_tokens / tool_uses / async）以
   * AgentTaskStatusEvent 接口为准，不在 envelope 重复声明。
   */
  task_id?: string | null;
  task_name?: string | null;
  progress?: number | null;
  message?: string | null;
  /**
   * ql-20260621：实时 / 终态 token。`tokens` 事件（执行中累积）与
   * `turn_completed` 事件（终态）都会带这两个字段；其它事件为 null。
   */
  input_tokens?: number | null;
  output_tokens?: number | null;
  /**
   * prompt cache 维度（Claude）：tokens / turn_completed 事件携带；
   * codex / OpenAI 系无缓存 → null。供徽标四维展示。
   */
  cache_read_tokens?: number | null;
  cache_creation_tokens?: number | null;
  /**
   * 2026-08-27-session-token-usage-fix task-07 / FR-01：该 run 期间最近一次
   * API 调用的提示词大小（上下文环）。tokens / turn_completed 事件携带；
   * 仅 main 桶上报（子代理桶不下发）；旧 backend 不下发此字段时为 undefined，
   * 消费方（task-08 onTokens / 终态回填）按 undefined 保持环未知态。
   */
  ctx_tokens?: number | null;
  /**
   * 2026-08-03-session-stream-partial-revoke / FR-03 / design §5 Phase2 / §7.2：
   * 流式分片 segment_id。backend（task-01 透传 log_entry.segment_id）对 partial 半截
   * 行下发非空（形如 "main:<msg_id>" 或 "<tool_use_id>:<seq>"），对 complete/其他行
   * 下发 null。前端 onLog 据此识别「半截」并记录起点，收到对应 override 令箭时精确撤回。
   *
   * 可选（design §9 兼容策略）：未升级的旧 backend 不下发此字段，运行时为 undefined，
   * onLog 守卫 `env.segment_id` 非空才记 Map，undefined 空转不误撤回。
   */
  segment_id?: string | null;
  /**
   * 2026-08-03-session-stream-partial-revoke / design §7.3：override 撤回令箭行
   * （[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] 前缀，task-02 publish-only 不落库）
   * 此字段为 true，标识该行是撤回信号而非正文日志。
   *
   * 可选：同 segment_id，旧 backend 缺此字段时 undefined，onLog 不依赖它（改由
   * classifySessionLog 识别 override 前缀 kind==="override" 触发撤回），stale 仅供
   * 日志/调试观测，避免与正文日志混淆。
   */
  stale?: boolean;
  /**
   * 2026-06-28-daemon-subagent-transcript task-09 / FR-08：归属三字段（backend run_sync
   * session channel publish 已透传，前端此前漏声明）。主 agent / 旧 backend →
   * null/undefined，消费方（session-log-assembler）按主 agent 平铺。
   */
  parent_tool_use_id?: string | null;
  subagent_type?: string | null;
  depth?: number | null;
  /**
   * 2026-07-05-agent-log-type-tags：工具种类标签
   * （与 lib/agent.ts AgentRunLogEntry.tool_kind 同语义）。
   */
  tool_kind?: string | null;
  /**
   * ql-20260824-020：Edit 工具结果 structuredPatch JSON 串（真实文件行号 hunks），
   * backend run_sync session channel publish 透传。仅 Edit tool_result 行有值，
   * 旧 backend / 其他工具 → null/undefined，Edit 展开区回退 LCS 自算。
   */
  edit_patch?: string | null;
}

/**
 * task-09 / design A6（2026-08-29-daemon-platform-resilience）：streamSession
 * 外露的连接状态。断线重连循环本就内建（对调用方只表现为事件暂停），本类型让
 * 调用方（session-panel 连接横幅）可观测：
 * - "reconnecting"：onerror → 进入退避重连（attempt = 即将进行的第 N 次尝试）；
 * - "reconnected"：resync 完成、SSE 连接重建（横幅「连接已恢复，正在同步…」）；
 * - "live"：重建后收到任一实时事件（恢复正常，无横幅）。
 */
export type SessionStreamStatus = "reconnecting" | "reconnected" | "live";

export interface SessionStreamHandlers {
  onTurnStarted(event: SessionStreamEnvelope): void;
  onLog(event: SessionStreamEnvelope, cursor: string | null): void;
  onTurnCompleted(event: SessionStreamEnvelope): void;
  onSessionEnded(event: SessionStreamEnvelope): void;
  onError(error: Error): void;
  /**
   * ql-20260621：backend 在每次 submit_messages 时往 session channel 推送的
   * `tokens` 事件（累积 input_tokens / output_tokens）。父组件据此实时更新
   * 当前 turn 的 token 显示，无需等 turn_completed 或轮询 DB。
   */
  onTokens?(event: SessionStreamEnvelope): void;
  /**
   * task-11 / ql-20260621：backend 通过同一 session SSE channel 推送的
   * permission_request 事件（Claude Code AskUserQuestion 远程人审 / 普通工具审批）。
   * 当 req.dialog_kind 存在时父组件应渲染 AskUserDialogCard（结构化问答），
   * 否则渲染普通 PermissionApprovalCard（allow/deny 二选一）。
   *
   * 仅监听本回调即可——不必再为 permission_request 建第二条 EventSource。
   */
  onPermissionRequest?(request: SessionPermissionRequest): void;
  /**
   * task-11 / ql-20260621：permission_resolved 事件——backend 确认请求已收口
   *（用户操作 manual 或 5min 超时 timeout）。父组件据此移除对应卡片。
   */
  onPermissionResolved?(resolved: SessionPermissionResolved): void;
  /**
   * task-05 / 2026-08-24-platform-session-feedback-fix：Agent 进入 plan 模式，
   * 父组件渲染 PlanApprovalCard 供用户 confirm / revise / cancel。
   */
  onPlanModeEntered?(event: PlanModeEnteredEvent): void;
  /**
   * task-05：Bash 命令状态变更（running / completed / failed）。
   */
  onBashStatus?(event: BashStatusEvent): void;
  /**
   * task-05：Bash 命令实时输出片段（stdout / stderr）。
   */
  onBashChunk?(event: BashChunkEvent): void;
  /**
   * verify P1 返工（FR-03）：后台 Agent 任务状态（running / completed / failed /
   * stopped）。父组件按 task_id 维护任务卡片列表；存在 running 任务时会话不显示
   * 「已完成」。
   * 2026-08-27-background-subagent-progress / FR-04（task-10）：携带异步子代理
   * 生命周期扩展字段 tool_use_id / summary / last_tool_name / elapsed_ms /
   * total_tokens / tool_uses / async（全可选，旧 daemon 事件为 null）。
   */
  onAgentTaskStatus?(event: AgentTaskStatusEvent): void;
  /**
   * task-09 / design A6（2026-08-29-daemon-platform-resilience）：连接状态回调
   * （可选，不传不影响既有退避 / resync 行为）。进入退避重连上报
   * "reconnecting"（attempt = 即将进行的第 N 次尝试，1 起）；resync 完成建连
   * 上报 "reconnected"；重建后收到任一实时事件转 "live"。首连（未断过线）不
   * 上报——调用方初始态即视为 live，不显示横幅。
   */
  onStatusChange?(status: SessionStreamStatus, attempt?: number): void;
}

export interface SessionStreamConnection {
  close(): void;
  getLastEventId(): string | null;
  /**
   * task-09 / design A6：立即对账一次——复用断线 resync 的 DB 缺口同步
   * （syncGapFromDb：运行中 run 合成 turn_started、终态 run 合成
   * turn_completed、增量回放日志），**不重建 SSE 连接**。运行轮看门狗 90s
   * 无事件时对账发现 run 已终态，经此走既有 resync 刷新路径收敛轮次（终态
   * 以 backend 数据为准，调用方不本地伪造）。对账失败静默（看门狗下一轮再兜）。
   *
   * 可选成员：既有调用方 / 测试桩不构造它也不受影响（看门狗按缺省跳过）。
   */
  resync?(): void;
}

/**
 * SSE 断线重连退避档位（ql-20260820-009）。原为 streamSession 内局部常量，
 * 2026-08-24-sessions-live-updates task-05 提升为模块级导出，供
 * subscribeAgentSessionsEvents 复用同一张档位表（不再各持一份）。
 */
export const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

/**
 * resync REST 快照拉取默认超时（F7 / 2026-08-25）：重连前的 runs/logs 拉取无
 * 超时时，TCP 半开 / 后端挂起会让 resync 流程停摆数分钟（退避循环卡死在
 * await）。10s 足够覆盖正常快照拉取；超时视为 resync 失败走既有 catch 退避
 * 分支（直接进入下一轮重连），不动 apiFetch 全局默认。测试可经
 * streamSession options.resyncTimeoutMs 注入毫秒级超时。
 */
const RESYNC_REST_TIMEOUT_MS = 10_000;

/** 超时信号（AbortSignal.timeout 缺失环境（旧 jsdom）退化为手动 AbortController）。 */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

/**
 * 订阅 session 级 SSE（贯穿整个会话多 turn）。
 *
 * - URL 走 Next route handler proxy（/api/daemon/sessions/{id}/stream），
 *   task-12：token 走 Authorization header（fetch-sse），不再拼 URL query。
 * - backend 对 turn_started/log/turn_completed/session_status/session_ended/permission_*
 *   统一发**默认 data 帧**（无 `event:` 行），payload 内 `event` 字段标识类型。
 *   故前端必须用 `es.onmessage` 接收并按 `parsed.event` dispatch —— 命名事件
 *   （addEventListener）只会收到带 `event:` 行的 done/error，收不到上述 turn 事件，
 *   会导致 InteractiveSessionPanel 的 onTurnStarted/onLog/onTurnCompleted 收不到事件。
 * - 校验 session_id 匹配；turn_started/log/turn_completed 必须有 run_id。
 * - turn_completed 不 close；session_ended close + 回调幂等。
 * - ql-20260820-009：onerror 自动重连（指数退避）——fetch-sse 无自动重连、
 *   backend Redis Pub/Sub 无补发，断连期间事件对本连接永久丢失；重连前经
 *   listSessionRuns + getAgentSessionLogs 全量回放/终态合成补齐缺口（调用方
 *   按 log_id 去重，合成 turn 事件在页面侧终态幂等）。close()/session_ended
 *   后不再重连。F7：resync 快照拉取带 10s 超时（options.resyncTimeoutMs 可覆盖）。
 * - ql-20260827-018：cursor / initialSync 首连缺口同步——调用方先回灌历史再
 *   建流（修 page 模式并行竞态：SSE 先到建 turn 致历史被整体丢弃），本函数在
 *   首次建连前跑一次 DB 缺口同步，补「历史快照 → SSE 订阅」窗口内发布的事件。
 * - task-09 / design A6：可选 onStatusChange 外露连接状态（reconnecting 携
 *   attempt / reconnected / live），仅观测不改退避 / resync 行为；连接对象新增
 *   resync() 供运行轮看门狗主动对账（复用 DB 缺口同步路径）。
 *
 * P0-1（2026-06-18）：从 addEventListener(kind) 改为 onmessage 单通道 dispatch，
 * 与 backend stream_session_logs 的 default data: 帧对齐。done/error 仍走命名事件
 * （backend 发 `event: done`/`event: error`），permission_request/permission_resolved
 * 兼容旧 task-08 onmessage 通道，已统一进 onmessage 解析。
 */
export function streamSession(
  sessionId: string,
  handlers: SessionStreamHandlers,
  options?: {
    /** 已回灌历史的最大 log timestamp（ISO）——首连缺口同步的增量游标起点。 */
    cursor?: string;
    resyncTimeoutMs?: number;
    /**
     * ql-20260827-018：建连前先跑一次 DB 缺口同步（runs 快照合成 + 全量 logs
     * 回放）。历史预取失败（无 cursor 可用）时的兜底路径；成功路径用 cursor
     * 增量同步即可，两者都置位时 cursor 优先（lastLogTs 已初始化）。
     */
    initialSync?: boolean;
  },
): SessionStreamConnection {
  const base = getApiBaseUrl();
  const url = new URL(
    `${base}/api/daemon/sessions/${encodeURIComponent(sessionId)}/stream`,
  );
  // task-12：token 不再进 URL query（访问日志明文泄漏），cursor 业务参数保留。
  if (options?.cursor) url.searchParams.set("cursor", options.cursor);

  let lastEventId: string | null = null;
  let sessionEndedFired = false;
  // ── P4（2026-08-24 会话审查）：增量回放游标 ──────────────────────────────
  // 最近一条已见 log 的 timestamp。回放（断线 resync / 轮后对账）只拉
  // `after = lastLogTs - 2s` 之后的增量，替代全量重放（5000 行 × 50KB）。
  // -2s 重叠窗口兜「submit_messages 同批日志共用同一 timestamp，纯 timestamp
  // 游标跳过同批后到行」的边界；重复行由页面装配器 seenLogIds（log_id）去重。
  // ql-20260827-018：调用方已回灌历史时传 cursor 初始化——首连缺口同步从该点
  // 增量拉取，避免无游标时的二次全量。
  let lastLogTs: string | null = options?.cursor ?? null;
  const REPLAY_OVERLAP_MS = 2000;
  // ── ql-20260820-009：断线重连（指数退避 + 全量回放 + 终态合成） ──────────
  // fetch-sse 无自动重连、backend Redis Pub/Sub 无补发：断连期间的 turn/log
  // 事件对本连接永久丢失。onerror → 退避后 resync 补缺口再重建 SSE 连接。
  let es: FetchSseConnection | null = null;
  let closed = false; // 调用方 close()/session_ended 后不再重连
  let retryCount = 0; // 退避档位（成功收到事件 / resync 后归零）
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  let postTurnTimer: ReturnType<typeof setTimeout> | null = null;
  // task-09 / design A6：连接状态外露（onStatusChange）。初值 live——首连（未断
  // 过线）不上报，调用方初始态即视为 live（不显示横幅）。
  let connStatus: SessionStreamStatus = "live";
  const setStatus = (s: SessionStreamStatus, attempt?: number): void => {
    if (s === "reconnecting") {
      // 每次尝试都上报（横幅要显示第 N 次，attempt 变化不算重复态）。
      connStatus = s;
      handlers.onStatusChange?.(s, attempt);
      return;
    }
    if (connStatus === s) return;
    connStatus = s;
    handlers.onStatusChange?.(s);
  };

  const TERMINAL_RUN_STATUSES: ReadonlySet<string | null> = new Set([
    "completed",
    "failed",
    "killed",
    "cancelled",
    "interrupted",
  ]);

  const dispatch = (raw: { data: string; lastEventId?: string }): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.data);
    } catch {
      // 不泄露原始 payload（可能含敏感内容）
      handlers.onError(new Error("Failed to parse session SSE event"));
      return;
    }
    if (!parsed || typeof parsed !== "object") {
      handlers.onError(new Error("Invalid session SSE payload"));
      return;
    }
    const env = parsed as Partial<SessionStreamEnvelope>;
    const kind = env.event;
    if (!kind) {
      // 无 event 字段：非 session channel 事件（如 backend summary 帧），忽略。
      return;
    }
    // 校验 session_id（permission_* 等同样携带 session_id，统一校验）
    if (env.session_id !== undefined && env.session_id !== sessionId) {
      handlers.onError(new Error(`Session id mismatch on ${kind} event`));
      return;
    }
    // turn / plan / bash / agent_task 类事件必须有 run_id（缺 run_id 的畸形
    // payload 事件丢弃——否则 run_id: String(undefined) 归一成字符串 "undefined"
    // 挂到不存在的 run 上）。agent_task_status 2026-08-25 补入白名单。
    if (
      (kind === "turn_started" ||
        kind === "log" ||
        kind === "turn_completed" ||
        kind === "tokens" ||
        kind === "plan_mode_entered" ||
        kind === "bash_status" ||
        kind === "bash_chunk" ||
        kind === "agent_task_status") &&
      !env.run_id
    ) {
      handlers.onError(new Error(`Missing run_id on ${kind} event`));
      return;
    }
    if (kind === "log" && raw.lastEventId) {
      lastEventId = raw.lastEventId;
    }
    // P4：游标推进——实时 log 事件也计入（envelope.timestamp 是后端落库同源 ts）。
    if (kind === "log" && typeof env.timestamp === "string" && env.timestamp) {
      if (!lastLogTs || env.timestamp > lastLogTs) lastLogTs = env.timestamp;
    }
    const envelope = env as SessionStreamEnvelope;
    switch (kind) {
      case "turn_started":
        handlers.onTurnStarted(envelope);
        break;
      case "log":
        handlers.onLog(envelope, raw.lastEventId ?? null);
        break;
      case "turn_completed":
        handlers.onTurnCompleted(envelope);
        // ql-20260820-010：轮完成即对账——Redis publish 是 best-effort（AC-06
        // try/except 吞错），连接活着也可能丢尾部日志事件（实测最终答复文本
        // 入库但未发布），轮边界重拉 DB 兜底收敛。
        schedulePostTurnReconcile();
        break;
      case "tokens":
        // ql-20260621：实时累积 token（每次 submit_messages 推送）。
        handlers.onTokens?.(envelope);
        break;
      case "plan_mode_entered":
        handlers.onPlanModeEntered?.(parsePlanModeEnteredEvent(parsed, sessionId));
        break;
      case "bash_status":
        handlers.onBashStatus?.(parseBashStatusEvent(parsed, sessionId));
        break;
      case "bash_chunk":
        handlers.onBashChunk?.(parseBashChunkEvent(parsed, sessionId));
        break;
      case "agent_task_status":
        handlers.onAgentTaskStatus?.(parseAgentTaskStatusEvent(parsed, sessionId));
        break;
      case "session_status":
        // session_status 不进入专门 handler（无 status 变更时静默），可选扩展。
        break;
      case "session_ended":
        if (!sessionEndedFired) {
          sessionEndedFired = true;
          handlers.onSessionEnded(envelope);
          closed = true; // 会话终局：不再重连（ql-20260820-009）
          es?.close();
        }
        break;
      default:
        // permission_request / permission_resolved / done / error 等其它事件。
        // done/error 不经 streamSession 契约，仍忽略。
        // permission_request / permission_resolved 在同一 session SSE channel
        // 推送（task-11 ql-20260621）：通过 parseSessionPermissionEvent 解析后
        // 分发给 onPermissionRequest / onPermissionResolved，避免父组件再建第二条
        // EventSource 订阅 permission 通道。
        // 注意：permission_* 不在 SessionEventKind 里（非 turn 类），运行时经
        // default 分支；用 String(kind) 做比较避免 TS 在穷尽 switch 后把 kind
        // 收窄成 undefined 触发 2367。
        const rawKind = String(kind);
        if (
          (rawKind === "permission_request" || rawKind === "permission_resolved") &&
          (handlers.onPermissionRequest || handlers.onPermissionResolved)
        ) {
          const perm = parseSessionPermissionEvent(parsed);
          if (perm) {
            // 区分 request / resolved：request 含 tool_name，resolved 含 decision
            if ((perm as SessionPermissionRequest).tool_name) {
              handlers.onPermissionRequest?.(perm as SessionPermissionRequest);
            } else {
              handlers.onPermissionResolved?.(
                perm as SessionPermissionResolved,
              );
            }
          }
        }
        break;
    }
  };

  /** run 快照 → 合成 turn 事件分发（ql-20260820-009 断线恢复路径）。 */
  const dispatchRunSynth = (
    run: SessionRunRead,
    event: "turn_started" | "turn_completed",
  ) => {
    dispatch({
      data: JSON.stringify({
        event,
        session_id: sessionId,
        run_id: run.id,
        turn: null,
        log_id: null,
        timestamp:
          event === "turn_completed" ? run.finished_at : run.started_at,
        channel: null,
        content: null,
        // interrupted/cancelled → killed（对齐页面 deriveTurnTerminalStatus 语义）
        status:
          event === "turn_completed"
            ? run.status === "interrupted" || run.status === "cancelled"
              ? "killed"
              : run.status
            : null,
        exit_code: run.exit_code,
        reason: null,
        input_tokens: run.input_tokens,
        output_tokens: run.output_tokens,
      }),
    });
  };

  const wireConnection = () => {
    // token 每次重连现取（原实现只在 streamSession 调用时取一次，长连接跨
    // token 刷新后重连会带旧值）。
    const { accessToken } = useSession.getState();
    es = fetchSse(url.toString(), accessToken ? { token: accessToken } : {});
    // backend turn/log/permission_* 走默认 data 帧（无 event: 行）→ 必须用 onmessage 接。
    //（task-12 迁移 fetch-sse 后 onmessage 签名 {data, lastEventId}，与原一致。）
    es.onmessage = (e) => {
      retryCount = 0; // 收到事件 = 连接健康，退避档位归零
      setStatus("live"); // task-09：重建后首条实时事件 → live（横幅收起）
      dispatch({ data: e.data, lastEventId: e.lastEventId || undefined });
    };
    // 终态收口（ql-20260829-007）：backend stream_session_logs 对终态（ended/failed）
    // 会话连上即发命名事件 `event: done` 并关闭连接（连接时终态 race guard 与流中
    // session_ended 两场景同款）。done 是命名事件不进 onmessage/dispatch，此前无人
    // 监听 → 连接关闭触发 onerror → 无限重连循环（终态会话打开面板时反复打
    // runs/logs/stream）。与 session_ended 分支同语义置 closed 终止本流；
    // `event: error`（Redis 故障，AC-07）保持 onerror → 退避重连路径不变。
    es.addEventListener("done", () => {
      closed = true;
      es?.close();
    });
    es.onerror = () => {
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closed) return;
    const delay =
      RECONNECT_BACKOFF_MS[
        Math.min(retryCount, RECONNECT_BACKOFF_MS.length - 1)
      ]!;
    retryCount += 1;
    // task-09：进入退避重连——上报 reconnecting（attempt = 即将进行的第 N 次）。
    setStatus("reconnecting", retryCount);
    reconnectTimer = setTimeout(() => {
      void resyncAndReconnect();
    }, delay);
  };

  /** DB 日志 → log 事件回放（resync 与轮后对账共用；调用方 seenLogIds 去重）。
   *
   * P4：已有游标（lastLogTs）时改增量拉取（after = 游标 - 2s 重叠，后端
   * `timestamp > after` 严格过滤）；首次（无游标）仍全量。
   * F7：signal 仅 resync 路径传入（超时防卡死）；轮后对账不设超时（行为不变）。 */
  const replayLogsFromDb = async (signal?: AbortSignal) => {
    let afterParam: string | undefined;
    if (lastLogTs) {
      const ts = Date.parse(lastLogTs);
      if (!Number.isNaN(ts)) {
        afterParam = new Date(Math.max(0, ts - REPLAY_OVERLAP_MS)).toISOString();
      }
    }
    const logs = await getAgentSessionLogs(
      sessionId,
      afterParam ? { after: afterParam, signal } : signal ? { signal } : {},
    );
    if (closed) return;
    for (const log of logs) {
      if (log.timestamp && (!lastLogTs || log.timestamp > lastLogTs)) {
        lastLogTs = log.timestamp;
      }
      dispatch({
        data: JSON.stringify({
          event: "log",
          session_id: sessionId,
          run_id: log.run_id,
          turn: null,
          log_id: log.id,
          timestamp: log.timestamp,
          channel: log.channel,
          content: log.content_redacted ?? "",
          status: null,
          exit_code: null,
          reason: null,
          // ql-20260827-018：归属字段透传——回放日志与硬重载渲染一致（子代理
          // 嵌套 / 工具类型 / Edit patch）。此前只带 5 个基础字段，断线 resync /
          // 轮后对账补放的子代理日志平铺渲染、与刷新后不一致。segment_id/stale
          // 不在 /logs DTO（partial 行 content 自带标记、override 撤回由分类器
          // 解析 content 前缀），维持 undefined 语义。
          parent_tool_use_id: log.parent_tool_use_id ?? null,
          subagent_type: log.subagent_type ?? null,
          depth: log.depth ?? null,
          tool_kind: log.tool_kind ?? null,
          edit_patch: log.edit_patch ?? null,
        }),
      });
    }
  };

  /**
   * 轮完成后对账（ql-20260820-010）：1.5s 缓冲后重拉日志回放——补「连接活着但
   * Redis 发布丢失」的尾部事件（如最终答复文本）。页面 upsertTurn 允许 log 事件
   * 落在终态轮（终态幂等设计），已见日志由装配器 seenLogIds 去重，回放安全。
   */
  const schedulePostTurnReconcile = () => {
    if (closed) return;
    if (postTurnTimer) clearTimeout(postTurnTimer);
    postTurnTimer = setTimeout(() => {
      void replayLogsFromDb().catch(() => {
        /* 静默：下一次轮完成 / 断连对账再兜 */
      });
    }, 1500);
  };

  /**
   * ql-20260827-018：DB 缺口同步（断线 resync 与首连缺口共用）——runs 快照 →
   * 运行中 run 合成 turn_started（建轮 + 设 currentRunId）→ /logs 增量回放
   * （P4 游标-2s 重叠，首次全量；调用方 seenLogIds 去重补缺口）→ 终态 run 合成
   * turn_completed（补错过的完成事件；页面终态幂等，重复合成 no-op）。
   * 不含建连——调用方决定时序（resync：同步后 wireConnection；首连：wireConnection
   * 前同步，回放期间无实时事件竞争、段内时序干净，与 resync 同序）。
   */
  const syncGapFromDb = async (signal?: AbortSignal) => {
    const runs = await listSessionRuns(sessionId, { signal });
    if (closed) return;
    for (const run of runs) {
      if (!TERMINAL_RUN_STATUSES.has(run.status)) {
        dispatchRunSynth(run, "turn_started");
      }
    }
    await replayLogsFromDb(signal);
    if (closed) return;
    for (const run of runs) {
      if (TERMINAL_RUN_STATUSES.has(run.status)) {
        dispatchRunSynth(run, "turn_completed");
      }
    }
  };

  /**
   * 断线恢复（ql-20260820-009）：runs 快照 → 运行中 run 合成 turn_started
   * （建轮 + 设 currentRunId）→ /logs 增量回放（P4 游标-2s 重叠，首次全量；调用方 seenLogIds 去重补缺口）
   * → 终态 run 合成 turn_completed（补错过的完成事件；页面终态幂等，重复合成
   * no-op）→ 重建 SSE 连接。订阅后 5s 延迟复核兜「快照与订阅之间完成」的 run。
   * 回放与实时事件的段内时序可能有微小交错（罕见，仅断连恢复瞬间）。
   */
  const resyncAndReconnect = async () => {
    if (closed) return;
    // F7：resync 快照拉取带超时——TCP 挂起时 abort 视为 resync 失败，走既有
    // catch 退避分支继续重连循环（不停摆数分钟）。仅作用于本轮两个 REST 调用。
    const signal = timeoutSignal(options?.resyncTimeoutMs ?? RESYNC_REST_TIMEOUT_MS);
    try {
      await syncGapFromDb(signal);
      if (closed) return;
      retryCount = 0;
      wireConnection();
      // task-09：resync 完成建连 → reconnected（「连接已恢复，正在同步…」；
      // 收到首条实时事件后再转 live）。
      setStatus("reconnected");
      reconcileTimer = setTimeout(() => void reconcileTerminalRuns(), 5000);
    } catch {
      scheduleReconnect(); // 后端不可达 → 继续退避重试
    }
  };

  /** 订阅后延迟复核：补「快照与订阅之间」完成的 run（幂等，已终态 no-op）。 */
  const reconcileTerminalRuns = async () => {
    if (closed) return;
    try {
      const runs = await listSessionRuns(sessionId);
      if (closed) return;
      for (const run of runs) {
        if (TERMINAL_RUN_STATUSES.has(run.status)) {
          dispatchRunSynth(run, "turn_completed");
        }
      }
    } catch {
      /* 复核失败不重试（下一断连循环会再兜） */
    }
  };

  // ql-20260827-018：首连缺口同步——调用方已回灌历史（cursor）或预取失败
  // （initialSync）时，建连**前**跑一次 DB 缺口同步（同 resync 时序：回放期间
  // 无实时事件竞争，段内时序干净），补「历史快照 → SSE 订阅」窗口内发布的
  // 事件；同步失败不阻断建连（轮后对账 / 断线 resync 兜底）。建连后 5s 延迟
  // 复核兜「同步窗口内完成」的 run（同 resync）。
  if (options?.cursor || options?.initialSync) {
    void syncGapFromDb(
      timeoutSignal(options?.resyncTimeoutMs ?? RESYNC_REST_TIMEOUT_MS),
    )
      .catch(() => {
        /* 静默：轮后对账 / 断线 resync 再兜 */
      })
      .finally(() => {
        if (!closed && !es) wireConnection();
        if (!closed) {
          reconcileTimer = setTimeout(() => void reconcileTerminalRuns(), 5000);
        }
      });
  } else {
    wireConnection();
  }

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (reconcileTimer) clearTimeout(reconcileTimer);
      if (postTurnTimer) clearTimeout(postTurnTimer);
      es?.close();
    },
    getLastEventId: () => lastEventId,
    // task-09：看门狗对账入口——复用断线 resync 的 DB 缺口同步路径（终态 run
    // 合成 turn_completed / 运行中 run 合成 turn_started / 增量日志回放），
    // 不重建 SSE 连接、不设超时（同轮后对账 1.5s 重放先例）。
    resync: () => {
      if (closed) return;
      void syncGapFromDb().catch(() => {
        /* 静默：看门狗下一轮再对账 */
      });
    },
  };
}

/* ---------- 会话列表变更信号订阅（2026-08-24-sessions-live-updates task-05） ----------
 *
 * GET /api/daemon/sessions/events：backend 在会话生命周期事件（创建 / 状态迁移 /
 * 删除）时经 Redis Pub/Sub 广播的哑信号，SSE 侧已按当前用户过滤。前端不解析
 * payload——收到即回调，由门户 invalidate ["agentSessions"] 前缀重拉列表
 * （design §2.2）。退避重连骨架抄 streamSession 的收敛版：fetchSse 无自动重连
 * （fetch-sse.ts 头注释），断连期间广播的信号对本连接永久丢失，靠 onReconnected
 * 补拉兜缺口。
 */

/**
 * 订阅会话列表变更信号（SSE，2026-08-24-sessions-live-updates task-05）。
 *
 * - onEvent：收到任一 data 帧（JSON 信号）触发一次。
 * - onReconnected：仅断开过才调，每个断连-恢复周期恰一次——重连成功（下一次
 *   连接建立 onopen 或首条消息，先到者）时触发，供调用方补拉断连期间丢失的
 *   信号（Redis Pub/Sub 无补发 / 无 Last-Event-ID 重放）。
 * - onConnected：F7（2026-08-25 后端审查遗留 B6）：每个连接周期恰一次（含**首次**
 *   订阅建立，onopen 或首条消息先到者）——调用方在订阅建立后补拉一次列表，兜
 *   「先拉快照（useQuery）后订阅（effect 建 SSE）」窗口内丢失的变更；重连建立
 *   时与 onReconnected 同点触发（调用方经同一去抖单点合并，不叠加刷新风暴）。
 * - close()：幂等终止（关连接 + 清退避定时器），之后不再重连。
 */
export function subscribeAgentSessionsEvents(opts: {
  onEvent: () => void;
  onReconnected?: () => void;
  onConnected?: () => void;
}): { close: () => void } {
  const url = new URL(`${getApiBaseUrl()}/api/daemon/sessions/events`);

  let es: FetchSseConnection | null = null;
  let closed = false; // 调用方 close() 后不再重连
  let retryCount = 0; // 退避档位（收到信号归零，对齐 streamSession）
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let hadDisconnection = false; // 断开过 → 下一次连接成功补发一次 onReconnected
  let connectedFired = false; // 本连接周期 onConnected 已发（onopen / 首条消息先到者）

  /** 断开后首次「连接成功」（onopen 或首条消息，先到者）触发一次 onReconnected。 */
  const fireReconnectedOnce = () => {
    if (!hadDisconnection) return;
    hadDisconnection = false;
    opts.onReconnected?.();
  };

  /** 连接建立恰一次 onConnected（含首次订阅；fireReconnectedOnce 语义独立叠加）。 */
  const fireConnectedOnce = () => {
    fireReconnectedOnce();
    if (connectedFired) return;
    connectedFired = true;
    opts.onConnected?.();
  };

  const wireConnection = () => {
    connectedFired = false; // 新连接周期重置（onopen / 首条消息先到者触发）
    // token 每次重连现取（对齐 streamSession：长连接跨 token 刷新后重连不带旧值）。
    const { accessToken } = useSession.getState();
    es = fetchSse(url.toString(), accessToken ? { token: accessToken } : {});
    es.onopen = () => {
      fireConnectedOnce();
    };
    // backend 信号统一发默认 data 帧（无 event: 行）→ onmessage 接收。
    es.onmessage = () => {
      retryCount = 0; // 收到信号 = 连接健康，退避档位归零
      fireConnectedOnce();
      opts.onEvent();
    };
    es.onerror = () => {
      hadDisconnection = true;
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closed) return;
    const delay =
      RECONNECT_BACKOFF_MS[
        Math.min(retryCount, RECONNECT_BACKOFF_MS.length - 1)
      ]!;
    retryCount += 1;
    reconnectTimer = setTimeout(() => {
      if (closed) return;
      wireConnection();
    }, delay);
  };

  wireConnection();

  return {
    close: () => {
      if (closed) return; // 幂等
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    },
  };
}

/* ---------- Session list + history (task-12 / FR-10 / D-005@v1) ----------
 *
 * 只读查询：GET /api/daemon/sessions（当前用户所有会话）+ GET /sessions/{id}/logs
 * （跨 AgentRun 历史回看，聚合键为 agent_runs.agent_session_id，见后端 service）。
 * permission 通道复用 task-08（respondSessionPermission / parseSessionPermissionEvent
 * 已在上方），本文件不新增第二套。
 */

import { z } from "zod";

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

/**
 * GET /api/daemon/sessions/{id}/logs — 跨 AgentRun 的只读历史回看。
 * 日志按 run_id 分组返回，run_id 完整保留以便前端区分 turn 边界（D-005@V1）。
 * F7（2026-08-25）：opts.signal 透传 apiFetch（AbortSignal）——仅 resync 重连路径
 * 传入超时信号（TCP 挂起防卡死），其余调用方缺省不设超时，行为不变。
 */
export async function getAgentSessionLogs(
  sessionId: string,
  opts?: { after?: string; signal?: AbortSignal },
): Promise<AgentRunLogEntry[]> {
  const qs = opts?.after ? `?after=${encodeURIComponent(opts.after)}` : "";
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
  status: string | null;
  error_code: string | null;
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

// 内部 dev-time 校验（不暴露给业务层，避免与 backend DTO 双重维护）。
export const AgentSessionListResponseSchema = z.object({
  items: z.array(z.object({}).passthrough()),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

/* ---------- Runtime usage stats (task-11 / FR-01 / FR-03 / D-002@v1 / D-004@v1) ---------- */

/**
 * 时间窗字面量（D-002@v1）：
 *   - "1d"：当日（本地自然日 today 00:00 起，D-004@v1），daily 按小时 24 桶；
 *   - "7d" / "30d"：daily 按日桶。
 */
export type RuntimeUsageWindow = "1d" | "7d" | "30d";

/**
 * 单个 runtime 的用量汇总（SUM over window）。对齐后端 RuntimeUsageSummaryRead（task-09）。
 * 后端 `SUM(COALESCE(col, 0))` 保证这些字段恒为数值（无 NULL）；
 * 前端类型用 number 不可空。codex 等无 cache 的 runtime，cache_read/creation_tokens = 0。
 */
export interface RuntimeUsageSummary {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_cost_usd: number;
}

/**
 * 时间序列单点（20 分钟桶 1d / 小时桶 7d / 日桶 30d）。ts 为 ISO 8601 字符串
 * （后端 datetime 序列化结果），前端不再 Date 化，图表 x 轴直接用字符串。
 */
export interface RuntimeUsagePoint {
  ts: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_cost_usd: number;
}

/** 单个 runtime 的完整用量（summary + 序列）。 */
export interface RuntimeUsageItem {
  runtime_id: string;
  summary: RuntimeUsageSummary;
  daily: RuntimeUsagePoint[];
  /**
   * 供应商×模型 分组明细（2026-08-29-usage-by-provider-model task-12 / FR-04-2）。
   * 对齐后端 RuntimeUsageRead.by_provider：空列表=无明细数据（老 daemon / 老数据），
   * 卡片隐藏分组明细区。类型取 api-types 生成版（task-02 gen:types），禁止手写。
   */
  by_provider?: components["schemas"]["ProviderModelUsageRead"][];
}

/** GET /api/daemon/runtimes/usage 响应体。runtimes 为全部 runtime 的数组（可能含 0 用量项）。 */
export interface RuntimeUsageResponse {
  window: RuntimeUsageWindow;
  runtimes: RuntimeUsageItem[];
}

/**
 * GET /api/daemon/runtimes/usage?window=1d|7d|30d — 批量拉取所有 runtime 的 token/cost 用量（FR-01 / FR-03）。
 *
 * 非实时（D-004@v1）：本函数仅进页面/切窗时主动调用，后端不做 SSE 推送卡片聚合。
 * 后端聚合用 LEFT JOIN+COALESCE 去重（D-003@v2），interactive run 只算一次。
 * codex / OpenAI 系无 cache（D-001@v1），其 cache_* 恒为 0，前端显示「—」。
 *
 * @param window 时间窗；默认 "7d"。
 * @throws ApiError 401 未登录 / 422 window 非法 / 5xx 后端故障——由 apiFetch 归一化抛出，调用方 try/catch。
 */
export async function getRuntimesUsage(
  window: RuntimeUsageWindow = "7d",
): Promise<RuntimeUsageResponse> {
  return apiFetch<RuntimeUsageResponse>("/api/daemon/runtimes/usage", {
    query: { window },
  });
}

/* ---------- Session team mission (2026-08-22-team-session-unify task-12 / FR-07) ----------
 *
 * 会话内团队任务 client（design §5 Phase 3 / §7）：
 *   - POST /api/daemon/sessions/{id}/team-mission  触发（预建，活跃冲突 409）
 *   - GET  /api/daemon/sessions/{id}/team-missions 列表（TeamTaskBlock 数据源）
 *   - POST /api/missions/{id}/cancel               取消（保留端点，D-011）
 *
 * 消费方：TeamTaskBlock（task-12）/ team-trigger-popover（task-11）。活跃 mission
 * （planning/running/awaiting_input）的 5s 轮询由父层（task-11 session-panel）驱动，
 * 本文件只提供一次性请求。
 */

/**
 * mission 派生状态（task-02 扩展后 derive_status 判据矩阵产出，含 awaiting_input 档；
 * 存量 external mission 不进该档）。渲染层对未知值有兜底映射，新增取值不崩。
 */
export type TeamMissionStatus =
  | "planning"
  | "running"
  | "awaiting_input"
  | "done"
  | "degraded"
  | "failed"
  | "cancelled";

/**
 * 分身 run 概要（TeamMissionSummary.workers 单项）。后端仅收 role != orchestrator
 * 的分身 run（主控轮 D-009 不进列表）；status 为 AgentRunStatus（pending/running/
 * completed/failed/killed）。
 */
export interface TeamMissionWorkerSummary {
  run_id: string;
  role: string | null;
  status: string;
  objective: string | null;
  /** 分身执行工作区（ql-20260825-003：跨工作区派发后日志/产物端点按此鉴权）。 */
  workspace_id?: string | null;
  /**
   * 分身子会话形态（2026-08-25-team-subsession-governance）：子会话行非空，
   * 分身行点击据此打开 session-panel；存量 batch 行缺省。first_run_id 与
   * run_id 同源（首 run 双标记锚），get_worker_result 消费。
   */
  sub_session_id?: string | null;
  first_run_id?: string | null;
  /** 运行中分身最新动作预览（UX 走查③）：最新日志行截断摘要，仅 running 行。 */
  latest_action?: string | null;
  /** 已完成分身的结论摘要（UX 优化 2026-08-27）：worker_done 上报的 summary 前 120 字符。 */
  result_summary?: string | null;
}

/** scope 工作区引用（ql-20260825-003：id+名称 enriched 视图）。 */
export interface TeamWorkspaceRef {
  id: string;
  name: string | null;
}

/**
 * 会话团队任务概要（触发响应 / 列表项，对齐 backend daemon/schema.py
 * TeamMissionSummary）。scope_workspace_ids 为落库冻结快照（NULL 缺省回落 [anchor]）。
 *
 * task-14 gen:types 已核对：与生成版 components["schemas"]["TeamMissionSummary"]
 * 字段名一致，但形态有差异，按 task-14 规则保留手写并在此注释差异：
 *   1. 生成版 status 为裸 string（后端 DTO 声明 str 而非 Literal/enum），
 *      手写保留 TeamMissionStatus 联合以获得编译期取值收窄；
 *   2. 生成版 workers 为可选（pydantic default_factory → 生成器标 ?），后端实际
 *      总会序列化该数组，手写保持必填省去消费方判空。
 */
export interface TeamMissionSummary {
  mission_id: string;
  status: TeamMissionStatus;
  objective: string | null;
  scope_workspace_ids: string[];
  /** scope 工作区 id+名称 enriched 视图（ql-20260825-003，前端范围徽标名称化）。 */
  scope_workspaces?: TeamWorkspaceRef[];
  budget_usd: number | null;
  /**
   * ql-20260828-012-4425：编辑回显三件套（后端 mission 行直取；后端为宽松
   * dict 形态，前端按 WorkerPresetItem/MainAgentConfig 精确消费——结构同源，
   * trigger 侧 lib 类型即该形态的生成契约）。
   */
  project_id?: string | null;
  worker_preset?: WorkerPresetItem[] | null;
  main_agent_config?: MainAgentConfig | null;
  workers: TeamMissionWorkerSummary[];
}

/**
 * POST /api/daemon/sessions/{id}/team-mission 请求体（对齐 task-03
 * TeamMissionTriggerRequest）。objective 可空（落库占位，首条 inject 回填 CC-09）；
 * scope_workspace_ids 缺省 = 会话绑定工作区（会话无工作区且未传 → 422，CC-10）。
 */
export interface TeamMissionTriggerRequest {
  objective?: string | null;
  scope_workspace_ids?: string[] | null;
  project_id?: string | null;
  budget_usd?: number | null;
  worker_preset?: WorkerPresetItem[] | null;
  main_agent_config?: MainAgentConfig | null;
}

/**
 * POST /api/daemon/sessions/{session_id}/team-mission — 在当前会话预建团队任务
 *（2026-08-22-team-session-unify task-03 端点）。会话已有活跃 mission 时后端
 * 返回 409（R-07 单活跃约束，ApiError 透传给触发弹层提示）。
 */
export async function triggerSessionTeamMission(
  sessionId: string,
  req: TeamMissionTriggerRequest,
): Promise<TeamMissionSummary> {
  return apiFetch<TeamMissionSummary>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/team-mission`,
    { method: "POST", json: req },
  );
}

/**
 * GET /api/daemon/sessions/{session_id}/team-missions — 会话关联团队任务列表
 *（created_at 倒序）+ 分身概要。TeamTaskBlock 数据源；父层对活跃 mission 5s
 * 轮询本端点，终态停止（design §5 Phase 3）。
 */
export async function listSessionTeamMissions(
  sessionId: string,
): Promise<TeamMissionSummary[]> {
  return apiFetch<TeamMissionSummary[]>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/team-missions`,
  );
}

/**
 * POST /api/missions/{mission_id}/cancel — 取消团队任务（D-011 保留端点，workspace
 * 无关路径）。TeamTaskBlock 取消按钮用；lib/agent.ts 的 cancelMission 是 workspace
 * 前缀旧路由（task-13 清理对象），勿混用。响应为 MissionResponse，本卡只关心
 * 取消副作用（父层 onRefresh 重拉列表展示新状态），不消费具体字段。
 */
export async function cancelTeamMission(missionId: string): Promise<void> {
  await apiFetch(
    `/api/missions/${encodeURIComponent(missionId)}/cancel`,
    { method: "POST" },
  );
}

