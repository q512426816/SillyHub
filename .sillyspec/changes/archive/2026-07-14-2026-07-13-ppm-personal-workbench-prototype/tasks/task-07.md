---
id: task-07
title: "lib/ppm/workbench.ts API client + types.ts 加 workbench 类型（覆盖：FR-01）"
title_zh: "前端工作台 API 客户端与类型"
author: qinyi
created_at: 2026-07-14 09:27:18
priority: P0
depends_on: [task-02]
blocks: [task-08, task-09, task-10, task-11]
requirement_ids: [FR-01]
decision_ids: []
allowed_paths:
  - frontend/src/lib/ppm/workbench.ts
  - frontend/src/lib/ppm/types.ts
provides:
  - contract: WorkbenchTypes
    fields: [WorkbenchProfile, WorkbenchMetrics, WorkbenchTodoItem, WorkbenchSummary, WorkbenchCalendar, CalendarDay]
  - contract: workbenchClient
    fields: [fetchWorkbenchProfile, fetchWorkbenchSummary, fetchWorkbenchCalendar]
expects_from:
  - contract: WorkbenchProfile
    needs: [display_name, employee_no, department_name, role_name, avatar_text]
  - contract: WorkbenchSummary
    needs: [metrics, todos]
  - contract: WorkbenchCalendar
    needs: [year_month, days]
goal: >
  前端封装 workbench 3 个只读聚合接口调用 + 对齐后端 DTO 的类型定义，供 task-08 页面与 task-09~11 组件消费。
implementation:
  - "types.ts（在文件末尾，对齐 design §7.1~§7.3 字段，全部 snake_case——后端 Pydantic 默认输出 snake_case，PPM 全域前端类型如 PlanTask/project_name/start_time 均为 snake_case 不做 camel 转换，task.ts apiFetch 亦无转换层）新增 6 个 interface：WorkbenchProfile { display_name: string | null; employee_no: string | null; department_name: string | null; role_name: string | null; avatar_text: string }、WorkbenchMetrics { task_count: number; completion_rate: number; delay_rate: number; work_hours: number; defect_count: number }、WorkbenchTodoItem { id: string; name: string; type: string; source: string }、WorkbenchSummary { metrics: WorkbenchMetrics; todos: WorkbenchTodoItem[] }、CalendarDay { date: string; load_level: string; alert_level: string; task_count: number }、WorkbenchCalendar { year_month: string; days: CalendarDay[] }"
  - "新建 lib/ppm/workbench.ts：顶部 `import { apiFetch } from \"@/lib/api\";` + `import type { WorkbenchProfile, WorkbenchSummary, WorkbenchCalendar } from \"./types\";`；头部 JSDoc 注明端点前缀 `/api/ppm/workbench/*`、3 个只读 GET、走 apiFetch（自动带 token + 401 刷新），对齐 lib/ppm/task.ts 风格"
  - "export async function fetchWorkbenchProfile(): Promise<WorkbenchProfile> — `return apiFetch<WorkbenchProfile>(\"/api/ppm/workbench/profile\");`"
  - "export async function fetchWorkbenchSummary(range: \"week\" | \"month\" | \"all\" = \"month\"): Promise<WorkbenchSummary> — `return apiFetch<WorkbenchSummary>(\"/api/ppm/workbench/summary\", { query: { range } });`"
  - "export async function fetchWorkbenchCalendar(yearMonth: string): Promise<WorkbenchCalendar> — `return apiFetch<WorkbenchCalendar>(\"/api/ppm/workbench/calendar\", { query: { year_month: yearMonth } });`（query key 用 snake_case `year_month` 对齐后端 design §7.3 参数名）"
  - "注：3 个接口无 id 路径参数，直接常量路径，无需 queryOf 辅助器"
  - "lib/ppm/index.ts barrel 加 `export * from \"./workbench\";`（与现有 project/plan/problem/task/kanban 同级）——此文件不在 allowed_paths 内的话，视为 index.ts barrel 导出属于 workbench.ts 导出的延伸，纳入 workbench.ts 修改面；若工具强约束路径，则把 barrel 行留 task-08 或单独说明，但建议一并加（否则页面 import 找不到符号）。落实时确认 index.ts 是否在 allowed_paths，不在则向 orchestrator 反馈扩 path 或退而从 workbench.ts 具名 import"
acceptance:
  - "types.ts 新增 6 个 interface，字段名/可空性与 design §7.1~§7.3 完全一致（snake_case）"
  - "workbench.ts 导出 3 个 async 函数，签名与返回类型正确（profile 无参；summary 接 range 默认 month；calendar 接 yearMonth 串）"
  - "路径与后端 router 一致：/api/ppm/workbench/{profile,summary,calendar}"
  - "apiFetch 调用沿用 task.ts 范式（query 用对象字面量），自动带 token + 401 刷新（无需手写）"
  - "`cd frontend && pnpm typecheck` 通过"
verify:
  - "cd frontend && pnpm typecheck"
constraints:
  - "沿用 apiFetch + 手写类型（PPM 域非 react-query，design §3 明确不引入）"
  - "字段命名 snake_case 与现有 PPM types.ts（PlanTask/task_execute 等）及后端 Pydantic 输出一致，不做 camelCase 转换"
  - "仅 task-02 后端 schema/router 就绪后此 client 才有对齐依据；实现时可先按 design §7 契约写，联调对齐留 task-13"
---
