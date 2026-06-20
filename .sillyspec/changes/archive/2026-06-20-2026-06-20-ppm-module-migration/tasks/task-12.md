---
id: task-12
title: 前端 task + kanban 页面(工时统计 + 看板拖拽)
priority: P1
estimated_hours: 14
depends_on: [task-09]
blocks: [task-13]
requirement_ids: [FR-05, FR-06]
decision_ids: []
author: qinyi
created_at: 2026-06-20T14:52:22+0800
---

## 目标
实现任务计划/执行、工时录入与统计(图表)、看板(人员分列拖拽 + 持久化)页面,覆盖任务执行与可视化协作。

## 文件
- 新增 frontend/src/app/(dashboard)/ppm/task-plans/page.tsx(任务计划 + 个人任务计划视图切换)
- 新增 frontend/src/app/(dashboard)/ppm/work-hours/page.tsx(工时录入 CRUD)
- 新增 frontend/src/app/(dashboard)/ppm/work-hour-statistics/page.tsx(工时统计图表)
- 新增 frontend/src/app/(dashboard)/ppm/kanban/page.tsx(人员分列看板 + 拖拽)

## 实现要点(参照源)
- 任务计划:参照源 views/ppm/{taskplan,taskexecute},Table + 状态筛选;个人视图按当前用户过滤。
- 工时录入:参照源 views/ppm/work-hour,按日期/项目/任务维度 CRUD,date picker + 工时数值。
- 工时统计:用 AntD Chart 或 ECharts 渲染 task-09 的 stat-by-user/stat-by-project 返回的聚合数组(柱状/饼图);支持日期范围筛选(list-by-date-range)。
- 看板(D-001 平台级,X-001 人员=可见 project_member,可按 Organization 分组):
  - 参照源 views/ppm/task-kanban;人员分列,任务卡片在列内排列。
  - 拖拽:优先原生 HTML5 drag-drop(轻量),复杂场景评估 @xyflow/react;拖拽跨列时调 assignKanban,同列内顺序变化调 reorderKanban(kanban_order 持久化,R-05)。
  - 卡片含任务标题/状态/负责人;顶部 search 调 searchKanban。
- 参照 admin/users 的客户端组件模式;状态本地 useState 或 Zustand。
- 无 i18n,中文文案。

## 验收
- [ ] 任务计划/个人视图切换正常,CRUD 可用
- [ ] 工时录入 CRUD + 日期范围查询正常
- [ ] 工时统计图表按 user/project 正确渲染(柱状 + 饼图至少各一)
- [ ] 看板:人员列加载(可见 project_member,支持按组织分组)
- [ ] 看板:跨列拖拽调 assign 持久化,同列重排调 reorder 持久化
- [ ] 看板 search 过滤生效
