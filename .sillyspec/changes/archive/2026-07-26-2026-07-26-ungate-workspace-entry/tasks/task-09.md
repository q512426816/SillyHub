---
id: task-09
title: 概览 WorkspaceConfigCard 核实收敛
title_zh: 复用既有 config-card 作可选配置入口
author: qinyi
created_at: 2026-07-26 15:36:00
priority: P1
depends_on: [task-04]
blocks: [task-10]
requirement_ids: [FR-03]
decision_ids: [D-002]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/components/workspace-config-card.tsx
goal: >
  guard 降级后，概览既有 WorkspaceConfigCard 自然成可选配置入口；核实其 unbound 渲染友好，过重则收敛。
implementation:
  - spike-02 核 WorkspaceConfigCard unbound 渲染：是轻量引导卡还是重型表单占满屏
  - 若 unbound 渲染过重（占满主区/喧宾夺主）：收敛为轻量引导（保留 [配置我的 daemon] 入口，展开 AccessGuide 或跳编辑态）
  - 若已友好：仅核实，不改（复用既有，零改动）
acceptance:
  - 无 binding 成员进概览 → WorkspaceConfigCard 显示配置引导（非阻断，与文档/变更统计共存）
  - 有 binding → 原 daemon 信息 + 编辑/同步/scan（零回归）
verify:
  - cd frontend && pnpm test -- --run "src/app/(dashboard)/workspaces/[id]/page.test.tsx"
constraints:
  - 复用既有 WorkspaceConfigCard，不新建卡片（Phase 3+6 合并）
  - 不改 config-card 的 scan/init/sync 逻辑
---
