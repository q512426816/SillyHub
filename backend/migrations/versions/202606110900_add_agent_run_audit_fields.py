"""add spec_strategy, profile_version, diff_summary to agent_runs

Revision ID: 202606110900
Revises: 202606101000
Create Date: 2026-06-11 09:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202606110900"
down_revision: str | None = "202606101000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agent_runs",
        sa.Column("spec_strategy", sa.String(length=30), nullable=True),
    )
    op.add_column(
        "agent_runs",
        sa.Column("profile_version", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "agent_runs",
        sa.Column("diff_summary", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_runs", "diff_summary")
    op.drop_column("agent_runs", "profile_version")
    op.drop_column("agent_runs", "spec_strategy")
