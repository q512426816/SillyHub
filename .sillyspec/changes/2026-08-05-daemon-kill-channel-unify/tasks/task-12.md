---
id: task-12
title: Phase4 测试（terminating_at 写仅 cancel/清、sweeper 超时告警、end_session 不写）
title_zh: Phase4 轻量终态确认测试
author: qinyi
created_at: 2026-08-05 19:24:02
priority: P1
depends_on: [task-10, task-11]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-007]
allowed_paths:
  - backend/app/modules/daemon/tests/
goal: >
  验证 terminating_at 写清时序 + sweeper 超时告警 + end_session 不写。
implementation:
  - 测试 cancel_lease 写 terminating_at 且 end_session 不写（XC-03）
  - 测试 complete_lease 或 notifySessionEnd 回传清 terminating_at
  - 测试 sweeper 对超 30s 未回传的 lease 告警且不改 lease.status（mock 时钟）
acceptance:
  - 写仅 cancel 清由回传触发断言通过
  - end_session 不写 terminating_at 断言通过
  - sweeper 超时告警断言通过
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov
constraints:
  - 不改实现仅补测试
  - mock 时钟验证 30s 阈值
---
