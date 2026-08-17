---
id: task-10
title: 变更详情页反向「关联的快速任务」区块（覆盖 FR-07）
title_zh: 变更详情反向 quick 区块
author: qinyi
created_at: 2026-08-17 00:41:00
priority: P1
depends_on: [task-08]
blocks: []
requirement_ids: [FR-07]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  - frontend/src/components/changes/detail/quicklog-linked-card.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx
provides: {}
expects_from:
  task-07: [quicklog_frontend_client]
goal: >
  变更详情页新增「关联的快速任务」SectionCard：listQuicklog(linked_change=本 change_key) 拉取，
  展示状态徽标+标题+时间，点击跳变更中心快速修复 tab（并携带定位参数）。
implementation:
  - [cid]/page.tsx 详情区加 SectionCard「关联的快速任务」
  - 用 listQuicklog(workspaceId, { linked_change: change.change_key, page_size: 20 }) 拉取
  - 每条：状态徽标 + 标题（可点击）+ 时间；空则区块显示「暂无关联快速任务」
  - 点击标题跳 /workspaces/[id]/changes?tab=quicklog（列表页支持 query 初始 tab 与定位）
  - 失败静默（区块隐藏或显示占位，不影响详情主内容）
acceptance:
  - 详情页可见关联 quick 区块；命中 linked_change 的条目列出；无则空态
  - 点击跳转变更中心快速修复 tab 正确
  - 既有详情页测试零回归
verify:
  - cd frontend && pnpm vitest run src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 区块只读展示，不引入新交互入口
  - 用详情页既有数据流（change.change_key 作为 linked_change 参数）
  - 列表页若未实现 query 初始 tab 则先补（本 task 一并）
related_tests: []
---
