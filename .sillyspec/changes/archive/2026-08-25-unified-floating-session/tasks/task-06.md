---
id: task-06
title: 'session panel pageContext passthrough'
title_zh: 'SessionPanel pageContext 最小透传'
author: 'qinyi'
created_at: 2026-08-25 03:14:30
priority: P0
depends_on: [task-03, task-05]
blocks: []
requirement_ids: [FR-5]
decision_ids: [D-006]
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/lib/daemon.ts
goal: >
  预会话首句 createSession 携带 page_context，使悬浮入口注入的页面上下文
  到达后端前导链；缺省零回归。
implementation:
  - SessionPreContext += pageContext?: { page_key: "ppm_project"; project_id: string }
  - handlePreSessionSend 的 createSession spread += pageContext 有值才带 page_context
  - lib/daemon.ts createSession body += input.page_context 有值才带
acceptance:
  - 不传 pageContext 时 createSession 请求体与现状逐字节一致
  - 传入时请求体含 page_context
  - 既有 session-panel/portal 测试零回归
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon src/components/sessions
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - session-panel.tsx 仅此两处增量，不动其它逻辑
  - 类型用生成版（不手写重复结构）
---
# task-06 最小透传
