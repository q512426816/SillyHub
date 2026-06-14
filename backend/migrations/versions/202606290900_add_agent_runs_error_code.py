"""add agent_runs.error_code column

Revision ID: 202606290900
Revises: 202606280900

Adds a nullable ``error_code`` column (VARCHAR(64)) to ``agent_runs`` storing a
machine-readable error code (e.g. ``no_online_daemon``) for failed runs. Backs
the ``NoOnlineDaemonError`` path introduced by change unified-agent-execution
(model ``AgentRun.error_code``, task-01).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606290900"
down_revision = "202606280900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_runs",
        sa.Column("error_code", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_runs", "error_code")
