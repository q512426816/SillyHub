---
id: task-09
title: 计划任务移动视图 app/m/ppm/task-plans MobileCardList 全功能（新建/编辑/导出/批量删/执行/详情+筛选+分页）
title_zh: 计划任务移动视图
author: qinyi
created_at: 2026-07-22 23:47:21
priority: P0
depends_on: [task-07]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-003, D-007, D-008]
allowed_paths:
  - frontend/src/app/m/ppm/task-plans/page.tsx
provides: [{contract: TaskPlansMobilePage, fields: [TaskPlansMobilePage]}]
expects_from: [{contract: MobileComponents, needs: [MobileCardList, MobileFilterDrawer, MobileDetailSheet, MobileActionMenu, MobileBatchBar, MobileExportButton]}]
goal: >
  新增 app/m/ppm/task-plans/page.tsx（FR-05）：MobileCardList 承载任务卡片替代表格（D-007），全功能对齐桌面——
  新建/编辑/导出/批量删除/启动/执行/详情 + 筛选 + 分页对接现有 page/page_size。
implementation:
  - '数据复用 @/lib/ppm/task：listPlanTasks/listPersonalPlanTasks/createPlanTask/updatePlanTask/deletePlanTask/startPlanTask/exportPlanTasks；项目 listSimpleProjects；isOverEstimate；useSession 同源；order_by=start_time&order=asc'
  - '承载：MobileCardList(卡片 项目/模块/状态/负责人/计划时间/预估·已消耗/内容；actions 经 MobileActionMenu=启动/执行/详情/编辑/删除) + MobileFilterDrawer(视图/状态多选/项目/负责人/区间/配合→PlanTaskPageReq) + MobileDetailSheet(新建/编辑) + MobileBatchBar(批量删) + MobileExportButton'
  - '分页 MobileCardList.pagination.onChange→load({page,page_size})，pageSize 用桌面 PAGE_SIZE_OPTIONS'
acceptance:
  - 卡片替代表格，启动/执行/详情/编辑/删除/批量删/导出/新建 全可用（D-008）
  - 筛选抽屉命中服务端过滤、回第 1 页重拉；翻页/改 pageSize 正常
  - canDelete/canOperate/canEdit 权限判定与桌面一致（useSession id/is_platform_admin）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test
constraints:
  - 复用 lib/ppm/task + lib/ppm/project 数据层，禁止自写请求（D-003）
  - 表格改卡片列表（D-007），与桌面功能对齐、全功能可用（D-008）
  - 桌面 (dashboard)/ppm/task-plans/** 不改（零回归）；触摸≥44×44px、正文≥14px
---

# task-09 · 计划任务移动视图

依据 design §5.5/FR-05。MobileCardList 全功能卡片列表替代表格，复用 lib/ppm/task 数据层。
