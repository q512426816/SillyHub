---
id: task-05
title: backend cancel_lease 对 batch 发 LEASE_CANCEL（覆盖 FR-03）
title_zh: 取消批处理 lease 发送 LEASE_CANCEL
author: qinyi
created_at: 2026-08-05 19:24:02
priority: P1
depends_on: [task-04]
blocks: [task-06, task-11]
requirement_ids: [FR-03]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/lease_service.py
expects_from:
  task-04:
    - contract: LEASE_CANCEL message
      needs: [lease_id, runtime_id]
goal: >
  cancel_lease 对 batch lease（kind 不等于 interactive）标记 cancelled 后经 ws_hub 即时发 LEASE_CANCEL，不再只靠心跳轮询。
implementation:
  - lease_service.py 的 cancel_lease 对 batch lease 分支经 ws_hub.send_to_runtime 发 LEASE_CANCEL
  - interactive lease 不走此分支（由 task-02 改发 SESSION_END）
  - 发送失败只 warn 靠现有心跳轮询兜底
acceptance:
  - cancel_lease 对 batch lease 发 LEASE_CANCEL
  - interactive lease 不发 LEASE_CANCEL（走 SESSION_END）
  - 发送失败不抛错（best-effort）
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov
  - cd backend && uv run ruff check app/modules/daemon
constraints:
  - 与 task-02 同改 lease_service.py 不同分支（execute 排程注意合并）
  - best-effort 发送失败靠心跳兜底
---
