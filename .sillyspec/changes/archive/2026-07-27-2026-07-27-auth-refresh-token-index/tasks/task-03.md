---
id: task-03
title: migration 202607271700 加 token_id_hmac 列 + 部分唯一索引
author: qinyi
created_at: 2026-07-27 22:15:00
priority: P0
depends_on: []
blocks: [task-08]
requirement_ids: [FR-10]
decision_ids: [D-008@v1]
allowed_paths:
  - backend/migrations/versions/
goal: 新建 migration 202607271700（接 head 202607270900）：加 sessions.token_id_hmac 列 + 部分唯一索引 ux_sessions_token_id_hmac（双 where），与 task-01 模型镜像。
implementation: 新建 202607271700_add_session_token_id_hmac.py，revision=202607271700 down_revision=202607270900；upgrade=op.add_column(String64 nullable)+op.create_index(unique=True, postgresql_where=IS NOT NULL, sqlite_where=同)；downgrade=drop_index+drop_column。
acceptance: alembic heads 单头 202607271700；upgrade/downgrade 可逆；旧行 token_id_hmac NULL 不违反部分唯一索引（PG+SQLite）。
verify: cd backend && alembic heads（单头）；alembic upgrade head && alembic downgrade -1 && alembic upgrade head（可逆）。
constraints: down_revision=202607270900（alembic heads 真实 head，不碰游离 202608010900）；双 where 保证 PG/SQLite 索引形态一致；不清表（旧行 NULL，D-008）。
provides:
  - contract: SessionTokenHmacMigration
    fields: [revision_202607271700]
expects_from: {}
---

# task-03 · alembic migration

## goal

DB 侧落地 token_id_hmac 列 + 部分唯一索引，镜像 task-01 模型定义（design §4，D-008：只加列不清表）。

## implementation

1. 新建 `backend/migrations/versions/202607271700_add_session_token_id_hmac.py`：
   - `revision = '202607271700'`，`down_revision = '202607270900'`（**先 `cd backend && alembic heads` 确认真实 head**）。
2. `upgrade()`：
   ```python
   op.add_column("sessions", sa.Column("token_id_hmac", sa.String(length=64), nullable=True))
   op.create_index("ux_sessions_token_id_hmac", "sessions", ["token_id_hmac"],
       unique=True,
       postgresql_where=sa.text("token_id_hmac IS NOT NULL"),
       sqlite_where=sa.text("token_id_hmac IS NOT NULL"))
   ```
3. `downgrade()`：`op.drop_index("ux_sessions_token_id_hmac", table_name="sessions")` + `op.drop_column("sessions", "token_id_hmac")`。

## 验收标准

- [ ] `alembic heads` 单头 `202607271700`
- [ ] upgrade + downgrade 可逆（SQLite 测试库实跑）
- [ ] 多行 `token_id_hmac IS NULL` 共存不违反部分唯一索引
- [ ] PG/SQLite 索引形态一致（双 where）

## verify

- `cd backend && alembic heads`
- `cd backend && alembic upgrade head && alembic downgrade -1 && alembic upgrade head`

## constraints

`down_revision` 指向 `alembic heads` 实际输出（202607270900），不接游离的 202608010900；不清 sessions 表（D-008）；不碰其它表。
