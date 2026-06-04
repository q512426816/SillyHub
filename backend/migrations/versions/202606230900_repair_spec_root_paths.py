"""Repair spec_root paths that were incorrectly resolved against CWD.

The backfill migration (202606220900) used ``os.path.abspath()`` which
resolves relative paths against the current working directory.  When Alembic
was run from ``backend/``, a ``SPEC_DATA_ROOT=./data/spec-storage`` setting
produced paths like::

    /abs/path/to/repo/backend/data/spec-storage/{ws_id}

This migration detects rows containing ``/backend/data/spec-storage`` and
rewrites them to the correct repo-root-relative path::

    /abs/path/to/repo/data/spec-storage/{ws_id}

Idempotent: rows that are already correct (or do not match the broken
pattern) are left untouched.

Revision ID: 202606230900
Revises: 202606220900
"""

from __future__ import annotations

import os
import uuid

import sqlalchemy as sa
from alembic import op
from pathlib import Path

revision = "202606230900"
down_revision = "202606220900"
branch_labels = None
depends_on = None

# Repo root:  backend/alembic/versions/*.py → parents[3] = repo root
_REPO_ROOT = Path(__file__).resolve().parents[3]


def upgrade() -> None:
    conn = op.get_bind()

    # Determine the correct spec_data_root (same logic as fixed backfill).
    spec_data_root = os.environ.get("SPEC_DATA_ROOT")
    if not spec_data_root:
        _dotenv = _REPO_ROOT / "backend" / ".env"
        if _dotenv.exists():
            for line in _dotenv.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("SPEC_DATA_ROOT="):
                    spec_data_root = line.split("=", 1)[1].strip().strip("\"'")
                    break
    if not spec_data_root:
        spec_data_root = "/data/sillyspec-data"

    # Resolve relative paths against repo root (NOT CWD).
    p = Path(spec_data_root)
    if not p.is_absolute():
        spec_data_root = str(_REPO_ROOT / p)

    # Fetch all spec_workspaces rows.
    rows = conn.execute(
        sa.text("SELECT workspace_id, spec_root FROM spec_workspaces")
    ).fetchall()

    if not rows:
        print("[repair_spec_root_paths] No spec_workspaces rows found, nothing to do.")
        return

    fixed = 0
    for ws_id, spec_root in rows:
        # Detect the broken pattern: path contains /backend/data/spec-storage
        if "/backend/data/spec-storage" not in spec_root:
            continue

        correct_root = f"{spec_data_root}/{ws_id}"
        conn.execute(
            sa.text(
                "UPDATE spec_workspaces SET spec_root = :new_root, "
                "updated_at = NOW() WHERE workspace_id = :ws_id"
            ),
            {"new_root": correct_root, "ws_id": ws_id},
        )

        # Create the correct physical directory if it does not exist.
        os.makedirs(correct_root, exist_ok=True)
        fixed += 1

    print(f"[repair_spec_root_paths] {fixed} row(s) fixed, "
          f"{len(rows) - fixed} row(s) already correct.")


def downgrade() -> None:
    """No-op downgrade — we cannot reliably reconstruct the broken paths."""
    print("[repair_spec_root_paths] Downgrade is a no-op (broken paths not restored).")
