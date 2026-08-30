---
id: task-04
title: 'floating session shell store'
title_zh: '悬浮会话壳层 store'
author: 'qinyi'
created_at: 2026-08-25 03:14:30
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-1, FR-2, FR-3]
decision_ids: [D-002]
allowed_paths:
  - frontend/src/stores/floating-session.ts
  - frontend/src/stores/floating-session.test.ts
goal: >
  全局壳层状态（开/关/最小化/选中会话/预会话上下文/页面上下文），
  为悬浮宿主与各页面入口提供唤起协议。
implementation:
  - zustand store：open/minimized/sessionId/preContext/pageContext + actions（openDrawer/minimize/restore/closeDrawer/selectSession/startPreSession）
  - closeDrawer 无活跃会话时清空全部壳态；有会话等同最小化
  - startPreSession 携带可选 pageContext
acceptance:
  - 动作机单测通过（含 minimized 保留 sessionId 语义）
  - store 无任何会话内部状态（R6：SSE/队列/turns 不上提）
verify:
  - cd frontend && pnpm exec vitest run src/stores/floating-session.test.ts
constraints:
  - 不 import SessionPanel 或 daemon lib（纯状态）
---
# task-04 壳层 store
