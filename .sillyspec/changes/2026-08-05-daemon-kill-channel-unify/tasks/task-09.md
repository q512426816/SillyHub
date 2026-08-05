---
id: task-09
title: Phase3 测试（超 budget 软切断、input+output 口径、None 短路）
title_zh: Phase3 budget 软切断测试
author: qinyi
created_at: 2026-08-05 19:24:02
priority: P1
depends_on: [task-07, task-08]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-006, D-009]
allowed_paths:
  - sillyhub-daemon/tests/
  - sillyhub-daemon/src/task-runner.ts
  - backend/app/modules/agent/tests/
  - backend/app/modules/daemon/tests/
goal: >
  验证 budget 软切断 + input+output 口径 + None 短路 + backend dispatch 下发（补次要观察）。
implementation:
  - 测试 daemon 超 budget 设 overBudget 且不调 close 或 kill（软切断 D-006）
  - 测试口径为 input 加 output 不含 cache（D-009）
  - 测试 budget_tokens 为 None 时检查点短路
  - 测试 backend execution dispatch 下发 budget_tokens 到 claim payload（补次要观察）
acceptance:
  - 超 budget 软切断不硬 kill 断言通过
  - input 加 output 口径断言通过（不含 cache）
  - None 短路断言通过
  - backend 下发 budget_tokens 断言通过
verify:
  - cd sillyhub-daemon && pnpm exec vitest run src/task-runner src/interactive/session-manager
  - cd backend && uv run pytest app/modules/daemon app/modules/agent -q --no-cov
constraints:
  - 不改实现仅补测试
  - 软切断语义与 backend can_dispatch_worker 一致
---
