---
id: task-07
title: 前端 lib 层（覆盖：FR-01, FR-02）
title_zh: lib — workbench.ts fetch 加 targetUserId + 新增 fetchTodos/SwitchableUsers；types/task 同步
author: qinyi
created_at: 2026-07-24 09:07:27
priority: P0
depends_on: [task-01]
blocks: [task-08, task-09, task-10, task-11, task-13, task-14]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1, D-003@v1, D-005@v1]
allowed_paths:
  - frontend/src/lib/ppm/workbench.ts
  - frontend/src/lib/ppm/types.ts
  - frontend/src/lib/ppm/task.ts
expects_from:
  task-01:
    - contract: WorkbenchProfile
      needs: [can_view_others]
    - contract: WorkbenchSummary
      needs: [metrics]
    - contract: WorkbenchSwitchableUser
      needs: [user_id, display_name, employee_no, department_name]
  task-03:
    - contract: WorkbenchTodosPage
      needs: [items, total, page, page_size]
goal: >
  前端 API client 与类型同步：fetchWorkbenchProfile/Summary/Calendar 加 targetUserId；新增 fetchWorkbenchTodos/fetchWorkbenchSwitchableUsers；listPersonalPlanTasks 加 targetUserId；types.ts 同步 DTO。
implementation:
  - workbench.ts：三 fetch 增 targetUserId 可选 → query target_user_id
  - 新增 fetchWorkbenchTodos(targetUserId?, page, page_size) → PageResp<WorkbenchTodoItem>
  - 新增 fetchWorkbenchSwitchableUsers() → WorkbenchSwitchableUser[]
  - task.ts listPersonalPlanTasks 增 targetUserId → query target_user_id
  - types.ts：WorkbenchProfile+=can_view_others、WorkbenchSummary-=todos、新增 WorkbenchSwitchableUser
acceptance:
  - 三 fetch 支持 targetUserId（undefined 时不带 query）
  - fetchWorkbenchTodos 返回 PageResp（items/total/page/page_size）
  - 类型与后端 schema 一致
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test lib/ppm
constraints:
  - 字段 snake_case 与后端一致，不做 camelCase
  - can_view_others 前端用 ?? 兜底旧响应
---
