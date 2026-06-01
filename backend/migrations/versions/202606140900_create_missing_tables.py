"""Create missing tables: releases, release_approvals, incidents, postmortems,
tool_operation_logs, change_reviews, audit_logs, scan_documents.

These tables have model definitions but were never physically created because
the database was stamped to 202606130900 without running the intermediate
migrations that define them.

Revision ID: 202606140900
Revises: 202606130900
Create Date: 2026-06-14 09:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202606140900"
down_revision: str | None = "202606130900"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── 1. releases ──────────────────────────────────────────────────────
    op.create_table(
        "releases",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.String(50), nullable=False),
        sa.Column("title", sa.String(500), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="draft"),
        sa.Column(
            "target_environment",
            sa.String(30),
            nullable=False,
            server_default="staging",
        ),
        sa.Column("change_ids", sa.JSON, nullable=False, server_default="[]"),
        sa.Column("deploy_policy", sa.JSON, nullable=True),
        sa.Column("pre_check_result", sa.Text, nullable=True),
        sa.Column("post_check_result", sa.Text, nullable=True),
        sa.Column("deploy_output", sa.Text, nullable=True),
        sa.Column(
            "creator_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("deployed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rolled_back_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        if_not_exists=True,
    )
    op.create_index(
        "ix_releases_workspace_status",
        "releases",
        ["workspace_id", "status"],
        if_not_exists=True,
    )

    # ── 2. release_approvals ────────────────────────────────────────────
    op.create_table(
        "release_approvals",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "release_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("releases.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "approver_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("verdict", sa.String(20), nullable=False),
        sa.Column("comment", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        if_not_exists=True,
    )
    op.create_index(
        "ux_release_approvals_release_user",
        "release_approvals",
        ["release_id", "approver_id"],
        unique=True,
        if_not_exists=True,
    )

    # ── 3. incidents ────────────────────────────────────────────────────
    op.create_table(
        "incidents",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False, server_default="medium"),
        sa.Column("status", sa.String(30), nullable=False, server_default="open"),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("root_cause", sa.Text, nullable=True),
        sa.Column("resolution", sa.Text, nullable=True),
        sa.Column("affected_components", sa.JSON, nullable=False, server_default="[]"),
        sa.Column(
            "reporter_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "resolved_by",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "release_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("releases.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        if_not_exists=True,
    )
    op.create_index(
        "ix_incidents_workspace_status",
        "incidents",
        ["workspace_id", "status"],
        if_not_exists=True,
    )

    # ── 4. postmortems ──────────────────────────────────────────────────
    op.create_table(
        "postmortems",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "incident_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("incidents.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("timeline", sa.Text, nullable=True),
        sa.Column("impact", sa.Text, nullable=True),
        sa.Column("root_cause_analysis", sa.Text, nullable=True),
        sa.Column("action_items", sa.JSON, nullable=False, server_default="[]"),
        sa.Column("lessons_learned", sa.Text, nullable=True),
        sa.Column(
            "author_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        if_not_exists=True,
    )

    # ── 5. tool_operation_logs ──────────────────────────────────────────
    op.create_table(
        "tool_operation_logs",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "lease_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("worktree_leases.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tool_type", sa.String(30), nullable=False),
        sa.Column("params_json", sa.Text, nullable=True),
        sa.Column("result_code", sa.Integer, nullable=False),
        sa.Column("redacted_output", sa.Text, nullable=True),
        sa.Column(
            "timestamp",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.now(),
        ),
        if_not_exists=True,
    )
    op.create_index(
        "ix_tool_op_lease",
        "tool_operation_logs",
        ["lease_id", "timestamp"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_tool_op_workspace",
        "tool_operation_logs",
        ["workspace_id", "timestamp"],
        if_not_exists=True,
    )

    # ── 6. change_reviews ───────────────────────────────────────────────
    op.create_table(
        "change_reviews",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "change_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reviewer_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("verdict", sa.String(20), nullable=False),
        sa.Column("comment", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        if_not_exists=True,
    )
    op.create_index(
        "ix_change_reviews_change",
        "change_reviews",
        ["change_id"],
        if_not_exists=True,
    )

    # ── 7. audit_logs ───────────────────────────────────────────────────
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "actor_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=False),
        sa.Column("resource_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("details_json", sa.Text, nullable=True),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        if_not_exists=True,
    )
    op.create_index(
        "ix_audit_workspace_ts",
        "audit_logs",
        ["workspace_id", "timestamp"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_audit_resource",
        "audit_logs",
        ["resource_type", "resource_id"],
        if_not_exists=True,
    )

    # ── 8. scan_documents ───────────────────────────────────────────────
    # Uses the post-migration-202606130900 schema (workspace_id only, no component_id).
    op.create_table(
        "scan_documents",
        sa.Column(
            "id",
            sa.Uuid(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("doc_type", sa.String(30), nullable=False),
        sa.Column("path", sa.Text, nullable=False),
        sa.Column("title", sa.String(500), nullable=True),
        sa.Column(
            "exists",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("content", sa.Text, nullable=True),
        sa.Column("last_modified_at", sa.DateTime(timezone=True), nullable=True),
        if_not_exists=True,
    )
    op.create_index(
        "ux_scan_docs_workspace_type",
        "scan_documents",
        ["workspace_id", "doc_type"],
        unique=True,
        if_not_exists=True,
    )
    op.create_index(
        "ix_scan_docs_workspace",
        "scan_documents",
        ["workspace_id"],
        if_not_exists=True,
    )


def downgrade() -> None:
    # Drop in reverse order to respect FK constraints
    op.drop_index("ix_scan_docs_workspace", table_name="scan_documents")
    op.drop_index("ux_scan_docs_workspace_type", table_name="scan_documents")
    op.drop_table("scan_documents")

    op.drop_index("ix_audit_resource", table_name="audit_logs")
    op.drop_index("ix_audit_workspace_ts", table_name="audit_logs")
    op.drop_table("audit_logs")

    op.drop_index("ix_change_reviews_change", table_name="change_reviews")
    op.drop_table("change_reviews")

    op.drop_index("ix_tool_op_workspace", table_name="tool_operation_logs")
    op.drop_index("ix_tool_op_lease", table_name="tool_operation_logs")
    op.drop_table("tool_operation_logs")

    op.drop_table("postmortems")

    op.drop_index("ix_incidents_workspace_status", table_name="incidents")
    op.drop_table("incidents")

    op.drop_index("ux_release_approvals_release_user", table_name="release_approvals")
    op.drop_table("release_approvals")

    op.drop_index("ix_releases_workspace_status", table_name="releases")
    op.drop_table("releases")
