---
id: task-01
title: Alembic 迁移——organizations/user_organizations/user_roles 三表 + roles/users 字段扩展
priority: P0
estimated_hours: 2
depends_on: []
blocks: [task-02, task-03]
allowed_paths:
  - backend/migrations/versions/202606161200_create_admin_org_role.py
author: WhaleFall
created_at: 2026-06-16T15:27:48
---

# task-01: Alembic 迁移

## 修改文件（必填）

- `backend/migrations/versions/202606161200_create_admin_org_role.py`（新增）

仅此一个文件。**不修改** auth/model.py、不创建 admin 模块代码、不动 schema/router——那是 task-02 / task-03 / 后续 task 的职责。本任务产物仅为 Alembic 迁移脚本。

## 实现要求

### 1. 迁移文件元信息

- `revision = "202606161200"`
- `down_revision = "202606300900"`（当前 head：`202606300900_add_api_keys.py`，参见 `backend/migrations/versions/` 最新文件）
- `branch_labels = None`
- `depends_on = None`
- 模块 docstring 写明变更名 `2026-06-16-admin-org-role-center`、task-01、对照 design.md §8.1 SQL DDL

### 2. upgrade() 函数——DDL 执行顺序（严格按以下顺序，FK 依赖决定）

#### Step 1：扩展 `roles` 表（添加 2 列 + 1 索引）

```python
op.add_column(
    "roles",
    sa.Column(
        "is_active",
        sa.Boolean(),
        nullable=False,
        server_default=sa.text("true"),
    ),
)
op.add_column(
    "roles",
    sa.Column(
        "updated_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    ),
)
op.create_index("ix_roles_is_active", "roles", ["is_active"])
```

**字段说明**：
- `is_active`：与 `users.is_active` 不同语义——这里是「角色启用/禁用开关」，禁用后绑定该角色的用户权限链路断开（具体行为在 task-04 实现，本任务只管 schema）
- `updated_at`：roles 表原本只有 `created_at`（参见 auth/model.py:122），需要补审计字段

#### Step 2：扩展 `users` 表（添加 1 列）

```python
op.add_column(
    "users",
    sa.Column(
        "login_enabled",
        sa.Boolean(),
        nullable=False,
        server_default=sa.text("true"),
    ),
)
```

**字段说明**：`login_enabled` 是独立的登录权限开关（与现有 `users.status` 软删除/`is_platform_admin` 区分）。已有 `users` 表无 `is_active` 字段（实际用 `status: str` 表示状态，见 auth/model.py:40），切勿与 design.md 笔误混淆——只新增 `login_enabled` 一列。

#### Step 3：创建 `organizations` 表（自引用，需先建表再加 FK）

```python
op.create_table(
    "organizations",
    sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
    sa.Column("name", sa.String(100), nullable=False),
    sa.Column("code", sa.String(50), nullable=False, unique=True),
    sa.Column("description", sa.Text(), nullable=True),
    # parent_id 自引用：先声明 column，FK 用 UseAlter 延后绑定避免循环
    sa.Column(
        "parent_id",
        sa.Uuid(as_uuid=True),
        sa.ForeignKey("organizations.id", ondelete="RESTRICT", name="fk_organizations_parent_id"),
        nullable=True,
    ),
    sa.Column(
        "status",
        sa.String(16),
        nullable=False,
        server_default=sa.text("'active'"),
    ),
    sa.Column(
        "sort_order",
        sa.Integer(),
        nullable=False,
        server_default=sa.text("0"),
    ),
    sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    ),
    sa.Column(
        "updated_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    ),
    sa.CheckConstraint(
        "status IN ('active', 'disabled')",
        name="ck_organizations_status",
    ),
)
op.create_index("ix_organizations_parent_id", "organizations", ["parent_id"])
op.create_index("ix_organizations_status", "organizations", ["status"])
```

#### Step 4：创建 `user_organizations` 表（多对多关联，复合 PK）

```python
op.create_table(
    "user_organizations",
    sa.Column(
        "user_id",
        sa.Uuid(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    ),
    sa.Column(
        "organization_id",
        sa.Uuid(as_uuid=True),
        sa.ForeignKey("organizations.id", ondelete="RESTRICT"),
        primary_key=True,
        nullable=False,
    ),
    sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    ),
)
op.create_index(
    "ix_user_organizations_org",
    "user_organizations",
    ["organization_id"],
)
```

#### Step 5：创建 `user_roles` 表（平台级，与现有 `user_workspace_roles` 区分）

```python
op.create_table(
    "user_roles",
    sa.Column(
        "user_id",
        sa.Uuid(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    ),
    sa.Column(
        "role_id",
        sa.Uuid(as_uuid=True),
        sa.ForeignKey("roles.id", ondelete="RESTRICT"),
        primary_key=True,
        nullable=False,
    ),
    sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    ),
)
op.create_index("ix_user_roles_role", "user_roles", ["role_id"])
```

### 3. downgrade() 函数——严格逆序（LIFO）

```python
def downgrade() -> None:
    # Step 5 逆
    op.drop_index("ix_user_roles_role", table_name="user_roles")
    op.drop_table("user_roles")

    # Step 4 逆
    op.drop_index("ix_user_organizations_org", table_name="user_organizations")
    op.drop_table("user_organizations")

    # Step 3 逆
    op.drop_index("ix_organizations_status", table_name="organizations")
    op.drop_index("ix_organizations_parent_id", table_name="organizations")
    op.drop_table("organizations")  # CHECK 约束随表删除，无需单独 drop

    # Step 2 逆
    op.drop_column("users", "login_enabled")

    # Step 1 逆
    op.drop_index("ix_roles_is_active", table_name="roles")
    op.drop_column("roles", "updated_at")
    op.drop_column("roles", "is_active")
```

### 4. CHECK / FK / DEFAULT 约束汇总（验收时对照）

| 表 | 约束 | 类型 | 细节 |
|---|---|---|---|
| organizations | `ck_organizations_status` | CHECK | `status IN ('active','disabled')` |
| organizations | `fk_organizations_parent_id` | FK self | `parent_id → organizations.id ON DELETE RESTRICT` |
| organizations | `organizations_code_key` | UNIQUE | `code` 唯一（由 `unique=True` 自动生成） |
| user_organizations | PK | 复合 PK | `(user_id, organization_id)` |
| user_organizations | FK | `user_id → users.id ON DELETE CASCADE` | 删用户级联 |
| user_organizations | FK | `organization_id → organizations.id ON DELETE RESTRICT` | 防止误删组织丢用户绑定 |
| user_roles | PK | 复合 PK | `(user_id, role_id)` |
| user_roles | FK | `user_id → users.id ON DELETE CASCADE` | 删用户级联 |
| user_roles | FK | `role_id → roles.id ON DELETE RESTRICT` | 防止误删角色丢权限绑定 |
| roles.is_active | DEFAULT | server | `true` |
| roles.updated_at | DEFAULT | server | `now()` |
| users.login_enabled | DEFAULT | server | `true` |

### 5. 索引汇总

| 索引名 | 表 | 列 | 用途 |
|---|---|---|---|
| `ix_roles_is_active` | roles | is_active | 列表筛选启用/禁用 |
| `ix_organizations_parent_id` | organizations | parent_id | 子树查询 |
| `ix_organizations_status` | organizations | status | 列表筛选 active/disabled |
| `ix_user_organizations_org` | user_organizations | organization_id | 反查组织成员 |
| `ix_user_roles_role` | user_roles | role_id | 反查角色用户（删除前置检查 count） |

复合 PK 自动建索引，无需显式 `create_index`。

## 接口定义

### 文件骨架（搬砖工照着填即可）

```python
"""create admin org/role tables + extend roles/users

Revision ID: 202606161200
Revises: 202606300900

Implements change ``2026-06-16-admin-org-role-center`` task-01. Mirrors
the SQL DDL blueprint in design.md §8.1 / §8.2.

Creates:
- organizations (self-ref tree)
- user_organizations (M:N users <-> organizations)
- user_roles (M:N users <-> roles, platform-level)

Extends:
- roles: + is_active BOOLEAN, + updated_at TIMESTAMPTZ
- users: + login_enabled BOOLEAN
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606161200"
down_revision = "202606300900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # === Step 1: roles 表扩展 ===
    op.add_column(...)  # 见上 §2.Step 1
    op.add_column(...)
    op.create_index("ix_roles_is_active", "roles", ["is_active"])

    # === Step 2: users 表扩展 ===
    op.add_column(...)  # login_enabled，见 §2.Step 2

    # === Step 3: organizations ===
    op.create_table(...)  # 见 §2.Step 3
    op.create_index(...)
    op.create_index(...)

    # === Step 4: user_organizations ===
    op.create_table(...)
    op.create_index(...)

    # === Step 5: user_roles ===
    op.create_table(...)
    op.create_index(...)


def downgrade() -> None:
    # 严格逆序，见 §3
    ...
```

### 类型选择规则

- UUID PK / FK → `sa.Uuid(as_uuid=True)`
- 时间戳 → `sa.DateTime(timezone=True)`（与 auth/model.py 一致）
- 布尔 → `sa.Boolean()`
- 短字符串 → `sa.String(N)`
- 长文本 → `sa.Text()`
- 整数 → `sa.Integer()`
- DEFAULT 一律用 `server_default=`（不用 Python default），保证迁移在裸 SQL 执行环境下也能补默认值

## 边界处理

1. **现有数据 backfill 策略**：所有新增列用 `server_default` + `nullable=False`，PostgreSQL 在 `ADD COLUMN` 时自动为已有行填默认值——`roles.is_active=true`、`roles.updated_at=now()`、`users.login_enabled=true`。**不需要单独的 UPDATE backfill 语句**。若未来出现「先 ADD COLUMN nullable，后续再 backfill」的二次迁移场景，需在 upgrade 末尾显式 `op.execute("UPDATE users SET login_enabled = true WHERE login_enabled IS NULL")`，本任务不涉及。

2. **downgrade 必须可逆**：`downgrade()` 严格按 upgrade 的 LIFO 反向操作，索引先 drop 再 drop_table，列后 drop。`downgrade -1` 后数据库结构与迁移前完全一致——`alembic downgrade -1 && alembic upgrade head` 循环测试必须通过（验收 AC-05）。

3. **CHECK 约束 status IN ('active','disabled')**：使用 `sa.CheckConstraint("status IN ('active','disabled')", name="ck_organizations_status")` 显式命名（不命名则 PG 自动生成 `organizations_check` 之类，downgrade 时难定位）。约束名在 `drop_table` 时随表删除，无需 `op.drop_constraint()`。

4. **FK ondelete 策略**：
   - `users.id` 方向 = `CASCADE`（删用户级联清空其绑定，与现有 `sessions`/`api_keys` 一致）
   - `organizations.id` / `roles.id` 方向 = `RESTRICT`（防止误删组织/角色丢历史绑定，必须先解绑再删——业务前置检查在 task-04/task-05 实现）
   - `organizations.parent_id` 自引用 = `RESTRICT`（防止删父组织遗留孤儿子组织）
   - **决策依据**：design.md §8.1 明确指定，与 R-04 风险应对一致

5. **server_default vs Python default**：本迁移**全部使用 `server_default`**（`sa.text("true")` / `sa.func.now()` / `sa.text("0")` / `sa.text("'active'")`），让 DB 层保证默认值；ORM 层（auth/model.py 在 task-02 修改）保留 Python `default=True` 用于内存对象创建场景。两层不冲突——ORM insert 时显式传值优先，未传值时 DB server_default 兜底。

6. **复合 PK 索引**：`user_organizations` / `user_roles` 使用 `primary_key=True` 标记两列形成复合 PK，PostgreSQL 自动建 `(user_id, organization_id)` / `(user_id, role_id)` 索引，**无需额外 `create_index`**；反向查（按 org_id / role_id）需要单独索引，已在 §5 索引汇总列出。

7. **organizations 自引用 FK 顺序**：`parent_id` 引用自身表，create_table 时表尚不存在——SQLAlchemy 通过 `sa.ForeignKey` 内联于 `sa.Column` 定义，配合 PG 的 `ALTER TABLE ADD CONSTRAINT` 语义在表创建后绑定 FK，无须显式 `UseAlter`。已在 §2 Step 3 通过 `name="fk_organizations_parent_id"` 显式命名以便 downgrade 定位（实际 drop_table 自动清理）。

8. **迁移失败回滚**：Alembic 单个迁移文件包裹在事务中（PG 默认 DDL 事务），任何一步失败自动整体回滚。**不要在 upgrade 内 commit**，不要混合 DDL 与 DML（除非 backfill 必需）。

9. **不破坏现有迁移链**：`down_revision = "202606300900"` 精确指向当前 head（验证：`ls backend/migrations/versions/ | sort | tail`）。**禁止改 `branch_labels` / `depends_on`**，禁止合并历史迁移。

## 非目标

- 不修改现有表数据（不 backfill 现有用户/角色，由 server_default 自动补默认值）
- 不创建 admin 模块的 Python 代码（Organization/UserOrganization/UserRole ORM 在 task-05 实现）
- 不修改 auth/model.py 的 Role/User 字段（task-02 处理 ORM 字段映射）
- 不写业务测试（迁移测试在 task-12 端到端验证）
- 不修改 `Permission` 枚举（task-02）
- 不 seed `platform_admin` 角色（task-03 处理 bootstrap）
- 不处理 PostgreSQL 之外的数据库方言（项目锁定 PG 16）
- 不引入 ENUM 类型（`status` 用 VARCHAR + CHECK，与现有 `users.status` 风格一致）

## 参考

- `backend/migrations/versions/202606300900_add_api_keys.py` —— 单表创建 + 索引 + downgrade 倒序的范本
- `backend/migrations/versions/202606270900_create_daemon_tables.py` —— 多表 + server_default + CheckConstraint 风格
- `design.md` §8.1（新增表 SQL DDL）+ §8.2（roles/users 扩展 SQL）+ §10 R-02（迁移 backfill 风险）
- `requirements.md` FR-01（迁移 + 双向可逆）+ 非功能需求 §可回退
- `backend/app/modules/auth/model.py` —— 现有 `users` / `roles` / `user_workspace_roles` 表结构对照（确认 is_active 字段不存在、status 是 String(20)、created_at 用 timezone=True）
- `backend/app/models/base.py` —— BaseModel 仅是 SQLModel 空壳，不提供审计字段（每个表自己声明 created_at/updated_at，本迁移须显式写）

## TDD 步骤

1. **写迁移文件**：在 `backend/migrations/versions/202606161200_create_admin_org_role.py` 创建文件，填入 §2 骨架代码。
2. **空库 upgrade**：
   ```bash
   cd backend
   # 重置测试库（项目未上线，数据可清空）
   docker compose exec postgres psql -U postgres -c "DROP DATABASE IF EXISTS sillyhub_test;"
   docker compose exec postgres psql -U postgres -c "CREATE DATABASE sillyhub_test;"
   DATABASE_URL=postgresql+asyncpg://postgres:***@localhost/sillyhub_test alembic upgrade head
   ```
   预期：无报错，输出 `Running upgrade 202606300900 -> 202606161200, ...`。
3. **psql 验证表结构**（对照 §4 约束表逐项核对）：
   ```bash
   docker compose exec postgres psql -U postgres -d sillyhub_test -c "\d organizations"
   docker compose exec postgres psql -U postgres -d sillyhub_test -c "\d user_organizations"
   docker compose exec postgres psql -U postgres -d sillyhub_test -c "\d user_roles"
   docker compose exec postgres psql -U postgres -d sillyhub_test -c "\d roles"
   docker compose exec postgres psql -U postgres -d sillyhub_test -c "\d users"
   ```
4. **downgrade 单步回退**：
   ```bash
   DATABASE_URL=... alembic downgrade -1
   ```
   预期：输出 `Running downgrade 202606161200 -> 202606300900, ...`，无报错。
5. **再次 upgrade 回来**（验证可重入）：
   ```bash
   DATABASE_URL=... alembic upgrade head
   ```
   预期：再次成功创建三张表 + 添加字段。
6. **含数据 brownfield 测试**（关键，对应 FR-01 backfill 语义）：
   ```bash
   # 在 upgrade head 之前的旧版本（down_revision 状态），插入测试数据
   alembic downgrade 202606300900
   docker compose exec postgres psql -d sillyhub_test -c "INSERT INTO users (id, email, password_hash, status) VALUES (gen_random_uuid(), 'a@b.c', 'x', 'active');"
   docker compose exec postgres psql -d sillyhub_test -c "INSERT INTO roles (id, key, name) VALUES (gen_random_uuid(), 'test_role', 'Test');"
   # 升级
   alembic upgrade head
   # 验证 backfill
   docker compose exec postgres psql -d sillyhub_test -c "SELECT email, login_enabled FROM users;"   # 应为 true
   docker compose exec postgres psql -d sillyhub_test -c "SELECT key, is_active, updated_at FROM roles;"  # 应为 true + 非空时间
   ```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `cd backend && alembic upgrade head`（空库） | 退出码 0；输出含 `Running upgrade 202606300900 -> 202606161200`；无 WARNING/ERROR |
| AC-02 | `psql -d sillyhub_test -c "\d users"` | 含 `login_enabled | boolean | not null default true`；其他字段（email/password_hash/status/...）保持迁移前一致 |
| AC-03 | `psql -d sillyhub_test -c "\d roles"` | 含 `is_active \| boolean \| not null default true` + `updated_at \| timestamp with time zone \| not null default now()`；原有 `key/name/description/is_system/created_at` 字段保留 |
| AC-04 | `psql -d sillyhub_test -c "\d organizations"` | 含 PK(id)、UNIQUE(code)、FK(parent_id→organizations.id ON DELETE RESTRICT)、CHECK(ck_organizations_status)、`status default 'active'`、`sort_order default 0`、`created_at`/`updated_at` not null；含 2 个索引（ix_organizations_parent_id、ix_organizations_status） |
| AC-05 | `psql -d sillyhub_test -c "\d user_organizations"` | 复合 PK(user_id, organization_id)；FK(user_id→users.id ON DELETE CASCADE)、FK(organization_id→organizations.id ON DELETE RESTRICT)；含 ix_user_organizations_org 索引 |
| AC-06 | `psql -d sillyhub_test -c "\d user_roles"` | 复合 PK(user_id, role_id)；FK(user_id→users.id ON DELETE CASCADE)、FK(role_id→roles.id ON DELETE RESTRICT)；含 ix_user_roles_role 索引 |
| AC-07 | `psql -d sillyhub_test -c "\dii+"` 或 `\d organizations` 检查约束 | `ck_organizations_status` 存在；`INSERT INTO organizations (id, name, code, status) VALUES (...,'invalid_status')` 报 `violates check constraint "ck_organizations_status"` |
| AC-08 | `alembic downgrade -1` | 退出码 0；输出含 `Running downgrade 202606161200 -> 202606300900`；三张新表 + 三个新字段全部消失（`\d organizations` 报 `Did not find any relation`；`\d users` 无 login_enabled；`\d roles` 无 is_active/updated_at） |
| AC-09 | `alembic upgrade head`（downgrade 后再 upgrade） | 退出码 0；表与字段重建成功（可重入） |
| AC-10 | brownfield backfill：旧库插入用户/角色数据后 `alembic upgrade head` | 现有 users 行的 `login_enabled=true`；现有 roles 行的 `is_active=true` + `updated_at` 非 null；现有数据 email/password_hash 等无丢失 |
| AC-11 | `cd backend && alembic history` | 输出头部含 `202606161200 (head)` 行，`202606300900 -> 202606161200` 链路正确 |
| AC-12 | `cd backend && ruff check migrations/versions/202606161200_create_admin_org_role.py` | 0 错误（迁移脚本通过 lint） |
