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

// ── Topology types ──

export type TopologyNode = Schemas["TopologyNode"];

export type TopologyEdge = Schemas["TopologyEdge"];

export type TopologyResponse = Schemas["TopologyResponse"];

// task-11：对齐 OpenAPI 生成类型。
export type ScanGenerateResponse = Schemas["ScanGenerateResponse"];

export async function scanGenerate(
  rootPath: string,
  provider?: string | null,
  model?: string | null,
  specStrategy?: SpecStrategy,
  daemonId?: string | null,
): Promise<ScanGenerateResponse> {
  return apiFetch<ScanGenerateResponse>("/api/workspaces/scan-generate", {
    method: "POST",
    json: {
      root_path: rootPath,
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      // daemon-entity-binding 后稳定绑定键是 daemon_id（平台统一
      // daemon-client 语义，runtime 维度已下沉到 per-member binding）。
      ...(daemonId ? { daemon_id: daemonId } : {}),
      ...(specStrategy ? { spec_strategy: specStrategy } : {}),
    },
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
  /**
   * 守护进程实体 ID（FK daemon_instances）。daemon-entity-binding task-10/11 补遗：
   * 「添加工作区」对话框 daemon 维度入口传此字段。backend WorkspaceService.create
   * 据此建 workspace_member_runtimes 成员绑定行。
   */
  daemon_id?: string | null;
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

export async function deleteWorkspace(id: string): Promise<Workspace> {
  return apiFetch<Workspace>(`/api/workspaces/${id}`, { method: "DELETE" });
}

export async function getWorkspace(id: string): Promise<Workspace> {
  return apiFetch<Workspace>(`/api/workspaces/${id}`);
}

// ── Components（只读目录，D-001@V1，变更 2026-07-06-component-readonly-split）──
// 组件从 projects/*.yaml 派生，不再是 workspace 行；GET /components 返回 ComponentRead[]。

export type Component = {
  component_key: string;
  name: string;
  path: string | null;
  type: string | null;
  role: string | null;
  tech_stack: string[];
  status: string;
};

export type ComponentListResponse = {
  items: Component[];
  total: number;
};

export async function getWorkspaceComponents(
  workspaceId: string,
): Promise<ComponentListResponse> {
  return apiFetch<ComponentListResponse>(
    `/api/workspaces/${workspaceId}/components`,
  );
}

// ── Global Topology ──

export async function getTopology(): Promise<TopologyResponse> {
  return apiFetch<TopologyResponse>("/api/workspaces/topology");
}
