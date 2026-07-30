---
author: qinyi
created_at: 2026-07-30 15:50:00
---

# 任务清单（Tasks）— ppm/kanban 人员工时热力网格

> 两个 Wave：Wave1 后端（接口 + gen:types）→ Wave2 前端（组件 + 切换）。前端依赖 Wave1 生成的 api-types。

## Wave 1 — 后端

- [ ] **task-01** schema：在 `backend/app/modules/ppm/kanban/schema.py` 新增 `WorkloadGridUserRow` / `WorkloadGridResponse`（FR-02）。
- [ ] **task-02** service 聚合：在 `backend/app/modules/ppm/kanban/service.py` 新增 `get_workload_grid()`，含 `_spread_plan_person_days()`（剩余负载摊天，FR-03）与 `_sum_actual_person_days()`（覆盖日求和，FR-04），人员复用 `_query_visible_members`。
- [ ] **task-03** router：在 `backend/app/modules/ppm/kanban/router.py` 新增 `GET /kanban/workload-grid` 端点（FR-02）。
- [ ] **task-04** 后端测试：新增 `backend/app/modules/ppm/kanban/tests/test_kanban_workload_grid.py`，覆盖 plan 摊天、actual 覆盖日求和、跨边界在途记录（R-01）、project 过滤 join PlanTask、problem 排除（R-08）、人员口径、空数据。
- [ ] **task-05** gen:types：跑 `pnpm gen:types`，提交 `frontend/src/lib/api-types.ts` + `backend/openapi.json`（NFR-03，先确认前端 node_modules 健康）。

## Wave 2 — 前端

- [ ] **task-06** api client：在 `frontend/src/lib/ppm/kanban.ts` 新增 `fetchWorkloadGrid()`，类型用生成的 api-types（FR-02）。
- [ ] **task-07** 颜色 helper：新增 `_components/kanban-workload-helpers.ts` 的 `workloadCellColor()`（FR-06）+ 工作日判断接线 `getDayStatus`（FR-07）。
- [ ] **task-08** 颜色单测：新增 `_components/kanban-workload-helpers.test.ts`，覆盖 0/<1/=1/>1/≥3/休息态/调休补班/浮点边界（R-07）。
- [ ] **task-09** 网格组件：新增 `_components/kanban-workload-grid.tsx`，人员×日期网格 + 工时数字 + 底色 + 图例（FR-05/06/07）。
- [ ] **task-10** page 接线：在 `frontend/src/app/(dashboard)/ppm/kanban/page.tsx` 计划/实际tab 各加 Segmented 视图切换 + 热力取数渲染（FR-01）。
- [ ] **task-11** 前端联调 + 测试：跑 `pnpm test` + `pnpm typecheck`/`lint`，确认零回归。

## 依赖

- task-02 依赖 task-01；task-03 依赖 task-02；task-04 依赖 task-02/03；task-05 依赖 task-03。
- task-06 依赖 task-05（api-types）；task-09 依赖 task-06/07；task-10 依赖 task-09；task-11 依赖 task-10。
