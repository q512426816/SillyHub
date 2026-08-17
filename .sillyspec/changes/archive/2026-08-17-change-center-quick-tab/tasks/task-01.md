---
id: task-01
title: quicklog_entries 表 model + alembic migration（覆盖 FR-03, D-003）
title_zh: quicklog 推送落库表与迁移
author: qinyi
created_at: 2026-08-17 00:32:00
priority: P0
depends_on: []
blocks: [task-02, task-04]
requirement_ids: [FR-03]
decision_ids: [D-003, D-004, D-005]
allowed_paths:
  - backend/app/modules/platform_sync/model.py
  - backend/migrations/versions/
provides:
  - contract: quicklog_entries_table
    fields: [workspace_id, ql_id, payload, created_at, updated_at]
expects_from: {}
goal: >
  新增 PG 表 quicklog_entries 承载 CLI 推送的 quicklog 条目原文（D-003 双链路的推送落点），
  UNIQUE(workspace_id, ql_id) 支撑幂等 upsert（D-004），只存 payload 原文、派生字段不入库（D-005）。
implementation:
  - platform_sync/model.py 新增 QuicklogEntry SQLModel：id PK / workspace_id FK(workspaces) / ql_id String / payload JSON / created_at / updated_at
  - 建 UNIQUE 约束 (workspace_id, ql_id)（迁移内 add_unique_constraint）
  - 新增 alembic migration（down_revision 指向当前 head），可 upgrade/downgrade
acceptance:
  - migration upgrade/downgrade 干净；表存在且 UNIQUE(workspace_id, ql_id) 生效（重复插入抛 IntegrityError）
  - 既有表零影响（纯新增表）
verify:
  - cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head
  - cd backend && uv run pytest app/modules/platform_sync -x -q
constraints:
  - 只加表不加其它 schema 变更；payload 为 JSON 原文
  - 迁移无平台特定 SQL（Windows/Linux/macOS 兼容）
  - 本 task 不做端点（归 task-02）
related_tests: []
---
