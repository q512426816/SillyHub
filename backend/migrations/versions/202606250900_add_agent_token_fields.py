"""add agent token count fields

Revision ID: 202606250900
Revises: 202606240900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606250900"
down_revision = "202606240900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agent_runs", sa.Column("input_tokens", sa.Integer, nullable=True))
    op.add_column("agent_runs", sa.Column("output_tokens", sa.Integer, nullable=True))


def downgrade() -> None:
    op.drop_column("agent_runs", "output_tokens")
    op.drop_column("agent_runs", "input_tokens")
