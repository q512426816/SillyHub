"""add tool_policies table + agent_runs FK + widen tool_type

Revision ID: 202606160900
Revises: 4d9236aa3abb
Create Date: 2026-06-16 09:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202606160900"
down_revision: str | None = "4d9236aa3abb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── 1. Create tool_policies table ──
    op.create_table(
        "tool_policies",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column(
            "allowed_tools",
            sa.JSON(),
            nullable=False,
            server_default='["file_read","file_write","file_list","file_search","shell_exec","run_tests","http_get"]',
        ),
        sa.Column(
            "blocked_commands",
            sa.JSON(),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "allowed_paths",
            sa.JSON(),
            nullable=False,
            server_default='["."]',
        ),
        sa.Column(
            "allowed_domains",
            sa.JSON(),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "max_timeout",
            sa.Integer(),
            nullable=False,
            server_default="30",
        ),
        sa.Column(
            "max_output_size",
            sa.Integer(),
            nullable=False,
            server_default="64000",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
    )

    op.create_index(
        "ux_tool_policy_workspace_name",
        "tool_policies",
        ["workspace_id", "name"],
        unique=True,
    )
    op.create_index(
        "ix_tool_policy_workspace",
        "tool_policies",
        ["workspace_id"],
    )

    # ── 2. Add agent_runs.tool_policy_id FK ──
    op.add_column(
        "agent_runs",
        sa.Column("tool_policy_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_agent_runs_tool_policy_id",
        "agent_runs",
        "tool_policies",
        ["tool_policy_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # ── 3. Widen tool_operation_logs.tool_type from VARCHAR(30) to VARCHAR(50) ──
    op.alter_column(
        "tool_operation_logs",
        "tool_type",
        existing_type=sa.String(30),
        type_=sa.String(50),
        existing_nullable=False,
    )


def downgrade() -> None:
    # ── 3. Narrow tool_type back to VARCHAR(30) ──
    op.alter_column(
        "tool_operation_logs",
        "tool_type",
        existing_type=sa.String(50),
        type_=sa.String(30),
        existing_nullable=False,
    )

    # ── 2. Drop agent_runs.tool_policy_id ──
    op.drop_constraint(
        "fk_agent_runs_tool_policy_id",
        "agent_runs",
        type_="foreignkey",
    )
    op.drop_column("agent_runs", "tool_policy_id")

    # ── 1. Drop tool_policies table ──
    op.drop_index("ix_tool_policy_workspace", table_name="tool_policies")
    op.drop_index("ux_tool_policy_workspace_name", table_name="tool_policies")
    op.drop_table("tool_policies")
