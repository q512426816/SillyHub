/**
 * Workspace API client. Mirrors backend/app/modules/workspace/schema.py.
 */
import { apiFetch } from "@/lib/api";

export interface WorkspaceStructure {
  has_projects_dir: boolean;
  has_changes_dir: boolean;
  has_docs_dir: boolean;
  has_runtime_dir: boolean;
  has_local_yaml: boolean;
  projects_count: number;
  active_changes_count: number;
  archived_changes_count: number;
}

export interface ScanResult {
  root_path: string;
  sillyspec_path: string;
  is_sillyspec: boolean;
  sillyspec_strategy_hint: string;
  structure: WorkspaceStructure;
  warnings: string[];
}

export type WorkspaceStatus = "active" | "archived" | "deleted";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  root_path: string;
  sillyspec_path: string;
  status: WorkspaceStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_scanned_at: string | null;
  deleted_at: string | null;
}

export interface WorkspaceListResponse {
  items: Workspace[];
  total: number;
}

export async function scanWorkspace(rootPath: string): Promise<ScanResult> {
  return apiFetch<ScanResult>("/api/workspaces/scan", {
    method: "POST",
    json: { root_path: rootPath },
  });
}

export async function listWorkspaces(): Promise<WorkspaceListResponse> {
  return apiFetch<WorkspaceListResponse>("/api/workspaces");
}

export interface CreateWorkspaceInput {
  name: string;
  root_path: string;
  slug?: string;
  spec_strategy?: string;
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  return apiFetch<Workspace>("/api/workspaces", {
    method: "POST",
    json: input,
  });
}

export async function rescanWorkspace(id: string): Promise<ScanResult> {
  return apiFetch<ScanResult>(`/api/workspaces/${id}/rescan`, { method: "POST" });
}

export async function deleteWorkspace(id: string): Promise<Workspace> {
  return apiFetch<Workspace>(`/api/workspaces/${id}`, { method: "DELETE" });
}

export async function getWorkspace(id: string): Promise<Workspace> {
  return apiFetch<Workspace>(`/api/workspaces/${id}`);
}
