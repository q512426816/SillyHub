/**
 * Workspace API client. Mirrors backend/app/modules/workspace/schema.py.
 *
 * task-11 / 2026-07-04-fix-frontend-type-divergence：响应类型全部改为
 * OpenAPI 生成类型别名（单一真相），请求输入类型保留手写以维持窄约束。
 *
 * task-05 / 2026-08-18-workspace-role-type：Create 补必填 type（8 值词表，
 * D-002@v1）与可选 description（FR-03）；Update 补 type/role/description
 * （omit=不改 / null=清空，D-005@v1）；列表参数补 unclassified（type IS NULL
 * 谓词筛选，D-005@v1——与 type 互斥，同传后端 422）。type 联合从
 * lib/workspace-types.ts 派生（其源头是 gen:types 的 WorkspaceCreate.type）。
 */
import { apiFetch } from "@/lib/api";
import type { SpecStrategy } from "@/lib/spec-workspaces";
import type { components } from "@/lib/api-types";
import type { WorkspaceType } from "@/lib/workspace-types";

type Schemas = components["schemas"];

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
// task-05 / 2026-08-18-workspace-role-type：加 unclassified=true（只列 type IS NULL
// 行，D-005@v1，与 type 互斥同传后端 422）。task-06 收紧 type 为 WorkspaceType
// 联合——桌面列表页筛选已换 8 值词表下拉（null | "unclassified" | WorkspaceType），
// 仅剩移动端 m/workspaces 调用点（task-08 收口，收紧后其 string typeFilter 传参处
// 会红 tsc，正是预期的破坏面显形）。
export interface WorkspaceListParams {
  q?: string;
  /** 工作区类型筛选（8 值词表；后端 Literal 校验，非法值/旧值 422）。 */
  type?: WorkspaceType;
  /** 只列未分类（type IS NULL）工作区；与 type 同传后端 422。 */
  unclassified?: boolean;
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
  /**
   * 工作区类型（8 值受控词表，必填，D-002@v1；2026-08-18-workspace-role-type
   * task-05 / FR-01）。联合从 lib/workspace-types.ts 派生（源头 gen:types）。
   */
  type: WorkspaceType;
  /**
   * 工作区角色自由文本（如「订单模块」，≤100 字符；FR-02）。可空：
   * 创建时可不填，后端默认 None。
   */
  role?: string | null;
  /** 用途说明（≤2000 字符，FR-03；2026-08-18-workspace-role-type task-05）。 */
  description?: string | null;
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
  // ── 2026-08-18-workspace-role-type task-05（FR-02/FR-05）──
  // omit=不改 / 显式 null=清空（对齐后端 exclude_unset 实现，D-005@v1）；
  // type 清空后列表/详情显示「未分类」灰徽标。
  /** 工作区类型（8 值词表；omit 不改 / null 清空为「未分类」）。 */
  type?: WorkspaceType | null;
  /** 角色（自由文本；omit 不改 / null 清空）。 */
  role?: string | null;
  /** 用途说明（omit 不改 / null 清空）。 */
  description?: string | null;
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
