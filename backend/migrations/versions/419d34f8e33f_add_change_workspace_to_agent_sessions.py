"""add_change_workspace_to_agent_sessions

Revision ID: 419d34f8e33f
Revises: 20260707_custom_skills
Create Date: 2026-07-09 18:56:50.948887

Bind interactive AgentSession rows to a change and workspace (D-001@v1 /
D-003@v1 of change 2026-07-09-change-detail-session). Both columns are
nullable so pre-existing runtime-level sessions stay regression-free; the
foreign keys use ON DELETE SET NULL so deleting a change/workspace does not
cascade-remove session history.

author: qinyi
created_at: 2026-07-09 18:56:50
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "419d34f8e33f"
down_revision: str | None = "20260707_custom_skills"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agent_sessions", sa.Column("change_id", sa.Uuid(), nullable=True))
    op.add_column("agent_sessions", sa.Column("workspace_id", sa.Uuid(), nullable=True))
    op.create_index("ix_agent_sessions_change_id", "agent_sessions", ["change_id"], unique=False)
    op.create_foreign_key(
        "fk_agent_sessions_change_id_changes",
        "agent_sessions",
        "changes",
        ["change_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_agent_sessions_workspace_id_workspaces",
        "agent_sessions",
        "workspaces",
        ["workspace_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_agent_sessions_workspace_id_workspaces", "agent_sessions", type_="foreignkey"
    )
    op.drop_constraint("fk_agent_sessions_change_id_changes", "agent_sessions", type_="foreignkey")
    op.drop_index("ix_agent_sessions_change_id", table_name="agent_sessions")
    op.drop_column("agent_sessions", "workspace_id")
    op.drop_column("agent_sessions", "change_id")
