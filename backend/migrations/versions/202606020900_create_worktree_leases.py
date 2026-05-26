"""create worktree_leases table

Revision ID: 202606020900
Revises: 202606010900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606020900"
down_revision = "202606010900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "worktree_leases",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "component_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("project_components.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "change_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "task_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("run_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("git_identity_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("path", sa.Text, nullable=False, unique=True),
        sa.Column("branch_name", sa.String(500), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="locked"),
        sa.Column("locked_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("released_at", sa.DateTime, nullable=True),
        sa.Column("expires_at", sa.DateTime, nullable=False),
        sa.CheckConstraint(
            "status IN ('locked', 'released', 'expired')",
            name="ck_worktree_leases_status",
        ),
    )
    op.create_index("ix_worktree_active", "worktree_leases", ["task_id", "status"])
    op.create_index("ix_worktree_expires", "worktree_leases", ["status", "expires_at"])


def downgrade() -> None:
    op.drop_index("ix_worktree_expires", table_name="worktree_leases")
    op.drop_index("ix_worktree_active", table_name="worktree_leases")
    op.drop_table("worktree_leases")
