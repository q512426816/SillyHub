"use client";

/**
 * 技能源管理 + 技能库客户端（变更 2026-09-11-skills-central-library / task-04）。
 *
 * 封装后端 modules/skill_source/router.py 的端点（task-01/03 定稿契约）：
 * - GET/POST /api/skill-sources、PATCH/DELETE /api/skill-sources/{source_id}、
 *   POST /api/skill-sources/{source_id}/refresh（均 admin——SETTINGS_ADMIN）
 * - GET /api/skills/library（登录即可，三源聚合 + 我的启用态）
 * - POST/DELETE /api/skills/{skill_key}/enable（本人，body EnableOp）
 *
 * 范式对齐 lib/custom-skills.ts（apiFetch 裸函数 + React Query hooks）；
 * 卡约束「React Query hooks 共置同目录、不新增 lib 文件」——本文件落在
 * components/skills-library/。query-keys.ts 不在本卡 allowed_paths，缓存键
 * 从 queryKeys.customSkills.all 前缀派生（lib/api/mcp-registry.ts
 * templatesKey 先例：React Query 按前缀失效，语义与既有工厂一致）。
 *
 * 类型一律取 api-types.ts 生成 schema（pnpm gen:types 产物，禁手写同名 DTO）。
 *
 * skill_key 含冒号（git = ``<source_id>:<目录名>``）：URL 构造一律
 * encodeURIComponent（%3A 为 RFC 3986 合法路径编码，ASGI 规范解码后到端点）。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { queryKeys } from "@/lib/query-keys";

// ── 生成类型再导出（页面/组件消费口） ─────────────────────────────────────

export type SkillSourceRead = components["schemas"]["SourceRead"];
export type SkillSourceCreateRequest = components["schemas"]["SourceCreate"];
export type SkillSourceUpdateRequest = components["schemas"]["SourceUpdate"];
export type LibraryView = components["schemas"]["LibraryView"];
export type LibrarySkillItem = components["schemas"]["LibrarySkillItem"];

// ── 缓存键（customSkills 前缀派生，见文件头） ─────────────────────────────

/**
 * 技能库查询缓存键（["customSkills", "library"]）：挂在 customSkills.all
 * 前缀下——custom skill 增删改的既有 invalidate(customSkills.all) 会连带
 * 刷新技能库（custom 技能是三源之一，列表口径随其变化）；反向本文件 mutation
 * 只精确失效 library（enable 成功追加 manifest——bundle version 随启用态变化）。
 */
const libraryKey = [...queryKeys.customSkills.all, "library"] as const;

// ── 裸 fetch 函数（源 CRUD admin / library+enable 登录即可） ──────────────

/** 列出全部 git 技能源（admin；页面源管理区块走 library 内嵌 sources，本函数供独立调用/测试）。 */
export async function listSkillSources(): Promise<SkillSourceRead[]> {
  return apiFetch<SkillSourceRead[]>("/api/skill-sources");
}

/** 新建源（admin，201；SSRF 400 / git 缺 422 由后端 service 抛领域错误）。 */
export async function createSkillSource(
  req: SkillSourceCreateRequest,
): Promise<SkillSourceRead> {
  return apiFetch<SkillSourceRead>("/api/skill-sources", {
    method: "POST",
    json: req,
  });
}

/** 部分更新源（admin；url 改动重过 SSRF，enabled=源级开关）。 */
export async function updateSkillSource(
  sourceId: string,
  req: SkillSourceUpdateRequest,
): Promise<SkillSourceRead> {
  return apiFetch<SkillSourceRead>(
    `/api/skill-sources/${encodeURIComponent(sourceId)}`,
    { method: "PATCH", json: req },
  );
}

/** 删除源（admin，204；连带清 user_skill_enables 绑定与缓存目录——service 层）。 */
export async function deleteSkillSource(sourceId: string): Promise<void> {
  await apiFetch<void>(`/api/skill-sources/${encodeURIComponent(sourceId)}`, {
    method: "DELETE",
  });
}

/** 手动刷新源（admin；拉最新 commit 回写 last_commit/last_error）。 */
export async function refreshSkillSource(
  sourceId: string,
): Promise<SkillSourceRead> {
  return apiFetch<SkillSourceRead>(
    `/api/skill-sources/${encodeURIComponent(sourceId)}/refresh`,
    { method: "POST" },
  );
}

/** 技能库三源聚合视图（登录即可；sources 内嵌 git 源列表，skills 含我的启用态）。 */
export async function getSkillsLibrary(): Promise<LibraryView> {
  return apiFetch<LibraryView>("/api/skills/library");
}

/** 启用一个 git 技能（本人；POST body EnableOp enabled=true）。 */
export async function enableSkill(skillKey: string): Promise<void> {
  await apiFetch<void>(`/api/skills/${encodeURIComponent(skillKey)}/enable`, {
    method: "POST",
    json: { enabled: true },
  });
}

/** 停用一个 git 技能（本人，DELETE 无体；幂等——无绑定也 204）。 */
export async function disableSkill(skillKey: string): Promise<void> {
  await apiFetch<void>(`/api/skills/${encodeURIComponent(skillKey)}/enable`, {
    method: "DELETE",
  });
}

// ── React Query hooks ────────────────────────────────────────────────────

/**
 * 技能库查询（staleTime 30s：低频变更，mutation 成功后主动失效）。
 * sources/skills 对 LibraryView 可选字段做 `?? []` 兜底（生成类型可缺省）。
 */
export function useSkillsLibrary() {
  const q = useQuery<LibraryView, ApiError>({
    queryKey: libraryKey,
    queryFn: getSkillsLibrary,
    staleTime: 30_000,
  });
  const view = q.data ?? null;
  return {
    view,
    sources: view?.sources ?? [],
    skills: view?.skills ?? [],
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

/** 新建源（admin；成功后失效 library 缓存——LibraryView.sources 内嵌源列表）。 */
export function useCreateSkillSource() {
  const qc = useQueryClient();
  return useMutation<SkillSourceRead, ApiError, SkillSourceCreateRequest>({
    mutationFn: (req) => createSkillSource(req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKey });
    },
  });
}

/** 部分更新源（admin；enabled 开关 / url·branch·subdir 编辑共用）。 */
export function useUpdateSkillSource() {
  const qc = useQueryClient();
  return useMutation<
    SkillSourceRead,
    ApiError,
    { sourceId: string; req: SkillSourceUpdateRequest }
  >({
    mutationFn: ({ sourceId, req }) => updateSkillSource(sourceId, req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKey });
    },
  });
}

/** 删除源（admin；成功后失效 library——技能列表随源删除收缩，悬空绑定由后端清理）。 */
export function useDeleteSkillSource() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (sourceId) => deleteSkillSource(sourceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKey });
    },
  });
}

/** 手动刷新源（admin；成功后失效 library 反映新 last_commit/last_error）。 */
export function useRefreshSkillSource() {
  const qc = useQueryClient();
  return useMutation<SkillSourceRead, ApiError, string>({
    mutationFn: (sourceId) => refreshSkillSource(sourceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKey });
    },
  });
}

/**
 * git 技能启用开关（本人；乐观更新失败回滚）。
 * - onMutate：取消在途 library 查询后预翻该 skill 的 enabled（快照存 context）
 * - onError：回滚快照（请求失败 UI 不留假状态）
 * - onSuccess：失效 library（启用态以服务端为准）+ manifest（启用变化 →
 *   bundle 内容/version 变化，daemon 同步链路依赖 manifest version）
 */
export function useToggleSkillEnable() {
  const qc = useQueryClient();
  return useMutation<
    void,
    ApiError,
    { skillKey: string; enabled: boolean },
    { previous: LibraryView | undefined }
  >({
    mutationFn: ({ skillKey, enabled }) =>
      enabled ? enableSkill(skillKey) : disableSkill(skillKey),
    onMutate: async ({ skillKey, enabled }) => {
      await qc.cancelQueries({ queryKey: libraryKey });
      const previous = qc.getQueryData<LibraryView>(libraryKey);
      if (previous) {
        qc.setQueryData<LibraryView>(libraryKey, {
          ...previous,
          skills: (previous.skills ?? []).map((s) =>
            s.skill_key === skillKey ? { ...s, enabled } : s,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(libraryKey, ctx.previous);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKey });
      void qc.invalidateQueries({ queryKey: queryKeys.customSkills.manifest });
    },
  });
}
