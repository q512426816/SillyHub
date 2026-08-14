/**
 * AgentProfile（智能体档案）API 客户端 + React Query hooks。
 *
 * 变更 2026-08-02-agent-profile-layer task-12。
 *
 * 端点（task-04 已 gen:types 进 api-types.ts）：
 *  - workspace 级 CRUD + 复制：/api/workspaces/{wid}/agent-profiles[/{pid}[/copy]]
 *  - platform 级读 + 改 + 删：/api/agent-profiles[/{pid}]（platform 级无 create/copy
 *    入口，建档走 workspace 级，跨级移动为 admin 专能不经 API 暴露——见
 *    AgentProfileUpdate DTO 注释）
 *
 * 类型一律从 api-types.ts 取 `components["schemas"]`（规则 20，禁手写）。
 *
 * 设计依据：design.md §3.1（字段）/ §8（兜底链）/ §11（文件清单）+
 * decisions D-009（三级 visibility）/ D-011（表单三组）/ D-016（v1 仅引用 tool_policy）。
 *
 * 注：queryKeys 本可入 lib/query-keys.ts，但本 task allowed_paths 限定 4 文件，
 * 故 query key 内聚在本模块（与 custom-skills/mcp-settings 走中央 queryKeys 的做法
 * 等价，仅作用域本地化，后续如需统一可平滑迁移）。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

/* ────────────────────── 类型（取自 api-types.ts，规则 20） ────────────────────── */

export type AgentProfileVisibility =
  components["schemas"]["AgentProfileVisibility"];
export type AgentProfileRead = components["schemas"]["AgentProfileRead"];
export type AgentProfileCreate = components["schemas"]["AgentProfileCreate"];
export type AgentProfileUpdate = components["schemas"]["AgentProfileUpdate"];
export type AgentProfileCopyRequest =
  components["schemas"]["AgentProfileCopyRequest"];
export type AgentProfileListResponse =
  components["schemas"]["AgentProfileListResponse"];
export type AgentProfileAggregatedItem =
  components["schemas"]["AgentProfileAggregatedItem"];
export type AgentProfileAggregatedListResponse =
  components["schemas"]["AgentProfileAggregatedListResponse"];
export type ToolPolicyRead = components["schemas"]["ToolPolicyRead"];

/** visibility 中文标签（UI 用）。 */
export const VISIBILITY_LABEL: Record<AgentProfileVisibility, string> = {
  private: "个人",
  workspace: "工作区",
  platform: "平台",
};

/** visibility → antd Tag color（FRONTEND_PAGE_STYLE.md §7：分类用 Tag color）。 */
export const VISIBILITY_TAG_COLOR: Record<AgentProfileVisibility, string> = {
  private: "default",
  workspace: "blue",
  platform: "purple",
};

/**
 * 「不指定，用默认」选项的统一占位值。
 * AgentProfileSelect value="" 映射 null（不发 agent_profile_id，走兜底链 design §8）。
 */
export const NO_PROFILE_VALUE = "";

/* ────────────────────── 本模块内聚的 query keys ────────────────────── */

/**
 * agent-profiles 查询缓存 key。
 *
 * workspace 级列表按 workspaceId 分桶；platform 级列表全局单桶。
 * mutation（create/update/delete/copy）成功后 invalidate 对应桶，触发重拉。
 */
export const agentProfileQueryKeys = {
  /** workspace 级列表（管理页用，含 workspace + private + platform 可见的全部档案）。 */
  workspaceList: (workspaceId: string) =>
    ["agentProfiles", "workspace", workspaceId] as const,
  /** platform 级列表（选档案下拉兜底用）。 */
  platformList: ["agentProfiles", "platform"] as const,
  /** 全局聚合列表（当前 actor 跨工作区可见全集，全局卡片墙用，scope=mine）。 */
  mineList: ["agentProfiles", "mine"] as const,
} as const;

/* ────────────────────── 裸 fetch 函数（workspace 级） ────────────────────── */

/**
 * 列出 workspace 可见的全部档案（含 private/workspace/platform 三级，service.list
 * 按 visibility+actor 过滤返回）。管理页用。返回 AgentProfileListResponse（{items}）。
 */
export async function listWorkspaceAgentProfiles(
  workspaceId: string,
): Promise<AgentProfileRead[]> {
  const resp = await apiFetch<AgentProfileListResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agent-profiles`,
  );
  return resp.items ?? [];
}

/** 新建档案（workspace 级建案权由 service.create 按 visibility 校验）。 */
export async function createWorkspaceAgentProfile(
  workspaceId: string,
  body: AgentProfileCreate,
): Promise<AgentProfileRead> {
  return apiFetch<AgentProfileRead>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agent-profiles`,
    { method: "POST", json: body },
  );
}

/** 取单个档案详情。 */
export async function getWorkspaceAgentProfile(
  workspaceId: string,
  profileId: string,
): Promise<AgentProfileRead> {
  return apiFetch<AgentProfileRead>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agent-profiles/${encodeURIComponent(profileId)}`,
  );
}

/** 部分更新档案（exclude_unset，省略=不动，显式 null=清空）。 */
export async function updateWorkspaceAgentProfile(
  workspaceId: string,
  profileId: string,
  body: AgentProfileUpdate,
): Promise<AgentProfileRead> {
  return apiFetch<AgentProfileRead>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agent-profiles/${encodeURIComponent(profileId)}`,
    { method: "PATCH", json: body },
  );
}

/** 删除档案（204）。系统预置档案后端拒删（is_system_default）。 */
export async function deleteWorkspaceAgentProfile(
  workspaceId: string,
  profileId: string,
): Promise<void> {
  await apiFetch<void>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agent-profiles/${encodeURIComponent(profileId)}`,
    { method: "DELETE" },
  );
}

/**
 * 删除平台/个人级档案（workspace_id=null，无归属工作区，无法走 workspace 级端点）。
 * 调 platform 级 DELETE /api/agent-profiles/{pid}（后端 service.delete 按三级 visibility
 * 鉴权：admin 短路删任意档；private 仅 owner；platform/系统预置仅 admin）。
 * 全局页对 workspace_id=null 档案：admin 走此端点；非 admin 由页面保留友好提示
 * （普通用户删自己的 private 档需后端另开 owner-gated 端点，后续）。
 */
export async function deleteAgentProfile(profileId: string): Promise<void> {
  await apiFetch<void>(
    `/api/agent-profiles/${encodeURIComponent(profileId)}`,
    { method: "DELETE" },
  );
}

/**
 * 复制档案（源档内容原样复制，新档 owner=actor / version=1 / 非系统预置）。
 * name 省略时后端取「{原名}（副本）」，visibility 省略时 private。
 */
export async function copyWorkspaceAgentProfile(
  workspaceId: string,
  profileId: string,
  body: AgentProfileCopyRequest,
): Promise<AgentProfileRead> {
  return apiFetch<AgentProfileRead>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agent-profiles/${encodeURIComponent(profileId)}/copy`,
    { method: "POST", json: body },
  );
}

/* ────────────────────── 裸 fetch 函数（platform 级，只读为主） ────────────────────── */

/**
 * 列出平台级档案（选档案下拉兜底数据源之一；platform 级含系统预置默认档案）。
 */
export async function listPlatformAgentProfiles(): Promise<AgentProfileRead[]> {
  const resp = await apiFetch<AgentProfileListResponse>(`/api/agent-profiles`);
  return resp.items ?? [];
}

/* ────────────────────── 裸 fetch 函数（聚合级，跨工作区只读） ────────────────────── */
//
// design §7.1 / D-004：GET /api/agent-profiles?scope=mine 跨工作区聚合返回 actor
// 可见全集（个人 private + 各 ws 的 workspace 级 + platform + 系统预置），逐档
// _can_read_async 判定（R-01 越权防护在后端 service.list_visible_all）。
// 每条在 AgentProfileRead 全字段之外携带 workspace_id / workspace_name（归属工作区，
// private/platform 级为 null），供全局卡片墙按工作区筛选与展示。
// 注意：未带 scope 时该端点行为冻结为 platform 级（C8），不走此分支。
//

/**
 * 列出当前 actor 跨工作区可见的全部档案（全局卡片墙用）。
 * 返回 AgentProfileAggregatedItem[]（含 workspace_id / workspace_name）。
 */
export async function listMineAgentProfiles(): Promise<AgentProfileAggregatedItem[]> {
  const resp = await apiFetch<AgentProfileAggregatedListResponse>(
    `/api/agent-profiles?scope=mine`,
  );
  return resp.items ?? [];
}

/* ────────────────────── 附带：ToolPolicy 列表（表单引用，D-016） ────────────────────── */
//
// design D-016：v1 工具策略仅引用 tool_policy_id，不做能力白名单 ∩ workspace 叠加。
// 后端 GET /api/workspaces/{wid}/tool-policies 已存在（api-types.ts:6411/28679），
// 但前端无独立 lib 客户端。为不越 task-12 allowed_paths 开新文件，把列表 fetch 内聚
// 在本模块（profile 表单专属，后续如其它页需要再独立成 lib/tool-policies.ts）。
//

/** 列出 workspace 的工具策略（表单 tool_policy_id 下拉用）。 */
export async function listWorkspaceToolPolicies(
  workspaceId: string,
): Promise<ToolPolicyRead[]> {
  return apiFetch<ToolPolicyRead[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/tool-policies`,
  );
}

/* ────────────────────── React Query hooks ────────────────────── */

/**
 * workspace 级档案列表（管理页用）。
 * staleTime 30s：CRUD mutation 主动 invalidate，无需高频自动刷新。
 */
export function useWorkspaceAgentProfiles(workspaceId: string) {
  const q = useQuery<AgentProfileRead[], ApiError>({
    queryKey: agentProfileQueryKeys.workspaceList(workspaceId),
    queryFn: () => listWorkspaceAgentProfiles(workspaceId),
    staleTime: 30_000,
  });
  return {
    profiles: q.data ?? [],
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

/**
 * 平台级档案列表（选档案下拉兜底用；含系统预置默认档案）。
 * staleTime 60s：平台级档案低频变更。
 */
export function usePlatformAgentProfiles() {
  const q = useQuery<AgentProfileRead[], ApiError>({
    queryKey: agentProfileQueryKeys.platformList,
    queryFn: () => listPlatformAgentProfiles(),
    staleTime: 60_000,
  });
  return {
    profiles: q.data ?? [],
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
  };
}

/**
 * 当前 actor 跨工作区可见的全部档案（全局卡片墙用）。
 * staleTime 30s：对齐 useWorkspaceAgentProfiles（CRUD mutation 主动 invalidate，
 * 无需高频自动刷新）。返回 refetch 供筛选切换/手动刷新场景使用。
 */
export function useMineAgentProfiles() {
  const q = useQuery<AgentProfileAggregatedItem[], ApiError>({
    queryKey: agentProfileQueryKeys.mineList,
    queryFn: () => listMineAgentProfiles(),
    staleTime: 30_000,
  });
  return {
    profiles: q.data ?? [],
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

/**
 * workspace 工具策略列表（表单 tool_policy_id 下拉用）。
 * staleTime 60s：策略低频变更。
 */
export function useWorkspaceToolPolicies(workspaceId: string) {
  const q = useQuery<ToolPolicyRead[], ApiError>({
    queryKey: ["agentProfiles", "toolPolicies", workspaceId] as const,
    queryFn: () => listWorkspaceToolPolicies(workspaceId),
    staleTime: 60_000,
  });
  return {
    policies: q.data ?? [],
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
  };
}

/** 新建档案。成功后 invalidate workspace 列表。 */
export function useCreateAgentProfile(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation<
    AgentProfileRead,
    ApiError,
    AgentProfileCreate
  >({
    mutationFn: (body) => createWorkspaceAgentProfile(workspaceId, body),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: agentProfileQueryKeys.workspaceList(workspaceId),
      });
    },
  });
}

/** 更新档案。成功后 invalidate workspace 列表。 */
export function useUpdateAgentProfile(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation<
    AgentProfileRead,
    ApiError,
    { profileId: string; body: AgentProfileUpdate }
  >({
    mutationFn: ({ profileId, body }) =>
      updateWorkspaceAgentProfile(workspaceId, profileId, body),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: agentProfileQueryKeys.workspaceList(workspaceId),
      });
    },
  });
}

/** 删除档案。成功后 invalidate workspace 列表。 */
export function useDeleteAgentProfile(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (profileId) =>
      deleteWorkspaceAgentProfile(workspaceId, profileId),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: agentProfileQueryKeys.workspaceList(workspaceId),
      });
    },
  });
}

/** 复制档案。成功后 invalidate workspace 列表。 */
export function useCopyAgentProfile(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation<
    AgentProfileRead,
    ApiError,
    { profileId: string; body: AgentProfileCopyRequest }
  >({
    mutationFn: ({ profileId, body }) =>
      copyWorkspaceAgentProfile(workspaceId, profileId, body),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: agentProfileQueryKeys.workspaceList(workspaceId),
      });
    },
  });
}
