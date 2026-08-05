---
id: task-03
title: Phase1 测试（end/fail→close、interrupt 不→close、cancel→END 集成）
title_zh: Phase1 交互式切断测试
author: qinyi
created_at: 2026-08-05 19:24:02
priority: P0
depends_on: [task-01, task-02]
blocks: [task-15]
requirement_ids: [FR-01, FR-02, FR-09]
decision_ids: [D-001@v2]
allowed_paths:
  - sillyhub-daemon/src/interactive/
  - sillyhub-daemon/tests/
goal: >
  验证 Phase1 的切断契约：end/fail 触发 close、interrupt 不触发 close、cancel_lease→SESSION_END→_terminateSession 集成链路。
implementation:
  - mock driver 验证 session-manager 的 end 和 fail 触发 driverHandle.close
  - mock driver 验证 interrupt 不触发 close（守 D-001@v2 打断本轮软）
  - mock SDK Query 验证 ClaudeDriverHandle.close 调 query.close；close() 本身**不吞错**（异常由调用方 `_terminateSession` 的 try/catch 兜底，R-01；非 close 内部 catch，tests/interactive/claude-driver-close-contract.test.ts 断言 close 抛错）
  - 集成测试 backend cancel_lease 发 SESSION_END 到 daemon 走 _terminateSession 硬杀
acceptance:
  - end 和 fail 触发 close 的断言通过
  - interrupt 不触发 close 的断言通过
  - cancel 到 SESSION_END 到 _terminateSession 链路集成通过
verify:
  - cd sillyhub-daemon && pnpm exec vitest run src/interactive
  - cd backend && uv run pytest app/modules/daemon -q --no-cov
constraints:
  - 不改实现仅补测试或调整失效断言
  - mock SDK 不真实 spawn claude
  - 非测试逻辑有误时不改测试强行通过（CLAUDE.md 规则9）
---
