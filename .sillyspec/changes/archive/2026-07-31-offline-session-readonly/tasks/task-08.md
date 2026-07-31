---
id: task-08
title: change-session-section 回归测试
title_zh: changes页会话区不传离线属性行为不变回归
author: WhaleFall
created_at: 2026-07-31T11:23:11
priority: P0
depends_on: [task-03]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/changes/__tests__/change-session-section-offline-regression.test.tsx
goal: >
  验证 change-session-section（共用 InteractiveSessionPanel）不传 offlineReadOnly，离线/在线
  行为与改前一致（prop 隔离，D-003）。
implementation:
  - 新建 change-session-section-offline-regression.test.tsx（或在既有 change-session-section.test.tsx 追加）
  - 用例：render change-session-section，runtime 离线 → 行为与改前一致（无离线横幅、不强制只读；其自有 hasOnlineProvider 守卫发送不变）
  - 验证 InteractiveSessionPanel 收到 offlineReadOnly=undefined/false
acceptance:
  - change-session-section 不传 offlineReadOnly
  - 离线时其行为与改前一致（回归，无新横幅/不破坏既有发送守卫）
verify:
  - pnpm test change-session-section
constraints:
  - 不改 change-session-section 源码（只验证回归）
  - 既有 change-session-section.test.tsx 应仍绿
---

## 实现说明

change-session-section.tsx:212-225 用 InteractiveSessionPanel 不传 offlineReadOnly。验证离线时 panel 默认 false → 无离线横幅 + 其自有 !hasOnlineProvider 守卫发送（既有逻辑）。确保 task-03 的 prop 默认值不波及 changes 页。
