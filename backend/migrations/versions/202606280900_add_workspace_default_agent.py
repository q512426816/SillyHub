"""add workspace.default_agent column

Revision ID: 202606280900
Revises: 202606270900

Adds a nullable ``default_agent`` column to ``workspaces`` storing the
workspace-level default agent provider (e.g. "claude"/"codex") used when an
explicit provider is not supplied at dispatch time. See change
2026-06-14-agent-runtime-selection (FR-01/FR-02).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606280900"
down_revision = "202606270900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspaces",
        sa.Column("default_agent", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workspaces", "default_agent")
