"use client";

/**
 * MCP 中央资产库客户端（变更 2026-09-10-mcp-central-registry / task-11）。
 *
 * 封装 /api/mcp-servers* 中本卡消费的端点（后端 modules/mcp_registry/router.py
 * 13 端点的子集）：
 * - GET /api/mcp-servers?scope=platform|mine|visible&search=&tag=（列表）
 * - GET /api/mcp-servers/{id}（详情，encrypted_env ct 遮蔽）
 * - POST /api/mcp-servers（创建，scope=platform 需 admin）
 * - PATCH /api/mcp-servers/{id}（部分更新，平台 server 需 admin）
 * - DELETE /api/mcp-servers/{id}（删除，平台 server 需 admin）
 * - POST/DELETE /api/mcp-servers/{id}/bindings[/scope_type]（加解绑，FR-03）
 * - POST /api/mcp-servers/templates（「存为模板」卡片操作直调；模板列表/管理归 task-10，
 *   导入三入口与诊断归 task-12，均不在本模块）。
 *
 * 范式对齐 lib/api/llm-providers.ts（裸 fetch 函数）+ lib/mcp-settings.ts
 * （React Query hooks + query key 走 lib/query-keys.ts 的 mcpRegistry 工厂）。
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
/** binding 的 scope_type 词表（platform 需 admin / user=对我启用）。 */
export type McpBindingScopeType = components["schemas"]["McpBindingCreate"]["scope_type"];

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
 * 后端 templates 模块 task-10 落地前返回 501，错误文案由 ApiError 透出）。
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
