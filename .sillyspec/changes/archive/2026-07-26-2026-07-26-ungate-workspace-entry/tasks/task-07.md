---
id: task-07
title: scan-docs 页接入 DaemonRequiredNotice
title_zh: 扫描文档页无 daemon 时空态
author: qinyi
created_at: 2026-07-26 15:36:00
priority: P0
depends_on: [task-05]
blocks: [task-10]
requirement_ids: [FR-04]
decision_ids: [D-003]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx
expects_from:
  task-05:
    - contract: DaemonRequiredNotice
      needs: [feature, workspaceId, canBorrow, onConfigured]
goal: >
  扫描文档页（读源码经 host_fs）成员无 binding 时主区渲染 DaemonRequiredNotice。
implementation:
  - spike-01 核 scan-docs 耦合：@/lib/scan-docs fetch 经 host_fs/daemon → 无 binding 失败点
  - 无 binding 主区渲染 `<DaemonRequiredNotice feature="扫描文档" ... />`
  - 有 binding 原路径（零回归）
acceptance:
  - 无 binding → 主区"⚠ 扫描文档需要守护进程" + 配置/借用
  - 有 binding → 原扫描树展示
verify:
  - cd frontend && pnpm test -- --run "src/app/(dashboard)/workspaces/[id]/scan-docs"
constraints:
  - 仅 daemon 依赖主区接空态
---
