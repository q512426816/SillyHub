"""add user username

Revision ID: 202607240900
Revises: 202607230900
Create Date: 2026-06-22

为 users 表新增 username 列(登录账号),回填旧用户 username = email 本地部分(@ 前)
小写,前缀重复自动加序号(a / a2 / a3 …),随后设 NOT NULL + 全局唯一索引。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607240900"
down_revision = "202607230900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 加 nullable 列(过渡,回填后再设 NOT NULL)
    op.add_column("users", sa.Column("username", sa.String(length=100), nullable=True))

    # 2. 回填 base = email 本地部分(@ 前)小写
    op.execute("UPDATE users SET username = lower(split_part(email, '@', 1))")

    # 3. 前缀重复加序号:同 base 的第 N(N>1) 个用户追加 N,得 a / a2 / a3 …
    op.execute(
        """
        WITH ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY lower(split_part(email, '@', 1))
                   ORDER BY created_at, id
                 ) AS rn
          FROM users
        )
        UPDATE users u SET username = u.username || r.rn::text
        FROM ranked r
        WHERE u.id = r.id AND r.rn > 1
        """
    )

    # 4. NOT NULL + 全局唯一索引(参照 ux_users_email_active)
    op.alter_column(
        "users",
        "username",
        existing_type=sa.String(length=100),
        nullable=False,
    )
    op.create_index("ux_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index("ux_users_username", table_name="users")
    op.drop_column("users", "username")
