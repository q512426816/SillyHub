---
schema_version: 1
doc_type: module-card
module_id: lib-api-keys
author: qinyi
created_at: 2026-08-18 01:45:00
---

# API Key 凭证客户端（lib-api-keys）

## 定位
长期凭证（API Key，daemon 接入用）的浏览器侧 API 客户端（`frontend/src/lib/api-keys.ts`，55 行）。封装后端 `/api/auth/api-keys` 的签发 / 列表 / 吊销，供 `/settings/api-keys` 页与 `ApiKeyCreateDialog` 使用。类型全部从 OpenAPI 生成（后端 `auth` 模块 schema），请求经 `apiFetch`，错误统一抛 `ApiError`。

## 契约摘要
- `listApiKeys(): Promise<ApiKeyRead[]>` — 列出全部 key（不含明文）；后端返回 `{ items }`，本函数解包，且后端已按 `created_at` 倒序。
- `createApiKey(req: ApiKeyCreateRequest): Promise<ApiKeyCreated>` — 签发新 key；`ApiKeyCreated` 比 `ApiKeyRead` 多**明文密钥**字段，仅创建时一次性返回。
- `revokeApiKey(id: string): Promise<void>` — 吊销（幂等语义：未知 id 或已吊销均 404）。
- `getLatestActiveApiKey(): Promise<ApiKeyRead | null>` — 取最近活跃 key（活跃 = `revoked_at == null && (expires_at == null || expires_at > now)`），无则 null。
- 类型：`ApiKeyRead` / `ApiKeyCreated` / `ApiKeyListResponse` / `ApiKeyCreateRequest`（OpenAPI 生成索引）。

## 关键逻辑
```
listApiKeys(): resp = apiFetch("/api/auth/api-keys"); return resp.items
getLatestActiveApiKey():
  items = await listApiKeys()          # 已 created_at desc
  active = items.filter(未吊销且未过期)
  return active[0] ?? null             # 首个即最新
```

## 注意事项
- **明文密钥仅 `createApiKey` 返回一次**：UI 必须一次性展示给用户复制，不可写日志/store，页面关闭无法取回。
- `getLatestActiveApiKey` 用于 CopyDaemonCommand 默认填充（调用方拿不到时 fallback 到 access_token）。
- `listApiKeys` 解包 `{items}`：后端若改为直接返回数组需同步调整。
- id 走 `encodeURIComponent` 防注入。
- 同形态的 workspace 级 MCP 令牌客户端在 `lib-mcp-tokens`（纯前端镜像结构），二者勿混。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
