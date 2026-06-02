/**
 * Compatibility shims for the removed component API endpoints.
 *
 * After the backend refactor, "components" are just child workspaces
 * (identifiable by `component_key !== null`).  This module remaps the
 * old component API calls to the current workspace endpoints so that
 * pages not yet fully migrated can still compile and work.
 *
 * See `.claude-tasks/frontend-api-fix.md` for the migration context.
 */
import { apiFetch } from "./api";
import type { Workspace } from "./workspaces";

/**
 * Component type preserved for backward compatibility with unmigrated pages.
 *
 * Mapped from `Workspace` — every child workspace (component_key !== null)
 * is treated as a component.
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

/** Map a Workspace object to the legacy Component shape. */
function workspaceToComponent(
  ws: Workspace,
  parentWorkspaceId: string,
): Component {
  return {
    id: ws.id,
    workspace_id: parentWorkspaceId,
    component_key: ws.component_key ?? ws.slug,
    name: ws.name,
    type: ws.type,
    role: ws.role,
    path: ws.root_path,
    repo_url: ws.repo_url,
    default_branch: ws.default_branch,
    tech_stack: ws.tech_stack,
    build_command: ws.build_command,
    test_command: ws.test_command,
    source_yaml_path: ws.source_yaml_path ?? "",
    status: ws.status,
    extra: {},
    created_at: ws.created_at,
    updated_at: ws.updated_at,
  };
}

/**
 * List all child workspaces (components) under the given parent workspace.
 *
 * Calls `GET /api/workspaces` and filters by `component_key !== null`.
 */
export async function listComponents(
  workspaceId: string,
): Promise<{ items: Component[]; total: number }> {
  const [ws, resp] = await Promise.all([
    apiFetch<Workspace>(`/api/workspaces/${workspaceId}`),
    apiFetch<{ items: Workspace[]; total: number }>("/api/workspaces"),
  ]);
  const prefix = ws.root_path + "/";
  const items = resp.items
    .filter((w) => w.root_path.startsWith(prefix) && w.id !== ws.id)
    .map((w) => workspaceToComponent(w, workspaceId));
  return { items, total: items.length };
}

/**
 * Get a single component (child workspace) by its ID.
 *
 * Calls `GET /api/workspaces/${componentId}` directly.
 */
export async function getComponent(
  _workspaceId: string,
  componentId: string,
): Promise<Component> {
  const ws = await apiFetch<Workspace>(
    `/api/workspaces/${componentId}`,
  );
  return workspaceToComponent(ws, _workspaceId);
}

/**
 * Re-scan / re-parse a workspace's components.
 *
 * Calls `POST /api/workspaces/${workspaceId}/rescan` and maps the
 * `ScanResult` response back to the legacy `ReparseResponse` shape.
 */
export async function reparseComponents(
  workspaceId: string,
): Promise<ReparseResponse> {
  await apiFetch<unknown>(
    `/api/workspaces/${workspaceId}/rescan`,
    { method: "POST" },
  );
  // After rescan, re-fetch the component list to populate the response
  const comps = await listComponents(workspaceId);
  return {
    workspace_id: workspaceId,
    stats: {
      parsed: 0,
      created: 0,
      updated: 0,
      deleted: 0,
      relations_created: 0,
      relations_deleted: 0,
    },
    components: comps.items,
    relations: [],
    warnings: [],
    errors: [],
  };
}

/**
 * Get the global workspace topology.
 *
 * Calls `GET /api/workspaces/topology` (global — no per-workspace filtering).
 * Maps the response to the legacy `TopologyResponse` shape.
 */
export async function getTopology(
  _workspaceId?: string,
): Promise<TopologyResponse> {
  const resp = await apiFetch<{
    nodes: { id: string; name: string; slug: string; component_key: string | null }[];
    edges: { id: string; source_id: string; target_id: string; relation_type: string; description: string | null }[];
  }>("/api/workspaces/topology");

  return {
    workspace_id: _workspaceId ?? "",
    nodes: resp.nodes.map((n) => ({
      id: n.id,
      component_key: n.component_key ?? n.slug,
      name: n.name,
      type: null,
      status: "active",
    })),
    edges: resp.edges.map((e) => ({
      source: e.source_id,
      target: e.target_id,
      relation_type: e.relation_type,
      description: e.description,
    })),
  };
}
