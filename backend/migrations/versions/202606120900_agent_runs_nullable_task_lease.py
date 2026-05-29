"""Make agent_runs.task_id and lease_id nullable for bootstrap runs

Bootstrap agent runs are not associated with a specific task or lease,
so these FK columns must accept NULL.

Revision ID: 202606120900
Revises: 202606110900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606120900"
down_revision = "202606110900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "agent_runs",
        "task_id",
        existing_type=sa.Uuid(as_uuid=True),
        nullable=True,
    )
    op.alter_column(
        "agent_runs",
        "lease_id",
        existing_type=sa.Uuid(as_uuid=True),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "agent_runs",
        "lease_id",
        existing_type=sa.Uuid(as_uuid=True),
        nullable=False,
    )
    op.alter_column(
        "agent_runs",
        "task_id",
        existing_type=sa.Uuid(as_uuid=True),
        nullable=False,
    )
