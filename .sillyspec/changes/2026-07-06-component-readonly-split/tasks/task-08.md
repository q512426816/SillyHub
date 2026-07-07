---
id: task-08
title: frontend lib 切换（workspaces.ts 去 getWorkspaceRelations + 新 getWorkspaceComponents；components.ts listComponents 改调）
author: qinyi
created_at: 2026-07-06 11:29:29
priority: P0
depends_on: [task-07]
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-001@V1]
allowed_paths:
  - frontend/src/lib/workspaces.ts
  - frontend/src/lib/components.ts
goal: >
  前端 lib 层切换到 W1 新接口：workspaces.ts 删 `getWorkspaceRelations`、新增 `getWorkspaceComponents`；components.ts 的 `listComponents` 改调 GET /components，移除 `workspaceToComponent` 兼容层。
implementation:
  - `workspaces.ts`：移除 `getWorkspaceRelations`；新增 `getWorkspaceComponents(id)` 调 `GET /workspaces/{id}/components`，返回 `Component[]`
  - `components.ts`：`listComponents` 改调 `getWorkspaceComponents`；移除 `workspaceToComponent` 兼容映射函数
  - 类型对齐 backend 响应（component_key/name/path/type/role/tech_stack/status）
  - 协调 task-06：若 `ChangeSummary.workspace_ids` 删除影响前端类型，一并清理 lib/types
acceptance:
  - `grep getWorkspaceRelations frontend/src` 无命中
  - `grep workspaceToComponent frontend/src` 无命中
  - `listComponents` 返回的 Component 结构与 backend 一致
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 后端新接口（task-02/03）必须先就绪再切（R-02 时序）
  - 不动 create-change 提交链路（仍是 component_key 字符串）
  - 保留 lib 层函数签名稳定，避免连锁改 page
---

