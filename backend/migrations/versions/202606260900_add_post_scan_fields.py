"""add post-scan validation fields to agent_runs

Revision ID: 202606260900
Revises: 202606250900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606260900"
down_revision = "202606250900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agent_runs", sa.Column("post_scan_status", sa.String(50), nullable=True))
    op.add_column("agent_runs", sa.Column("source_commit", sa.String(64), nullable=True))
    op.add_column("agent_runs", sa.Column("is_resume", sa.Integer, nullable=True))
    op.add_column("agent_runs", sa.Column("resumed_from_step", sa.Integer, nullable=True))


def downgrade() -> None:
    op.drop_column("agent_runs", "resumed_from_step")
    op.drop_column("agent_runs", "is_resume")
    op.drop_column("agent_runs", "source_commit")
    op.drop_column("agent_runs", "post_scan_status")
