---
id: task-09
title: 前端 lib/ppm API client + 领域类型
priority: P0
estimated_hours: 8
depends_on: [task-08]
blocks: [task-10, task-11, task-12, task-13]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: []
author: qinyi
created_at: 2026-06-20T14:52:22+0800
---

## 目标
为 ppm 全量前端提供统一 API client 与 TypeScript 领域类型层,动词式函数(走 `apiFetch`)对齐后端 Pydantic schema 与 §7 路径前缀 `/api/ppm`,供 task-10~13 页面复用。

## 文件
- 新增 frontend/src/lib/ppm/index.ts(re-export + 公共分页类型 PageReq/PageResp<T>)
- 新增 frontend/src/lib/ppm/project.ts(listProjects/getProject/createProject/updateProject/deleteProject/exportProjects + 客户/成员/干系人 CRUD 动词)
- 新增 frontend/src/lib/ppm/plan.ts(PlanNode/PlanNodeModule CRUD + ProjectPlan + PlanNodeDetail + save/reject/change 流程动词)
- 新增 frontend/src/lib/ppm/problem.ts(ProblemList/ProblemChange CRUD + nextProcess/rejectProcess/doneTask/closeTask/process-log 动词)
- 新增 frontend/src/lib/ppm/task.ts(TaskPlan/PersonalTaskPlan/TaskExecute/WorkHour CRUD + stat-by-user/stat-by-project/list-by-date-range 动词)
- 新增 frontend/src/lib/ppm/kanban.ts(listKanbanUsers/listKanbanTasks/assignKanban/reorderKanban/searchKanban 动词)

## 实现要点(参照源)
- 参照 frontend/src/lib/admin.ts 的动词式写法,统一 `apiFetch<T>(path, { json, query })`。
- 参照源 api/ppm/* 的 url 与参数形状(如 problemchange/problemlist 的 process 端点),但类型按本项目后端 schema(ProjectMaintenance/ProblemList/TaskPlan/WorkHour/KanbanUserColumn 等,字段来自 W1~W5 后端 schema.py)。
- 状态机相关端点(problem/process-task + plan/detail save/reject/change)单独命名动词,不混入 CRUD。
- 统计端点返回 ECharts/AntD Chart 友好结构(按 user/project 聚合数组)。
- index.ts re-export 各子模块,避免页面深路径引用。

## 验收
- [ ] frontend `pnpm tsc --noEmit` 类型检查通过
- [ ] 各子域 CRUD + 流程动词齐全(对照 §7 路径表逐项核对)
- [ ] 函数签名包含入参 + 返回类型(无 any)
- [ ] 无网络调用单元测试负担(纯类型 + path 封装)
