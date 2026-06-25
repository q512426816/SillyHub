"""add display_alias to daemon runtimes and workspaces

Revision ID: 202606251900
Revises: 202608010900
Create Date: 2026-06-25 19:00:00

为 ``daemon_runtimes`` 和 ``workspaces`` 增加可空 ``display_alias`` 展示别名
(change 2026-06-25-admin-global-daemon-workspace-management / task-03 / D-002@v1)。
历史数据无需回填，空值回退原始 ``name`` / ``slug`` / ``provider``。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606251900"
down_revision = "202608010900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daemon_runtimes",
        sa.Column("display_alias", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "workspaces",
        sa.Column("display_alias", sa.String(length=200), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workspaces", "display_alias")
    op.drop_column("daemon_runtimes", "display_alias")
