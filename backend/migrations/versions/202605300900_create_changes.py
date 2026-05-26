"""create changes and change_documents tables

Revision ID: 202605300900
Revises: 202605290900
Create Date: 2026-05-30 09:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "202605300900"
down_revision: str | None = "202605290900"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "changes",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("change_key", sa.String(length=200), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column(
            "status",
            sa.String(length=30),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("location", sa.String(length=20), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column(
            "affected_components",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("change_type", sa.String(length=50), nullable=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("archived_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.CheckConstraint(
            "location IN ('active', 'archive')",
            name="ck_changes_location",
        ),
        sa.UniqueConstraint("workspace_id", "change_key", name="ux_changes_workspace_key"),
    )
    op.create_index(
        "ix_changes_workspace",
        "changes",
        ["workspace_id", "location", "status"],
    )

    op.create_table(
        "change_documents",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("change_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("doc_type", sa.String(length=30), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column(
            "exists",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("status", sa.String(length=30), nullable=True),
        sa.Column("last_modified_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["change_id"], ["changes.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "change_id", "doc_type", "path", name="ux_change_docs_type_path"
        ),
    )
    op.create_index(
        "ix_change_docs_change",
        "change_documents",
        ["change_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_change_docs_change", table_name="change_documents")
    op.drop_table("change_documents")
    op.drop_index("ix_changes_workspace", table_name="changes")
    op.drop_table("changes")
