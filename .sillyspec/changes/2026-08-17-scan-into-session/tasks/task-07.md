---
id: task-07
title: render-scan-badge-in-session-list
title_zh: 会话列表扫描徽标
author: qinyi
created_at: 2026-08-17 14:10:00
priority: P1
depends_on: [task-03, task-06]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/daemon/session-list-layout.tsx
  - frontend/src/components/workspace-session-section.tsx
  - frontend/src/components/__tests__/workspace-session-section.test.tsx
provides: {}
expects_from:
  task-03:
    - contract: AgentSessionListItem
      needs: [mode]
goal: >
  workspace 会话列表按 AgentSessionListItem.mode 区分 scan 与 chat，为 scan 会话渲染「扫描」徽标，chat 与未传 kind 的既有调用方零回归。
implementation:
  - session-list-layout 的 SessionListEntry 补可选 kind 字段（scan 或 chat），行内标题旁渲染「扫描」徽标，不传 kind 不渲染
  - workspace-session-section 组装 entries 时按 s.mode 等于 scan 传 kind，chat 或 mode 缺失不传
  - 适配测试在 workspace-session-section.test.tsx 补徽标断言（scan 会话显示扫描徽标，chat 会话无徽标）
acceptance:
  - mode 为 scan 的会话在列表行内渲染「扫描」徽标且可被测试断言到
  - mode 非 scan 或 mode 缺失的会话不渲染徽标
  - runtimes 弹窗与变更会话不传 kind，列表渲染与既有行为完全一致（零回归）
  - workspace-session-section 与 session-list-layout 相关测试全部通过
verify:
  - cd frontend 后运行 pnpm vitest run workspace-session-section
  - 运行 pnpm exec tsc --noEmit 确认类型无错
constraints:
  - 仅允许修改 allowed_paths 内三个文件，session-list-layout 自身测试不在白名单不得改动
  - kind 为可选字段，不得破坏 SessionListEntry 既有调用方
  - 徽标文案用中文「扫描」，样式沿用既有 Badge 组件
---
