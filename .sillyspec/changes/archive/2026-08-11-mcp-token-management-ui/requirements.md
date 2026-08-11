# 需求（Requirements）— McpToken 管理 UI

---
author: qinyi
created_at: 2026-08-11 14:55:00
---

## 功能需求

### FR-01：McpToken 列表展示
workspace 内 `/workspaces/[id]/mcp-tokens` 页面展示该 workspace 全部 McpToken（`GET /api/workspaces/{id}/mcp-tokens`），含已吊销，新→旧。每行：名称、scope（徽章）、状态（活跃/已吊销）、最近使用时间、创建时间、吊销操作。列表永不展示明文或前缀。

### FR-02：签发 McpToken
点「签发 MCP 令牌」→ 弹窗填名称（1-100 字）+ scope 多选（read/dispatch/converge，至少 1 个，默认勾 read+dispatch）→ 提交 `POST` → 成功后**明文仅展示一次**（复制按钮 + 警示"关闭后不可获取" + 连接信息：MCP URL 与 `Authorization: Bearer` 用法）。关闭后明文不可再获取。

### FR-03：吊销 McpToken
列表中对未吊销的 token 点「吊销」→ 二次确认 → `DELETE` → 成功（204）后刷新列表，该 token 标记已吊销。已吊销行不显示吊销按钮。

### FR-04：workspace 子导航入口
`workspace-tabs.tsx` 加「MCP 令牌」tab 项，紧邻现有「MCP」tab，对所有 bound 成员可见（D-001@v1）。

### FR-05：viewer 无权限兜底
viewer（只读成员）点入该页 → `GET` 返 403 → 前端展示"无权限"空态，不泄漏 token 存在性（D-001@v1）。

### FR-06：统计卡片
页面顶部展示 3 张统计卡：全部令牌 / 活跃 / 已吊销（McpToken 无 expires 概念，故无"已过期"卡，区别于 api-keys 的 4 卡）。

## 非功能需求

### NFR-01：零后端改动
不改 backend / schema / migration / 权限。类型复用 `api-types.ts` 现有 schema（`McpTokenRead`/`McpTokenCreated`/`McpTokenCreateRequest`），不重跑 gen:types。

### NFR-02：技术栈对齐 api-keys 页
手写 `useState`+`useEffect`+`useCallback` + 手写 fetch（**非 react-query**），复用 `@/components/layout`、`@/components/ui/*`、`@/lib/errors`。StatCard 从 api-keys 页内联复制（本地组件非共享）。

### NFR-03：明文安全
明文 token 仅 POST 201 一次返回，弹窗醒目警示，列表/响应永不回显明文或 token_hash（后端契约保证）。吊销二次确认防误操作。

### NFR-04：跨平台兼容
纯前端 React/Next.js，无平台特定代码，Win/Linux/macOS 浏览器行为一致。

## 验收标准

- 三项操作（签发/列表/吊销）端到端可用（对接已就绪后端）。
- vitest 单测覆盖 lib 三函数 + 弹窗双 phase + 403 空态。
- viewer 进入页面看到无权限提示，非崩溃。
- 现有 api-keys 页 + workspace 其他页零回归。
