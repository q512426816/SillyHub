/**
 * API Keys 客户端 (daemon-api-key 变更)。
 *
 * 长期凭证管理：admin 签发 / 列表 / 吊销。Plaintext 仅在创建时一次性返回，
 * 后续 GET 不再包含。
 *
 * 类型从 OpenAPI 自动生成（@/lib/api-types，由 scripts/gen-api-types.mjs 产出），
 * 消除手写类型漂移。后端 schema 来源：backend/app/modules/auth。
 */

import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

export type ApiKeyRead = components["schemas"]["ApiKeyRead"];
export type ApiKeyCreated = components["schemas"]["ApiKeyCreated"];
export type ApiKeyListResponse = components["schemas"]["ApiKeyListResponse"];
export type ApiKeyCreateRequest = components["schemas"]["ApiKeyCreateRequest"];

/** 列出当前 admin 的所有 API Key（不含 plaintext）。 */
export async function listApiKeys(): Promise<ApiKeyRead[]> {
  const resp = await apiFetch<ApiKeyListResponse>("/api/auth/api-keys");
  return resp.items;
}

/** 签发新的 API Key。返回的 plaintext 仅此一次可见。 */
export async function createApiKey(req: ApiKeyCreateRequest): Promise<ApiKeyCreated> {
  return apiFetch<ApiKeyCreated>("/api/auth/api-keys", {
    method: "POST",
    json: req,
  });
}

/** 吊销 API Key（幂等：未知 id 或已吊销都返回 404）。 */
export async function revokeApiKey(id: string): Promise<void> {
  await apiFetch<void>(`/api/auth/api-keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/**
 * 拉取最新的活跃 key（用于 CopyDaemonCommand 默认填充）。
 * 活跃定义：revoked_at == null && (expires_at == null || expires_at > now)。
 * 找不到返回 null（调用方 fallback 到 access_token）。
 */
export async function getLatestActiveApiKey(): Promise<ApiKeyRead | null> {
  const items = await listApiKeys();
  const now = Date.now();
  const active = items.filter(
    (k) =>
      !k.revoked_at &&
      (!k.expires_at || new Date(k.expires_at).getTime() > now),
  );
  // listApiKeys 已按 created_at desc 排序，取第一个即最新。
  return active[0] ?? null;
}
