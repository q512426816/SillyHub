"""add change_id to agent_runs

Revision ID: 202606180900
Revises: 4d9236aa3abb
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606180900"
down_revision = "4d9236aa3abb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_runs",
        sa.Column(
            "change_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_agent_runs_change_id", "agent_runs", ["change_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_runs_change_id", table_name="agent_runs")
    op.drop_column("agent_runs", "change_id")
