"""create daemon_runtimes and daemon_task_leases tables

Revision ID: 202606270900
Revises: 202606260900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606270900"
down_revision = "202606260900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "daemon_runtimes",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("provider", sa.String(50), nullable=True),
        sa.Column("version", sa.String(50), nullable=True),
        sa.Column("os", sa.String(50), nullable=True),
        sa.Column("arch", sa.String(50), nullable=True),
        sa.Column("status", sa.String(20), nullable=True),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("capabilities", sa.JSON, nullable=True),
        sa.Column("metadata", sa.JSON, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("idx_daemon_runtimes_user_id", "daemon_runtimes", ["user_id"])
    op.create_index("idx_daemon_runtimes_status", "daemon_runtimes", ["status"])

    op.create_table(
        "daemon_task_leases",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "runtime_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("daemon_runtimes.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "agent_run_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(20), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_number", sa.Integer, nullable=True, server_default="1"),
        sa.Column("metadata", sa.JSON, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "idx_daemon_task_leases_runtime_id",
        "daemon_task_leases",
        ["runtime_id"],
    )
    op.create_index(
        "idx_daemon_task_leases_status",
        "daemon_task_leases",
        ["status"],
    )
    op.create_index(
        "idx_daemon_task_leases_agent_run_id",
        "daemon_task_leases",
        ["agent_run_id"],
    )
    op.create_index(
        "idx_daemon_task_leases_expires_at",
        "daemon_task_leases",
        ["lease_expires_at"],
        postgresql_where=sa.text("status IN ('claimed', 'pending')"),
    )


def downgrade() -> None:
    op.drop_index("idx_daemon_task_leases_expires_at", table_name="daemon_task_leases")
    op.drop_index("idx_daemon_task_leases_agent_run_id", table_name="daemon_task_leases")
    op.drop_index("idx_daemon_task_leases_status", table_name="daemon_task_leases")
    op.drop_index("idx_daemon_task_leases_runtime_id", table_name="daemon_task_leases")
    op.drop_table("daemon_task_leases")

    op.drop_index("idx_daemon_runtimes_status", table_name="daemon_runtimes")
    op.drop_index("idx_daemon_runtimes_user_id", table_name="daemon_runtimes")
    op.drop_table("daemon_runtimes")
