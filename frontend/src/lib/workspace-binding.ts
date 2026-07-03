import { apiFetch } from "./api";

/**
 * Per-member workspace daemon binding (task-03/10, change 2026-07-01-collaborative-workspace).
 */

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
}

export interface MemberBindingUpsertRequest {
  daemon_id: string | null;
  root_path: string;
  path_source: string;
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
