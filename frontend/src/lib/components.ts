/**
 * @deprecated This module is deprecated. Use `@/lib/workspaces` instead.
 *
 * The backend component API endpoints have been removed and replaced by
 * Workspace Relations and global Topology APIs. This file provides minimal
 * compatibility shims so that existing pages not yet migrated can compile.
 *
 * See task-10 for the migration plan.
 */
import { apiFetch } from "./api";
import type { Workspace } from "./workspaces";

/**
 * @deprecated Use `Workspace` from `@/lib/workspaces` instead.
 * Component type preserved for backward compatibility with unmigrated pages.
 */
export type Component = {
  id: string;
  workspace_id: string;
  component_key: string;
  name: string;
  type: string | null;
  role: string | null;
  path: string | null;
  repo_url: string | null;
  default_branch: string | null;
  tech_stack: string[];
  build_command: string | null;
  test_command: string | null;
  source_yaml_path: string;
  status: "active" | "path_missing" | string;
  extra: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Relation = {
  id: string;
  workspace_id: string;
  source_component_id: string;
  target_component_id: string;
  relation_type: string;
  description: string | null;
};

export type ParseIssue = {
  code: string;
  file: string | null;
  detail: string;
  severity: "warning" | "error" | string;
};

export type ReparseStats = {
  parsed: number;
  created: number;
  updated: number;
  deleted: number;
  relations_created: number;
  relations_deleted: number;
};

export type ReparseResponse = {
  workspace_id: string;
  stats: ReparseStats;
  components: Component[];
  relations: Relation[];
  warnings: ParseIssue[];
  errors: ParseIssue[];
};

export type TopologyNode = {
  id: string;
  component_key: string;
  name: string;
  type: string | null;
  status: string;
};

export type TopologyEdge = {
  source: string;
  target: string;
  relation_type: string;
  description: string | null;
};

export type TopologyResponse = {
  workspace_id: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
};

/**
 * @deprecated Use `getWorkspaceRelations` from `@/lib/workspaces` instead.
 * This calls a removed endpoint and will fail at runtime.
 */
export function listComponents(workspaceId: string) {
  return apiFetch<{ items: Component[]; total: number }>(
    `/api/workspaces/${workspaceId}/components`,
  );
}

/**
 * @deprecated Use `getWorkspace` from `@/lib/workspaces` instead.
 */
export function getComponent(workspaceId: string, componentId: string) {
  return apiFetch<Component>(
    `/api/workspaces/${workspaceId}/components/${componentId}`,
  );
}

/**
 * @deprecated Use `rescanWorkspace` from `@/lib/workspaces` instead.
 */
export function reparseComponents(workspaceId: string) {
  return apiFetch<ReparseResponse>(
    `/api/workspaces/${workspaceId}/components/reparse`,
    { method: "POST" },
  );
}

/**
 * @deprecated Use `getTopology` from `@/lib/workspaces` instead.
 */
export function getTopology(workspaceId: string) {
  return apiFetch<TopologyResponse>(
    `/api/workspaces/${workspaceId}/components/topology`,
  );
}
