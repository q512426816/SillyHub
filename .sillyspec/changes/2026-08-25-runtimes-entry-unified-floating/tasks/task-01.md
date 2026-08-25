---
id: task-01
title: 'add locked runtime shell state to floating session store'
title_zh: '悬浮会话 store 加 lockedRuntime 壳态与唤起动作'
author: 'qinyi'
created_at: 2026-08-25 15:35:26
priority: P0
depends_on: []
blocks: [task-03, task-04]
requirement_ids: [FR-01, FR-02]
decision_ids: []
allowed_paths:
  - frontend/src/stores/floating-session.ts
  - frontend/src/stores/floating-session.test.ts
provides:
  - contract: FloatingSessionState
    fields: [lockedRuntime, openRuntimeSession, closeRuntimeLock]
goal: >
  悬浮会话壳 store 新增 lockedRuntime 锁定壳态与 openRuntimeSession/closeRuntimeLock 动作，
  供 runtimes 入口唤起抽屉时锁定机器+智能体（FR-01/FR-02）。
implementation:
  - FloatingSessionState 接口加 lockedRuntime 字段（id/machineLabel/providerLabel 三元组或 null）
  - 新增 openRuntimeSession(lock) 动作（置 lockedRuntime+open=true+清 sessionId/preContext）
  - 新增 closeRuntimeLock() 动作（仅清 lockedRuntime，不动其余壳态）
  - closeDrawer/selectSession/startPreSession/preSessionCreated 不自动清 lockedRuntime
  - floating-session.test.ts 补三动作行为测试
acceptance:
  - openRuntimeSession 置 lockedRuntime 且 open=true、sessionId/preContext 为 null
  - closeRuntimeLock 仅清 lockedRuntime 其余壳态不变
  - closeDrawer（有会话转最小化）后 lockedRuntime 保留
  - pnpm exec vitest run stores/floating-session.test.ts 全绿
verify:
  - cd frontend && pnpm exec vitest run src/stores/floating-session.test.ts
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改既有 open/minimize/restore/selectSession/startPreSession 动作语义
  - 不 import SessionPanel/daemon lib（store 保持纯状态可单测）
---
