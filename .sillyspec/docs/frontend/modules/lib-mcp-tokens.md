---
schema_version: 1
doc_type: module-card
module_id: lib-mcp-tokens
author: qinyi
created_at: 2026-08-18 01:45:00
---

# MCP 令牌客户端（lib-mcp-tokens）

## 定位
workspace 级 MCP 访问令牌（McpToken）客户端（`frontend/src/lib/mcp-tokens.ts`，约 57 行，mcp-token-management-ui 变更产出）。签发 / 列表 / 吊销三操作，风格 1:1 对齐 `lib-api-keys`：复用 `apiFetch` 做鉴权与错误归一，不引入 react-query、不手写 fetch。供 workspace `mcp-tokens` 页与 `McpTokenCreateDialog` 消费。

## 契约摘要
- `listMcpTokens(workspaceId): Promise<McpTokenRead[]>` — 列表（直接返回 items 数组，与 listApiKeys 同形，不含明文）。
- `createMcpToken(workspaceId, { name, scope: McpScope[] }): Promise<McpTokenCreated>` — 签发。
  - 返回体携带**明文 token，仅此一次可见**（R-06）。
- `revokeMcpToken(workspaceId, tokenId): Promise<void>` — 吊销（204；已吊销 / 不存在 / 越权均返 404）。
- `McpScope = "read" | "dispatch" | "converge"` — 与后端 `McpTokenCreateRequest.scope` 取值一致。
- 类型 `McpTokenRead` / `McpTokenCreated` / `McpTokenListResponse` / `McpTokenCreateRequest` 全部从 `@/lib/api-types` 生成类型引用，零手写。

## 关键逻辑
```
POST /api/workspaces/{ws}/mcp-tokens        → 201 McpTokenCreated（明文一次）
GET  /api/workspaces/{ws}/mcp-tokens        → { items: McpTokenRead[] }（无明文）
DELETE /api/workspaces/{ws}/mcp-tokens/{id} → 204
```

## 注意事项
- 明文 token 只在 POST 201 响应出现一次，UI 须当场展示/引导复制，刷新后不可再取。
- 签发后端三端点 + DTO 由 public-mcp-server 变更交付，本模块零后端改动；scope 语义变更须后端先行。
- id 与 workspaceId 均走 `encodeURIComponent`。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
