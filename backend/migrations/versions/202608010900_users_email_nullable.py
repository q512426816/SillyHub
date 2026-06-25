"""users.email DROP NOT NULL

把 users.email 从 NOT NULL 改为 NULLABLE，登录主账号改由 username 承担。
ux_users_email_active(email, unique=True) 唯一索引保留 —— PG 中多个 NULL
不冲突，非空 email 仍全局唯一（D-003@v1）。

Revision ID: 202608010900
Revises: 202606241300
Create Date: 2026-06-25
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
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
    # 前提：执行 downgrade 时 users 表中不存在 email IS NULL 的行。
    # 若已有空 email 用户，需先手工 backfill（如 UPDATE users SET email = username || '@local' WHERE email IS NULL）。
    op.alter_column(
        "users",
        "email",
        existing_type=sa.String(length=255),
        nullable=False,
    )
