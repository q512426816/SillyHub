import { apiFetch } from "./api";
import type { components } from "@/lib/api-types";

/**
 * Per-member workspace daemon binding (task-03/10, change 2026-07-01-collaborative-workspace).
 */

// MemberBindingUpsertRequest 从 OpenAPI 自动生成（@/lib/api-types），
// 后端 schema 来源：backend/app/modules/workspace/member_runtimes/router.py。
export type MemberBindingUpsertRequest = components["schemas"]["MemberBindingUpsertRequest"];

// MemberBindingView 从 OpenAPI 自动生成（@/lib/api-types）。
// 后端 member_runtimes/router.py 三端点已声明 response_model=MemberBindingView。
export type MemberBindingView = components["schemas"]["MemberBindingView"];

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
