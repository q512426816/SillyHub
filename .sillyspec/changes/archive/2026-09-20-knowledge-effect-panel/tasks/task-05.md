---
id: task-05
title: 'frontend unified entry card list'
title_zh: '统一条目渲染器（三形态+fr zone 组+双 tab）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 22:20:00
priority: P0
depends_on: [task-03, task-04]
blocks: [task-06]
requirement_ids: [FR-04, FR-05, FR-06]
decision_ids: [D-004@v2, D-005@v1]
allowed_paths:
  - frontend/src/components/knowledge/entry-card-list.tsx
  - frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
target_files:
  - NEW:frontend/src/components/knowledge/entry-card-list.tsx
  - NEW:frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx
expects_from:
  task-03:
    - contract: KnowledgeEntryRead
      needs: [use_count, zone]
goal: >
  统一条目渲染器三形态（手册小节卡、决策 FR 结构化卡、INDEX 导航卡）+ fr zone 组 + 双 tab 分发 + 使用徽标。
implementation:
  - entry-card-list 按文件形态分发：手册解析 ## 小节逐条正文卡（条目级徽标 slug 对齐）；decisions 与 fr 解析 ## ID 与字段行渲染结构化卡（状态徽标、字段行、理由摘要块、取代链、依据决策点击跳决策库文件、全文链接、最近确认）；INDEX 解析分类段与路由行渲染可点导航选中目标条目；generated 单条目卡
  - rejected 决策置顶加防复潮横幅；superseded 折叠置灰
  - ZONE_GROUPS 增需求规则组（决策库后）；文件点开双 tab 卡片与原文，原文复用现有 md 视图零改动
  - 文件级 use_count 徽标挂树行
acceptance:
  - 三形态渲染断言（真实样例形态 fixture）
  - 依据决策跳转与 INDEX 路由点击选中与原文 tab 切换
  - fr 条目归需求规则组
  - rejected 置顶带横幅且 superseded 折叠
verify:
  - cd frontend && pnpm exec vitest run src/components/knowledge src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 单组件配置化承载三形态（不得三套重复实现）
  - 既有 md 阅读视图零改动
  - AI-Native 主题
related_tests:
  - path: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
    reason: 双 tab 分发与 fr 组需适配既有树用例
---
