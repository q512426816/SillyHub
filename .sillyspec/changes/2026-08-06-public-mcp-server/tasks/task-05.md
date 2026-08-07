---
id: task-05
title: mcp_gateway/server.py + main.py mount /mcp（FastMCP http_app ASGI）
author: qinyi
created_at: 2026-08-06 13:57:53
priority: P0
depends_on: [task-04]
blocks: [task-06, task-13]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/mcp_gateway/server.py
  - backend/app/main.py
goal: 基于 task-04 spike-A 结论建 mcp_gateway/server.py（FastMCP 实例 + mcp_asgi = FastMCP.http_app()）并在 main.py 追加 app.mount("/mcp", mcp_asgi)，对外暴露 streamable HTTP MCP 端点（design §5.2 P1 / §6）
implementation: server.py 按 spike-A 通过写法建 FastMCP 实例 + mcp_asgi 并导出 server/mount_path；main.py 仅追加 app.mount("/mcp", mcp_asgi)；不写 include_router（token/webhook 管理 API 属 task-02/11）
acceptance: app.routes 含 /mcp；现有 /api/* 路由零回归；transport = streamable HTTP；McpServerInstance 契约可被 task-06/13 消费
verify: cd backend && uv run python -c "from app.main import app; print([r.path for r in app.routes])"（确认 /mcp 挂载）
constraints: 仅 mount /mcp 不动 /api/* 路由（零侵入）；streamable HTTP transport；mcp_asgi = FastMCP.http_app()；main.py 只加 mount 行，include_router 由 task-02/11 负责（G-1 协调不同行不冲突）；写法严格对齐 task-04 spike-A 验证通过版本 + mcp SDK 锁定版本（R-01/R-04）
provides:
  - contract: McpServerInstance
    fields: [server, mount_path]
expects_from:
  task-04: spike-A 结论（FastMCP.http_app() mount 到现有 FastAPI 可行 + mcp SDK 锁定版本 + 鉴权 middleware 注入 workspace/scope 验证通过）
---

# task-05 · mcp_gateway server + main.py mount

## 实现

1. **server.py**（新建）按 task-04 spike-A 验证通过的写法建 `FastMCP` 实例，`mcp_asgi = mcp.http_app()`（streamable HTTP transport，2025 官方推荐取代老 SSE），导出 `server`（供 task-06/13 注册 tool）+ `mount_path = "/mcp"` + `mcp_asgi`。
2. **main.py**（修改）仅追加 `app.mount("/mcp", mcp_asgi)`（从 server.py import mcp_asgi）；**不写** `include_router`——token/webhook 管理 API 由 task-02/11 挂载（G-1 协调，不同行不冲突）。

## 验收 + verify

- `/mcp` 出现在 `app.routes`；现有 `/api/*` 路由零回归（mount 仅新增端点）；transport = streamable HTTP；`McpServerInstance`（server + mount_path）可被 task-06/13 消费。
- verify：`cd backend && uv run python -c "from app.main import app; print([r.path for r in app.routes])"`

## constraints

零侵入现有 `/api/*` 路由（design §9）；`mcp_asgi = FastMCP.http_app()`；main.py 只加 mount 行不碰 include_router；FastMCP 实例与 mount 写法严格对齐 spike-A 验证版本 + mcp SDK 锁定版本（R-01/R-04）。
