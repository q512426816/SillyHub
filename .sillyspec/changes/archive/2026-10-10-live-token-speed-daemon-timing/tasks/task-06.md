---
id: task-06
title: frontend live speed wiring and gating relaxation
title_zh: 前端实时接线与门控放宽
author: qinyi
created_at: 2026-10-10 19:56:43
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-07]
decision_ids: []
allowed_paths:
  - frontend/src/lib/daemon/session-sse.ts
  - frontend/src/components/daemon/turn-speed.ts
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
  - frontend/src/components/daemon/__tests__/turn-speed.test.ts
  - frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx
target_files:
  - frontend/src/lib/daemon/session-sse.ts
  - frontend/src/components/daemon/turn-speed.ts
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
  - frontend/src/components/daemon/__tests__/turn-speed.test.ts
  - frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx
expects_from:
  task-05:
    - contract: SSE tokens/turn_completed duration_api_ms
      needs: [duration_api_ms]
related_tests:
  - frontend/src/components/daemon/__tests__/turn-speed.test.ts（非终态不显示用例将翻转为按数据显示）
  - frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx（运行中用例增实时显示断言）
goal: >
  前端接住 tokens 事件的 duration_api_ms（onTokens 写 turn.apiDurationMs），
  turnTokenSpeedText 门控放宽为「双值可得即显示（任意状态）」——运行中实时
  速度为核心交付（FR-07）；缺数据仍不显示。
implementation:
  - frontend/src/lib/daemon/session-sse.ts envelope.duration_api_ms 注释更新（tokens/turn_completed 均携带）
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx onTokens 加 apiDurationMs 写入（page 与 dialog 两处，?? 链同 ctxTokens 守卫）
  - frontend/src/components/daemon/turn-speed.ts turnTokenSpeedText 去 TERMINAL_SPEED_STATUSES 门控（签名不变）：双值可得即返回文本
  - frontend/src/components/daemon/__tests__/turn-speed.test.ts 改写非终态用例（running+有数据显示/无数据不显示）；turn-timeline-token-speed.test.tsx 增运行中实时用例（output=625、duration=12500 → · 50 tok/s）
acceptance:
  - running 轮 output=625、duration=12500 → 显示 · 50 tok/s（FR-07 场景 1）
  - running 轮 duration 缺失 → 只显示 token 计数（FR-07 场景 2）
  - 终态行为与上变更完全一致
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/turn-speed.test.ts src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx
  - cd frontend && pnpm typecheck
constraints:
  - 不伪造：数据缺失/时长非正禁止显示
  - 禁止 tail 截断掩盖多行 tsc 错误（教训：上变更 P1 根因）

---
-->
