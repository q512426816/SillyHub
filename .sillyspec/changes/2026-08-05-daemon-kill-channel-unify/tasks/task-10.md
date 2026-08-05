---
id: task-10
title: terminating_at model + Alembic migration（覆盖 FR-04, R-05）
title_zh: terminating_at 字段与数据库迁移
author: qinyi
created_at: 2026-08-05 19:24:02
priority: P1
depends_on: []
blocks: [task-11, task-12, task-13]
requirement_ids: [FR-04]
decision_ids: [D-007]
allowed_paths:
  - backend/app/modules/daemon/model.py
  - backend/migrations/versions/
provides:
  - contract: DaemonTaskLease.terminating_at
    fields: [terminating_at]
goal: >
  DaemonTaskLease 加 terminating_at 时间戳字段加 Alembic migration，为轻量终态确认提供观测点。
implementation:
  - model.py 的 DaemonTaskLease 加 terminating_at 字段类型 datetime 或 None（nullable default None）
  - 先 alembic heads 确认单 head（R-05），基于当前 head 新增 migration 加列
  - 本地 alembic upgrade head 验证 apply 成功
acceptance:
  - DaemonTaskLease.terminating_at 字段存在且 nullable
  - migration 单 head 无冲突且 apply 成功
  - 现有 lease 默认 terminating_at 为 None 不受影响
verify:
  - cd backend && uv run alembic heads
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run pytest app/modules/daemon -q --no-cov
constraints:
  - 多 head 时先 rebase 或合并再新增（R-05 防 crash-loop）
  - PPM 不依赖此表零回归
  - 不改 lease.status 状态机取值集合（D-007）
---
