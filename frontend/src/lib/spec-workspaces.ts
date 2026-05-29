/**
 * Spec Workspace API client. Mirrors backend spec_workspace endpoints.
 */
import { apiFetch } from "@/lib/api";

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
  spec_root: string;
  validation_passed: boolean;
  errors: { path: string; message: string; category: string }[];
  warnings: { path: string; message: string; category: string }[];
  sync_status: string;
}

export async function bootstrapSpecWorkspace(
  workspaceId: string,
): Promise<BootstrapResult> {
  return apiFetch<BootstrapResult>(
    `/api/workspaces/${workspaceId}/spec-bootstrap`,
    { method: "POST" },
  );
}
