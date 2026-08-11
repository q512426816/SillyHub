# 提案（Proposal）— McpToken 管理 UI

---
author: qinyi
created_at: 2026-08-11 14:55:00
---

## 背景

变更 `2026-08-06-public-mcp-server` 交付了 McpToken 后端（`POST/GET/DELETE /api/workspaces/{workspace_id}/mcp-tokens` + DTO + 鉴权 + 测试），但**前端零调用**——`createMcpToken` 仅在生成的 `api-types.ts`，无 UI。2026-08-11 配置 sillyspec `local.yaml` mcp 段时实证踩到：用户既无界面可签 McpToken，`shk_live_` API Key 也签不了（通用 `/api` 鉴权拒 API Key），只能 `docker exec` 进容器直建。这是后端先行的产品债，本变更补齐前端管理 UI。

## 提案

在 workspace 区新增独立管理页 `/workspaces/[id]/mcp-tokens`，1:1 镜像已验证的 `settings/api-keys` 页面模式（workspace-scoped 版），提供 McpToken 的**签发 / 列表 / 吊销**三项操作。纯前端、零后端改动、零 schema/migration。

## 在范围内

- 新增 `frontend/src/lib/mcp-tokens.ts`（API client + 复用 api-types 类型）
- 新增 `frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/page.tsx`（管理主页）
- 新增 `frontend/src/components/mcp-token-create-dialog.tsx`（签发弹窗 + 明文一次展示）
- 修改 `frontend/src/components/workspace-tabs.tsx`（加「MCP 令牌」tab，D-001@v1 全可见）
- 单元测试（vitest）覆盖 lib + 关键交互

## 不在范围内（Non-Goals）

- **McpWebhook 管理 UI**：同模块另一组端点（`/api/workspaces/{id}/mcp-webhooks`），绑定 token 的回调订阅，独立后续 change。
- **任何后端改动**：三端点 + DTO 已交付，本变更纯前端。
- **改现有 `/workspaces/[id]/mcp` 只读页**：该页管 workspace 消费的 mcpServers，语义不同。
- **通用凭据管理组件抽象**：api-keys 与 mcp-tokens 字段差异大（用户级带 expires vs workspace 级带 scope），YAGNI。
- **tab 级客户端权限隐藏**：D-001@v1 决策——客户端无 workspace-scoped WRITE 信号源，tab 对所有 bound 成员可见，靠服务端 403 兜底。

## 预期收益

- 用户可在 UI 自助签发/吊销 McpToken，不再依赖 API/DB 直建（消除本次配置 sillyspec 时的痛点）。
- 与 api-keys 页一致的交互体验，零学习成本。
- 补全 `2026-08-06-public-mcp-server` 的前端缺口，MCP 对外能力的端到端闭环。
