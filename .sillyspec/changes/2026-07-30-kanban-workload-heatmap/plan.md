---
plan_level: full
author: qinyi
created_at: 2026-07-30 16:00:00
---

# 实现计划（Plan）— ppm/kanban 人员工时热力网格

## 来源
design.md / requirements.md / tasks.md（brainstorm 8/8 已闭环，Design Grill 独立审查 pass，2 blocker + 2 gap 均修复）。

## Spike 前置验证
无。纯业务逻辑 + 已有代码集成（复用 workbench 摊天口径、workday.ts、kanban 现有人口径），无新技术栈/安全隔离/性能瓶颈不确定性。

## Wave 1 — 后端接口（组内顺序执行）
- [x] task-01: schema 新增 `WorkloadGridUserRow` / `WorkloadGridResponse`（覆盖：FR-02）
- [x] task-02: service `get_workload_grid()` + plan 剩余负载摊天 + actual 覆盖日求和（覆盖：FR-02/03/04）
- [x] task-03: router 新增 `GET /kanban/workload-grid` 端点（覆盖：FR-02）
- [x] task-04: 后端聚合测试 `test_kanban_workload_grid.py`（覆盖：FR-03/04, R-01, R-08）
- [x] task-05: 跑 `pnpm gen:types` 提交 `api-types.ts` + `openapi.json`（覆盖：NFR-03）

## Wave 2 — 前端网格（依赖 Wave 1 的 task-05 api-types）
- [x] task-06: `kanban.ts` 新增 `fetchWorkloadGrid()`（覆盖：FR-02）
- [x] task-07: `kanban-workload-helpers.ts` 的 `workloadCellColor()` + 接线 `getDayStatus`（覆盖：FR-06/07）
- [x] task-08: `kanban-workload-helpers.test.ts` 颜色单测（覆盖：FR-06, R-07）
- [x] task-09: `kanban-workload-grid.tsx` 网格组件（覆盖：FR-05/06/07）
- [x] task-10: `page.tsx` 计划/实际tab 视图切换接线（覆盖：FR-01）
- [x] task-11: 前端联调 + 测试零回归（覆盖：FR-01~07）

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 | 说明 |
|---|---|---|---|---|---|---|
| task-01 | schema 新增 | W1 | P0 | — | FR-02 | WorkloadGridUserRow/Response |
| task-02 | service 聚合 | W1 | P0 | task-01 | FR-02/03/04 | plan 摊天 + actual 覆盖日求和，人员复用 _query_visible_members |
| task-03 | router 端点 | W1 | P0 | task-02 | FR-02 | GET /kanban/workload-grid |
| task-04 | 后端测试 | W1 | P0 | task-02,03 | FR-03/04, R-01, R-08 | 摊天/覆盖日/跨边界/project过滤/problem排除/人员口径 |
| task-05 | gen:types | W1 | P0 | task-03 | NFR-03 | api-types + openapi.json，先确认 node_modules 健康 |
| task-06 | api client | W2 | P0 | task-05 | FR-02 | fetchWorkloadGrid |
| task-07 | 颜色 helper | W2 | P0 | — | FR-06/07 | workloadCellColor + getDayStatus |
| task-08 | 颜色单测 | W2 | P0 | task-07 | FR-06, R-07 | 0/<1/=1/>1/≥3/休息态/调休/浮点 |
| task-09 | 网格组件 | W2 | P0 | task-06,07 | FR-05/06/07 | 人员×日期×工时数字+底色+图例 |
| task-10 | page 切换 | W2 | P0 | task-09 | FR-01 | 两 tab Segmented 切换，甘特保留 |
| task-11 | 前端联调 | W2 | P0 | task-10 | FR-01~07 | pnpm test + typecheck/lint 零回归 |

## 关键路径
task-01 → task-02 → task-03 → task-05 → task-06 → task-09 → task-10 → task-11（最长路径，决定最短交付周期）

## 全局验收标准
- [ ] 后端 ppm 测试通过：`cd backend && uv run pytest app/modules/ppm -q --no-cov`
- [ ] 前端测试通过：`cd frontend && pnpm test` + `pnpm typecheck` + `pnpm lint`
- [ ] 未切换视图时甘特图行为不变（brownfield 兼容）
- [ ] 计划/实际tab 工时热力染色符合锚点偏离式（=1无色/<1绿→黄/>1红→黑，周末法定灰底、调休正常）
- [ ] 计划/实际口径与工作台工作日历同源（plan 剩余负载摊天、actual 覆盖日求和）
- [ ] `api-types.ts` 由 `pnpm gen:types` 生成，不手写
