"""add approval / stage fields to changes table

Revision ID: 202605311700
Revises: 202606160900
Create Date: 2026-05-31 17:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202605311700"
down_revision: str | None = "202606160900"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "changes",
        sa.Column("current_stage", sa.String(), nullable=True),
    )
    op.add_column(
        "changes",
        sa.Column("stages", sa.JSON(), nullable=True),
    )
    op.add_column(
        "changes",
        sa.Column(
            "approval_status",
            sa.String(),
            nullable=False,
            server_default="not_required",
        ),
    )
    op.add_column(
        "changes",
        sa.Column("approved_by", sa.String(), nullable=True),
    )
    op.add_column(
        "changes",
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "changes",
        sa.Column("rejection_reason", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("changes", "rejection_reason")
    op.drop_column("changes", "approved_at")
    op.drop_column("changes", "approved_by")
    op.drop_column("changes", "approval_status")
    op.drop_column("changes", "stages")
    op.drop_column("changes", "current_stage")
