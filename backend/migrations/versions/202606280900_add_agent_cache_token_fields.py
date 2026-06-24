"""add agent cache token count fields

Revision ID: 202606280900
Revises: 202607240900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606280900"
down_revision = "202607240900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_runs",
        sa.Column("cache_read_tokens", sa.Integer, nullable=True),
    )
    op.add_column(
        "agent_runs",
        sa.Column("cache_creation_tokens", sa.Integer, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_runs", "cache_creation_tokens")
    op.drop_column("agent_runs", "cache_read_tokens")
