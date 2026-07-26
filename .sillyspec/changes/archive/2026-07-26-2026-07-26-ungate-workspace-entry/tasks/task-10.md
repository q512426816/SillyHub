---
id: task-10
title: 测试更新（进门/guard/空态）
title_zh: 前端测试对齐门禁后移
author: qinyi
created_at: 2026-07-26 15:36:00
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09]
blocks: [task-11]
requirement_ids: [FR-01, FR-02, FR-04]
decision_ids: [D-004]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx
  - frontend/src/components/__tests__/workspace-switcher.test.tsx
  - frontend/src/app/m/workspaces
  - frontend/src/components/workspace-binding-guard.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/runtime
  - frontend/src/app/(dashboard)/workspaces/[id]/scan-docs
  - frontend/src/app/(dashboard)/workspaces/[id]/components
goal: >
  各测试对齐门禁后移：进门自由化（未绑定→导航/切换，不弹 Dialog）、guard 降级、DaemonRequiredNotice 渲染、daemon 依赖页空态。
implementation:
  - workspaces/page.test.tsx：原"未绑定→弹 Dialog"用例改为"未绑定→直接导航"
  - workspace-switcher.test.tsx：原"未绑定→弹 Dialog"用例改"未绑定→switchWorkspace"；移除 ql-004 的 canBorrow 放行用例（进门自由化使 canBorrow 判定移除，改判"任意成员未绑定也切换"）
  - m/workspaces 测试：同改
  - workspace-binding-guard.test.tsx（若无则新建）：unbound → 不渲染表单（null）；bound → 编辑入口
  - daemon 依赖页测试：无 binding 主区渲染 DaemonRequiredNotice
acceptance:
  - 全部测试绿；进门/guard/空态行为断言正确
  - ql-004 canBorrow 入口用例正确迁移（不残留对已删判定的断言）
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm typecheck
constraints:
  - 非测试逻辑有误不改测试通过（CLAUDE.md 规则 9）；本任务是测试对齐新行为，合法
---
