/**
 * Worktree API client. Mirrors backend/app/modules/worktree/schema.py.
 */
import { apiFetch } from "@/lib/api";

// ── Types ──

export interface WorktreeAcquireRequest {
  component_id?: string;
  change_id?: string;
  task_id?: string;
  git_identity_id?: string;
  ttl_seconds?: number;
}

export interface WorktreeLeaseRead {
  id: string;
  workspace_id: string;
  component_id: string | null;
  change_id: string | null;
  task_id: string | null;
  user_id: string | null;
  run_id: string | null;
  git_identity_id: string | null;
  path: string;
  branch_name: string;
  status: string;
  locked_at: string;
  released_at: string | null;
  expires_at: string;
}

export interface WorktreeLeaseList {
  items: WorktreeLeaseRead[];
  total: number;
}

export interface WorktreeExtendRequest {
  additional_seconds: number;
}

// ── Workspace-scoped endpoints ──

/** Acquire (create) a worktree lease for a workspace. */
export function acquireWorktree(
  workspaceId: string,
  input: WorktreeAcquireRequest = {},
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
