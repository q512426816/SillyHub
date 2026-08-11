/**
 * McpToken 客户端（2026-08-11-mcp-token-management-ui 变更）。
 *
 * workspace 级 MCP 访问凭据管理：签发 / 列表 / 吊销。
 * 明文 token 仅在 POST 201 一次返回（R-06），后续 GET 与列表永不包含明文。
 *
 * 风格 1:1 对齐 @/lib/api-keys：复用 @/lib/api 的 apiFetch 做鉴权与错误归一，
 * 不引入 react-query、不手写 fetch。类型从 OpenAPI 自动生成（@/lib/api-types）。
 * 后端三端点 + DTO 已在变更 2026-08-06-public-mcp-server 交付，本文件零后端改动。
 */

import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

/** McpToken 授权范围，与后端 McpTokenCreateRequest.scope 取值一致。 */
export type McpScope = "read" | "dispatch" | "converge";

export type McpTokenRead = components["schemas"]["McpTokenRead"];
export type McpTokenCreated = components["schemas"]["McpTokenCreated"];
export type McpTokenListResponse = components["schemas"]["McpTokenListResponse"];
export type McpTokenCreateRequest = components["schemas"]["McpTokenCreateRequest"];

/** 列出 workspace 下所有 McpToken（不含明文）。直接返回 items 数组，与 listApiKeys 同形。 */
export async function listMcpTokens(workspaceId: string): Promise<McpTokenRead[]> {
  const resp = await apiFetch<McpTokenListResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/mcp-tokens`,
  );
  return resp.items;
}

/** 签发新的 McpToken。返回体携带明文 token，仅此一次可见。 */
export async function createMcpToken(
  workspaceId: string,
  input: { name: string; scope: McpScope[] },
): Promise<McpTokenCreated> {
  return apiFetch<McpTokenCreated>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/mcp-tokens`,
    {
      method: "POST",
      json: input,
    },
  );
}

/** 吊销 McpToken（成功 204；已吊销 / 不存在 / 越权均返 404）。 */
export async function revokeMcpToken(
  workspaceId: string,
  tokenId: string,
): Promise<void> {
  await apiFetch<void>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/mcp-tokens/${encodeURIComponent(tokenId)}`,
    {
      method: "DELETE",
    },
  );
}
