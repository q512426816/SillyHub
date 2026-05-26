"""create project_components & component_relations

Revision ID: 202605270900
Revises: 202605261000
Create Date: 2026-05-27 09:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "202605270900"
down_revision: str | None = "202605261000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
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
        sa.ForeignKeyConstraint(
            ["source_component_id"], ["project_components.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["target_component_id"], ["project_components.id"], ondelete="CASCADE"
        ),
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


def downgrade() -> None:
    op.drop_index("ix_relations_workspace", table_name="component_relations")
    op.drop_index("ux_relations_triplet", table_name="component_relations")
    op.drop_table("component_relations")
    op.drop_index("ix_components_workspace", table_name="project_components")
    op.drop_index("ux_components_workspace_key", table_name="project_components")
    op.drop_table("project_components")
