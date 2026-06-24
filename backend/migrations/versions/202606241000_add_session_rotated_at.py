"""Add rotated_at column to sessions table (grace window for refresh rotation).

Revision ID: 202606241000
Revises: 202607240900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606241000"
down_revision = "202607240900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sessions", "rotated_at")
