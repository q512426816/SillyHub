---
id: task-04
title: WorkspaceBindingGuard 降级
title_zh: guard 从进门闸降级为已绑定编辑入口
author: qinyi
created_at: 2026-07-26 15:35:00
priority: P0
depends_on: []
blocks: [task-09, task-10]
requirement_ids: [FR-02]
decision_ids: [D-004]
allowed_paths:
  - frontend/src/components/workspace-binding-guard.tsx
goal: >
  详情页 guard 未绑定时不再渲染绑定表单阻断（return null），已绑定保留编辑入口。
implementation:
  - state=unbound 分支：不再渲染 `<WorkspaceAccessGuide>`，直接 return null（概览 WorkspaceConfigCard 接管配置引导）
  - ql-004 加的 canBorrow 判定（unbound+canBorrow → null）扩展为：unbound 一律 return null（无论 canBorrow）
  - state=bound：保留"编辑我的接入配置"按钮（零回归）
  - 可移除 now-unused useSession/canBorrow 引入（若 unbound 不再判 canBorrow）
acceptance:
  - 未绑定成员进详情页 → guard 不渲染表单（页面正常展示 tabs/内容）
  - 已绑定成员 → "编辑接入配置"按钮原行为
verify:
  - cd frontend && pnpm test -- --run "src/components/workspace-binding-guard"
constraints:
  - guard 不再阻断；配置引导移交给概览 WorkspaceConfigCard（task-09 核实）
  - 不改 layout.tsx 挂载点
---
