"""daemon_change_writes add files_total/files_processed

Revision ID: 20260813173000
Revises: 20260813170000
Create Date: 2026-08-13 23:20:00

ql-20260813-spec-sync-visibility Wave 3 task-06：DaemonChangeWrite 加同步进度计数列。
D-002 nullable 兼容旧行；D-004 单一写者（progress 端点，complete 不碰计数列）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260813173000"
down_revision = "20260813170000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daemon_change_writes",
        sa.Column("files_total", sa.Integer(), nullable=True),
    )
    op.add_column(
        "daemon_change_writes",
        sa.Column("files_processed", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("daemon_change_writes", "files_processed")
    op.drop_column("daemon_change_writes", "files_total")
