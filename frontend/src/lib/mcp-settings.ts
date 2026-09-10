/**
 * MCP server 白名单客户端 + React Query hooks。
 *
 * 变更 2026-07-07-skills-mcp-management-ui task-09；2026-09-10-mcp-central-registry
 * task-13：旧「平台默认 MCP 配置」客户端（GET/PUT /api/platform-settings/mcp +
 * mcpConfigSchema + useMcpConfig/useUpdateMcpConfig + MCP_SECRET_PLACEHOLDER）
 * 随两端点移除删除（D-003 零兼容负担），平台默认配置改走中央资产库
 * `@/lib/api/mcp-registry`；本模块仅剩白名单：
 *
 * - GET/PUT /api/platform-settings/mcp-whitelist（server 名白名单，admin）
 *
 * 类型手写（后端 settings/router.py 白名单两端点直返 list[str]，无 pydantic
 * response_model，未进 OpenAPI 生成范围）。design §7 接口契约：whitelist →
 * ["server_name", ...]；PUT 请求体为顶层 JSON 数组。
 *
 * 设计依据：design.md §5.1 + §7 + D-009（zod 校验）。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, apiFetch } from "@/lib/api";
import { queryKeys } from "./query-keys";

/* ────────────────────── zod schema（D-009 前端校验） ────────────────────── */

/** 白名单：server 名字符串数组。 */
export const mcpWhitelistSchema = z.array(z.string());

/* ────────────────────── 类型 ────────────────────── */

/** zod 推导类型。 */
export type McpWhitelist = z.infer<typeof mcpWhitelistSchema>;

/* ────────────────────── 裸 fetch 函数 ────────────────────── */

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

/** MCP server 白名单（admin）。
 * staleTime 60s：白名单低频变更；mutation 保存后主动 invalidate 刷新。
 */
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
