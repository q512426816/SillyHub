"""add change workflow feedback fields and fix current_stage data

Revision ID: 202606170900
Revises: 202605311700
Create Date: 2026-06-17 09:00:00.000000

Adds:
  - feedback_category (String(30), nullable) — feedback classification
  - feedback_text (Text, nullable) — feedback detailed content

Fixes:
  - current_stage: NULL → 'draft', 'created' → 'draft'
  - current_stage: adds server_default='draft'

WARNING: downgrade does NOT restore previous current_stage values.
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202606170900"
down_revision: str | None = "202605311700"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add feedback_category column
    op.add_column(
        "changes",
        sa.Column("feedback_category", sa.String(30), nullable=True),
    )

    # 2. Add feedback_text column
    op.add_column(
        "changes",
        sa.Column("feedback_text", sa.Text(), nullable=True),
    )

    # 3. Fix current_stage: NULL → 'draft'
    op.execute("""
        UPDATE changes
        SET current_stage = 'draft'
        WHERE current_stage IS NULL
    """)

    # 4. Fix current_stage: 'created' → 'draft'
    op.execute("""
        UPDATE changes
        SET current_stage = 'draft'
        WHERE current_stage = 'created'
    """)

    # 5. Add server_default='draft' to current_stage
    op.alter_column(
        "changes",
        "current_stage",
        server_default="draft",
    )


def downgrade() -> None:
    # Reverse order of upgrade
    op.alter_column(
        "changes",
        "current_stage",
        server_default=None,
    )
    op.drop_column("changes", "feedback_text")
    op.drop_column("changes", "feedback_category")
