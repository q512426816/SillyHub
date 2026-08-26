/**
 * workspace 详情只读 skills / .mcp.json 视图 API client + react-query hooks
 *（task-10，变更 2026-07-07-skills-mcp-management-ui）。
 *
 * 依据:
 *   - backend/app/modules/workspace/skills_view_service.py（响应契约）
 *   - backend/app/modules/workspace/router.py:316/333（端点定义）
 *
 * 契约:
 *   - GET /api/workspaces/{id}/skills     → { skills: [{ name, files: [relpath,...] }] }（task-06）
 *   - GET /api/workspaces/{id}/mcp-config → { mcpServers: { ... } }（env secret 已脱敏）
 *   - PUT /api/workspaces/{id}/mcp-config → 写后脱敏视图（与 GET 同构；env 中保留
 *     "<set>" 的键由后端从磁盘现有文件还原真值，见该变更 design §7.1）
 *
 * D-001@v2（变更 2026-08-26-workspace-mcp-edit task-09，推翻旧变更 D-006 的只读
 * 约束）：mcp-config 可编辑——新增 updateWorkspaceMcpConfig fetch +
 * useUpdateWorkspaceMcpConfig mutation，成功后失效 workspaceMcpConfig.detail；
 * skills 仍只读。
 * 两个查询独立（不同端点、不同失效节奏），各自 refetchInterval 对齐 workspace 详情页
 * 静态视图的轻量轮询（30s），可被父组件按需关闭。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch, ApiError } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { queryKeys } from "@/lib/query-keys";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** 单个 workspace 自定义 skill 的只读视图。 */
export interface SkillFileEntry {
  /** skill 名（specDir/skills/<name> 目录名）。 */
  name: string;
  /** skill 目录下文件清单（relpath 相对 skills/<name>/）。 */
  files: string[];
}

/** GET /api/workspaces/{id}/skills 响应。 */
export interface SkillsViewResponse {
  skills: SkillFileEntry[];
}

/*
 * mcp-config 请求/响应类型：后端 pydantic 模型已进 OpenAPI 生成范围（变更
 * 2026-08-26-workspace-mcp-edit task-04 重生成），禁手写，经 api-types 别名
 * 引出供页面（task-10 编辑器）复用。
 */

/** PUT /api/workspaces/{id}/mcp-config 请求体（仅 stdio，未知字段拒绝）。 */
export type McpConfigUpdateRequest =
  components["schemas"]["McpConfigUpdateRequest"];

/** PUT 单个 server 条目（type 缺省 "stdio"；env 值 "<set>" 表示不改该密钥）。 */
export type McpServerEntryPut = components["schemas"]["McpServerEntryPut"];

/** GET/PUT /api/workspaces/{id}/mcp-config 响应（env secret 已脱敏）。 */
export type McpConfigViewResponse =
  components["schemas"]["McpConfigViewResponse"];

/* ------------------------------------------------------------------ */
/*  Fetch（GET 只读视图 + PUT 编辑）                                   */
/* ------------------------------------------------------------------ */

export async function getWorkspaceSkills(
  workspaceId: string,
): Promise<SkillsViewResponse> {
  return apiFetch<SkillsViewResponse>(`/api/workspaces/${workspaceId}/skills`);
}

export async function getWorkspaceMcpConfig(
  workspaceId: string,
): Promise<McpConfigViewResponse> {
  return apiFetch<McpConfigViewResponse>(
    `/api/workspaces/${workspaceId}/mcp-config`,
  );
}

/**
 * 写 workspace .mcp.json（PUT；后端还原 `<set>` 密钥后临时文件 + os.replace
 * 原子写盘）。返回写后脱敏视图（与 GET 同构），错误归一 ApiError。
 */
export async function updateWorkspaceMcpConfig(
  workspaceId: string,
  body: McpConfigUpdateRequest,
): Promise<McpConfigViewResponse> {
  return apiFetch<McpConfigViewResponse>(
    `/api/workspaces/${workspaceId}/mcp-config`,
    { method: "PUT", json: body },
  );
}

/* ------------------------------------------------------------------ */
/*  react-query hooks                                                  */
/* ------------------------------------------------------------------ */

/**
 * useWorkspaceSkills — workspace 自定义 skills 只读列表。
 *
 * 30s 轮询（对齐 workspace 详情静态视图节奏）。loading/error 归调用方展示。
 */
export function useWorkspaceSkills(workspaceId: string) {
  const q = useQuery<SkillsViewResponse, ApiError>({
    queryKey: queryKeys.workspaceSkillsView.detail(workspaceId),
    queryFn: () => getWorkspaceSkills(workspaceId),
    refetchInterval: 30000,
  });
  return {
    skills: q.data?.skills ?? [],
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

/**
 * useWorkspaceMcpConfig — workspace .mcp.json 只读视图（env secret 已脱敏）。
 *
 * 30s 轮询。无 .mcp.json 时 backend 返空 { mcpServers: {} }，不抛错。
 */
export function useWorkspaceMcpConfig(workspaceId: string) {
  const q = useQuery<McpConfigViewResponse, ApiError>({
    queryKey: queryKeys.workspaceMcpConfig.detail(workspaceId),
    queryFn: () => getWorkspaceMcpConfig(workspaceId),
    refetchInterval: 30000,
  });
  return {
    mcpServers: q.data?.mcpServers ?? {},
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

/**
 * 保存 workspace .mcp.json（PUT）。成功后失效 workspaceMcpConfig.detail
 * （与 useWorkspaceMcpConfig 同 key，queryKeys 中央工厂），重取到的即写后
 * 脱敏视图。返回完整 mutation 结果（mutate/isPending/isError/error 等），
 * 交给页面自行组装保存交互，不在本层拆散。
 */
export function useUpdateWorkspaceMcpConfig(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation<McpConfigViewResponse, ApiError, McpConfigUpdateRequest>({
    mutationFn: (body) => updateWorkspaceMcpConfig(workspaceId, body),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.workspaceMcpConfig.detail(workspaceId),
      });
    },
  });
}
