"""Add human_gate column to change table + migrate old stages.

Revision ID: 202606220900
Revises: 202606210900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606220900"
down_revision = "202606210900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "changes",
        sa.Column(
            "human_gate",
            sa.String(50),
            server_default="none",
            nullable=False,
        ),
    )

    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE changes SET current_stage = 'verify', human_gate = 'blocked' "
            "WHERE current_stage = 'rework_required'"
        ),
    )
    conn.execute(
        sa.text(
            "UPDATE changes SET current_stage = 'verify', human_gate = 'need_archive_confirm' "
            "WHERE current_stage = 'accepted'"
        ),
    )


def downgrade() -> None:
    op.drop_column("changes", "human_gate")
