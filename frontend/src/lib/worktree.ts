/**
 * Worktree API client. Mirrors backend/app/modules/worktree/schema.py.
 */
import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

// 类型从 OpenAPI 自动生成（@/lib/api-types，由 scripts/gen-api-types.mjs 产出），
// 消除手写类型漂移。后端 schema 来源：backend/app/modules/worktree/schema.py。
// 注意：schema 的 WorktreeAcquireRequest 各 ID 字段均为必填（后端 422 兜底），
// 因此 acquireWorktree 的 input 不再默认 {}；WorktreeLeaseRead 的 ID 字段后端
// 声明为非空 uuid（旧手写误为 string | null，读侧收窄安全）。
export type WorktreeAcquireRequest = components["schemas"]["WorktreeAcquireRequest"];
export type WorktreeLeaseRead = components["schemas"]["WorktreeLeaseRead"];
export type WorktreeLeaseList = components["schemas"]["WorktreeLeaseList"];
export type WorktreeExtendRequest = components["schemas"]["WorktreeExtendRequest"];

// ── Workspace-scoped endpoints ──

/** Acquire (create) a worktree lease for a workspace. */
export function acquireWorktree(
  workspaceId: string,
  input: WorktreeAcquireRequest,
): Promise<WorktreeLeaseRead> {
  return apiFetch<WorktreeLeaseRead>(
    `/api/workspaces/${workspaceId}/worktrees/acquire`,
    { method: "POST", json: input },
  );
}

/** List all worktree leases for a workspace. */
export function listWorktrees(workspaceId: string): Promise<WorktreeLeaseList> {
  return apiFetch<WorktreeLeaseList>(
    `/api/workspaces/${workspaceId}/worktrees`,
  );
}

// ── Global (lease-scoped) endpoints ──

/** Get a worktree lease by its ID. */
export function getWorktree(leaseId: string): Promise<WorktreeLeaseRead> {
  return apiFetch<WorktreeLeaseRead>(`/api/worktrees/${leaseId}`);
}

/** Release a worktree lease. */
export function releaseWorktree(leaseId: string): Promise<WorktreeLeaseRead> {
  return apiFetch<WorktreeLeaseRead>(`/api/worktrees/${leaseId}/release`, {
    method: "POST",
  });
}

/** Extend a worktree lease's TTL. */
export function extendWorktree(
  leaseId: string,
  input: WorktreeExtendRequest,
): Promise<WorktreeLeaseRead> {
  return apiFetch<WorktreeLeaseRead>(`/api/worktrees/${leaseId}/extend`, {
    method: "POST",
    json: input,
  });
}
