"""daemon instance build_id

Revision ID: 202607041800
Revises: b16bf63a5d05
Create Date: 2026-07-04

为 daemon_instances 新增 build_id 列（git short SHA，daemon 构建标识）。
version 列（语义版本）已存在（202607031200 建表），本迁移仅加 build_id 用于
精确版本比对与升级判断。2026-07-04-daemon-version-management D-003。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607041800"
down_revision = "b16bf63a5d05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daemon_instances",
        sa.Column("build_id", sa.String(length=50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("daemon_instances", "build_id")
