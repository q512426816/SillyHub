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
  /** @deprecated Backend no longer returns this field */
  sillyspec_path?: string;
  is_sillyspec: boolean;
  /** @deprecated Backend no longer returns this field */
  sillyspec_strategy_hint?: string;
  structure: WorkspaceStructure;
  warnings: string[];
}

export type WorkspaceStatus = "active" | "archived" | "deleted";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  root_path: string;
  status: WorkspaceStatus;
  // Component metadata fields
  component_key: string | null;
  type: string | null;
  role: string | null;
  repo_url: string | null;
  default_branch: string | null;
  tech_stack: string[];
  build_command: string | null;
  test_command: string | null;
  source_yaml_path: string | null;
  // Original fields
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

// ── Workspace Relation types ──

export interface WorkspaceRelation {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  description: string | null;
  created_at: string;
}

export interface RelationListResponse {
  outgoing: WorkspaceRelation[];
  incoming: WorkspaceRelation[];
}

// ── Topology types ──

export interface TopologyNode {
  id: string;
  name: string;
  slug: string;
  component_key: string | null;
}

export interface TopologyEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  description: string | null;
}

export interface TopologyResponse {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

// ── Workspace CRUD ──

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

// ── Workspace Relations ──

export async function getWorkspaceRelations(
  workspaceId: string,
): Promise<RelationListResponse> {
  return apiFetch<RelationListResponse>(
    `/api/workspaces/${workspaceId}/relations`,
  );
}

export async function createRelation(
  workspaceId: string,
  data: { target_id: string; relation_type: string; description?: string },
): Promise<WorkspaceRelation> {
  return apiFetch<WorkspaceRelation>(
    `/api/workspaces/${workspaceId}/relations`,
    { method: "POST", json: data },
  );
}

export async function deleteRelation(relationId: string): Promise<void> {
  await apiFetch<unknown>(`/api/workspaces/relations/${relationId}`, {
    method: "DELETE",
  });
}

// ── Global Topology ──

export async function getTopology(): Promise<TopologyResponse> {
  return apiFetch<TopologyResponse>("/api/workspaces/topology");
}
