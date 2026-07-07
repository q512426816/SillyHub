/**
 * MCP 平台配置 / 白名单 客户端 + React Query hooks。
 *
 * 变更 2026-07-07-skills-mcp-management-ui task-09。
 *
 * - GET/PUT /api/platform-settings/mcp（平台默认 MCP 配置，admin；GET 返回的 env
 *   secret 类 key 已被后端遮蔽为 `<set>`，D-008）
 * - GET/PUT /api/platform-settings/mcp-whitelist（server 名白名单，admin）
 *
 * 类型手写（后端 schema: backend/app/modules/settings/router.py:192+ 的 dict /
 * list[str] 直返，非 pydantic response_model，未进 OpenAPI 生成范围）。design §7
 * 接口契约：GET mcp → {mcpServers: {name: {command, args, env?}}}；whitelist →
 * ["server_name", ...]；PUT mcp-whitelist 请求体为顶层 JSON 数组。
 *
 * 设计依据：design.md §5.1 + §7 + D-008（secret 遮蔽）+ D-009（zod 校验）。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, apiFetch } from "@/lib/api";
import { queryKeys } from "./query-keys";

/* ────────────────────── zod schema（D-009 前端校验） ────────────────────── */

/** 单个 MCP server 的 env entry value（secret 类 GET 时被遮蔽为 `<set>`）。 */
const envValue = z.string();

/** MCP server 配置条目：command 必填，args 字符串数组，env 可选键值对。 */
export const mcpServerEntrySchema = z.object({
  command: z.string().min(1, "command 不能为空"),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), envValue).optional(),
});

/** 完整 mcpServers 配置文档：{ mcpServers: { name: entry } }。 */
export const mcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), mcpServerEntrySchema),
});

/** 白名单：server 名字符串数组。 */
export const mcpWhitelistSchema = z.array(z.string());

/* ────────────────────── 类型 ────────────────────── */

/** zod 推导类型。env value 为 string（secret 字段 GET 时为 `<set>` 占位符）。 */
export type McpConfig = z.infer<typeof mcpConfigSchema>;
export type McpServerEntry = z.infer<typeof mcpServerEntrySchema>;
export type McpWhitelist = z.infer<typeof mcpWhitelistSchema>;

/**
 * secret env value 占位符（与后端 _SECRET_REDACTED_PLACEHOLDER 一致）。
 * GET 返回的 env 里 token/key/secret/password 类 key 值为此串；编辑时若保持此
 * 串不变，PUT 后端会原样存储（task 提示：留 `<set>` 表示不改该 secret）。
 */
export const MCP_SECRET_PLACEHOLDER = "<set>";

/* ────────────────────── 裸 fetch 函数 ────────────────────── */

/** 读平台默认 MCP 配置（admin；env secret 已遮蔽为 `<set>`）。 */
export async function getMcpConfig(): Promise<McpConfig> {
  return apiFetch<McpConfig>("/api/platform-settings/mcp");
}

/** 写平台默认 MCP 配置（admin；后端接收原值存储，返回遮蔽后视图）。 */
export async function updateMcpConfig(config: McpConfig): Promise<McpConfig> {
  return apiFetch<McpConfig>("/api/platform-settings/mcp", {
    method: "PUT",
    json: config,
  });
}

/** 读 MCP server 白名单（admin）。 */
export async function getMcpWhitelist(): Promise<McpWhitelist> {
  return apiFetch<McpWhitelist>("/api/platform-settings/mcp-whitelist");
}

/** 写 MCP server 白名单（admin；请求体为顶层 JSON 数组）。 */
export async function updateMcpWhitelist(
  servers: McpWhitelist,
): Promise<McpWhitelist> {
  return apiFetch<McpWhitelist>("/api/platform-settings/mcp-whitelist", {
    method: "PUT",
    json: servers,
  });
}

/* ────────────────────── React Query hooks ────────────────────── */

/**
 * 平台默认 MCP 配置（admin GET，env secret 遮蔽）。
 * staleTime 60s：MCP 配置低频变更；mutation 保存后主动 invalidate 刷新。
 */
export function useMcpConfig() {
  const q = useQuery<McpConfig, ApiError>({
    queryKey: queryKeys.mcpSettings.config,
    queryFn: () => getMcpConfig(),
    staleTime: 60_000,
  });
  return {
    config: q.data ?? null,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

/** MCP server 白名单（admin）。 */
export function useMcpWhitelist() {
  const q = useQuery<McpWhitelist, ApiError>({
    queryKey: queryKeys.mcpSettings.whitelist,
    queryFn: () => getMcpWhitelist(),
    staleTime: 60_000,
  });
  return {
    whitelist: q.data ?? [],
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

/** 保存平台默认 MCP 配置（admin）。成功后刷新 config 缓存。 */
export function useUpdateMcpConfig() {
  const qc = useQueryClient();
  return useMutation<McpConfig, ApiError, McpConfig>({
    mutationFn: (config) => updateMcpConfig(config),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mcpSettings.config });
    },
  });
}

/** 保存 MCP server 白名单（admin）。成功后刷新 whitelist 缓存。 */
export function useUpdateMcpWhitelist() {
  const qc = useQueryClient();
  return useMutation<McpWhitelist, ApiError, McpWhitelist>({
    mutationFn: (servers) => updateMcpWhitelist(servers),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mcpSettings.whitelist });
    },
  });
}
