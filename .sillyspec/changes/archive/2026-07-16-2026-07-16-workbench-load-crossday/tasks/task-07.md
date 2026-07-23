---
id: task-07
title: lib/ppm/plan.ts + types.ts start/execute(action) API（删 submit）
phase: W2
priority: P0
status: draft
owner: qinyi
estimated_hours: 1
affected_components: [frontend]
allowed_paths:
  - frontend/src/lib/ppm/plan.ts
  - frontend/src/lib/ppm/types.ts
depends_on: [task-03]
blocks: [task-05, task-06]
goal: "lib/ppm/plan.ts + types.ts：start/execute(action) API（删 submit）"
implementation:
  - "plan.ts 加 startTask(plan_task_id, execute_user_id?) → POST /task-plan/{id}/start"
  - "executePlanTask body 删 submit 加 action + task_execute_id"
  - "types.ts ExecutePlanReq 类型对齐"
acceptance:
  - "cd frontend && pnpm typecheck 绿"
verify:
  - "cd frontend && pnpm typecheck"
constraints:
  - "类型对齐后端 ExecutePlanReq（D-003）"
---

## 目标
加 startTask API；executePlanTask 改 action（删 submit）；types 对齐。

## 依据
design §7.1 / §7.2；D-003。

## steps
1. plan.ts：加 `startTask(plan_task_id, execute_user_id?)` → POST /api/ppm/task-plan/{id}/start
2. executePlanTask body 改：删 submit，加 `action: "submit"|"complete"` + `task_execute_id`
3. types.ts：ExecutePlanReq 类型删 submit 加 action + task_execute_id

## 验收标准
- `cd frontend && pnpm typecheck` 绿
