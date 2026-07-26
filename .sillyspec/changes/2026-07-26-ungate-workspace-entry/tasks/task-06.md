---
id: task-06
title: runtime 页接入 DaemonRequiredNotice
title_zh: 运行时页无 daemon 时空态
author: qinyi
created_at: 2026-07-26 15:36:00
priority: P0
depends_on: [task-05]
blocks: [task-10]
requirement_ids: [FR-04]
decision_ids: [D-003]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/runtime/page.tsx
expects_from:
  task-05:
    - contract: DaemonRequiredNotice
      needs: [feature, workspaceId, canBorrow, onConfigured]
goal: >
  运行时页成员无 binding 时主区渲染 DaemonRequiredNotice，非阻断。
implementation:
  - spike-01 先核 runtime 页 daemon 耦合：哪些 fetch 经 daemon（运行时实体/心跳）→ 无 binding 时主数据为空/报错点
  - 无 binding（!myBinding?.daemon_id）主区渲染 `<DaemonRequiredNotice feature="运行时" workspaceId canBorrow onConfigured={refetch} />`
  - 有 binding 走原路径（零回归）
acceptance:
  - 无 binding 成员进 runtime 页 → 主区显示"⚠ 运行时需要守护进程" + 配置/借用按钮
  - 有 binding → 原运行时信息展示
verify:
  - cd frontend && pnpm test -- --run "src/app/(dashboard)/workspaces/[id]/runtime"
constraints:
  - 仅替换 daemon 依赖的主区；页面其余部分正常
  - 不改 runtime 数据获取逻辑
---
