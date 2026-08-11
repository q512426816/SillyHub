---
id: task-01
title: McpToken API client lib
title_zh: McpToken API 客户端 mcp-tokens.ts（list/create/revoke 三函数）
author: qinyi
created_at: 2026-08-11 15:08:00
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04, task-05, task-08]
allowed_paths:
  - frontend/src/lib/mcp-tokens.ts
provides:
  - contract: McpTokenApi
    fields: [listMcpTokens, createMcpToken, revokeMcpToken, McpTokenRead, McpTokenCreated, McpScope]
goal: >
  新增 frontend/src/lib/mcp-tokens.ts，提供 McpToken 三端点客户端（列出解包 items、签发拿明文、吊销），
  1:1 对齐 @/lib/api-keys 的 apiFetch 与 components schemas 类型别名风格，覆盖 FR-01/02/03 数据层。
implementation:
  - 从 @/lib/api-types 的 components schemas 导出 McpTokenRead、McpTokenCreated、McpTokenListResponse、McpTokenCreateRequest 类型别名，并定义 McpScope 字面量联合取值 read、dispatch、converge
  - listMcpTokens 收 workspaceId 调 apiFetch GET workspaces 下 mcp-tokens 端点，返回其 items 字段解包成数组
  - createMcpToken 收 workspaceId 与含 name、scope 入参调 apiFetch POST 同端点，返回含明文 token 的响应
  - revokeMcpToken 收 workspaceId 与 tokenId 调 apiFetch DELETE 单 token 子路径，tokenId 用 encodeURIComponent 编码，返回 void
  - 复用 @/lib/api 的 apiFetch 做鉴权与错误归一，不引入新依赖不手写 fetch
acceptance:
  - listMcpTokens 命中 GET 端点并直接返回 items 数组而非包一层
  - createMcpToken 命中 POST 端点并返回带明文 token 的响应体
  - revokeMcpToken 命中 DELETE 单 token 子路径且 tokenId 已 URL 编码
  - 三函数风格与 @/lib/api-keys 一致，无手写 DTO
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- mcp-tokens
constraints:
  - 零后端改动，三端点与 DTO 已在 2026-08-06-public-mcp-server 交付，类型直接复用 api-types.ts 已生成项无需 gen:types
  - 不引入 react-query，沿用 api-keys 的 apiFetch 手写风格
  - 列表响应必须解包 items 后返回数组，与 listApiKeys 同形
  - 代码须兼容 Windows、Linux、macOS
---
