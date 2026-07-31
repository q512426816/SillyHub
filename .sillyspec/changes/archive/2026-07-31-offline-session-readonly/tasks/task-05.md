---
id: task-05
title: runtime-card 离线会话按钮测试
title_zh: 离线卡片会话按钮渲染与点击测试
author: WhaleFall
created_at: 2026-07-31T11:23:11
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/daemon/__tests__/runtime-card-offline.test.tsx
goal: >
  验证离线 runtime 卡片"会话"按钮仍渲染 + 可点（onOpenSession 触发），在线行为回归。
implementation:
  - 新建 runtime-card-offline.test.tsx
  - 用例 1：status=offline + provider=claude → 会话按钮渲染（查询按钮文本/role）+ 点击触发 onOpenSession mock
  - 用例 2：status=online → 按钮渲染 + 点击（回归，行为不变）
  - 用例 3：provider=其他（非 claude/codex）→ 按钮不渲染（provider 限制保留）
acceptance:
  - 离线按钮渲染 + 点击触发回调
  - 在线回归 + provider 限制保留
verify:
  - pnpm test runtime-card-offline
constraints:
  - 复用既有 runtime-card test 模式（mock props）
---

## 实现说明

render RuntimeCard with status offline/online + provider claude/其他，断言按钮 DOM 存在性 + onClick mock 调用。
