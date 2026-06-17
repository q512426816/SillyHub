"""add per-run agent provider/model fields

Revision ID: 202607020900
Revises: 202607010900

Adds nullable provider/model snapshots to ``agent_runs`` plus a workspace-level
``default_model`` used when a dispatch request does not specify a model.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607020900"
down_revision = "202607010900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agent_runs", sa.Column("provider", sa.String(64), nullable=True))
    op.add_column("agent_runs", sa.Column("model", sa.String(128), nullable=True))
    op.add_column("workspaces", sa.Column("default_model", sa.String(128), nullable=True))


def downgrade() -> None:
    op.drop_column("workspaces", "default_model")
    op.drop_column("agent_runs", "model")
    op.drop_column("agent_runs", "provider")
