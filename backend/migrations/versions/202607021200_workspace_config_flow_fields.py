"""workspace-config-flow: spec_workspaces.spec_version + workspace_member_runtimes.init_synced fields

Revision ID: 202607021200
Revises: 202607021100
Create Date: 2026-07-02 12:00:00

Change 2026-07-02-workspace-config-flow (task-09 / D-010): schema changes for
the "init -> scan -> sync" flow.

- ``spec_workspaces.spec_version`` (INT NOT NULL DEFAULT 0): server-authoritative
  spec bundle version. Bumped on scan_generate success / apply_sync landing (see
  spec_workspace.service `_write_spec_root`). Daemon compares this against the
  local ``.sillyspec-platform.json.spec_version`` to decide whether to pull.
  NOT a reuse of ``profile_version`` (scan profile format version) — different
  semantics, kept as a separate column.
- ``workspace_member_runtimes.init_synced_at`` (DATETIME NULL) +
  ``init_synced_spec_version`` (INT NULL): written by the init-lease complete
  path; NULL until a member's first successful init. Model fields landed in
  task-03; this migration adds the DB columns.

Migration ordering: ``down_revision`` points at the real alembic head at execute
time (``202607021100`` = change-detail-file-tree-editor's ``kind`` column),
avoiding a double-head crash-loop (see known issue migration-chain-fragmentation).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607021200"
down_revision = "202607021100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # spec_workspaces.spec_version — INT NOT NULL DEFAULT 0
    op.add_column(
        "spec_workspaces",
        sa.Column(
            "spec_version",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )

    # workspace_member_runtimes.init_synced_at / init_synced_spec_version
    op.add_column(
        "workspace_member_runtimes",
        sa.Column("init_synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "workspace_member_runtimes",
        sa.Column("init_synced_spec_version", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workspace_member_runtimes", "init_synced_spec_version")
    op.drop_column("workspace_member_runtimes", "init_synced_at")
    op.drop_column("spec_workspaces", "spec_version")
