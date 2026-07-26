---
id: task-03
title: 移动端列表进门自由化
title_zh: 移动端未绑定点击提示电脑端
author: qinyi
created_at: 2026-07-26 15:35:00
priority: P0
depends_on: []
blocks: [task-10]
requirement_ids: [FR-01]
decision_ids: [D-001]
allowed_paths:
  - frontend/src/app/m/workspaces/page.tsx
goal: >
  移动端列表点任意工作区（含未绑定）都提示"请在电脑端打开"，不再弹绑定 Dialog。
implementation:
  - handleActivate（~194-201）：移除 `setBindingTarget(w)` 分支，always `message.info("请在电脑端打开")`
  - 删 bindingTarget state + 对 `<WorkspaceBindingDialog>` 的进门用法
  - 移除 ql-004 加的 canBorrow 判定（permissions/isPlatformAdmin/canBorrow + import）
acceptance:
  - 未绑定工作区点击 → 提示电脑端（不弹 Dialog）
  - 已绑定工作区点击 → 提示电脑端（零回归）
verify:
  - cd frontend && pnpm test -- --run "src/app/m/workspaces"
constraints:
  - 移动端不导航（原行为），只移除绑定拦截
  - canBorrow 判定随进门闸移除
---
