"""add agent_sessions table, daemon_task_leases.kind, agent_runs.agent_session_id

Change: 2026-06-18-daemon-interactive-session

Covers:
- FR-01: create interactive session entity (agent_sessions table)
- FR-09: isolate batch vs interactive via lease.kind (default batch, zero
  impact on existing TaskRunner path)
- D-001@v1: name the new entity AgentSession; its SDK session_id lives in
  agent_sessions.agent_session_id (String 255), distinct from
  AgentRun.session_id (claude resume id) which is left untouched
- D-002@v3: driver layer coexists with TaskRunner, gated by lease.kind
- D-005@v1: ternary relationship session <-> lease 1:1 (session.lease_id FK)
  and session <-> runs 1:N (agent_runs.agent_session_id FK, ondelete SET NULL)

Revision ID: 202607040900
Revises: 202607030900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607040900"
down_revision = "202607030900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. agent_sessions table (13 columns, design.md §5.1)
    op.create_table(
        "agent_sessions",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "runtime_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("daemon_runtimes.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "lease_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("daemon_task_leases.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("provider", sa.String(30), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("agent_session_id", sa.String(255), nullable=True),
        sa.Column("config", sa.JSON, nullable=True),
        sa.Column("turn_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("cwd", sa.String, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_agent_sessions_user_id", "agent_sessions", ["user_id"])
    op.create_index("ix_agent_sessions_runtime_id", "agent_sessions", ["runtime_id"])
    op.create_index("ix_agent_sessions_status", "agent_sessions", ["status"])
    op.create_index("ix_agent_sessions_lease_id", "agent_sessions", ["lease_id"])

    # 2. daemon_task_leases.kind (FR-09, D-002@v3)
    #    server_default='batch' lets add_column NOT NULL succeed on existing
    #    rows (PostgreSQL fills DEFAULT for存量 rows); also keeps existing
    #    batch leases out of the interactive path.
    op.add_column(
        "daemon_task_leases",
        sa.Column(
            "kind",
            sa.String(20),
            nullable=False,
            server_default="batch",
        ),
    )

    # 3. agent_runs.agent_session_id FK (D-005@v1, session<->runs 1:N)
    op.add_column(
        "agent_runs",
        sa.Column(
            "agent_session_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_agent_runs_agent_session_id",
        "agent_runs",
        ["agent_session_id"],
    )


def downgrade() -> None:
    # Reverse order of upgrade (FK dependency: agent_session_id -> agent_sessions).
    op.drop_index("ix_agent_runs_agent_session_id", table_name="agent_runs")
    op.drop_column("agent_runs", "agent_session_id")

    op.drop_column("daemon_task_leases", "kind")

    op.drop_index("ix_agent_sessions_lease_id", table_name="agent_sessions")
    op.drop_index("ix_agent_sessions_status", table_name="agent_sessions")
    op.drop_index("ix_agent_sessions_runtime_id", table_name="agent_sessions")
    op.drop_index("ix_agent_sessions_user_id", table_name="agent_sessions")
    op.drop_table("agent_sessions")
