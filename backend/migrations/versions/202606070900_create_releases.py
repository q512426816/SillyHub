"""create releases and release_approvals tables

Revision ID: 202606070900
Revises: 202606060900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606070900"
down_revision = "202606060900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "releases",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.String(50), nullable=False),
        sa.Column("title", sa.String(500), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="draft"),
        sa.Column(
            "target_environment",
            sa.String(30),
            nullable=False,
            server_default="staging",
        ),
        sa.Column("change_ids", sa.JSON, nullable=False, server_default="[]"),
        sa.Column("deploy_policy", sa.JSON, nullable=True),
        sa.Column("pre_check_result", sa.Text, nullable=True),
        sa.Column("post_check_result", sa.Text, nullable=True),
        sa.Column("deploy_output", sa.Text, nullable=True),
        sa.Column(
            "creator_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("deployed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rolled_back_at", sa.DateTime(timezone=True), nullable=True),
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
        "ix_releases_workspace_status",
        "releases",
        ["workspace_id", "status"],
    )

    op.create_table(
        "release_approvals",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "release_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("releases.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "approver_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("verdict", sa.String(20), nullable=False),
        sa.Column("comment", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ux_release_approvals_release_user",
        "release_approvals",
        ["release_id", "approver_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ux_release_approvals_release_user", table_name="release_approvals")
    op.drop_table("release_approvals")
    op.drop_index("ix_releases_workspace_status", table_name="releases")
    op.drop_table("releases")
