/**
 * workspace 详情只读 skills / .mcp.json 视图 API client + react-query hooks
 *（task-10，变更 2026-07-07-skills-mcp-management-ui）。
 *
 * 依据:
 *   - backend/app/modules/workspace/skills_view_service.py（响应契约）
 *   - backend/app/modules/workspace/router.py:316/333（端点定义）
 *
 * 契约（task-06 已就绪）:
 *   - GET /api/workspaces/{id}/skills     → { skills: [{ name, files: [relpath,...] }] }
 *   - GET /api/workspaces/{id}/mcp-config → { mcpServers: { ... } }（env secret 已脱敏）
 *
 * D-006：只读——本模块只暴露查询函数 + useQuery hooks，无 mutation。
 * 两个查询独立（不同端点、不同失效节奏），各自 refetchInterval 对齐 workspace 详情页
 * 静态视图的轻量轮询（30s），可被父组件按需关闭。
 */
import { useQuery } from "@tanstack/react-query";

import { apiFetch, ApiError } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/* ------------------------------------------------------------------ */
/*  Types（镜像 backend SkillsViewResponse / McpConfigViewResponse）   */
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

/** MCP server 配置条目（.mcp.json mcpServers.<name>）。结构宽松，按原样展示。 */
export type McpServerEntry = Record<string, unknown>;

/** GET /api/workspaces/{id}/mcp-config 响应（env secret 已脱敏）。 */
export interface McpConfigViewResponse {
  mcpServers: Record<string, McpServerEntry>;
}

/* ------------------------------------------------------------------ */
/*  Fetch（只读 GET）                                                  */
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
