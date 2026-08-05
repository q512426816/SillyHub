---
id: task-06
title: Phase2 测试（LEASE_CANCEL 收发、双触发幂等）
title_zh: Phase2 batch 即时取消测试
author: qinyi
created_at: 2026-08-05 19:24:02
priority: P1
depends_on: [task-04, task-05]
blocks: []
requirement_ids: [FR-03]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/tests/
  - sillyhub-daemon/src/daemon.ts
  - backend/app/modules/daemon/tests/
goal: >
  验证 LEASE_CANCEL 双端收发 + 与心跳轮询双触发幂等（R-06）。
implementation:
  - 测试 backend cancel_lease 对 batch lease 发 LEASE_CANCEL（ws_hub mock）
  - 测试 daemon 收 LEASE_CANCEL 触发 taskRunner.cancel 走 _killChild
  - 测试 LEASE_CANCEL 与心跳轮询双触发 cancel 幂等不重复抛错
acceptance:
  - batch cancel 发 LEASE_CANCEL 断言通过
  - daemon 收 LEASE_CANCEL 调 cancel 断言通过
  - 双触发幂等断言通过
verify:
  - cd sillyhub-daemon && pnpm exec vitest run（含 daemon handler 测试）
  - cd backend && uv run pytest app/modules/daemon -q --no-cov
constraints:
  - 不改实现仅补测试
  - 失败靠心跳兜底的路径也覆盖
---
