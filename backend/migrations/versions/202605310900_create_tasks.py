"""create tasks table

Revision ID: 202605310900
Revises: 202605300900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202605310900"
down_revision = "202605300900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "change_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("task_key", sa.String(200), nullable=False),
        sa.Column("title", sa.String(500), nullable=True),
        sa.Column(
            "status",
            sa.String(30),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("phase", sa.String(20), nullable=True),
        sa.Column("priority", sa.String(10), nullable=True),
        sa.Column("owner_key", sa.String(100), nullable=True),
        sa.Column("estimated_hours", sa.Float, nullable=True),
        sa.Column(
            "affected_components",
            sa.JSON,
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "allowed_paths",
            sa.JSON,
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "depends_on",
            sa.JSON,
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "blocks",
            sa.JSON,
            nullable=False,
            server_default="[]",
        ),
        sa.Column("path", sa.Text, nullable=True),
        sa.Column("content", sa.Text, nullable=True),
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
        sa.CheckConstraint(
            "status IN ('draft', 'ready', 'in_progress', 'review', 'done', 'cancelled')",
            name="ck_tasks_status",
        ),
        sa.CheckConstraint(
            "priority IS NULL OR priority IN ('P0', 'P1', 'P2', 'P3')",
            name="ck_tasks_priority",
        ),
    )
    op.create_index(
        "ux_tasks_change_key", "tasks", ["change_id", "task_key"], unique=True
    )
    op.create_index(
        "ix_tasks_workspace", "tasks", ["workspace_id", "status"]
    )


def downgrade() -> None:
    op.drop_index("ix_tasks_workspace", table_name="tasks")
    op.drop_index("ux_tasks_change_key", table_name="tasks")
    op.drop_table("tasks")
