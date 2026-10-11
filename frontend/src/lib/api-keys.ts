/**
 * API Keys 客户端 (daemon-api-key 变更)。
 *
 * 长期凭证管理：admin 签发 / 列表 / 吊销 / 物理删除 / 按需取回明文。
 * 明文在创建时一次性返回（canonical）；2026-10-11-apikey-mcp-copy-delete 起，
 * 签发时已加密存档的活跃 key 还可经 plaintext 端点再取回（供列表复制与
 * runtimes 页启动命令内嵌）。存量 hash-only 行不可恢复（409）。
 *
 * 类型从 OpenAPI 自动生成（@/lib/api-types，由 scripts/gen-api-types.mjs 产出），
 * 消除手写类型漂移。后端 schema 来源：backend/app/modules/auth。
 */

import { ApiError, apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

export type ApiKeyRead = components["schemas"]["ApiKeyRead"];
export type ApiKeyCreated = components["schemas"]["ApiKeyCreated"];
export type ApiKeyListResponse = components["schemas"]["ApiKeyListResponse"];
export type ApiKeyCreateRequest = components["schemas"]["ApiKeyCreateRequest"];
export type ApiKeyPlaintextResponse = components["schemas"]["ApiKeyPlaintextResponse"];

/** 列出当前 admin 的所有 API Key（不含 plaintext，行带 plaintext_recoverable）。 */
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
 * 物理删除已吊销的 API Key（?hard=true；行从列表与数据库移除）。
 * 未吊销的 key 后端拒绝（409，需先吊销）。
 */
export async function deleteApiKey(id: string): Promise<void> {
  await apiFetch<void>(`/api/auth/api-keys/${encodeURIComponent(id)}?hard=true`, {
    method: "DELETE",
  });
}

/** 按需取回某把活跃 key 的明文（列表「复制密钥」入口）。 */
export async function fetchApiKeyPlaintext(id: string): Promise<string> {
  const resp = await apiFetch<ApiKeyPlaintextResponse>(
    `/api/auth/api-keys/${encodeURIComponent(id)}/plaintext`,
  );
  return resp.plaintext;
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

/** resolveDaemonApiKey 的结果。 */
export type DaemonApiKeyResolution =
  /** 拿到了可直接拼进启动命令的明文（createdName 非空表示本次自动签发了新 key）。 */
  | { status: "ok"; plaintext: string; keyPrefix: string; createdName?: string }
  /** 无 API_KEY_ADMIN 权限（list/create 均 403），调用方回退 access_token。 */
  | { status: "forbidden" };

/** 自动签发 key 的名称前缀（runtimes 页「复制命令」触发，永不过期）。 */
export const AUTO_CREATED_KEY_PREFIX = "守护进程启动命令自动签发";

function _isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

/**
 * 解析守护进程启动命令要内嵌的 API key 明文（runtimes 页复制入口）。
 *
 * 分支：
 * 1. 最新活跃 key 可恢复明文 → 取回明文返回；
 * 2. 无活跃 key、或最新活跃 key 是存量 hash-only（不可恢复）/ 取回失败（并发
 *    吊销等）→ 自动签发一把永不过期（expires_at=null）的新 key 并用其明文
 *    （createdName 回显给用户）；
 * 3. list/create 返回 403 → forbidden（非 admin，调用方回退浏览器 access_token）。
 * 其余意外错误向上抛（调用方按复制失败处理，不静默降级成错命令）。
 */
export async function resolveDaemonApiKey(): Promise<DaemonApiKeyResolution> {
  try {
    const latest = await getLatestActiveApiKey();
    if (latest?.plaintext_recoverable) {
      try {
        return {
          status: "ok",
          plaintext: await fetchApiKeyPlaintext(latest.id),
          keyPrefix: latest.key_prefix,
        };
      } catch (err) {
        // 明文取回失败：403 属权限态上抛；其余（404 并发吊销 / 409 旧档损坏）
        // 落到下方自动签发兜底。
        if (_isForbidden(err)) throw err;
      }
    }
    const name = `${AUTO_CREATED_KEY_PREFIX} ${new Date().toISOString().slice(0, 10)}`;
    const created = await createApiKey({ name, expires_at: null });
    return {
      status: "ok",
      plaintext: created.plaintext,
      keyPrefix: created.key_prefix,
      createdName: name,
    };
  } catch (err) {
    if (_isForbidden(err)) return { status: "forbidden" };
    throw err;
  }
}
