---
id: task-03
title: Starlette middleware 校验 McpToken 注入 workspace/scope + scope 不足 403
title_zh: McpToken 鉴权中间件（注入 workspace_id/scope/token_id + 越界 403）
author: qinyi
created_at: 2026-08-06 13:52:28
priority: P0
depends_on: [task-02]
blocks: [task-04]
requirement_ids: [FR-02, FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/mcp_gateway/auth.py
goal: >
  新增走 /mcp mount 的独立 Starlette middleware，解析 Authorization
  Bearer McpToken，校验通过后把 workspace_id/scope/token_id 注入
  McpAuthContext 供 task-05/06 tool handler 消费，越权或无效一律拒绝。
implementation: 新建 mcp_gateway/auth.py 定义 McpAuthContext contract（字段 workspace_id/scope/token_id）与 Starlette BaseHTTPMiddleware，从 request.headers 解析 Bearer，复用 task-02 McpTokenService.verify（Redis 缓存命中优先），命中则把上下文挂到 request.state.mcp_auth，无效或吊销返 401，scope 不足返 403 并 structlog 记决策日志
acceptance: 无 token/坏 token/吊销 token 命中 401；合法 token 注入 McpAuthContext 到 request.state.mcp_auth；缺所需 scope 返 403 且 structlog 记决策日志；缓存命中路径不查库；现有 /api 路由零回归
verify: cd backend && uv run pytest app/modules/mcp_gateway -q --no-coc
constraints: 走 /mcp mount 的独立 middleware（与 /api 的 get_current_principal 物理隔离，CC-06）；无效/吊销 token 返 401；scope 不足返 403 且记决策日志；缓存命中优先（复用 task-02 的 Redis 校验）；FastMCP http_app ASGI 挂 middleware 的精确写法待 task-04 spike-A 验证（R-01/CC-07）
provides: "contract McpAuthContext, fields [workspace_id, scope, token_id]（task-05/06 的 tool handler 消费此上下文）"
---

# task-03: Starlette McpToken 鉴权中间件

## 验收标准
A. `mcp_gateway/auth.py` 定义 `McpAuthContext`（字段 workspace_id/scope/token_id）+ Starlette middleware。
B. 无 token / 坏 token / 吊销 token → 401；缺所需 scope → 403 且 structlog 记决策日志；缓存命中不查库。
C. 与 `/api` 的 `get_current_principal` 物理隔离（CC-06），现有 `/api/*` 路由零回归。
D. 注入的 `McpAuthContext` 可被 task-05/06 tool handler 经 `request.state.mcp_auth` 读取。
