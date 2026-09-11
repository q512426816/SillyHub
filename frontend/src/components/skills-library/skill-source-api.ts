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
 * 2026-09-11-workspace-asset-bridges task-05 扩 workspace 维度（桥①/桥④）：
 * - library/enable/disable 可选 workspaceId → 请求带 ?workspace_id=（后端
 *   service 做成员校验 403；library 视角切「我的 ∪ 该工作区」并集启用态）；
 * - 新增 workspace 收编两端点（modules/workspace/skills_view_service.py
 *   契约）：GET /api/workspaces/{id}/skills/adoptable（差集候选）与
 *   POST /api/workspaces/{id}/skills/adopt（逐名结果，单名失败不炸整批）。
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
// workspace 收编（bridges task-03 契约 → task-05 消费）
export type AdoptableSkill = components["schemas"]["AdoptableSkill"];
export type AdoptableSkillsResponse = components["schemas"]["AdoptableSkillsResponse"];
export type SkillAdoptRequest = components["schemas"]["SkillAdoptRequest"];
export type SkillAdoptResponse = components["schemas"]["SkillAdoptResponse"];
export type SkillAdoptItemResult = components["schemas"]["SkillAdoptItemResult"];
/** 收编逐名状态（后端 Literal 四态）。 */
export type AdoptItemStatus = SkillAdoptItemResult["status"];

// ── 缓存键（customSkills 前缀派生，见文件头） ─────────────────────────────────────

/**
 * 技能库缓存键前缀（["customSkills", "library"]）：挂在 customSkills.all
 * 前缀下——custom skill 增删改的既有 invalidate(customSkills.all) 会连带
 * 刷新技能库（custom 技能是三源之一，列表口径随其变化）。
 */
const libraryPrefix = [...queryKeys.customSkills.all, "library"] as const;

/**
 * 技能库查询缓存键：无 workspaceId = 用户个人维度（键与前缀同形，既有失效
 * 断言零变化）；带 workspaceId = 该工作区并集视角（用户 ∪ 工作区），键尾
 * 追加 workspaceId 防两个维度缓存互串（本文件头「影响结果的变量都进键」规则）。
 */
const libraryKey = (workspaceId?: string | null) =>
  workspaceId
    ? ([...libraryPrefix, workspaceId] as const)
    : libraryPrefix;

/**
 * workspace 可收编候选缓存键（同挂 customSkills 前缀：adopt 成功新增
 * CustomSkill → invalidate(customSkills.all) 连带刷新差集列表）。
 */
const adoptableKey = (workspaceId: string) =>
  [...queryKeys.customSkills.all, "adoptable", workspaceId] as const;

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

/**
 * 技能库三源聚合视图（登录即可；sources 内嵌 git 源列表，skills 含启用态）。
 * 可选 workspaceId → ?workspace_id=：返回「我的 ∪ 该工作区」并集启用态视角
 * （后端做成员校验，非成员 403）；缺省 = 用户个人维度（行为不变）。
 */
export async function getSkillsLibrary(
  workspaceId?: string,
): Promise<LibraryView> {
  return apiFetch<LibraryView>("/api/skills/library", {
    ...(workspaceId ? { query: { workspace_id: workspaceId } } : {}),
  });
}

/**
 * 启用一个 git 技能（POST body EnableOp enabled=true）。
 * 可选 workspaceId → ?workspace_id= 切工作区维度（工作区成员即可写，
 * D-001@v1 桥①——成员即写权限）；缺省 = 本人个人维度（行为不变）。
 */
export async function enableSkill(
  skillKey: string,
  workspaceId?: string,
): Promise<void> {
  await apiFetch<void>(`/api/skills/${encodeURIComponent(skillKey)}/enable`, {
    method: "POST",
    json: { enabled: true },
    ...(workspaceId ? { query: { workspace_id: workspaceId } } : {}),
  });
}

/**
 * 停用一个 git 技能（DELETE 无体；幂等——无绑定也 204）。
 * 可选 workspaceId → 停工作区维度绑定（后端删除谓词带 scope，不误删个人
 * 绑定——D-010）；缺省 = 本人个人维度（行为不变）。
 */
export async function disableSkill(
  skillKey: string,
  workspaceId?: string,
): Promise<void> {
  await apiFetch<void>(`/api/skills/${encodeURIComponent(skillKey)}/enable`, {
    method: "DELETE",
    ...(workspaceId ? { query: { workspace_id: workspaceId } } : {}),
  });
}

/**
 * 列 specDir/skills 可收编候选（桥④ / D-005 两阶段之列表；WORKSPACE_WRITE——
 * 与确认落库同级权限）。只列差集：已进平台库名全集（CustomSkill 全体 ∪
 * sillyspec-* ∪ enabled git discover）的目录不出现；invalid 条目带原因。
 */
export async function listAdoptableSkills(
  workspaceId: string,
): Promise<AdoptableSkillsResponse> {
  return apiFetch<AdoptableSkillsResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/skills/adoptable`,
  );
}

/**
 * 收编 specDir/skills 技能为操作者的 CustomSkill（桥④ / D-005 确认落库）。
 * names 为 adoptable 列表回传的目录名原样数组；响应逐名结果（adopted /
 * invalid / missing / conflict 重名 409——单名失败不炸整批）。
 */
export async function adoptWorkspaceSkills(
  workspaceId: string,
  names: string[],
): Promise<SkillAdoptResponse> {
  return apiFetch<SkillAdoptResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/skills/adopt`,
    { method: "POST", json: { names } satisfies SkillAdoptRequest },
  );
}

// ── React Query hooks ────────────────────────────────────────────────────

/**
 * 技能库查询（staleTime 30s：低频变更，mutation 成功后主动失效）。
 * 可选 workspaceId → 工作区并集视角（键带维度后缀，见 libraryKey）。
 * sources/skills 对 LibraryView 可选字段做 `?? []` 兜底（生成类型可缺省）。
 */
export function useSkillsLibrary(workspaceId?: string) {
  const q = useQuery<LibraryView, ApiError>({
    queryKey: libraryKey(workspaceId),
    queryFn: () => getSkillsLibrary(workspaceId),
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
      void qc.invalidateQueries({ queryKey: libraryPrefix });
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
      void qc.invalidateQueries({ queryKey: libraryPrefix });
    },
  });
}

/** 删除源（admin；成功后失效 library——技能列表随源删除收缩，悬空绑定由后端清理）。 */
export function useDeleteSkillSource() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (sourceId) => deleteSkillSource(sourceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryPrefix });
    },
  });
}

/** 手动刷新源（admin；成功后失效 library 反映新 last_commit/last_error）。 */
export function useRefreshSkillSource() {
  const qc = useQueryClient();
  return useMutation<SkillSourceRead, ApiError, string>({
    mutationFn: (sourceId) => refreshSkillSource(sourceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryPrefix });
    },
  });
}

/**
 * git 技能启用开关（乐观更新失败回滚；bridges task-05 起支持 workspace 维度）。
 * - mutationFn：vars.workspaceId 有值 → 请求带 ?workspace_id=（工作区维度），
 *   缺省 = 本人个人维度（既有调用点零变化）
 * - onMutate：取消在途 library 查询（前缀——两维度在途都停）后预翻该 skill
 *   的 enabled（仅改本维度键的缓存，快照存 context）
 * - onError：回滚快照（请求失败 UI 不留假状态）
 * - onSuccess：个人维度变化会改所有 workspace 并集视角 → 失效 library 前缀
 *   整体 + manifest（bundle 内容/version 变化，daemon 同步链路依赖）；
 *   workspace 维度只失效本维度键（个人启用态/manifest 不受影响）
 */
export function useToggleSkillEnable() {
  const qc = useQueryClient();
  return useMutation<
    void,
    ApiError,
    { skillKey: string; enabled: boolean; workspaceId?: string },
    { previous: LibraryView | undefined; key: ReturnType<typeof libraryKey> }
  >({
    mutationFn: ({ skillKey, enabled, workspaceId }) =>
      enabled
        ? enableSkill(skillKey, workspaceId)
        : disableSkill(skillKey, workspaceId),
    onMutate: async ({ skillKey, enabled, workspaceId }) => {
      await qc.cancelQueries({ queryKey: libraryPrefix });
      const key = libraryKey(workspaceId);
      const previous = qc.getQueryData<LibraryView>(key);
      if (previous) {
        qc.setQueryData<LibraryView>(key, {
          ...previous,
          skills: (previous.skills ?? []).map((s) =>
            s.skill_key === skillKey ? { ...s, enabled } : s,
          ),
        });
      }
      return { previous, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(ctx.key, ctx.previous);
      }
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: vars.workspaceId ? libraryKey(vars.workspaceId) : libraryPrefix,
      });
      if (!vars.workspaceId) {
        void qc.invalidateQueries({ queryKey: queryKeys.customSkills.manifest });
      }
    },
  });
}

/**
 * workspace 可收编候选查询（桥④列表阶段；enabled 控制弹窗打开才拉取，
 * 避免页面挂载即多一请求）。差集随 adopt/CustomSkill 变化，mutation 成功
 * 后经 customSkills.all 前缀失效连带刷新。
 */
export function useAdoptableSkills(workspaceId: string, enabled: boolean) {
  const q = useQuery<AdoptableSkillsResponse, ApiError>({
    queryKey: adoptableKey(workspaceId),
    queryFn: () => listAdoptableSkills(workspaceId),
    enabled,
    staleTime: 30_000,
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
 * 收编确认（桥④落库阶段）。成功后失效 customSkills.all 前缀——custom 技能
 * 列表 / manifest / 技能库（两维度）/ adoptable 差集一并刷新；逐名结果由
 * 调用方（弹窗）直接消费 mutation data 渲染，不走缓存。
 */
export function useAdoptSkills(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation<SkillAdoptResponse, ApiError, string[]>({
    mutationFn: (names) => adoptWorkspaceSkills(workspaceId, names),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customSkills.all });
    },
  });
}
