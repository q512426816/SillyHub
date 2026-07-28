---
id: task-09
title: 前端关联 API 客户端
title_zh: 前端关联接口客户端函数
author: qinyi
created_at: 2026-07-28 14:05:41
priority: P0
depends_on: [task-05, task-06]
blocks: [task-10, task-11]
requirement_ids: [FR-02, FR-03]
decision_ids: []
allowed_paths:
  - frontend/src/lib/workspace.ts
goal: >
  新增前端调用关联 API 的客户端函数(项目侧 + 工作区侧 bind/unbind/list),供弹窗与区块组件使用。
implementation:
  - 在 workspace.ts(或新建 link api 模块)加 list/bind/unbind 函数
  - 工作区侧调 /api/workspaces/{id}/ppm-projects
  - 项目侧调 /api/ppm/projects/{id}/workspaces
  - 类型暂手写,task-13 由 gen:types 对齐
acceptance:
  - API 客户端函数存在,调用正确端点
  - TypeScript 类型检查通过
verify:
  - "cd frontend && pnpm exec tsc --noEmit"
constraints:
  - 类型暂手写,task-13 pnpm gen:types 对齐
  - 复用现有 fetch/api 封装
---
