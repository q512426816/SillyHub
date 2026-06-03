"""Change scan_documents unique index from (workspace_id, doc_type) to (workspace_id, path)

Revision ID: 202606210900
Revises: 202606200900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606210900"
down_revision = "202606200900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ux_scan_docs_workspace_type", table_name="scan_documents")
    op.alter_column(
        "scan_documents",
        "doc_type",
        type_=sa.String(100),
        existing_type=sa.String(30),
    )
    op.create_index(
        "ux_scan_docs_workspace_path",
        "scan_documents",
        ["workspace_id", "path"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ux_scan_docs_workspace_path", table_name="scan_documents")
    op.alter_column(
        "scan_documents",
        "doc_type",
        type_=sa.String(30),
        existing_type=sa.String(100),
    )
    op.create_index(
        "ux_scan_docs_workspace_type",
        "scan_documents",
        ["workspace_id", "doc_type"],
        unique=True,
    )
