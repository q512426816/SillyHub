"""create scan_documents table

Revision ID: 202605290900
Revises: 202605280900
Create Date: 2026-05-29 09:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "202605290900"
down_revision: str | None = "202605280900"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scan_documents",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("component_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("doc_type", sa.String(length=30), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column(
            "exists",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("last_modified_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["component_id"], ["project_components.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ux_scan_docs_component_type",
        "scan_documents",
        ["component_id", "doc_type"],
        unique=True,
    )
    op.create_index(
        "ix_scan_docs_workspace",
        "scan_documents",
        ["workspace_id"],
    )
    op.create_index(
        "ix_scan_docs_component",
        "scan_documents",
        ["component_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_scan_docs_component", table_name="scan_documents")
    op.drop_index("ix_scan_docs_workspace", table_name="scan_documents")
    op.drop_index("ux_scan_docs_component_type", table_name="scan_documents")
    op.drop_table("scan_documents")
