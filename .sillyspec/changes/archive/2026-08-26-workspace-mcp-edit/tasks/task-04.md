---
author: qinyi
created_at: 2026-08-26 14:20:00
id: task-04
title_zh: "前端类型重生成"
title: "前端类型重生成"
priority: P0
depends_on: [task-01, task-03]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
goal: 后端 schema 落地后重生成前端类型并同提交
acceptance: |
  1. pnpm exec tsc --version 先探 node_modules 健康（规则 21/36），半坏则 pnpm install --force 修复
  2. pnpm gen:types 产出 api-types.ts 含 McpServerEntryPut / McpConfigUpdateRequest / daemon mcp config 新字段
  3. git diff 无无关变更（发现无关旧债按规则 21 处理：无关不动，相关顺手修）
verify: cd frontend && pnpm exec tsc --noEmit -p tsconfig.json && git diff --stat frontend/src/lib/api-types.ts backend/openapi.json
implementation: 探 node_modules 健康后 pnpm gen:types，提交 api-types.ts + openapi.json
constraints: ["规则 21/36：tsc --version 探针；--force 修复半坏", "diff 仅含本变更两端点"]
provides:
  - contract: "api-types"
    fields: [PUT mcp-config 请求/响应类型, daemon mcp config workspace 类型]
expects_from:
  task-01:
    - contract: "PUT /api/workspaces/{workspace_id}/mcp-config"
      needs: [McpServerEntryPut, McpConfigUpdateRequest]
  task-03:
    - contract: "GET /api/daemon/mcp/config?workspace_id="
      needs: [workspace.mcpServers]
---

# task-04: 类型重生成

## 步骤

1. `cd frontend && pnpm exec tsc --version`（健康探针）
2. `pnpm gen:types`
3. 检查 diff 仅含本变更两端点相关条目
