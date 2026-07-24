import { apiFetch } from "./api";

export type ReleaseStatus =
  | "draft"
  | "staging"
  | "approved"
  | "deploying"
  | "deployed"
  | "rolled_back";

export type ReleaseEnvironment = "staging" | "production";

export interface Release {
  id: string;
  workspace_id: string;
  version: string;
  title: string | null;
  status: ReleaseStatus;
  target_environment: ReleaseEnvironment;
  change_ids: string[];
  deploy_policy: Record<string, unknown> | null;
  pre_check_result: string | null;
  post_check_result: string | null;
  deploy_output: string | null;
  creator_id: string;
  deployed_at: string | null;
  rolled_back_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateReleaseInput {
  version: string;
  title?: string;
  target_environment?: ReleaseEnvironment;
  change_ids?: string[];
  deploy_policy?: Record<string, unknown>;
}

export function listReleases(workspaceId: string, status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch<Release[]>(
    `/api/workspaces/${workspaceId}/releases${qs}`,
  );
}

export function createRelease(workspaceId: string, input: CreateReleaseInput) {
  return apiFetch<Release>(`/api/workspaces/${workspaceId}/releases`, {
    method: "POST",
    json: input,
  });
}

export function deployRelease(releaseId: string) {
  return apiFetch<Release>(`/api/releases/${releaseId}/deploy`, {
    method: "POST",
  });
}

export function promoteRelease(releaseId: string) {
  return apiFetch<Release>(`/api/releases/${releaseId}/promote`, {
    method: "POST",
  });
}

export function rollbackRelease(releaseId: string) {
  return apiFetch<Release>(`/api/releases/${releaseId}/rollback`, {
    method: "POST",
  });
}
