"""add ref_workspace_id to workspace_linked_repos（2026-10-11-linked-repo-workspace-ref task-01）

- 可空 FK → workspaces.id（ondelete=SET NULL，防御性保留——平台为纯软删，实际读时降级，Grill X-001）
- 索引 ix_linked_repos_ref_ws

Revision ID: 20261011020000
Revises: 20261010190000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261011020000"
down_revision = "20261010190000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace_linked_repos",
        sa.Column(
            "ref_workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_linked_repos_ref_ws", "workspace_linked_repos", ["ref_workspace_id"])


def downgrade() -> None:
    op.drop_index("ix_linked_repos_ref_ws", table_name="workspace_linked_repos")
    op.drop_column("workspace_linked_repos", "ref_workspace_id")
