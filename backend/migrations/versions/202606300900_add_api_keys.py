"""create api_keys table

Revision ID: 202606300900
Revises: 202606290900

Adds the ``api_keys`` table backing the daemon long-lived credential flow
(change ``daemon-api-key`` task-01). Stores ``bcrypt(plaintext)`` in
``key_hash`` plus a non-sensitive ``key_prefix`` for UI display.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606300900"
down_revision = "202606290900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "api_keys",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("key_prefix", sa.String(16), nullable=False),
        sa.Column("key_hash", sa.String(255), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_api_keys_user_revoked",
        "api_keys",
        ["user_id", "revoked_at"],
    )
    op.create_index(
        "ix_api_keys_prefix",
        "api_keys",
        ["key_prefix"],
    )


def downgrade() -> None:
    op.drop_index("ix_api_keys_prefix", table_name="api_keys")
    op.drop_index("ix_api_keys_user_revoked", table_name="api_keys")
    op.drop_table("api_keys")
