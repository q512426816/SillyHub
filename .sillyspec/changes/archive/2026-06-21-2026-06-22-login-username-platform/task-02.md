---
author: qinyi
created_at: 2026-06-22T00:50:00
---

# task-02: alembic 迁移 — 加列 + 回填 + 唯一索引

## 目标
单 revision 一次性完成：加 `username` 列（NULL）→ 回填 `lower(email 本地部分)` 并对前缀重复加序号去重 → 建 UNIQUE INDEX。

## 涉及文件
- backend/alembic/versions/2026xxxx_add_user_username.py（新增）

## 实现要点
- 参考 `backend/alembic/versions/` 现有迁移的 revision 头、down_revision 链接
- upgrade 三步顺序：① `op.add_column('users', Column('username', String(100), nullable=True))` ② 用 `op.get_bind()` 拿 connection 遍历 users：username = `email.split('@')[0].lower().strip()`，已占用则 `base + '2'`、`base + '3'` 递增去重（内存维护已用集合）③ `op.create_index('ux_users_username', 'users', ['username'], unique=True)`
- 回填后用 UPDATE 逐行写回（避免单条 SQL 跨方言问题），仅处理 active/所有现存用户
- downgrade 反向：drop index → drop column
- 文件名 / revision id 遵循现有命名（日期前缀 + 简述）

## 覆盖
FR-1, D-003@V1

## 验收
- `alembic upgrade head` 后所有 users 的 username 非空且全局唯一
- 两个前缀同为 `a` 的用户得到 `a`、`a2`
- `alembic downgrade -1` 能干净回退（列与索引均消失）
