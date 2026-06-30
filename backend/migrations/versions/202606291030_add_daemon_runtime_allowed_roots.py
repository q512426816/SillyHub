"""add daemon_runtimes.allowed_roots

Revision ID: 202606291030
Revises: 202606281237
Create Date: 2026-06-29 10:30:00

为 ``daemon_runtimes`` 加 ``allowed_roots``（JSON 数组，默认 ``["~/.sillyhub"]``），
供 runtimes 页面配置 daemon 可访问目录沙箱（change 2026-06-29-runtime-allowed-roots-config / task-01）。
server_default 同时回填存量行（pg ADD COLUMN DEFAULT / sqlite 均回填）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606291030"
down_revision = "202606281237"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daemon_runtimes",
        sa.Column(
            "allowed_roots",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[\"~/.sillyhub\"]'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("daemon_runtimes", "allowed_roots")
