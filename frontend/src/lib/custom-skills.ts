/**
 * Custom Skills 客户端 + React Query hooks。
 *
 * 变更 2026-07-07-skills-mcp-management-ui task-08。
 *
 * - 列表/详情/新增/编辑/删除 调 /api/custom-skills（admin only，列表登录可见）
 * - 平台 sillyspec skills manifest 调 /api/daemon/skills/latest/manifest（只读）
 *
 * 类型手写（后端 schema: backend/app/modules/skills/schema.py + skills_bundle_service
 * manifest 返回结构）。task-02 端点的 schema 未进 OpenAPI 生成范围（api-keys 模式），
 * 这里手写并标注来源，待后续生成类型批次统一收敛。
 *
 * 设计依据：design.md §7 接口定义 + D-001（单文件 DB）。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";
import { queryKeys } from "./query-keys";

/* ────────────────────── 类型（手写，对齐后端 schema） ────────────────────── */

/** CustomSkill 列表项（不含 content，含 preview）。来源 schema.CustomSkillRead。 */
export interface CustomSkillRead {
  id: string;
  name: string;
  description: string;
  content_preview: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** CustomSkill 详情（含完整 content）。来源 schema.CustomSkillDetail。 */
export interface CustomSkillDetail extends CustomSkillRead {
  content: string;
}

/** 新建请求体。来源 schema.CustomSkillCreate。 */
export interface CustomSkillCreateRequest {
  name: string;
  description: string;
  content: string;
}

/** 更新请求体（部分更新，字段可选）。来源 schema.CustomSkillUpdate。 */
export interface CustomSkillUpdateRequest {
  name?: string;
  description?: string;
  content?: string;
}

/**
 * 平台 skills manifest 响应。来源 skills_bundle_service.build_skills_manifest。
 * files.path 形如 `sillyspec-foo/SKILL.md`（用 / 分隔）。
 */
export interface PlatformSkillsManifestFile {
  path: string;
  sha256: string;
}

export interface PlatformSkillsManifest {
  version: string;
  files: PlatformSkillsManifestFile[];
  /** 当代码库无 sillyspec skills 时返回的提示信息（version 为空字符串）。 */
  message?: string;
}

/* ────────────────────── 裸 fetch 函数 ────────────────────── */

/** 列出自定义 skills（登录用户可见，不含 content 正文）。 */
export async function listCustomSkills(): Promise<CustomSkillRead[]> {
  return apiFetch<CustomSkillRead[]>("/api/custom-skills");
}

/** 获取自定义 skill 详情（含完整 content，admin）。 */
export async function getCustomSkill(id: string): Promise<CustomSkillDetail> {
  return apiFetch<CustomSkillDetail>(`/api/custom-skills/${encodeURIComponent(id)}`);
}

/** 新建自定义 skill（admin）。 */
export async function createCustomSkill(
  req: CustomSkillCreateRequest,
): Promise<CustomSkillDetail> {
  return apiFetch<CustomSkillDetail>("/api/custom-skills", {
    method: "POST",
    json: req,
  });
}

/** 更新自定义 skill（admin，部分字段可选）。 */
export async function updateCustomSkill(
  id: string,
  req: CustomSkillUpdateRequest,
): Promise<CustomSkillDetail> {
  return apiFetch<CustomSkillDetail>(`/api/custom-skills/${encodeURIComponent(id)}`, {
    method: "PUT",
    json: req,
  });
}

/** 删除自定义 skill（admin，204）。 */
export async function deleteCustomSkill(id: string): Promise<void> {
  await apiFetch<void>(`/api/custom-skills/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** 平台 sillyspec skills manifest（登录用户可见，只读）。 */
export async function getPlatformSkillsManifest(): Promise<PlatformSkillsManifest> {
  return apiFetch<PlatformSkillsManifest>("/api/daemon/skills/latest/manifest");
}

/* ────────────────────── React Query hooks ────────────────────── */

/**
 * 自定义 skills 列表（只读列表，登录可见；CRUD 由 admin 后端鉴权）。
 * staleTime 30s：admin 操作后 mutation 主动 invalidate，无需高频自动刷新。
 */
export function useCustomSkills() {
  const q = useQuery<CustomSkillRead[], ApiError>({
    queryKey: queryKeys.customSkills.all,
    queryFn: () => listCustomSkills(),
    staleTime: 30_000,
  });
  return {
    skills: q.data ?? [],
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

/**
 * 平台 sillyspec skills manifest（只读，登录可见）。
 * staleTime 5min：平台 skills 随部署更新，admin 自定义 skill 改动会变更 version；
 * mutation（create/update/delete custom skill）也 invalidate 以反映 version 变化。
 */
export function usePlatformSkillsManifest() {
  const q = useQuery<PlatformSkillsManifest, ApiError>({
    queryKey: queryKeys.customSkills.manifest,
    queryFn: () => getPlatformSkillsManifest(),
    staleTime: 5 * 60_000,
  });
  return {
    manifest: q.data ?? null,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

/** 新建自定义 skill（admin）。成功后刷新列表 + manifest（version 会变）。 */
export function useCreateCustomSkill() {
  const qc = useQueryClient();
  return useMutation<CustomSkillDetail, ApiError, CustomSkillCreateRequest>({
    mutationFn: (req) => createCustomSkill(req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customSkills.all });
      void qc.invalidateQueries({ queryKey: queryKeys.customSkills.manifest });
    },
  });
}

/** 更新自定义 skill（admin）。成功后刷新列表 + manifest。 */
export function useUpdateCustomSkill() {
  const qc = useQueryClient();
  return useMutation<
    CustomSkillDetail,
    ApiError,
    { id: string; req: CustomSkillUpdateRequest }
  >({
    mutationFn: ({ id, req }) => updateCustomSkill(id, req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customSkills.all });
      void qc.invalidateQueries({ queryKey: queryKeys.customSkills.manifest });
    },
  });
}

/** 删除自定义 skill（admin）。成功后刷新列表 + manifest。 */
export function useDeleteCustomSkill() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => deleteCustomSkill(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customSkills.all });
      void qc.invalidateQueries({ queryKey: queryKeys.customSkills.manifest });
    },
  });
}
