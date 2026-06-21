---
author: qinyi
created_at: 2026-06-21T03:00:00+0800
change: 2026-06-21-ppm-full-alignment
plan_level: full
---

# 实现计划

## 来源
brainstorm 已产出 design.md(W1-W6 方案)/requirements.md(FR-01~06)/decisions.md(D-011~014 均 accepted)/tasks.md(W1-W6 维度)。本计划将 W1-W6 拆为 6 个任务(每 Wave 一 task,粒度均匀),复用现有 ppm 组件(ppm-sub-table / ppm-status-actions / PpmUserSelect / PpmFileUrls / lib/ppm API)。

## 范围
- 后端:backend/app/modules/ppm/(router/service/model/fsm),复用 problem 流骨架 fsm.py
- 前端:frontend/src/app/(dashboard)/ppm/ 13 页 + lib/ppm/* API
- 新表:ppm_kanban_comment, ppm_kanban_subtask(W1,D-011)
- 除外:文件上传(D-007/010)、工作流 silly(D-002)

## Wave 划分(每 Wave 一 task,W2 轻依赖 W1 的 router 模式;W4 复用 W2 的 submitDetail;W5/W6 独立)

## Wave 1(并行,无依赖)
- [x] task-01: 看板任务工作站(覆盖:FR-01, D-011)

## Wave 2(复用 W1 router/service 模式,逻辑独立)
- [x] task-02: 变更流4节点 + submitDetail + nextProcess/rejectProcess + 通知(覆盖:FR-02, D-012)

## Wave 3(并行,无依赖)
- [x] task-03: projectplan 三联表 + 成本派生 + 17字段表单(覆盖:FR-03, D-014)

## Wave 4(依赖 task-02 的 submitDetail 路由骨架)
- [x] task-04: psplannone 审批6态表单(覆盖:FR-04)

## Wave 5(并行,无依赖)
- [x] task-05: echarts-for-react + work-hour/projectplan 图表(覆盖:FR-05, D-013)

## Wave 6(并行,收尾)
- [x] task-06: 收尾(task-execute 详情 / problemchange 多态 / plannodemodule 独立页 / list-by-date-range)(覆盖:FR-06)

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 看板任务工作站(task CRUD + comment/subtask 表 + TaskDetailDrawer + UserColumn 饱和度) | W1 | P0 | — | FR-01, D-011 | 后端 kanban router/service task POST/PUT/DELETE + 新表 model/migration;前端 TaskDetailDrawer 评论/子任务/附件 |
| task-02 | 变更流4节点(problem/service ProChangeProcesssExecutor + plan submitDetail + problem-change nextProcess/rejectProcess + 审计日志通知) | W2 | P0 | — | FR-02, D-012 | 复用 problem 流骨架 fsm.py;审计日志延续 D-006 |
| task-03 | projectplan 三联表 + 成本派生 + 17字段表单 | W3 | P0 | — | FR-03, D-014 | 后端 plan/service 联表查询 + remaining=budget-actual;前端 17 字段表单 + 三联表 |
| task-04 | psplannone 审批6态表单(Add/Approve/Audit/ChangeApprove/Change/View) | W4 | P1 | task-02 | FR-04 | 复用 ppm-status-actions + ppm-sub-table;6 表单对照源 9 Vue 抽公共 |
| task-05 | echarts-for-react + work-hour(柱+饼)+ projectplan 成本条形 | W5 | P1 | — | FR-05, D-013 | 依赖加 echarts + echarts-for-react;Next.js dynamic import |
| task-06 | 收尾(task-execute 详情 / problemchange 多态 / plannodemodule 独立页 / problem list-by-date-range) | W6 | P2 | — | FR-06 | 多态表单/problem list 端点 |

## 关键路径
task-01 / task-02 / task-03 / task-05 / task-06 五条并行主线;task-04 → task-02(submitDetail 路由复用)。最长路径 task-02 → task-04。

## 全局验收标准
- [ ] 后端 ruff format + ruff check + pytest(新增表 migration + 路由测试)通过
- [ ] 前端 tsc --noEmit + next lint 通过(新增页面/组件无类型错误)
- [ ] W1:看板 task 可 CRUD,task 可加评论/子任务,UserColumn 显示 taskCount/totalHours/saturation
- [ ] W2:problem-change nextProcess/rejectProcess 可流转4节点,审计日志记录每步
- [ ] W3:projectplan 三联表查询返回项目计划→PS节点→任务,remaining=budget-actual
- [ ] W4:milestone-details 6 态表单可按 status 切换
- [ ] W5:work-hour-statistics 柱+饼图、projectplan 成本条形图渲染
- [ ] W6:task-execute 详情页组件可加载;problem list-by-date-range 端点可用
- [ ] 对照源逐项 verify(看板 TaskDetailDrawer / problem-change / projectplan / psplannone 6 态)

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-011@v1 | task-01 | ppm_kanban_comment + ppm_kanban_subtask 表 + TaskDetailDrawer |
| D-012@v1 | task-02 | problem-change 流转写 audit_logs(无站内信) |
| D-013@v1 | task-05 | echarts-for-react 依赖 + 图表渲染 |
| D-014@v1 | task-03 | remaining=budget-actual 派生计算 + 17 字段表单 |
| FR-01 | task-01 | 看板 task CRUD + 饱和度 |
| FR-02 | task-02 | 变更流4节点 + 通知 |
| FR-03 | task-03 | 三联表 + 成本 |
| FR-04 | task-04 | 审批6态 |
| FR-05 | task-05 | 图表 |
| FR-06 | task-06 | 收尾 |
