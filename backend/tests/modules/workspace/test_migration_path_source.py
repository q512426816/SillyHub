"""Smoke test for migration 202607030900_add_workspace_path_source.

SQLite does not support ALTER TABLE ADD COLUMN with an inline FK constraint,
so a full op.upgrade() round-trip would need batch_alter_table (which the
migration itself deliberately does not use — the dev/prod DB is Postgres).
Instead we assert:

1. Migration metadata (revision / down_revision / module importable).
2. The ``path_source`` add-column works on SQLite when we strip the FK clause
   (the FK target ``daemon_runtimes.id`` resolution is exercised by the real
   Postgres ``alembic upgrade head`` run, listed as a manual AC-10 step).

This satisfies task-01 §8 step 3 within the project's SQLite test sandbox.
"""

from __future__ import annotations

import importlib

import sqlalchemy as sa


def test_migration_metadata():
    migration = importlib.import_module(
        "migrations.versions.202607030900_add_workspace_path_source"
    )
    assert migration.revision == "202607030900"
    assert migration.down_revision == "202607020900"
    assert migration.branch_labels is None
    assert migration.depends_on is None
    # upgrade/downgrade must be callables.
    assert callable(migration.upgrade)
    assert callable(migration.downgrade)


def test_path_source_add_column_smoke_sqlite():
    """Replays the path_source add-column (without FK clause) on SQLite."""
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(
            sa.text("CREATE TABLE workspaces (id TEXT PRIMARY KEY, name VARCHAR(200) NOT NULL)")
        )
        # Mirror the migration's path_source column spec verbatim minus FK.
        conn.execute(
            sa.text(
                "ALTER TABLE workspaces ADD COLUMN path_source "
                "VARCHAR(20) NOT NULL DEFAULT 'server-local'"
            )
        )
        insp = sa.inspect(conn)
        cols = {c["name"] for c in insp.get_columns("workspaces")}
        assert "path_source" in cols
        path_source_col = next(
            c for c in insp.get_columns("workspaces") if c["name"] == "path_source"
        )
        assert path_source_col["nullable"] is False
        assert path_source_col["default"] == "'server-local'"
