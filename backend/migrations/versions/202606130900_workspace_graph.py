"""Workspace graph: absorb component metadata, add relations and M:N tables.

Revision ID: 202606130900
Revises: 202606120900
Create Date: 2026-06-13 09:00:00.000000

Task-01: Workspace absorbs Component metadata fields, WorkspaceRelation,
ChangeWorkspace, TaskWorkspace, AgentRunWorkspace models.
Drops project_components and component_relations tables.
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "202606130900"
down_revision: str | None = "202606120900"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add component metadata columns to workspaces
    op.add_column("workspaces", sa.Column("component_key", sa.String(length=100), nullable=True))
    op.add_column("workspaces", sa.Column("type", sa.String(length=50), nullable=True))
    op.add_column("workspaces", sa.Column("role", sa.String(length=100), nullable=True))
    op.add_column("workspaces", sa.Column("repo_url", sa.Text(), nullable=True))
    op.add_column(
        "workspaces",
        sa.Column(
            "default_branch", sa.String(length=100), nullable=True, server_default=sa.text("'main'")
        ),
    )
    op.add_column(
        "workspaces",
        sa.Column(
            "tech_stack",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column("workspaces", sa.Column("build_command", sa.Text(), nullable=True))
    op.add_column("workspaces", sa.Column("test_command", sa.Text(), nullable=True))
    op.add_column("workspaces", sa.Column("source_yaml_path", sa.Text(), nullable=True))

    # 2. Drop sillyspec_path column
    op.drop_column("workspaces", "sillyspec_path")

    # 3. Create workspace_relations table
    op.create_table(
        "workspace_relations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("relation_type", sa.String(length=50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["source_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.CheckConstraint("source_id != target_id", name="ck_workspace_relations_no_self_loop"),
    )
    op.create_index(
        "ux_workspace_relations_triplet",
        "workspace_relations",
        ["source_id", "target_id", "relation_type"],
        unique=True,
    )
    op.create_index(
        "ix_workspace_relations_source",
        "workspace_relations",
        ["source_id"],
    )
    op.create_index(
        "ix_workspace_relations_target",
        "workspace_relations",
        ["target_id"],
    )

    # 4. Create change_workspaces table
    op.create_table(
        "change_workspaces",
        sa.Column("change_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(length=30), nullable=True),
        sa.PrimaryKeyConstraint("change_id", "workspace_id"),
        sa.ForeignKeyConstraint(["change_id"], ["changes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_change_workspaces_workspace",
        "change_workspaces",
        ["workspace_id"],
    )

    # 5. Create task_workspaces table
    op.create_table(
        "task_workspaces",
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(length=30), nullable=True),
        sa.PrimaryKeyConstraint("task_id", "workspace_id"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_task_workspaces_workspace",
        "task_workspaces",
        ["workspace_id"],
    )

    # 6. Create agent_run_workspaces table
    op.create_table(
        "agent_run_workspaces",
        sa.Column("agent_run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.PrimaryKeyConstraint("agent_run_id", "workspace_id"),
        sa.ForeignKeyConstraint(["agent_run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_agent_run_workspaces_workspace",
        "agent_run_workspaces",
        ["workspace_id"],
    )

    # 7. Detach FKs that reference project_components
    # 7a. scan_documents: drop component_id FK, indexes, and column
    op.drop_constraint("scan_documents_component_id_fkey", "scan_documents", type_="foreignkey")
    op.drop_index("ux_scan_docs_component_type", table_name="scan_documents")
    op.drop_index("ix_scan_docs_component", table_name="scan_documents")
    op.drop_column("scan_documents", "component_id")

    # 7b. worktree_leases: change component_id FK from project_components → workspaces
    op.drop_constraint("worktree_leases_component_id_fkey", "worktree_leases", type_="foreignkey")
    op.create_foreign_key(
        "worktree_leases_component_id_fkey",
        "worktree_leases",
        "workspaces",
        ["component_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # 8. Drop component_relations table (must come before project_components)
    op.drop_index("ix_relations_workspace", table_name="component_relations")
    op.drop_index("ux_relations_triplet", table_name="component_relations")
    op.drop_table("component_relations")

    # 9. Drop project_components table
    op.drop_index("ix_components_workspace", table_name="project_components")
    op.drop_index("ux_components_workspace_key", table_name="project_components")
    op.drop_table("project_components")


def downgrade() -> None:
    # WARN: data loss — component metadata in workspaces will be dropped

    # 9. Rebuild project_components table
    op.create_table(
        "project_components",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("component_key", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("type", sa.String(length=50), nullable=True),
        sa.Column("role", sa.String(length=100), nullable=True),
        sa.Column("path", sa.Text(), nullable=True),
        sa.Column("repo_url", sa.Text(), nullable=True),
        sa.Column(
            "default_branch",
            sa.String(length=100),
            nullable=True,
            server_default=sa.text("'main'"),
        ),
        sa.Column(
            "tech_stack",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("build_command", sa.Text(), nullable=True),
        sa.Column("test_command", sa.Text(), nullable=True),
        sa.Column("source_yaml_path", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
        sa.Column(
            "extra",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ux_components_workspace_key",
        "project_components",
        ["workspace_id", "component_key"],
        unique=True,
    )
    op.create_index(
        "ix_components_workspace",
        "project_components",
        ["workspace_id"],
    )

    # 8. Rebuild component_relations table
    op.create_table(
        "component_relations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_component_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("target_component_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("relation_type", sa.String(length=50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ux_relations_triplet",
        "component_relations",
        ["source_component_id", "target_component_id", "relation_type"],
        unique=True,
    )
    op.create_index(
        "ix_relations_workspace",
        "component_relations",
        ["workspace_id"],
    )

    # 7b. Restore worktree_leases.component_id FK → project_components
    op.drop_constraint("worktree_leases_component_id_fkey", "worktree_leases", type_="foreignkey")
    op.create_foreign_key(
        "worktree_leases_component_id_fkey",
        "worktree_leases",
        "project_components",
        ["component_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # 7a. Restore scan_documents.component_id column and FK
    op.add_column(
        "scan_documents",
        sa.Column("component_id", postgresql.UUID(as_uuid=True), nullable=False),
    )
    op.create_foreign_key(
        "scan_documents_component_id_fkey",
        "scan_documents",
        "project_components",
        ["component_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_scan_docs_component",
        "scan_documents",
        ["component_id"],
    )
    op.create_index(
        "ux_scan_docs_component_type",
        "scan_documents",
        ["component_id", "doc_type"],
        unique=True,
    )

    # 6. Drop agent_run_workspaces
    op.drop_index("ix_agent_run_workspaces_workspace", table_name="agent_run_workspaces")
    op.drop_table("agent_run_workspaces")

    # 5. Drop task_workspaces
    op.drop_index("ix_task_workspaces_workspace", table_name="task_workspaces")
    op.drop_table("task_workspaces")

    # 4. Drop change_workspaces
    op.drop_index("ix_change_workspaces_workspace", table_name="change_workspaces")
    op.drop_table("change_workspaces")

    # 3. Drop workspace_relations
    op.drop_index("ix_workspace_relations_target", table_name="workspace_relations")
    op.drop_index("ix_workspace_relations_source", table_name="workspace_relations")
    op.drop_index("ux_workspace_relations_triplet", table_name="workspace_relations")
    op.drop_table("workspace_relations")

    # 2. Restore sillyspec_path column
    op.add_column(
        "workspaces",
        sa.Column("sillyspec_path", sa.Text(), nullable=False, server_default=sa.text("''")),
    )

    # 1. Drop component metadata columns from workspaces
    op.drop_column("workspaces", "source_yaml_path")
    op.drop_column("workspaces", "test_command")
    op.drop_column("workspaces", "build_command")
    op.drop_column("workspaces", "tech_stack")
    op.drop_column("workspaces", "default_branch")
    op.drop_column("workspaces", "repo_url")
    op.drop_column("workspaces", "role")
    op.drop_column("workspaces", "type")
    op.drop_column("workspaces", "component_key")
