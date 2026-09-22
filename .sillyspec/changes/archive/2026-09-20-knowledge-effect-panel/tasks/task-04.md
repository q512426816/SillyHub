---
id: task-04
title: 'frontend ops dashboard'
title_zh: '运营仪表盘（四指标卡+死条目抽屉+使用率榜 % 格式）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 22:20:00
priority: P0
depends_on: [task-03]
blocks: [task-06]
requirement_ids: [FR-02, FR-03]
decision_ids: [D-008@v3, D-009]
allowed_paths:
  - frontend/src/components/knowledge/ops-dashboard.tsx
  - frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
  - frontend/src/lib/knowledge.ts
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
target_files:
  - NEW:frontend/src/components/knowledge/ops-dashboard.tsx
  - NEW:frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
  - frontend/src/lib/knowledge.ts
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx
expects_from:
  task-01:
    - contract: KnowledgeStatsOut
      needs: [coverage, dead_entries, density, freshness, usage_board]
goal: >
  运营仪表盘：四指标卡（覆盖率+趋势、死条目抽屉、密度、生效速度）+ 使用率榜全量（% 格式小于 10 两位小数否则一位小数）+ 三态。
implementation:
  - ops-dashboard 组件 react-query 消费 getKnowledgeStats；覆盖率卡含迷你周趋势 SVG；死条目卡点击展开抽屉清单（锚点+最后命中或从未）
  - 使用率榜全量滚动，主数值 per_task 百分比格式化（小于 10 两位小数否则一位小数），绝对次数副显
  - knowledge.ts 增 getKnowledgeStats 封装（类型 import 自 api-types）
  - 页面顶部挂载；空态暂无使用数据与加载与错误三态；AI-Native 主题中文文案
acceptance:
  - 四指标渲染与 mock 一致且死条目抽屉开合
  - 榜按 per_task 降序且 % 格式阈值正确（0.032 展示 3.25%、0.254 展示 25.4%）
  - 无数据空态与错误态不白屏
verify:
  - cd frontend && pnpm exec vitest run src/components/knowledge src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不做条目卡片流（task-05 范围）
  - 不手写 DTO 一律 api-types
related_tests:
  - path: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
    reason: 顶部挂 ops-dashboard 需补 stats mock 与空态断言
---
