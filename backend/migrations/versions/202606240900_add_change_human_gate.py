"""Add human_gate column to change table + migrate old stages.

Revision ID: 202606240900
Revises: 202606230900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606240900"
down_revision = "202606230900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    # Idempotent: column may exist from a prior partial migration attempt.
    conn.execute(
        sa.text(
            """
            DO $$ BEGIN
                ALTER TABLE changes
                    ADD COLUMN human_gate VARCHAR(50) DEFAULT 'none' NOT NULL;
            EXCEPTION
                WHEN duplicate_column THEN NULL;
            END $$;
            """
        )
    )

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
