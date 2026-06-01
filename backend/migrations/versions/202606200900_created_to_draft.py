"""Map remaining legacy 'created' stage to 'draft'.

Revision ID: 202606200900
Revises: 202606190900
"""

from __future__ import annotations

from alembic import op

revision = "202606200900"
down_revision = "202606190900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Map 'created' → 'draft' for current_stage and status (idempotent)."""
    conn = op.get_bind()
    conn.execute(
        __import__("sqlalchemy").text(
            "UPDATE changes SET current_stage = 'draft' WHERE current_stage = 'created'"
        ),
    )
    conn.execute(
        __import__("sqlalchemy").text(
            "UPDATE changes SET status = 'draft' WHERE status = 'created'"
        ),
    )


def downgrade() -> None:
    pass
