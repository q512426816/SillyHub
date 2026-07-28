---
id: task-01
title: Session 加 token_id_hmac 列 + 部分唯一索引
author: qinyi
created_at: 2026-07-27 22:15:00
priority: P0
depends_on: []
blocks: [task-04, task-05, task-06, task-08]
requirement_ids: [FR-04]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/auth/model.py
goal: Session 表加 token_id_hmac 列（String64 nullable）+ __table_args__ 加部分唯一索引 ux_sessions_token_id_hmac（双 where），对齐 workspace/model.py 范式（D-003）。
implementation: model.py Session 加裸 Column(String(64), nullable=True) 字段 token_id_hmac；__table_args__ 追加 Index(unique=True, postgresql_where=token_id_hmac IS NOT NULL, sqlite_where=同)，与既有 ix_sessions_user_revoked 并列。
acceptance: token_id_hmac 列存在且 nullable；部分唯一索引 ux_sessions_token_id_hmac 存在；NULL 行不参与唯一约束；create_all 与 migration 索引形态一致。
verify: cd backend && python -c "from app.modules.auth.model import Session; t=Session.__table__; assert 'token_id_hmac' in t.columns; assert any(i.name=='ux_sessions_token_id_hmac' for i in t.indexes)"；pytest tests/modules/auth/ 零回归。
constraints: 裸 Column 不带 unique/index（索引在 __table_args__）；双 where 保证 PG/SQLite 一致；参照 workspace/model.py:32-49；不动既有 ix_sessions_user_revoked；from sqlalchemy import text/Index 已在文件内（确认 import）。
provides:
  - contract: SessionTokenIndex
    fields: [token_id_hmac_column, token_id_hmac_partial_index]
expects_from: {}
---

# task-01 · Session 数据模型

## goal

为 refresh token O(1) 查找提供 DB 侧基础：Session 加 `token_id_hmac`（HMAC-SHA256 hex，64 字符）+ 部分唯一索引。对齐 `workspace/model.py:32-49` 既有 partial-unique-index 范式（裸 Column + `__table_args__ Index(unique=True, postgresql_where=, sqlite_where=)`），不用 `Column(unique=True, index=True)`（design §4 / Grill B2）。

## implementation

1. `backend/app/modules/auth/model.py` Session 类加字段（裸 Column）：
   ```python
   token_id_hmac: str | None = Field(
       default=None,
       sa_column=Column(String(64), nullable=True),
   )
   ```
2. `__table_args__` 在既有 `ix_sessions_user_revoked` 后追加部分唯一索引：
   ```python
   Index("ux_sessions_token_id_hmac", "token_id_hmac", unique=True,
         postgresql_where=text("token_id_hmac IS NOT NULL"),
         sqlite_where=text("token_id_hmac IS NOT NULL")),
   ```
3. 确认文件已 import `Index`/`text`/`Column`/`String`（既有 ix_sessions_user_revoked 用到 Index，text 可能需补）。

## 验收标准

- [ ] `token_id_hmac` 列存在（String(64), nullable=True）
- [ ] `ux_sessions_token_id_hmac` 部分唯一索引存在，含双 where
- [ ] NULL 行不违反唯一约束（多行 NULL 共存）
- [ ] 既有 auth 测试零回归

## verify

- `cd backend && python -c "..."`（见 frontmatter verify，验列+索引）
- `cd backend && uv run pytest tests/modules/auth/ -q`

## constraints

不碰既有 `ix_sessions_user_revoked`；不写 migration（task-03 负责）；不碰 service/security。
