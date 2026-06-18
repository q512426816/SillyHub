#!/usr/bin/env python3
"""Migrate existing scan docs from workspace repos to spec_root directories.

Reads spec_workspaces + workspaces from the database and copies
.sillyspec/docs/{component_key}/scan/ from the workspace root_path
to the spec_root for each workspace that has a component_key.

Idempotent: uses shutil.copytree(dirs_exist_ok=True) so re-running
is safe — existing files are overwritten, missing directories are created.

Usage:
    python scripts/migrate_scan_docs.py
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# .env loader — minimal, no dependency on python-dotenv
# ---------------------------------------------------------------------------

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_BACKEND_DIR = _PROJECT_ROOT / "backend"
_ENV_FILE = _BACKEND_DIR / ".env"


def _load_env(path: Path) -> dict[str, str]:
    """Parse a simple .env file (KEY=VALUE lines, no interpolation)."""
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip().strip("\"'")
    return env


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    # ── 1. Read DATABASE_URL from backend/.env ─────────────────────────
    env = _load_env(_ENV_FILE)
    database_url = env.get("DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not database_url:
        print(
            "ERROR: DATABASE_URL not found in backend/.env or environment.",
            file=sys.stderr,
        )
        sys.exit(1)

    # Convert asyncpg URL to plain psycopg2/psycopg URL.
    # e.g. postgresql+asyncpg://... → postgresql://...
    sync_url = database_url.replace("+asyncpg", "")

    # ── 2. Connect and query ────────────────────────────────────────────
    try:
        import psycopg2
    except ImportError:
        try:
            # psycopg exposes connect() at top level when installed as psycopg2-binary compat
            # but let's be explicit.
            from psycopg import connect as _psycopg_connect

            _connect = _psycopg_connect
        except ImportError:
            print(
                "ERROR: Neither psycopg2 nor psycopg is installed.\n"
                "Install with:  pip install psycopg2-binary",
                file=sys.stderr,
            )
            sys.exit(1)
    else:
        _connect = psycopg2.connect

    conn = _connect(sync_url)
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute(
        """
        SELECT
            w.root_path,
            w.component_key,
            sw.spec_root
        FROM workspaces w
        JOIN spec_workspaces sw ON sw.workspace_id = w.id
        WHERE w.status = 'active'
          AND w.deleted_at IS NULL
        ORDER BY w.component_key
        """
    )
    rows = cur.fetchall()

    if not rows:
        print("No active workspaces with spec_workspaces rows found.")
        cur.close()
        conn.close()
        return

    # ── 3. Copy scan docs ──────────────────────────────────────────────
    total_copied = 0
    total_skipped = 0
    total_no_source = 0

    for root_path, component_key, spec_root in rows:
        # Skip workspaces without a component_key.
        if not component_key:
            print(f"  SKIP  component_key is None  (root_path={root_path})")
            total_skipped += 1
            continue

        # Source: try root_path first, then project root (for monorepo
        # sub-projects whose .sillyspec lives at the repo root).
        source_dir = Path(root_path) / ".sillyspec" / "docs" / component_key / "scan"
        if not source_dir.exists():
            source_dir = _PROJECT_ROOT / ".sillyspec" / "docs" / component_key / "scan"
        target_dir = Path(spec_root) / ".sillyspec" / "docs" / component_key / "scan"

        if not source_dir.exists():
            print(f"  SKIP  source not found: {source_dir}")
            total_no_source += 1
            continue

        # Count files before copy for stats.
        source_files = [f for f in source_dir.rglob("*") if f.is_file()]

        if not source_files:
            print(f"  SKIP  source is empty: {source_dir}")
            total_no_source += 1
            continue

        # Ensure target parent exists.
        target_dir.mkdir(parents=True, exist_ok=True)

        shutil.copytree(
            str(source_dir),
            str(target_dir),
            dirs_exist_ok=True,
        )

        print(
            f"  OK    {component_key}: copied {len(source_files)} file(s)\n"
            f"        from {source_dir}\n"
            f"        to   {target_dir}"
        )
        total_copied += len(source_files)

    # ── 4. Summary ─────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("Migration complete.")
    print(f"  Workspaces processed: {len(rows)}")
    print(f"  Files copied:         {total_copied}")
    print(f"  Skipped (no key):     {total_skipped}")
    print(f"  Skipped (no source):  {total_no_source}")
    print("=" * 60)

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
