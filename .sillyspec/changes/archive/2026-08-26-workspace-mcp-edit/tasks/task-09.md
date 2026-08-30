---
author: qinyi
created_at: 2026-08-26 14:20:00
id: task-09
title_zh: "前端mutation与缓存失效"
title: "前端 mutation 与缓存失效"
priority: P1
depends_on: [task-04]
allowed_paths:
  - frontend/src/lib/workspace-skills-view.ts
goal: 新增 updateWorkspaceMcpConfig fetch + useUpdateWorkspaceMcpConfig mutation，成功后失效查询缓存
acceptance: |
  1. updateWorkspaceMcpConfig(workspaceId, body) 走 apiFetch PUT /api/workspaces/{id}/mcp-config，错误归一 ApiError
  2. useUpdateWorkspaceMcpConfig：mutation 成功 invalidate workspaceMcpConfig.detail(workspaceId)（queryKeys 工厂既有 key，workspace-skills-view.ts:97）
  3. hook 返回完整 mutation 结果（不拆散），命名/文件位置遵循仓库样板（mcp-settings.ts 先例）
verify: cd frontend && pnpm test -- workspace-skills-view
implementation: workspace-skills-view.ts 新增 updateWorkspaceMcpConfig fetch + useUpdateWorkspaceMcpConfig mutation
constraints: ["queryKey 走中央工厂", "错误归一 ApiError", "hook 返回完整 mutation 结果"]
provides:
  - contract: "useUpdateWorkspaceMcpConfig"
    fields: [updateWorkspaceMcpConfig, useUpdateWorkspaceMcpConfig, invalidate workspaceMcpConfig.detail]
expects_from:
  task-04:
    - contract: "api-types"
      needs: [PUT mcp-config 请求/响应类型]
---

# task-09: 前端数据层

## 实现要点

- body 类型用 task-04 生成的 api-types（或按 mcp-settings.ts 手写先例——该接口若 dict 直返不进 OpenAPI 则手写并注明，与 mcp-settings.ts 头注释同惯例）
- queryKey 复用 `queryKeys.workspaceMcpConfig.detail(workspaceId)`，mutation 与 query 同 key 失效
