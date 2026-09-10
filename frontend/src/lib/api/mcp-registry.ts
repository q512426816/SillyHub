"use client";

/**
 * MCP 中央资产库客户端（变更 2026-09-10-mcp-central-registry / task-11 + task-12）。
 *
 * 封装 /api/mcp-servers* 中消费的端点（后端 modules/mcp_registry/router.py）：
 * - GET /api/mcp-servers?scope=platform|mine|visible&search=&tag=（列表）
 * - GET /api/mcp-servers/{id}（详情，encrypted_env ct 遮蔽）
 * - POST /api/mcp-servers（创建，scope=platform 需 admin）
 * - PATCH /api/mcp-servers/{id}（部分更新，平台 server 需 admin）
 * - DELETE /api/mcp-servers/{id}（删除，平台 server 需 admin）
 * - POST/DELETE /api/mcp-servers/{id}/bindings[/scope_type]（加解绑，FR-03）
 * - POST /api/mcp-servers/import-json（JSON 粘贴导入，task-08 / FR-06）
 * - POST /api/mcp-servers/workspace-scan + workspace-import-apply（扫描两阶段，
 *   task-09 / FR-07；候选三态去重判定 + apply 落库）
 * - GET/POST /api/mcp-servers/templates（模板列表 +「存为模板」，task-10 / FR-09）
 * - GET /api/mcp-servers/diagnostics（注入预检五项，task-04 / FR-08 / D-011，
 *   admin 专属——前端只展示返回项，不自行推断诊断）
 *
 * 范式对齐 lib/api/llm-providers.ts（裸 fetch 函数）+ lib/mcp-settings.ts
 * （React Query hooks + query key 走 lib/query-keys.ts 的 mcpRegistry 工厂；
 * task-12 新增的模板/诊断缓存键是 mcpRegistry.all 前缀的派生子键，定义见
 * 下方 templatesKey/diagnosticsKey——query-keys.ts 不在 task-12 allowed_paths）。
 *
 * 类型一律取 api-types.ts 生成 schema（pnpm gen:types 产出，禁止手写同名 DTO）。
 *
 * 安全：env secret 键（键名含 token/key/secret/password 子串，与后端
 * schema.py `_SECRET_KEY_MARKERS` 逐字一致）在 GET 响应里已被后端遮蔽为
 * `<set>`；编辑态保留 `<set>` 提交=后端不动该 secret（service 侧占位语义）。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { queryKeys } from "../query-keys";

// ── 生成类型再导出（页面/组件消费口） ────────────────────────────────────────

export type McpServerRead = components["schemas"]["McpServerRead"];
export type McpServerDetail = components["schemas"]["McpServerDetail"];
export type McpServerCreateRequest = components["schemas"]["McpServerCreate"];
export type McpServerUpdateRequest = components["schemas"]["McpServerUpdate"];
export type McpTemplateRead = components["schemas"]["McpTemplateRead"];
/** 导入/扫描/诊断生成类型（task-12 消费 task-08/09/04 契约）。 */
export type McpImportResult = components["schemas"]["McpImportResult"];
export type McpWorkspaceCandidate = components["schemas"]["McpWorkspaceCandidate"];
export type McpDiagnostic = components["schemas"]["McpDiagnostic"];
/** 诊断 code 五值词表（api-types McpDiagnostic.code）。 */
export type McpDiagnosticCode = McpDiagnostic["code"];
/** binding 的 scope_type 词表（platform 需 admin / user=对我启用）。 */
export type McpBindingScopeType = components["schemas"]["McpBindingCreate"]["scope_type"];
/** 导入目标库词表（api-types McpImportRequest.scope；platform 需 admin）。 */
export type McpImportScope = components["schemas"]["McpImportRequest"]["scope"];

/** 列表 ?scope= 查询词表（api-types list_servers query；visible 仅查询态）。 */
export type McpServerListScope = "platform" | "mine" | "visible";

/** 列表查询参数（进 query key 的影响变量全集，见 query-keys.ts 头规则）。 */
export interface McpRegistryListParams {
  scope: McpServerListScope;
  search?: string;
  tag?: string;
}

// ── secret 键判定（与后端 _SECRET_KEY_MARKERS / _SECRET_REDACTED_PLACEHOLDER 一致） ──

export const MCP_SECRET_KEY_MARKERS = ["token", "key", "secret", "password"] as const;

/** env 遮蔽占位符（后端 schema.py `_SECRET_REDACTED_PLACEHOLDER`；保留提交=不改该 secret）。 */
export const MCP_SECRET_ENV_PLACEHOLDER = "<set>";

/** 键名含 token/key/secret/password 子串（大小写不敏感）→ 视为 secret（R-05 前端预判同规则）。 */
export function isSecretEnvKey(k: string): boolean {
  const lowered = k.toLowerCase();
  return MCP_SECRET_KEY_MARKERS.some((m) => lowered.includes(m));
}

/** server_config.env 里的 secret 键数量（卡片「🔒 N 个密钥」徽标用）。 */
export function countSecretEnvKeys(
  serverConfig: Record<string, unknown> | null | undefined,
): number {
  const env = serverConfig?.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return 0;
  let n = 0;
  for (const k of Object.keys(env as Record<string, unknown>)) {
    if (isSecretEnvKey(k)) n += 1;
  }
  return n;
}

/**
 * server_config 的 stdio 视图（防御性收窄：后端 server_config 是
 * `dict[str, Any]`，写路径已限制 stdio——D-005@v2；此处仅做 UI 展示兜底，
 * 非 DTO 重声明）。command/args/env 缺失或类型不符时回退安全空值。
 */
export function readStdioEntry(
  serverConfig: Record<string, unknown> | null | undefined,
): { command: string; args: string[]; env: Record<string, string> } {
  const cfg = serverConfig ?? {};
  const command = typeof cfg.command === "string" ? cfg.command : "";
  const args = Array.isArray(cfg.args)
    ? cfg.args.filter((a): a is string => typeof a === "string")
    : [];
  const rawEnv = cfg.env;
  const env: Record<string, string> = {};
  if (rawEnv && typeof rawEnv === "object" && !Array.isArray(rawEnv)) {
    for (const [k, v] of Object.entries(rawEnv as Record<string, unknown>)) {
      env[k] = typeof v === "string" ? v : String(v ?? "");
    }
  }
  return { command, args, env };
}

/** cmd 单行展示（`npx -y @foo/bar`；command 为空回退 —）。 */
export function formatCmdLine(
  serverConfig: Record<string, unknown> | null | undefined,
): string {
  const { command, args } = readStdioEntry(serverConfig);
  if (!command) return "—";
  return [command, ...args].join(" ");
}

// ── workspace 导入 renamed 名前端重算（展示用，与后端 apply 口径一致） ─────────
//
// task-09 契约注：McpWorkspaceCandidate **不含** renamed 最终落库名（后端
// apply 时按当时库态重判重算）。扫描弹窗要展示「改名后叫什么」，前端按同一
// 规则重算——以下两个函数与后端 importer.py 逐字对齐（勿单边改）：
// - `_workspace_short_name`：workspace 名 strip + 小写 + 非 [a-z0-9-] 连续段
//   合并为单连字符 + 去首尾连字符；空 slug（纯非 ASCII 名）回退 `id.hex[:6]`
//   （API 形态是带连字符 uuid，hex = 去连字符小写形态 → 去 `-` 取前 6）。
// - `_renamed_name`：`<归一化名>-<短名>`；超 100 截断去尾连字符。归一化名即
//   candidate.name（后端扫描响应已归一化）。

/** workspace 短名 slug（≡ importer.py `_workspace_short_name`）。 */
export function workspaceShortSlug(workspaceName: string, workspaceId: string): string {
  const slug = workspaceName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug) return slug;
  return workspaceId.replace(/-/g, "").slice(0, 6);
}

/** renamed 候选最终落库名重算（≡ importer.py `_renamed_name`；仅展示用）。 */
export function recomputeRenamedName(
  candidateName: string,
  workspaceName: string,
  workspaceId: string,
): string {
  let renamed = `${candidateName}-${workspaceShortSlug(workspaceName, workspaceId)}`;
  if (renamed.length > 100) {
    renamed = renamed.slice(0, 100).replace(/-+$/g, "");
  }
  return renamed;
}

// ── 裸 fetch 函数 ───────────────────────────────────────────────────────────

/** 列表（env 脱敏 + 绑定态 + 诊断徽标；scope=platform|mine|visible）。 */
export async function listMcpServers(
  params: McpRegistryListParams,
): Promise<McpServerRead[]> {
  const resp = await apiFetch<components["schemas"]["McpServerList"]>(
    "/api/mcp-servers",
    { query: { scope: params.scope, search: params.search, tag: params.tag } },
  );
  return resp.items;
}

/** 详情（额外带 encrypted_env 的脱敏形态；跨用户私有 404 由后端防枚举保证）。 */
export async function getMcpServer(serverId: string): Promise<McpServerDetail> {
  return apiFetch<McpServerDetail>(
    `/api/mcp-servers/${encodeURIComponent(serverId)}`,
  );
}

/** 创建（scope=platform 需 admin、stdio-only、secret 键抽列加密——后端 service 层）。 */
export async function createMcpServer(
  req: McpServerCreateRequest,
): Promise<McpServerDetail> {
  return apiFetch<McpServerDetail>("/api/mcp-servers", {
    method: "POST",
    json: req,
  });
}

/** 部分更新（平台 server 需 admin；换 server_config 时 secret 键重加密）。 */
export async function updateMcpServer(
  serverId: string,
  req: McpServerUpdateRequest,
): Promise<McpServerDetail> {
  return apiFetch<McpServerDetail>(
    `/api/mcp-servers/${encodeURIComponent(serverId)}`,
    { method: "PATCH", json: req },
  );
}

/** 删除（204；平台 server 需 admin，binding 级联删靠后端 FK CASCADE）。 */
export async function deleteMcpServer(serverId: string): Promise<void> {
  await apiFetch<void>(`/api/mcp-servers/${encodeURIComponent(serverId)}`, {
    method: "DELETE",
  });
}

/** 加绑定 `{scope_type}`（platform 需 admin；user=「对我启用」——FR-03）。 */
export async function addMcpBinding(
  serverId: string,
  scopeType: McpBindingScopeType,
): Promise<void> {
  await apiFetch<void>(`/api/mcp-servers/${encodeURIComponent(serverId)}/bindings`, {
    method: "POST",
    json: { scope_type: scopeType },
  });
}

/** 解绑（DELETE /bindings/{scope_type}；user 解绑 scope_ref=本人由后端补全）。 */
export async function removeMcpBinding(
  serverId: string,
  scopeType: McpBindingScopeType,
): Promise<void> {
  await apiFetch<void>(
    `/api/mcp-servers/${encodeURIComponent(serverId)}/bindings/${scopeType}`,
    { method: "DELETE" },
  );
}

/**
 * 存为模板（POST /api/mcp-servers/templates，`{name, from_server_id}` 形态；
 * task-10 已落地：service 只取非 secret env，密文绝不内联进模板表）。
 */
export async function saveMcpTemplate(
  name: string,
  fromServerId: string,
): Promise<McpTemplateRead> {
  return apiFetch<McpTemplateRead>("/api/mcp-servers/templates", {
    method: "POST",
    json: { name, from_server_id: fromServerId },
  });
}

// ── 导入三入口 + 诊断（task-12 消费 task-08/09/04/10 契约） ──────────────────

/** JSON 粘贴导入（task-08 / FR-06；scope=platform 需 admin——router 权限门）。 */
export async function importMcpServersFromJson(
  jsonText: string,
  scope: McpImportScope,
): Promise<McpImportResult> {
  return apiFetch<McpImportResult>("/api/mcp-servers/import-json", {
    method: "POST",
    json: { json_text: jsonText, scope },
  });
}

/** workspace 扫描（只读阶段，task-09 / FR-07；workspaceId 缺省=扫描全部）。 */
export async function scanWorkspacesForImport(
  workspaceId?: string,
): Promise<McpWorkspaceCandidate[]> {
  return apiFetch<McpWorkspaceCandidate[]>("/api/mcp-servers/workspace-scan", {
    method: "POST",
    json: workspaceId ? { workspace_id: workspaceId } : {},
  });
}

/**
 * 应用扫描候选（写阶段，task-09 / FR-07）。候选回传完整 McpWorkspaceCandidate
 * 形态（schema 契约：后端按 workspace_id+name 重读原文件取明文，脱敏展示
 * 不阻断应用）。
 */
export async function applyWorkspaceImport(
  candidates: McpWorkspaceCandidate[],
  scope: McpImportScope,
): Promise<McpImportResult> {
  return apiFetch<McpImportResult>("/api/mcp-servers/workspace-import-apply", {
    method: "POST",
    json: { candidates, scope },
  });
}

/** 模板列表（task-10 / FR-09：平台预置 + 本人自存，跨用户自存不出现）。 */
export async function listMcpTemplates(): Promise<McpTemplateRead[]> {
  const resp = await apiFetch<components["schemas"]["McpTemplateList"]>(
    "/api/mcp-servers/templates",
  );
  return resp.items;
}

/** 注入预检诊断（task-04 / FR-08 / D-011：SETTINGS_ADMIN 专属端点）。 */
export async function getMcpDiagnostics(): Promise<McpDiagnostic[]> {
  return apiFetch<McpDiagnostic[]>("/api/mcp-servers/diagnostics");
}

// ── React Query hooks ───────────────────────────────────────────────────────

/**
 * 列表查询（按 scope/search/tag 分桶缓存）。staleTime 30s：资产库低频变更，
 * mutation 成功后主动 invalidate mcpRegistry.all 双 tab 一起刷新。
 */
export function useMcpServers(params: McpRegistryListParams) {
  const q = useQuery<McpServerRead[], ApiError>({
    queryKey: queryKeys.mcpRegistry.list(params),
    queryFn: () => listMcpServers(params),
    staleTime: 30_000,
  });
  return {
    servers: q.data ?? [],
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

/** 创建（成功后失效全部列表缓存）。 */
export function useCreateMcpServer() {
  const qc = useQueryClient();
  return useMutation<McpServerDetail, ApiError, McpServerCreateRequest>({
    mutationFn: (req) => createMcpServer(req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mcpRegistry.all });
    },
  });
}

/** 部分更新（成功后失效全部列表缓存）。 */
export function useUpdateMcpServer() {
  const qc = useQueryClient();
  return useMutation<
    McpServerDetail,
    ApiError,
    { serverId: string; req: McpServerUpdateRequest }
  >({
    mutationFn: ({ serverId, req }) => updateMcpServer(serverId, req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mcpRegistry.all });
    },
  });
}

/** 删除（成功后失效全部列表缓存）。 */
export function useDeleteMcpServer() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (serverId) => deleteMcpServer(serverId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mcpRegistry.all });
    },
  });
}

/**
 * binding 开关（「对我启用」user binding / admin 平台库 tab 的 platform binding
 * 共用；enabled=true 走 POST，false 走 DELETE——FR-03 加解绑同一 hook）。
 */
export function useToggleMcpBinding() {
  const qc = useQueryClient();
  return useMutation<
    void,
    ApiError,
    { serverId: string; scopeType: McpBindingScopeType; enabled: boolean }
  >({
    mutationFn: ({ serverId, scopeType, enabled }) =>
      enabled
        ? addMcpBinding(serverId, scopeType)
        : removeMcpBinding(serverId, scopeType),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mcpRegistry.all });
    },
  });
}

// ── task-12 hooks：导入三入口 + 诊断 ────────────────────────────────────────
//
// 模板/诊断查询缓存键：query-keys.ts 不在本卡 allowed_paths，故在此基于
// mcpRegistry.all 前缀派生子键——React Query 按前缀失效，任何 mutation 成功
// 后 invalidate(mcpRegistry.all) 时模板/诊断缓存一并刷新，语义与既有工厂一致。

const templatesKey = [...queryKeys.mcpRegistry.all, "templates"] as const;
const diagnosticsKey = [...queryKeys.mcpRegistry.all, "diagnostics"] as const;

/** JSON 粘贴导入（成功后失效库列表缓存）。 */
export function useImportMcpJson() {
  const qc = useQueryClient();
  return useMutation<
    McpImportResult,
    ApiError,
    { jsonText: string; scope: McpImportScope }
  >({
    mutationFn: ({ jsonText, scope }) => importMcpServersFromJson(jsonText, scope),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mcpRegistry.all });
    },
  });
}

/** workspace 扫描（只读，无需失效缓存）。 */
export function useScanMcpWorkspaces() {
  return useMutation<McpWorkspaceCandidate[], ApiError, string | undefined>({
    mutationFn: (workspaceId) => scanWorkspacesForImport(workspaceId),
  });
}

/** 应用扫描候选（成功后失效库列表缓存）。 */
export function useApplyMcpWorkspaceImport() {
  const qc = useQueryClient();
  return useMutation<
    McpImportResult,
    ApiError,
    { candidates: McpWorkspaceCandidate[]; scope: McpImportScope }
  >({
    mutationFn: ({ candidates, scope }) => applyWorkspaceImport(candidates, scope),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mcpRegistry.all });
    },
  });
}

/** 模板列表查询（预置 + 本人自存；存为模板/导入成功后随 all 前缀失效）。 */
export function useMcpTemplates() {
  const q = useQuery<McpTemplateRead[], ApiError>({
    queryKey: templatesKey,
    queryFn: listMcpTemplates,
    staleTime: 30_000,
  });
  return {
    templates: q.data ?? [],
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

/**
 * 注入预检诊断（D-011：语义一律以 GET 返回为准，前端只展示不推断）。
 * enabled 由调用方给（页面徽标随 admin 常开，抽屉随 open 拉取）。
 */
export function useMcpDiagnostics(enabled: boolean) {
  const q = useQuery<McpDiagnostic[], ApiError>({
    queryKey: diagnosticsKey,
    queryFn: getMcpDiagnostics,
    enabled,
    staleTime: 30_000,
  });
  return {
    diagnostics: q.data ?? [],
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

/** 存为模板（task-12 收口：成功后失效模板缓存，供「从模板新建」列表刷新）。 */
export function useSaveMcpTemplate() {
  const qc = useQueryClient();
  return useMutation<
    McpTemplateRead,
    ApiError,
    { name: string; fromServerId: string }
  >({
    mutationFn: ({ name, fromServerId }) => saveMcpTemplate(name, fromServerId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mcpRegistry.all });
    },
  });
}
