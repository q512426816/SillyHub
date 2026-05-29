"""create git_operation_logs table

Revision ID: 202606030900
Revises: 202606020900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606030900"
down_revision = "202606020900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "git_operation_logs",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "lease_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("worktree_leases.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("operation", sa.String(50), nullable=False),
        sa.Column("args_json", sa.Text, nullable=True),
        sa.Column("result_code", sa.Integer, nullable=False),
        sa.Column("redacted_output", sa.Text, nullable=True),
        sa.Column("timestamp", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_git_op_lease", "git_operation_logs", ["lease_id", "timestamp"])
    op.create_index("ix_git_op_workspace", "git_operation_logs", ["workspace_id", "timestamp"])


def downgrade() -> None:
    op.drop_index("ix_git_op_workspace", table_name="git_operation_logs")
    op.drop_index("ix_git_op_lease", table_name="git_operation_logs")
    op.drop_table("git_operation_logs")
