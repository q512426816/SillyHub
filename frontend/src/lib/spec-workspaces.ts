/**
 * Spec Workspace API client. Mirrors backend spec_workspace endpoints.
 */
import { apiFetch } from "@/lib/api";
import type { AgentRunStatus } from "@/lib/agent";

export type SpecStrategy = "platform-managed" | "repo-mirrored" | "repo-native";
export type SyncStatus = "clean" | "dirty" | "conflicted";

export interface SpecWorkspace {
  id: string;
  workspace_id: string;
  spec_root: string;
  strategy: SpecStrategy;
  repo_sillyspec_path: string | null;
  profile_version: string;
  sync_status: SyncStatus;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getSpecWorkspace(
  workspaceId: string,
): Promise<SpecWorkspace> {
  return apiFetch<SpecWorkspace>(
    `/api/workspaces/${workspaceId}/spec-workspace`,
  );
}

export async function importSpecWorkspace(
  workspaceId: string,
): Promise<SpecWorkspace> {
  return apiFetch<SpecWorkspace>(
    `/api/workspaces/${workspaceId}/spec-workspace/import`,
    { method: "POST" },
  );
}

export async function syncSpecWorkspace(
  workspaceId: string,
): Promise<SpecWorkspace> {
  return apiFetch<SpecWorkspace>(
    `/api/workspaces/${workspaceId}/spec-workspace/sync`,
    { method: "POST" },
  );
}

export interface BootstrapResult {
  agent_run_id: string;
  stream_url: string;
  status: AgentRunStatus;
  spec_root: string;
  message: string;
}

export async function bootstrapSpecWorkspace(
  workspaceId: string,
): Promise<BootstrapResult> {
  return apiFetch<BootstrapResult>(
    `/api/workspaces/${workspaceId}/spec-bootstrap`,
    { method: "POST" },
  );
}

// ── Spec Workspace Update ──

export interface SpecWorkspaceUpdateInput {
  strategy?: SpecStrategy;
  repo_sillyspec_path?: string | null;
  profile_version?: string;
}

export async function updateSpecWorkspace(
  workspaceId: string,
  input: SpecWorkspaceUpdateInput,
): Promise<SpecWorkspace> {
  return apiFetch<SpecWorkspace>(
    `/api/workspaces/${workspaceId}/spec-workspace`,
    { method: "PATCH", json: input },
  );
}

// ── Spec Conflicts ──

export type SpecConflictStatus = "open" | "approved" | "rejected" | "resolved";

export interface SpecConflictRead {
  id: string;
  workspace_id: string;
  change_id: string | null;
  task_id: string | null;
  stage: string;
  conflict_type: string;
  details_json: string | null;
  status: SpecConflictStatus;
  created_at: string;
}

export interface SpecConflictListResponse {
  items: SpecConflictRead[];
  total: number;
}

export interface SpecConflictResolveInput {
  status: SpecConflictStatus;
  details_json?: string | null;
}

export function listSpecConflicts(
  workspaceId: string,
  params?: {
    status_filter?: string;
    limit?: number;
    offset?: number;
  },
): Promise<SpecConflictListResponse> {
  return apiFetch<SpecConflictListResponse>(
    `/api/workspaces/${workspaceId}/spec-conflicts`,
    { query: params as Record<string, string | number | undefined> },
  );
}

export function resolveSpecConflict(
  workspaceId: string,
  conflictId: string,
  input: SpecConflictResolveInput,
): Promise<SpecConflictRead> {
  return apiFetch<SpecConflictRead>(
    `/api/workspaces/${workspaceId}/spec-conflicts/${conflictId}/resolve`,
    { method: "POST", json: input },
  );
}
