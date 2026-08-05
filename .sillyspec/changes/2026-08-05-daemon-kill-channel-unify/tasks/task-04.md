---
id: task-04
title: LEASE_CANCEL 双端协议 + daemon handler（覆盖 FR-03, R-06）
title_zh: LEASE_CANCEL 消息双端协议与 daemon 处理
author: qinyi
created_at: 2026-08-05 19:24:02
priority: P1
depends_on: []
blocks: [task-05, task-06, task-11]
requirement_ids: [FR-03]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/protocol.py
  - sillyhub-daemon/src/protocol.ts
  - sillyhub-daemon/src/daemon.ts
provides:
  - contract: LEASE_CANCEL message
    fields: [lease_id, runtime_id]
goal: >
  新增 daemon:lease_cancel WS 消息双端协议，daemon 收到后调 taskRunner.cancel 即时杀 batch 子进程，不再等心跳周期。
implementation:
  - backend protocol.py 新增 DAEMON_MSG_LEASE_CANCEL 常量加 payload 字段 lease_id 和 runtime_id
  - daemon protocol.ts 新增 LEASE_CANCEL 常量对齐 backend
  - daemon.ts 的 _handleWsMessage 新增 LEASE_CANCEL case 调 taskRunner.cancel 复用现有 AbortController 到 _killChild
  - taskRunner.cancel 已存在确保可被 WS 路径调用且幂等（R-06）
acceptance:
  - 双端 LEASE_CANCEL 常量定义一致
  - daemon 收 LEASE_CANCEL 调 taskRunner.cancel 触发 _killChild
  - 与心跳轮询双触发幂等不重复抛错
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - cd backend && uv run ruff check app/modules/daemon && uv run mypy app/modules/daemon
constraints:
  - 消息纯新增旧 daemon 收到走 default 仅 warn（向后兼容）
  - 不改 taskRunner.cancel 内部逻辑仅接通 WS 调用点
---
