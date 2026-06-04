"""Backfill spec_workspaces for all active workspaces.

Iterates over every active (status='active', deleted_at IS NULL) row in
``workspaces`` and creates a corresponding ``spec_workspaces`` row with
strategy ``platform-managed`` and spec_root ``{spec_data_root}/{workspace_id}``.

Idempotent: skips workspaces that already have a spec_workspaces row.

Revision ID: 202606220900
Revises: 202606210900
"""

from __future__ import annotations

import os
import uuid

import sqlalchemy as sa
from alembic import op

revision = "202606220900"
down_revision = "202606210900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Determine spec_data_root — prefer env var, fallback to default.
    spec_data_root = os.environ.get(
        "SPEC_DATA_ROOT",
        "/data/sillyspec-data",
    )
    # Resolve to absolute path so that spec_root is unambiguous.
    spec_data_root = os.path.abspath(spec_data_root)

    # Fetch all active workspaces.
    workspaces = conn.execute(
        sa.text(
            "SELECT id FROM workspaces "
            "WHERE status = 'active' AND deleted_at IS NULL"
        )
    ).fetchall()

    if not workspaces:
        return

    # Collect existing workspace_ids that already have a spec_workspaces row.
    existing = conn.execute(
        sa.text("SELECT workspace_id FROM spec_workspaces")
    ).fetchall()
    existing_ids = {row[0] for row in existing}

    now = sa.text("NOW()")
    inserted = 0

    for (ws_id,) in workspaces:
        if ws_id in existing_ids:
            continue

        spec_root = f"{spec_data_root}/{ws_id}"
        conn.execute(
            sa.text(
                "INSERT INTO spec_workspaces "
                "(id, workspace_id, spec_root, strategy, profile_version, "
                " sync_status, created_at, updated_at) "
                "VALUES (gen_random_uuid(), :ws_id, :spec_root, "
                "        'platform-managed', '0.1.0', 'clean', NOW(), NOW())"
            ),
            {"ws_id": ws_id, "spec_root": spec_root},
        )

        # Create the physical directory.
        os.makedirs(spec_root, exist_ok=True)
        inserted += 1

    print(f"[backfill_spec_workspaces] {inserted} rows inserted, "
          f"{len(workspaces) - inserted} skipped (already exist).")


def downgrade() -> None:
    """Remove spec_workspaces rows that were created by this migration.

    Does NOT remove physical directories (safe downgrade).
    """
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "DELETE FROM spec_workspaces "
            "WHERE workspace_id IN ("
            "  SELECT id FROM workspaces"
            ")"
        )
    )
    print("[backfill_spec_workspaces] Removed all spec_workspaces rows "
          "linked to workspaces.")
