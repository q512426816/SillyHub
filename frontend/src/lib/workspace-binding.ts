import { apiFetch } from "./api";
import type { components } from "@/lib/api-types";

/**
 * Per-member workspace daemon binding (task-03/10, change 2026-07-01-collaborative-workspace).
 */

// MemberBindingUpsertRequest 从 OpenAPI 自动生成（@/lib/api-types），
// 后端 schema 来源：backend/app/modules/workspace/member_runtimes/router.py。
export type MemberBindingUpsertRequest = components["schemas"]["MemberBindingUpsertRequest"];

// MemberBindingView 暂无 OpenAPI schema：后端 my-binding 系列端点未声明 response_model
// （见 member_runtimes/router.py 的 get_my_binding_endpoint / upsert_my_binding_endpoint /
// list_member_bindings_endpoint），FastAPI 不抽取无名响应模型，故 api-types.ts 里没有它。
// 待后端补 response_model=MemberBindingView 后再迁移。这里按后端 _to_view 的真实字段手写，
// 已包含 init_synced_spec_version（旧手写漏列）。
export interface MemberBindingView {
  workspace_id: string;
  user_id: string;
  daemon_id: string | null;
  /** @deprecated kept for backward compat with existing bindings */
  runtime_id: string | null;
  root_path: string;
  path_source: string;
  synced_at: string | null;
  last_scan_at: string | null;
  /** 平台配置首次下发到本地项目目录的时间（workspace-config-flow W2）。
   *  NULL = 该成员尚未初始化。仅 platform-managed 策略会写入；
   *  repo-native / repo-mirrored 不走 init 下发，恒为 NULL。 */
  init_synced_at: string | null;
  /** init 下发时的 spec 版本号（workspace-config-flow W3 spec_version 保鲜）。 */
  init_synced_spec_version: number | null;
}

/**
 * Fetch current user's own binding for this workspace.
 * Returns null when no binding exists (frontend shows access guide).
 */
export async function fetchMyBinding(
  workspaceId: string,
): Promise<MemberBindingView | null> {
  try {
    const data = await apiFetch<MemberBindingView | null>(
      `/api/workspaces/${workspaceId}/my-binding`,
    );
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * 遗留 1（daemon-entity-binding）：批量拉取当前用户在所有 workspace 的 binding。
 * 返回 list（前端自行按 workspace_id 索引成 Map）。失败降级为空数组（列表卡片不阻塞）。
 */
export async function fetchMyBindings(): Promise<MemberBindingView[]> {
  try {
    const data = await apiFetch<MemberBindingView[] | null>(
      "/api/workspaces/my-bindings",
    );
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Upsert current user's binding for this workspace.
 */
export async function upsertMyBinding(
  workspaceId: string,
  req: MemberBindingUpsertRequest,
): Promise<MemberBindingView> {
  return apiFetch<MemberBindingView>(
    `/api/workspaces/${workspaceId}/my-binding`,
    { method: "PUT", json: req },
  );
}
