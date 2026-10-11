/**
 * McpToken 客户端（2026-08-11-mcp-token-management-ui 变更）。
 *
 * workspace 级 MCP 访问凭据管理：签发 / 列表 / 吊销 / 物理删除 / 按需取回明文。
 * 明文 token 在 POST 201 一次返回（canonical）；2026-10-11-apikey-mcp-copy-delete
 * 起已加密存档的活跃 token 可经 plaintext 端点再取回（列表「复制令牌」）。
 * 存量 hash-only 行不可恢复（409）。
 *
 * 风格 1:1 对齐 @/lib/api-keys：复用 @/lib/api 的 apiFetch 做鉴权与错误归一，
 * 不引入 react-query、不手写 fetch。类型从 OpenAPI 自动生成（@/lib/api-types）。
 */

import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

/** McpToken 授权范围，与后端 McpTokenCreateRequest.scope 取值一致。 */
export type McpScope = "read" | "dispatch" | "converge";

export type McpTokenRead = components["schemas"]["McpTokenRead"];
export type McpTokenCreated = components["schemas"]["McpTokenCreated"];
export type McpTokenListResponse = components["schemas"]["McpTokenListResponse"];
export type McpTokenCreateRequest = components["schemas"]["McpTokenCreateRequest"];
export type McpTokenPlaintextResponse = components["schemas"]["McpTokenPlaintextResponse"];

/** 列出 workspace 下所有 McpToken（不含明文，行带 plaintext_recoverable）。 */
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

/**
 * 物理删除已吊销的 McpToken（?hard=true；行从列表与数据库移除，其 webhook
 * 配置随外键级联清理）。未吊销的 token 后端拒绝（409，需先吊销）。
 */
export async function deleteMcpToken(
  workspaceId: string,
  tokenId: string,
): Promise<void> {
  await apiFetch<void>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/mcp-tokens/${encodeURIComponent(tokenId)}?hard=true`,
    {
      method: "DELETE",
    },
  );
}

/** 按需取回某个活跃 token 的明文（列表「复制令牌」入口）。 */
export async function fetchMcpTokenPlaintext(
  workspaceId: string,
  tokenId: string,
): Promise<string> {
  const resp = await apiFetch<McpTokenPlaintextResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/mcp-tokens/${encodeURIComponent(tokenId)}/plaintext`,
  );
  return resp.token;
}
