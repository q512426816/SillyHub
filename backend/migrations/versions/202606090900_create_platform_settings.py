"""create platform_settings table

Revision ID: 202606090900
Revises: 202606080900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606090900"
down_revision = "202606080900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_settings",
        sa.Column("key", sa.String(100), primary_key=True, nullable=False),
        sa.Column("value", sa.String, nullable=False),
        sa.Column("updated_by", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("platform_settings")
