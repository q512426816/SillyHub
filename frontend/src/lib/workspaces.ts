/**
 * Workspace API client. Mirrors backend/app/modules/workspace/schema.py.
 *
 * task-11 / 2026-07-04-fix-frontend-type-divergence：响应类型全部改为
 * OpenAPI 生成类型别名（单一真相），请求输入类型保留手写以维持窄约束。
 */
import { apiFetch } from "@/lib/api";
import type { SpecStrategy } from "@/lib/spec-workspaces";
import type { components } from "@/lib/api-types";

type Schemas = components["schemas"];

// task-11：响应类型对齐 OpenAPI 生成类型，保留原类型名作为别名（调用方零改动）。
export type WorkspaceStructure = Schemas["WorkspaceStructureDTO"];

export type ScanResult = Schemas["ScanResponse"];

// task-11：从生成类型派生 WorkspaceStatus，自动含 "pending"（单一真相）。
export type WorkspaceStatus = Schemas["WorkspaceRead"]["status"];

export type OwnerRead = Schemas["app__modules__workspace__schema__OwnerRead"];

export type Workspace = Schemas["WorkspaceRead"];

export type WorkspaceListResponse = Schemas["WorkspaceListResponse"];

// ── Workspace Relation types ──

export type WorkspaceRelation = Schemas["RelationRead"];

export type RelationListResponse = Schemas["RelationListResponse"];

// ── Topology types ──

export type TopologyNode = Schemas["TopologyNode"];

export type TopologyEdge = Schemas["TopologyEdge"];

export type TopologyResponse = Schemas["TopologyResponse"];

// ── Workspace CRUD ──

export async function scanWorkspace(rootPath: string): Promise<ScanResult> {
  return apiFetch<ScanResult>("/api/workspaces/scan", {
    method: "POST",
    json: { root_path: rootPath },
  });
}

// task-11：对齐 OpenAPI 生成类型。
export type ScanGenerateResponse = Schemas["ScanGenerateResponse"];

export async function scanGenerate(
  rootPath: string,
  provider?: string | null,
  model?: string | null,
  pathSource?: "server-local" | "daemon-client",
  daemonRuntimeId?: string | null,
  specStrategy?: SpecStrategy,
): Promise<ScanGenerateResponse> {
  return apiFetch<ScanGenerateResponse>("/api/workspaces/scan-generate", {
    method: "POST",
    json: {
      root_path: rootPath,
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(pathSource ? { path_source: pathSource } : {}),
      ...(daemonRuntimeId ? { daemon_runtime_id: daemonRuntimeId } : {}),
      ...(specStrategy ? { spec_strategy: specStrategy } : {}),
    },
  });
}

export async function activateWorkspace(workspaceId: string): Promise<Workspace> {
  return apiFetch<Workspace>(`/api/workspaces/${workspaceId}/activate`, {
    method: "POST",
  });
}

// task-06 / FR-04：服务端筛选分页。无参调用保持 {items,total} 兼容。
export interface WorkspaceListParams {
  q?: string;
  type?: string;
  status?: string;
  user_id?: string;
  limit?: number;
  offset?: number;
  include_deleted?: boolean;
}

export async function listWorkspaces(
  params?: WorkspaceListParams,
): Promise<WorkspaceListResponse> {
  return apiFetch<WorkspaceListResponse>("/api/workspaces", {
    query: params as Record<string, string | number | boolean | undefined>,
  });
}

export interface CreateWorkspaceInput {
  name: string;
  root_path: string;
  slug?: string;
  spec_strategy?: string;
  // task-10：daemon-client 路径来源（默认 server-local）
  path_source?: "server-local" | "daemon-client";
  /**
   * 守护进程实体 ID（FK daemon_instances）。daemon-entity-binding task-10/11 补遗：
   * 「添加工作区」对话框 daemon 维度入口传此字段，不再传 daemon_runtime_id。
   * backend WorkspaceService.create 据此建 workspace_member_runtimes 成员绑定行。
   */
  daemon_id?: string | null;
  /** @deprecated daemon-entity-binding 后退化为 fallback；新链路一律用 daemon_id。 */
  daemon_runtime_id?: string | null;
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  return apiFetch<Workspace>("/api/workspaces", {
    method: "POST",
    json: input,
  });
}

export interface UpdateWorkspaceInput {
  name?: string;
  slug?: string;
  display_alias?: string | null;
  repo_url?: string | null;
  default_branch?: string | null;
  // Default agent provider; omit to keep, null to clear (FR-02,
  // 2026-06-14-agent-runtime-selection).
  default_agent?: string | null;
  default_model?: string | null;
  tech_stack?: string[];
  build_command?: string | null;
  test_command?: string | null;
  status?: WorkspaceStatus;
  // ql-20260619-006：daemon-client workspace 改绑目标 daemon。backend
  // WorkspaceUpdate 已支持（schema.py WorkspaceUpdate.daemon_runtime_id +
  // service.update exclude_unset+setattr 通用循环），前端此前未暴露该字段，
  // 导致详情页无法切换绑定 daemon（绑定 daemon 离线时扫描/派发直接失败）。
  // 传 string UUID；仅 daemon-client workspace 生效。
  daemon_runtime_id?: string | null;
}

export async function updateWorkspace(
  id: string,
  input: UpdateWorkspaceInput,
): Promise<Workspace> {
  return apiFetch<Workspace>(`/api/workspaces/${id}`, {
    method: "PATCH",
    json: input,
  });
}

export async function rescanWorkspace(id: string): Promise<ScanResult> {
  return apiFetch<ScanResult>(`/api/workspaces/${id}/rescan`, { method: "POST" });
}

export interface ReparseResult {
  parsed: number;
  created: number;
  updated: number;
  deleted: number;
  relations_created: number;
  relations_deleted: number;
  children: { id: string; name: string; component_key: string; slug: string }[];
  relations: { id: string; source_id: string; target_id: string; relation_type: string }[];
}

export async function reparseWorkspace(id: string): Promise<ReparseResult> {
  return apiFetch<ReparseResult>(`/api/workspaces/${id}/reparse`, { method: "POST" });
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

export async function deleteRelation(
  workspaceId: string,
  relationId: string,
): Promise<void> {
  await apiFetch<unknown>(
    `/api/workspaces/${workspaceId}/relations/${relationId}`,
    { method: "DELETE" },
  );
}

// ── Global Topology ──

export async function getTopology(): Promise<TopologyResponse> {
  return apiFetch<TopologyResponse>("/api/workspaces/topology");
}
