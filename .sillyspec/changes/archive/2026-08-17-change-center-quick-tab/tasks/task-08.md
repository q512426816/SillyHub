---
id: task-08
title: 变更中心第三 tab + quicklog-table.tsx（列/筛选/轮询/空态）+ vitest（覆盖 FR-05, FR-08, D-001, D-007）
title_zh: 快速修复 tab 列表
author: qinyi
created_at: 2026-08-17 00:39:00
priority: P0
depends_on: [task-07]
blocks: [task-09, task-10]
requirement_ids: [FR-05, FR-08]
decision_ids: [D-001, D-007]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx
  - frontend/src/components/changes/quicklog-table.tsx
  - frontend/src/components/changes/__tests__/quicklog-table.test.tsx
provides:
  - contract: quicklog_table_ui
    fields: [tab_integration, columns, filters, polling, empty_states]
expects_from:
  task-07: [quicklog_frontend_client]
goal: >
  变更中心加「快速修复」第三 tab（进行中/已归档/快速修复，D-001），徽标计数；快速修复 tab 下渲染
  QuicklogTable：4 态状态徽标/标题/负责人/影响模块/关联变更（跳转）/时间，筛选=关键词全文+状态+负责人+空壳开关（默认隐藏），
  存在 in_progress|stale 条目时 30s 轮询全终态停轮（复用变更列表轮询模式），空态分场景。
implementation:
  - page.tsx：TABS 加第三项；tab=快速修复时渲染独立查询区（阶段筛选隐藏）+ QuicklogTable；徽标计数用独立 useQuery 或并入列表 total
  - quicklog-table.tsx：DataTable 列（状态徽标 4 态映射/标题/负责人/影响模块/关联变更 Link/时间）+ 筛选控件 + 轮询 useQuery + 空态
  - 状态徽标：in_progress=进行中(amber) / partial_done=已暂存(blue) / stale=疑似中断(red) / completed=已完成(green)
acceptance:
  - 第三 tab 渲染；切 tab 阶段筛选隐藏、变更列表筛选不受影响（回归）
  - 4 态徽标映射正确；空壳默认过滤可开关；关联变更列可跳完整变更详情
  - 轮询纯函数（有 in_progress/stale → 30000，全终态 → false）单测覆盖
  - vitest 组件测试通过；既有 changes 页测试零回归
verify:
  - cd frontend && pnpm vitest run src/components/changes/__tests__/quicklog-table.test.tsx src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改进行中/已归档 tab 既有列与行为
  - 阶段筛选（brainstorm/plan/...）不显示在快速修复 tab（quick 无阶段概念）
  - locale 日期 toLocaleString 显式 zh-CN
related_tests: []
---
