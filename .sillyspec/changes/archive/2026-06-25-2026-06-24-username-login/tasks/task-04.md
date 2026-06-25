---
task_id: task-04
title: DB migration — users.email DROP NOT NULL（保留 ux_users_email_active 唯一索引）
priority: P0
depends_on: [task-01]
blocks: [task-10]
decision_ids: [D-003@v1]
requirement_ids: []
allowed_paths: [backend/migrations/versions/]
author: WhaleFall
created_at: 2026-06-25T08:43:50
---

# task-04 — DB migration：users.email DROP NOT NULL

> 覆盖 D-003@v1（非空 email 仍唯一）、配合 D-005@v1（链修复后 down_revision=`202606241300`）。

## 1. 修改文件

### 新增

- `backend/migrations/versions/202608010900_users_email_drop_not_null.py`
  - revision id：`202608010900`（未来日期格式；已核实未与现有 revision id 冲突，规避「revision id 重复致后端无限重启」的历史问题）。
  - down_revision：`202606241300`（task-01 删除坏 merge `202606281200` 后恢复的线性 head）。
  - 覆盖来源：`design.md` §3 Phase 3、`plan.md` Wave 2 task-04、`decisions.md` D-003@v1 / D-005@v1。

### 覆盖来源（不动）

- `backend/app/modules/auth/model.py` `User.email`：当前 ORM 定义为 `nullable=False`。**本 task 不改 ORM**——ORM 与 DB 暂时存在「DB 已 nullable / ORM 仍标 NOT NULL」的差异，由 task-02/03 的应用层 schema/service 改造承接（`UserCreateRequest.email: str | None`），后续可在专项 task 同步 ORM。此处仅做 DB 层 schema 演进，与 design.md §3 Phase 3 一致。

## 2. 实现要求

1. 只动 `users.email` 列的可空性（`DROP NOT NULL`）；**不动** `username` 列、不动 `ux_users_email_active` / `ux_users_username` 两个唯一索引。
2. `revision` / `down_revision` 字符串与上述取值严格一致；`branch_labels = None`、`depends_on = None`。
3. 文件头 docstring 写明 Revision ID / Revises / Create Date（参照 `202606120900_agent_runs_nullable_task_lease.py` 风格）。
4. `upgrade()` 用 `op.alter_column(..., existing_type=sa.String(length=255), nullable=True)`；`downgrade()` 用 `op.alter_column(..., existing_type=sa.String(length=255), nullable=False)`。
5. `existing_type` 必须显式传 `sa.String(length=255)`（与 model.py `email` 定义一致），避免 alembic 在某些后端误推断类型导致 ALTER 重写列定义。
6. 文件以 `from __future__ import annotations` 开头，`import sqlalchemy as sa` + `from alembic import op`。

## 3. 接口定义（alembic op 伪代码）

```python
"""users.email DROP NOT NULL

Revision ID: 202608010900
Revises: 202606241300
Create Date: 2026-06-25

把 users.email 从 NOT NULL 改为 NULLABLE，登录主账号改由 username 承担。
ux_users_email_active(email, unique=True) 唯一索引保留 —— PG 中多个 NULL
不冲突，非空 email 仍全局唯一（D-003@v1）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202608010900"
down_revision = "202606241300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TABLE users ALTER COLUMN email DROP NOT NULL
    op.alter_column(
        "users",
        "email",
        existing_type=sa.String(length=255),
        nullable=True,
    )


def downgrade() -> None:
    # ALTER TABLE users ALTER COLUMN email SET NOT NULL
    # 前提：执行 downgrade 时 users 表中不存在 email IS NULL 的行
    op.alter_column(
        "users",
        "email",
        existing_type=sa.String(length=255),
        nullable=False,
    )
```

## 4. 边界处理

1. **down_revision 锁定 `202606241300`**：依赖 task-01 已删除坏 merge `202606281200` 并恢复线性链，head=`202606241300`。task-04 execute 前必须先确认 task-01 已完成；若 `alembic heads` 仍多分支，本 migration 将无法应用。
2. **revision id `202608010900` 唯一不冲突**：已扫描 `backend/migrations/versions/` 全部文件名，无 `202608010900` 占用；规避历史「revision id 重复致后端无限重启」事故。严禁复用任何已存在 id（如 `202607010900` 已被 `rename_system_roles_to_zh` 占用）。
3. **downgrade 回退前提**：`SET NOT NULL` 要求回退时 `users` 表无 `email IS NULL` 的行。生产/存量数据原本 email 全非空，但若运行期间已新建空 email 用户，回退前必须先 `UPDATE users SET email = username || '@local' WHERE email IS NULL`（或人工补值），否则 `SET NOT NULL` 报错。downgrade 不在此自动 backfill，保留人工确认。
4. **PG NULL 唯一语义**：`ux_users_email_active(email, unique=True)` 在 PostgreSQL 中对多个 NULL 放行、仅对非 NULL 值去重，因此多个空 email 用户可共存、非空 email 仍全局唯一，满足 D-003@v1。**不**改造为部分唯一索引（design.md §5 非目标）。
5. **SQLite 测试库行为**：项目测试用 SQLite，其 UNIQUE 约束同样对多 NULL 放行，行为与 PG 一致；task-08 会增专门用例覆盖（多个 email=None 用户共存、非空 email 重复仍报错）。
6. **不动 username 与索引**：`username` 列保持 `nullable=True`（存量可能空，应用层 task-02/03 改为必填），`ux_users_username` 唯一索引保留；本 migration 只触碰 `email`。
7. **ORM 与 DB 暂时错位**：DB 已 nullable 而 `model.py` 仍标 `nullable=False`。这是有意的最小改造——应用层在 task-02/03 通过 schema（`email: str | None`）和 service（`create_user(email=None)`）承接 nullable 语义；ORM 标注的 NOT NULL 不影响 SQLModel 在 PG 上对 NULL 的写入（PG 列定义才是真相源）。后续若需 ORM 与 DB 完全一致，另开专项 task 同步，**不在本 task 范围**。

## 5. 非目标

- 不改 ORM `User.email` 的 `nullable=False` 标注（见边界 7）。
- 不改 `username` 列或其索引。
- 不改 `ux_users_email_active` 为部分唯一索引。
- 不做 email 数据回填 / 清洗（存量全非空）。
- 不动其他表。

## 6. 参考

- `design.md` §3 Phase 3、§4 验收标准 5/6、§7 回退。
- `plan.md` Wave 2 task-04 行、覆盖矩阵 D-003@v1/D-005@v1。
- `decisions.md` D-003@v1、D-005@v1。
- 格式参考：`backend/migrations/versions/202606120900_agent_runs_nullable_task_lease.py`（同款 `op.alter_column(..., existing_type=..., nullable=...)` 用法）。
- 列定义来源：`backend/app/modules/auth/model.py` `User.email = Column(String(255), nullable=False)`（line 40）。

## 7. TDD 步骤

| # | 动作 | 期望 |
|---|---|---|
| 1 | task-01 完成后跑 `alembic heads` | 单一 head = `202606241300` |
| 2 | 写 migration 文件 `202608010900_users_email_drop_not_null.py` | 内容如 §3 |
| 3 | `alembic heads` | 单一 head = `202608010900`（链 `…→202606241300→202608010900`） |
| 4 | `alembic upgrade head` | 应用成功，无报错 |
| 5 | `\d users`（或 `information_schema.columns`）查 `email` | `is_nullable = YES` |
| 6 | `SELECT indexdef FROM pg_indexes WHERE indexname='ux_users_email_active'` | 索引仍存在且 `unique = true` |
| 7 | `INSERT INTO users(..., email=NULL, ...)` 两条 | 两条均成功（多 NULL 不冲突） |
| 8 | `INSERT` 两条相同非空 email | 第二条报 unique violation |
| 9 | `alembic downgrade -1`（前提无空 email 行） | 成功回退，`email` 恢复 `NOT NULL` |
| 10 | `alembic upgrade head` 再升回 | 成功 |

## 8. 验收标准

| ID | 验收项 | 验证方式 | 通过判据 |
|---|---|---|---|
| AC-1 | `alembic heads` 单一 head | `alembic heads` | 输出仅 `202608010900 (head)`，无多分支 |
| AC-2 | `alembic upgrade head` 成功 | 执行 upgrade | 退出码 0，无 KeyError / 无重复 id 报错 |
| AC-3 | `users.email` 已 nullable | 查 `information_schema.columns` | `users.email.is_nullable = 'YES'` |
| AC-4 | `ux_users_email_active` 唯一索引保留 | 查 `pg_indexes` | 索引存在 + `unique=true` |
| AC-5 | 多个空 email 可共存 | 插入两条 `email=NULL` | 均成功（SC-5 子项） |
| AC-6 | 非空 email 仍唯一 | 插入重复非空 email | 第二条 unique violation（SC-5 / D-003） |
| AC-7 | `username` 列与索引未被触碰 | 查列 nullable + 索引 | `username` nullable 不变、`ux_users_username` 存在 |
| AC-8 | `alembic downgrade -1` 可回退（无空 email 前提） | 执行 downgrade | 成功，`email` 恢复 NOT NULL |
| AC-9 | revision id 全局唯一不冲突 | `ls migrations/versions/` | 仅一个 `202608010900_*` 文件 |
| AC-10 | 后端可正常启动 | Docker rebuild backend | 容器健康，无无限重启 |

## 9. 依赖与阻塞

- **depends_on**：`task-01`（必须先修复 alembic 链 → head=`202606241300`）。
- **blocks**：`task-10`（集成验证 + 部署的 `alembic upgrade head` 验收依赖本 migration 存在并可应用）。
