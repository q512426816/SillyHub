"""add agent usage and conversation tracking fields

Revision ID: 202606240900
Revises: 202606230900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606240900"
down_revision = "202606230900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agent_runs", sa.Column("total_cost_usd", sa.Float, nullable=True))
    op.add_column("agent_runs", sa.Column("duration_ms", sa.Integer, nullable=True))
    op.add_column("agent_runs", sa.Column("duration_api_ms", sa.Integer, nullable=True))
    op.add_column("agent_runs", sa.Column("num_turns", sa.Integer, nullable=True))
    op.add_column("agent_runs", sa.Column("session_id", sa.String(128), nullable=True))
    op.add_column("agent_runs", sa.Column("conversation_events", sa.JSON, nullable=True))


def downgrade() -> None:
    op.drop_column("agent_runs", "conversation_events")
    op.drop_column("agent_runs", "session_id")
    op.drop_column("agent_runs", "num_turns")
    op.drop_column("agent_runs", "duration_api_ms")
    op.drop_column("agent_runs", "duration_ms")
    op.drop_column("agent_runs", "total_cost_usd")
