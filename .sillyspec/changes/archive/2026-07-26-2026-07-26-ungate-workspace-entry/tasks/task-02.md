---
id: task-02
title: workspace-switcher 进门自由化
title_zh: 顶栏切换器未绑定直接切换
author: qinyi
created_at: 2026-07-26 15:35:00
priority: P0
depends_on: []
blocks: [task-10]
requirement_ids: [FR-01]
decision_ids: [D-001]
allowed_paths:
  - frontend/src/components/workspace-switcher.tsx
goal: >
  顶栏 switcher 点任意工作区（含未绑定）直接切换，不再弹绑定 Dialog。
implementation:
  - handleClickEntry（~219-227）：移除 `!entry.bound → setBindingTargetId` 分支，always `switchWorkspace(entry.id)`
  - 删顶栏对 `<WorkspaceBindingDialog>` 的进门用法（bindingTargetId state + 渲染）
  - 移除 ql-004 加的 canBorrow 判定（useSession permissions/isPlatformAdmin/canBorrow）——进门不再需要
acceptance:
  - 未绑定工作区点击 → 直接 switchWorkspace（不弹 Dialog）
  - 已绑定工作区点击 → switchWorkspace（零回归）
verify:
  - cd frontend && pnpm test -- --run "src/components/__tests__/workspace-switcher.test.tsx"
constraints:
  - 移除 ql-004 的 canBorrow 入口判定 + 其测试用例（进门自由化使入口判定冗余；agent 触发点保留 task-13）
  - WorkspaceBindingDialog 组件保留
---
