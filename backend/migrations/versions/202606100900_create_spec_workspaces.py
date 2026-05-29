"""create spec_workspaces table

Revision ID: 202606100900
Revises: 202606090900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606100900"
down_revision = "202606090900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "spec_workspaces",
        sa.Column(
            "id",
            sa.Uuid(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("spec_root", sa.Text(), nullable=False),
        sa.Column(
            "strategy",
            sa.String(30),
            nullable=False,
            server_default=sa.text("'platform-managed'"),
        ),
        sa.Column("repo_sillyspec_path", sa.Text(), nullable=True),
        sa.Column(
            "profile_version",
            sa.String(50),
            nullable=False,
            server_default=sa.text("'0.1.0'"),
        ),
        sa.Column(
            "sync_status",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'clean'"),
        ),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_spec_workspaces_workspace_id",
        "spec_workspaces",
        ["workspace_id"],
        unique=True,
    )
    op.create_index(
        "ix_spec_workspaces_strategy",
        "spec_workspaces",
        ["strategy"],
        unique=False,
    )
    op.create_index(
        "ix_spec_workspaces_sync_status",
        "spec_workspaces",
        ["sync_status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_spec_workspaces_sync_status", table_name="spec_workspaces")
    op.drop_index("ix_spec_workspaces_strategy", table_name="spec_workspaces")
    op.drop_index("ix_spec_workspaces_workspace_id", table_name="spec_workspaces")
    op.drop_table("spec_workspaces")
