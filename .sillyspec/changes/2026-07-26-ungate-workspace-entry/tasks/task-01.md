---
id: task-01
title: list page 进门自由化
title_zh: 工作区列表页未绑定点击直接进入
author: qinyi
created_at: 2026-07-26 15:35:00
priority: P0
depends_on: []
blocks: [task-10]
requirement_ids: [FR-01]
decision_ids: [D-001, D-004]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/page.tsx
goal: >
  列表页点任意工作区（含未绑定）直接导航进详情，不再弹 daemon 绑定 Dialog。
implementation:
  - handleActivate（~189-200）：移除 `setBindingTarget(w)` 分支，always `router.push(/workspaces/${w.id})`
  - 删 `bindingTarget` state + 列表页对 `<WorkspaceBindingDialog>` 的进门用法渲染
  - canBorrow 判定（ql-004）随之移除（进门自由化对所有成员生效，不再需要入口判定）
acceptance:
  - 未绑定工作区点击 → 直接导航（不弹 Dialog）
  - 已绑定工作区点击 → 导航（零回归）
verify:
  - cd frontend && pnpm test -- --run "src/app/(dashboard)/workspaces/__tests__/page.test.tsx"
constraints:
  - WorkspaceBindingDialog 组件保留（供设置页/概览复用），只移除其列表页进门用法
  - 不动已绑定路径行为
---
