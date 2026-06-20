"""multi-agent orchestration domain models

Change: 2026-06-19-multi-agent-orchestration (Wave 1)

Introduces the multi-agent delegation domain:
- ``agent_missions``: aggregation root (intent metadata only; status is derived,
  NOT persisted — source of truth stays AgentRun + Lease).
- ``agent_run_dependencies``: DAG edges between AgentRuns (worker ordering).
- ``agent_artifacts``: structured Worker outputs (raw logs stay in agent_run_logs).
- ``agent_runs.{mission_id, parent_run_id, role, objective, attempt}``: link a Run
  into a Mission / parent / role.

All new agent_runs columns are nullable with server defaults, so existing single-
agent flows are unaffected. agent_missions is created before the agent_runs FK
so the reference resolves.

Revision ID: 202607060900
Revises: 202607050900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607060900"
down_revision = "202607050900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. agent_missions (created first — agent_runs.mission_id references it)
    op.create_table(
        "agent_missions",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "change_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("objective", sa.Text, nullable=False),
        sa.Column("constraints", sa.JSON, nullable=True),
        sa.Column("budget_tokens", sa.Integer, nullable=True),
        sa.Column("budget_usd", sa.Float, nullable=True),
        sa.Column(
            "created_by",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_agent_missions_workspace", "agent_missions", ["workspace_id"])
    op.create_index("ix_agent_missions_change", "agent_missions", ["change_id"])

    # 2. agent_run_dependencies (DAG edges)
    op.create_table(
        "agent_run_dependencies",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "run_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "depends_on_run_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_agent_run_dep_run", "agent_run_dependencies", ["run_id"])
    op.create_index("ix_agent_run_dep_depends", "agent_run_dependencies", ["depends_on_run_id"])

    # 3. agent_artifacts
    op.create_table(
        "agent_artifacts",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "run_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("content_ref", sa.Text, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_agent_artifacts_run", "agent_artifacts", ["run_id"])

    # 4. agent_runs orchestration columns (nullable — single-agent flows untouched)
    op.add_column(
        "agent_runs",
        sa.Column(
            "mission_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_missions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "agent_runs",
        sa.Column(
            "parent_run_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("agent_runs", sa.Column("role", sa.String(30), nullable=True))
    op.add_column("agent_runs", sa.Column("objective", sa.Text, nullable=True))
    op.add_column(
        "agent_runs",
        sa.Column("attempt", sa.Integer, nullable=False, server_default="0"),
    )
    op.create_index("ix_agent_runs_mission_id", "agent_runs", ["mission_id"])
    op.create_index("ix_agent_runs_parent_run_id", "agent_runs", ["parent_run_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_runs_parent_run_id", table_name="agent_runs")
    op.drop_index("ix_agent_runs_mission_id", table_name="agent_runs")
    op.drop_column("agent_runs", "attempt")
    op.drop_column("agent_runs", "objective")
    op.drop_column("agent_runs", "role")
    op.drop_column("agent_runs", "parent_run_id")
    op.drop_column("agent_runs", "mission_id")

    op.drop_index("ix_agent_artifacts_run", table_name="agent_artifacts")
    op.drop_table("agent_artifacts")

    op.drop_index("ix_agent_run_dep_depends", table_name="agent_run_dependencies")
    op.drop_index("ix_agent_run_dep_run", table_name="agent_run_dependencies")
    op.drop_table("agent_run_dependencies")

    op.drop_index("ix_agent_missions_change", table_name="agent_missions")
    op.drop_index("ix_agent_missions_workspace", table_name="agent_missions")
    op.drop_table("agent_missions")
