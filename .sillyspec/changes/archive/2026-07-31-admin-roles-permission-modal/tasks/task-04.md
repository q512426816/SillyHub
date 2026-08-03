---
id: task-04
title: RoleDrawer → Modal 测试
title_zh: 新建编辑角色弹窗测试
author: WhaleFall
created_at: 2026-07-31T15:05:25
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/admin/roles/__tests__/page-modal.test.tsx
goal: >
  验证新建/编辑开居中 Modal(非抽屉)+ 字段/保存/只读不变。
implementation:
  - 用例 1:点"新建角色" → 居中 Modal 打开(非右侧抽屉)
  - 用例 2:Key/名称/描述字段渲染 + 保存触发 create
  - 用例 3:编辑模式 Key 只读
  - 用例 4:系统角色只读(仅改描述)
acceptance:
  - Modal 打开 + 字段/保存/只读行为正确
verify:
  - pnpm test page-modal
constraints:
  - mock createRole/updateRole
---

## 实现说明

render /admin/roles page,触发新建/编辑,断言 Modal 打开 + 字段 + 保存调用。vitest + testing-library。
