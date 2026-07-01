"""collaborative workspace: per-member binding + doc source tracking + conflict history

Revision ID: 202607011200
Revises: 202606301500
Create Date: 2026-07-01 12:00:00

Change 2026-07-01-collaborative-workspace (方案 A): per-member bindings.

- new table ``workspace_member_runtimes`` (PK workspace_id+user_id)
- new table ``scan_doc_conflict_history`` (archived overwritten versions)
- ``scan_documents`` += source_member_id/source_runtime_id (FK SET NULL)
  + source_synced_at + source_mtime + content_hash
- backfill: owner binding + workspace_owner role for existing workspaces
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607011200"
down_revision = "202606301500"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. workspace_member_runtimes — per-member daemon+path binding
    op.create_table(
        "workspace_member_runtimes",
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "runtime_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("daemon_runtimes.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("root_path", sa.String(), nullable=False),
        sa.Column("path_source", sa.String(length=20), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_scan_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_wmr_workspace", "workspace_member_runtimes", ["workspace_id"])
    op.create_index("ix_wmr_runtime", "workspace_member_runtimes", ["runtime_id"])

    # 2. scan_doc_conflict_history — archived overwritten versions (D-001@V1)
    op.create_table(
        "scan_doc_conflict_history",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("old_content", sa.Text(), nullable=True),
        sa.Column("old_source_member_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("old_source_runtime_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("old_mtime", sa.DateTime(timezone=True), nullable=True),
        sa.Column("new_source_member_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("new_mtime", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_scan_doc_conflict_ws_path",
        "scan_doc_conflict_history",
        ["workspace_id", "path"],
    )

    # 3. scan_documents += source tracking columns (Grill 点 5: SET NULL)
    op.add_column(
        "scan_documents",
        sa.Column(
            "source_member_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "scan_documents",
        sa.Column(
            "source_runtime_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("daemon_runtimes.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "scan_documents",
        sa.Column("source_synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "scan_documents",
        sa.Column("source_mtime", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "scan_documents",
        sa.Column("content_hash", sa.String(length=64), nullable=True),
    )

    # 4. Backfill owner binding + workspace_owner role for existing workspaces.
    op.execute(
        """
        INSERT INTO workspace_member_runtimes
            (workspace_id, user_id, runtime_id, root_path, path_source, created_at, updated_at)
        SELECT w.id, w.created_by, w.daemon_runtime_id, w.root_path, w.path_source, now(), now()
        FROM workspaces w
        WHERE w.created_by IS NOT NULL
        ON CONFLICT (workspace_id, user_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO user_workspace_roles (user_id, workspace_id, role_id, granted_at)
        SELECT w.created_by, w.id, r.id, now()
        FROM workspaces w
        CROSS JOIN roles r
        WHERE r.key = 'workspace_owner' AND w.created_by IS NOT NULL
        ON CONFLICT (user_id, workspace_id, role_id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_column("scan_documents", "content_hash")
    op.drop_column("scan_documents", "source_mtime")
    op.drop_column("scan_documents", "source_synced_at")
    op.drop_column("scan_documents", "source_runtime_id")
    op.drop_column("scan_documents", "source_member_id")
    op.drop_index("ix_scan_doc_conflict_ws_path", table_name="scan_doc_conflict_history")
    op.drop_table("scan_doc_conflict_history")
    op.drop_index("ix_wmr_runtime", table_name="workspace_member_runtimes")
    op.drop_index("ix_wmr_workspace", table_name="workspace_member_runtimes")
    op.drop_table("workspace_member_runtimes")
