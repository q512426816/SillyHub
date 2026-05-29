"""create agent_runs and agent_run_logs tables

Revision ID: 202606050900
Revises: 202606040900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606050900"
down_revision = "202606040900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_runs",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "task_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "lease_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("worktree_leases.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("agent_type", sa.String(30), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("exit_code", sa.Integer, nullable=True),
        sa.Column("output_redacted", sa.Text, nullable=True),
    )
    op.create_index("ix_agent_runs_task", "agent_runs", ["task_id"])
    op.create_index("ix_agent_runs_lease", "agent_runs", ["lease_id"])

    op.create_table(
        "agent_run_logs",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "run_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("channel", sa.String(20), nullable=False),
        sa.Column("content_redacted", sa.Text, nullable=True),
    )
    op.create_index("ix_agent_run_logs_run", "agent_run_logs", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_run_logs_run", table_name="agent_run_logs")
    op.drop_table("agent_run_logs")
    op.drop_index("ix_agent_runs_lease", table_name="agent_runs")
    op.drop_index("ix_agent_runs_task", table_name="agent_runs")
    op.drop_table("agent_runs")
