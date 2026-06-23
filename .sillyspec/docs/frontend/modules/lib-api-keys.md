---
schema_version: 1
doc_type: module-card
module_id: lib-api-keys
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:04
---
# lib-api-keys

## 定位
用户级 API Key（个人访问令牌）的浏览器侧 API 客户端。封装后端 `/api/auth/api-keys` 端点的列表、创建、撤销、查询最近活跃 key 四个操作，供设置页 `/settings/api-keys` 与相关组件使用。所有请求经 `lib-api` 的 `apiFetch` 发起，错误统一抛 `ApiError`。

## 契约摘要
全部 `export async function`，类型定义在文件头部：

- `listApiKeys(): Promise<ApiKeyRead[]>` — 列出当前用户全部 key（含已撤销），后端返回 `{ items }`，本函数解包返回数组。
- `createApiKey(req: ApiKeyCreateRequest): Promise<ApiKeyCreated>` — 创建新 key；`ApiKeyCreated` 在 `ApiKeyRead` 基础上多出**明文密钥**字段（仅创建时一次性返回，后端不再存储明文）。
- `revokeApiKey(id: string): Promise<void>` — 撤销指定 key（`DELETE /api/auth/api-keys/<id>`）。
- `getLatestActiveApiKey(): Promise<ApiKeyRead | null>` — 取最近一条活跃 key，无则返回 null。

类型：`ApiKeyRead`（列表/查询项，含 id/label/前缀/状态/创建时间等，不含明文）、`ApiKeyCreateRequest`（含 label 等创建参数）。

## 关键逻辑
```
listApiKeys():
  resp = apiFetch<{ items: ApiKeyRead[] }>("/api/auth/api-keys")
  return resp.items          // 后端包了一层 items，前端解包
createApiKey(req):
  return apiFetch("/api/auth/api-keys", { method:"POST", body: req })  // 含明文
revokeApiKey(id):
  await apiFetch(`/api/auth/api-keys/${encodeURIComponent(id)}`, {method:"DELETE"})
```

## 注意事项
- **明文密钥仅在 `createApiKey` 返回一次**：`ApiKeyCreated` 的明文字段必须在 UI 一次性展示给用户复制，不可写入日志/状态/store，页面关闭后无法再取回。
- 这些端点后端要求 `api_key:admin` 权限（`platform:admin` 自动通过），参见 `lib-menu-permissions` 中 API 密钥菜单的权限映射。
- `listApiKeys` 解包 `{items}`：若后端契约改为直接返回数组，此处需同步调整。
- id 走 `encodeURIComponent` 防注入。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
