"""add path_source and daemon_runtime_id to workspaces

Revision ID: 202607030900
Revises: 202607020900

Adds two columns to ``workspaces``:
- ``path_source`` VARCHAR(20) NOT NULL DEFAULT 'server-local'
  (enum: server-local | daemon-client). Distinguishes whether the workspace's
  ``root_path`` is reachable from the backend process locally, or whether it
  lives on a daemon client machine.
- ``daemon_runtime_id`` UUID NULL, FK -> daemon_runtimes.id.
  The strongly-bound daemon runtime when path_source='daemon-client' (D-001@v1 /
  D-004@v1). NULL for server-local workspaces.

Covers change 2026-06-18-workspace-client-path FR-01 / D-004@v1. The
server_default='server-local' backfills existing rows so brownfield behaviour
is byte-identical (design §9). An index on daemon_runtime_id supports the
task-03 daemon-client routing lookup. FK uses default ondelete=RESTRICT —
deleting a daemon that still has workspaces is blocked (R-06 cascade is out of
scope for this change).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607030900"
down_revision = "202607020900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspaces",
        sa.Column(
            "path_source",
            sa.String(length=20),
            nullable=False,
            server_default="server-local",
        ),
    )
    op.add_column(
        "workspaces",
        sa.Column(
            "daemon_runtime_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("daemon_runtimes.id"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_workspaces_daemon_runtime_id",
        "workspaces",
        ["daemon_runtime_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_workspaces_daemon_runtime_id", table_name="workspaces")
    op.drop_column("workspaces", "daemon_runtime_id")
    op.drop_column("workspaces", "path_source")
