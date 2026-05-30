"""add execution coordinator fields to agent_runs

Revision ID: 202606150900
Revises: 202606140900
Create Date: 2026-06-15 09:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202606150900"
down_revision: str | None = "202606140900"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agent_runs",
        sa.Column("idempotency_key", sa.String(64), nullable=True),
    )
    op.add_column(
        "agent_runs",
        sa.Column("resume_token", sa.String(64), nullable=True),
    )
    op.add_column(
        "agent_runs",
        sa.Column(
            "checkpoint_version",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "agent_runs",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "agent_runs",
        sa.Column("approval_token", sa.String(64), nullable=True),
    )
    op.add_column(
        "agent_runs",
        sa.Column("context_fingerprint", sa.String(64), nullable=True),
    )
    op.add_column(
        "agent_runs",
        sa.Column("checkpoint_data", sa.JSON(), nullable=True),
    )
    op.add_column(
        "agent_runs",
        sa.Column("max_retries", sa.Integer(), nullable=False, server_default="3"),
    )
    op.add_column(
        "agent_runs",
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_index(
        "ix_agent_runs_idempotency_key",
        "agent_runs",
        ["idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )
    op.create_index(
        "ix_agent_runs_resume_token",
        "agent_runs",
        ["resume_token"],
        postgresql_where=sa.text("resume_token IS NOT NULL"),
    )
    op.create_index(
        "ix_agent_runs_context_fingerprint",
        "agent_runs",
        ["context_fingerprint"],
        postgresql_where=sa.text("context_fingerprint IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_agent_runs_context_fingerprint", table_name="agent_runs"
    )
    op.drop_index("ix_agent_runs_resume_token", table_name="agent_runs")
    op.drop_index("ix_agent_runs_idempotency_key", table_name="agent_runs")

    op.drop_column("agent_runs", "retry_count")
    op.drop_column("agent_runs", "max_retries")
    op.drop_column("agent_runs", "checkpoint_data")
    op.drop_column("agent_runs", "context_fingerprint")
    op.drop_column("agent_runs", "approval_token")
    op.drop_column("agent_runs", "version")
    op.drop_column("agent_runs", "checkpoint_version")
    op.drop_column("agent_runs", "resume_token")
    op.drop_column("agent_runs", "idempotency_key")
