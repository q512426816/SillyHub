---
id: task-10
title: 问题清单移动视图 app/m/ppm/problem-list MobileCardList 全功能（新建/编辑/导出/批量删/执行/详情+筛选+分页）
title_zh: 问题清单移动视图
author: qinyi
created_at: 2026-07-22 23:47:21
priority: P0
depends_on: [task-07]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-003, D-007, D-008]
allowed_paths:
  - frontend/src/app/m/ppm/problem-list/page.tsx
provides: [{contract: ProblemListMobilePage, fields: [ProblemListMobilePage]}]
expects_from: [{contract: MobileComponents, needs: [MobileCardList, MobileFilterDrawer, MobileDetailSheet, MobileActionMenu, MobileBatchBar, MobileExportButton]}]
goal: >
  新增 app/m/ppm/problem-list/page.tsx（FR-06）：同 task-09 模式，MobileCardList 承载问题卡片替代表格（D-007），
  全功能对齐桌面——新建/编辑/导出/批量删除/开始/执行/详情 + 筛选 + 分页。
implementation:
  - '数据复用 @/lib/ppm：listProblems/startProblem/deleteProblem/exportProblems；文案 @/components/ppm-status-actions（PROBLEM_STATUS_TEXT/COLOR/PROBLEM_TYPE_TEXT）；isOverEstimate；useSession 同源；order_by=plan_start_time&order=asc'
  - '承载：MobileCardList(卡片 项目/模块/类型/描述/责任人&处置人/紧急/预估·已消耗/计划起止/状态；actions=编辑/开始/执行/详情/删除) + MobileFilterDrawer(mine/all/关键字/状态多选/项目/类型/紧急/区间→ProblemListPageReq) + MobileDetailSheet(新建/编辑) + MobileBatchBar(批量 deleteProblem) + MobileExportButton'
  - '分页 onChange→load({page,page_size})；权限 can_edit/can_delete/canOperate（责任人‖管理员）'
acceptance:
  - 卡片替代表格，编辑/开始/执行/详情/删除/批量删/导出/新建 全可用（D-008）；bug/紧急标红与桌面一致
  - 筛选抽屉命中服务端过滤、回第 1 页重拉；翻页/改 pageSize 正常
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test
constraints:
  - 复用 lib/ppm 数据层，禁止自写请求（D-003）
  - 表格改卡片列表（D-007），与桌面功能对齐、全功能可用（D-008）
  - 桌面 (dashboard)/ppm/problem-list/** 不改（零回归）；触摸≥44×44px、正文≥14px
---

# task-10 · 问题清单移动视图

依据 design §5.5/FR-06。同 task-09 模式，复用 lib/ppm 数据层，全功能卡片列表。
