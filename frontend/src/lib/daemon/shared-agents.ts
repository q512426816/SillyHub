/**
 * Daemon API client —— 平台共享智能体 + 共享给我的机器域。
 *
 * 2026-09-07-arch-large-file-split task-15：自原 lib/daemon.ts 按资源域原样搬移，
 * @/lib/daemon 导入面经 ./index 全量再导出保持零变化。
 */
import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

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
