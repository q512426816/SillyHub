---
id: task-08
title: components 页接入 DaemonRequiredNotice
title_zh: 组件拓扑页（读源码）无 daemon 时空态
author: qinyi
created_at: 2026-07-26 15:36:00
priority: P0
depends_on: [task-05]
blocks: [task-10]
requirement_ids: [FR-04]
decision_ids: [D-003]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx
expects_from:
  task-05:
    - contract: DaemonRequiredNotice
      needs: [feature, workspaceId, canBorrow, onConfigured]
goal: >
  组件拓扑页（读源码构建拓扑）成员无 binding 时主区渲染 DaemonRequiredNotice。
implementation:
  - spike-01 核 components 页 daemon 耦合（组件拓扑源码扫描经 host_fs/daemon）
  - 无 binding 主区渲染 `<DaemonRequiredNotice feature="组件拓扑" ... />`
  - 有 binding 原路径（零回归）
  - 若该页实际不依赖 daemon（spike-01 证伪），则 skip 并记原因（不强制接入）
acceptance:
  - 若 daemon 依赖：无 binding → 空态；有 binding → 原拓扑
  - 若 daemon 无关：不接入，记 spike 结论
verify:
  - cd frontend && pnpm test -- --run "src/app/(dashboard)/workspaces/[id]/components"
constraints:
  - spike-01 决定是否接入（R-01 不漏页也不强加）
---
