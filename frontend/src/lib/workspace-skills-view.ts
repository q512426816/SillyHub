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
 * useUpdateWorkspaceMcpConfig mutation，成功后失效 workspaceMcpConfig.detail。
 *
 * 2026-08-26-workspace-skill-edit task-05：skills 亦升级完整文件编辑——
 * skill 建删 + 文件读/写/删五组 fetch/hooks，写后失效 workspaceSkillsView
 * 与 workspaceSkillFile 双键。
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

/* ------------------------------------------------------------------ */
/*  skills 完整文件编辑（2026-08-26-workspace-skill-edit task-05）      */
/* ------------------------------------------------------------------ */

/** POST /skills 请求体。 */
export type SkillCreateRequest = components["schemas"]["SkillCreateRequest"];

/** GET 文件内容响应。 */
export type SkillFileContentResponse =
  components["schemas"]["SkillFileContentResponse"];

/** PUT 文件请求体。 */
export type SkillFileWriteRequest =
  components["schemas"]["SkillFileWriteRequest"];

/** 删除类写操作响应。 */
export type SkillMutationResponse =
  components["schemas"]["SkillMutationResponse"];

/** PUT 文件响应。 */
export type SkillFileWriteResponse =
  components["schemas"]["SkillFileWriteResponse"];

export async function createWorkspaceSkill(
  workspaceId: string,
  body: SkillCreateRequest,
): Promise<SkillsViewResponse> {
  return apiFetch<SkillsViewResponse>(`/api/workspaces/${workspaceId}/skills`, {
    method: "POST",
    json: body,
  });
}

export async function deleteWorkspaceSkill(
  workspaceId: string,
  skillName: string,
): Promise<SkillMutationResponse> {
  return apiFetch<SkillMutationResponse>(
    `/api/workspaces/${workspaceId}/skills/${encodeURIComponent(skillName)}`,
    { method: "DELETE" },
  );
}

export async function readWorkspaceSkillFile(
  workspaceId: string,
  skillName: string,
  path: string,
): Promise<SkillFileContentResponse> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return apiFetch<SkillFileContentResponse>(
    `/api/workspaces/${workspaceId}/skills/${encodeURIComponent(skillName)}/files/${encoded}`,
  );
}

export async function writeWorkspaceSkillFile(
  workspaceId: string,
  skillName: string,
  path: string,
  body: SkillFileWriteRequest,
): Promise<SkillFileWriteResponse> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return apiFetch<SkillFileWriteResponse>(
    `/api/workspaces/${workspaceId}/skills/${encodeURIComponent(skillName)}/files/${encoded}`,
    { method: "PUT", json: body },
  );
}

export async function deleteWorkspaceSkillFile(
  workspaceId: string,
  skillName: string,
  path: string,
): Promise<SkillMutationResponse> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return apiFetch<SkillMutationResponse>(
    `/api/workspaces/${workspaceId}/skills/${encodeURIComponent(skillName)}/files/${encoded}`,
    { method: "DELETE" },
  );
}

/** skill 单文件内容查询（编辑器数据源，无轮询——按需手动 refetch）。 */
export function useWorkspaceSkillFile(
  workspaceId: string,
  skillName: string,
  path: string | null,
) {
  return useQuery<SkillFileContentResponse, ApiError>({
    queryKey: queryKeys.workspaceSkillFile.detail(
      workspaceId,
      skillName,
      path ?? "",
    ),
    queryFn: () =>
      readWorkspaceSkillFile(workspaceId, skillName, path as string),
    enabled: path !== null,
  });
}

/** skill 级/文件级写操作统一失效：列表 + 单文件双键。 */
function useInvalidateSkillQueries(workspaceId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({
      queryKey: queryKeys.workspaceSkillsView.detail(workspaceId),
    });
    void qc.invalidateQueries({ queryKey: ["workspaceSkillFile"] });
  };
}

export function useCreateWorkspaceSkill(workspaceId: string) {
  const invalidate = useInvalidateSkillQueries(workspaceId);
  return useMutation<SkillsViewResponse, ApiError, SkillCreateRequest>({
    mutationFn: (body) => createWorkspaceSkill(workspaceId, body),
    onSuccess: invalidate,
  });
}

export function useDeleteWorkspaceSkill(workspaceId: string) {
  const invalidate = useInvalidateSkillQueries(workspaceId);
  return useMutation<SkillMutationResponse, ApiError, string>({
    mutationFn: (skillName) => deleteWorkspaceSkill(workspaceId, skillName),
    onSuccess: invalidate,
  });
}

export function useWriteWorkspaceSkillFile(workspaceId: string) {
  const invalidate = useInvalidateSkillQueries(workspaceId);
  return useMutation<
    SkillFileWriteResponse,
    ApiError,
    { skillName: string; path: string; body: SkillFileWriteRequest }
  >({
    mutationFn: ({ skillName, path, body }) =>
      writeWorkspaceSkillFile(workspaceId, skillName, path, body),
    onSuccess: invalidate,
  });
}

export function useDeleteWorkspaceSkillFile(workspaceId: string) {
  const invalidate = useInvalidateSkillQueries(workspaceId);
  return useMutation<
    SkillMutationResponse,
    ApiError,
    { skillName: string; path: string }
  >({
    mutationFn: ({ skillName, path }) =>
      deleteWorkspaceSkillFile(workspaceId, skillName, path),
    onSuccess: invalidate,
  });
}
