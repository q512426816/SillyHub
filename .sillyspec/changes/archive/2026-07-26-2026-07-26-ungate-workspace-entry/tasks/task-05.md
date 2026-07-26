---
id: task-05
title: DaemonRequiredNotice 统一空态组件
title_zh: daemon 依赖功能无 daemon 时的内联空态
author: qinyi
created_at: 2026-07-26 15:35:00
priority: P0
depends_on: []
blocks: [task-06, task-07, task-08]
requirement_ids: [FR-04]
decision_ids: [D-003, D-004]
allowed_paths:
  - frontend/src/components/daemon-required-notice.tsx
  - frontend/src/components/daemon-required-notice.test.tsx
provides:
  - contract: DaemonRequiredNotice
    fields: [feature, workspaceId, canBorrow, onConfigured]
goal: >
  新建统一空态组件：daemon 依赖功能无 daemon 时显示"⚠ {feature} 需要守护进程" + 配置/借用按钮，非阻断。
implementation:
  - props: { feature: string; workspaceId: string; canBorrow: boolean; onConfigured?: () => void }
  - 渲染：标题"⚠ {feature} 需要守护进程" + 简短说明 + 按钮 [配置我的 daemon]（展开/跳 WorkspaceAccessGuide 或概览 config-card）+ canBorrow 时提示"你已有借用能力，可直接在 agent 页触发"
  - 内联、非阻断（SectionCard 风格，不替换整页）
acceptance:
  - 渲染标题/说明/配置按钮；canBorrow=true 显示借用提示，=false 不显示
  - onConfigured 回调在配置成功时触发
verify:
  - cd frontend && pnpm test -- --run "src/components/daemon-required-notice.test.tsx"
constraints:
  - 复用 canBorrowSharedDaemon 判定（调用方传入）；不直接读 session
  - 中文文案（CLAUDE.md 规则 12）
---
