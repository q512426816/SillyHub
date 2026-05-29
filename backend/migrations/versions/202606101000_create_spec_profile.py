"""create spec_profile_manifests and spec_conflicts

Revision ID: 202606101000
Revises: 202606100900
Create Date: 2026-06-10 10:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "202606101000"
down_revision: str | None = "202606100900"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "spec_profile_manifests",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("source_path", sa.Text(), nullable=False),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column("manifest_json", sa.Text(), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("TRUE"),
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_spec_profile_manifests_is_active",
        "spec_profile_manifests",
        ["is_active"],
        unique=False,
    )

    op.create_table(
        "spec_conflicts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("change_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("stage", sa.String(length=64), nullable=False),
        sa.Column("conflict_type", sa.String(length=32), nullable=False),
        sa.Column("details_json", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'open'"),
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_spec_conflicts_workspace_id",
        "spec_conflicts",
        ["workspace_id"],
        unique=False,
    )
    op.create_index(
        "ix_spec_conflicts_status",
        "spec_conflicts",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_spec_conflicts_stage",
        "spec_conflicts",
        ["stage"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_spec_conflicts_stage", table_name="spec_conflicts")
    op.drop_index("ix_spec_conflicts_status", table_name="spec_conflicts")
    op.drop_index("ix_spec_conflicts_workspace_id", table_name="spec_conflicts")
    op.drop_table("spec_conflicts")

    op.drop_index(
        "ix_spec_profile_manifests_is_active",
        table_name="spec_profile_manifests",
    )
    op.drop_table("spec_profile_manifests")
