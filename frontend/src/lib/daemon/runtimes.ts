/**
 * Daemon API client —— runtimes 域（CRUD/版本/用量 + PROVIDER_META/MIN_VERSIONS/isVersionBelow）。
 *
 * 2026-09-07-arch-large-file-split task-15：自原 lib/daemon.ts 按资源域原样搬移，
 * @/lib/daemon 导入面经 ./index 全量再导出保持零变化。
 */
import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

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
