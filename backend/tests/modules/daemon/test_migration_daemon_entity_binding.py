"""Smoke test for daemon-entity-binding migrations (task-13).

SQLite does not support ALTER TABLE ADD COLUMN with an inline FK constraint,
so a full op.upgrade() round-trip would need batch_alter_table (which the
migration itself deliberately does not use — the dev/prod DB is Postgres).
Instead we assert:

1. Migration metadata (revision / down_revision / module importable).
2. The add-column operations work on SQLite when we strip the FK clause
   (the FK target ``daemon_instances.id`` resolution is exercised by the real
   Postgres ``alembic upgrade head`` run, listed as a manual verify step).

Matches the pattern established by
``tests/modules/workspace/test_migration_path_source.py``.
"""

from __future__ import annotations

import importlib

import sqlalchemy as sa


def _load_migration(revision_id: str):
    """Load migration module by matching revision ID in filename."""
    import os
    from pathlib import Path

    # Test file: backend/tests/modules/daemon/test_*.py → 4 parents → backend/
    backend_root = Path(__file__).resolve().parent.parent.parent.parent
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and revision_id in f and f != "__init__.py":
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {revision_id} in {versions_dir}")


# ---------------------------------------------------------------------------
# Migration 1: create daemon_instances table
# ---------------------------------------------------------------------------


def test_migration_202607031200_metadata():
    mod = _load_migration("202607031200")
    assert mod.revision == "202607031200"
    assert mod.down_revision == "202607022300"
    assert mod.branch_labels is None
    assert mod.depends_on is None
    assert callable(mod.upgrade)
    assert callable(mod.downgrade)


def test_migration_202607031200_create_table_smoke_sqlite():
    """Verify the create_table DDL works on SQLite (without FK clauses)."""
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(
            sa.text("""
                CREATE TABLE users (
                    id CHAR(32) PRIMARY KEY NOT NULL
                )
            """)
        )

    # Manually replay the create-table operations from the migration
    with engine.begin() as conn:
        conn.execute(
            sa.text("""
            CREATE TABLE daemon_instances (
                id CHAR(32) PRIMARY KEY NOT NULL,
                user_id CHAR(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                hostname VARCHAR(255) NOT NULL,
                display_alias VARCHAR(200),
                server_url VARCHAR(255) NOT NULL,
                os VARCHAR(50),
                arch VARCHAR(50),
                version VARCHAR(50),
                allowed_roots JSON NOT NULL DEFAULT '["~/.sillyhub"]',
                capabilities JSON,
                status VARCHAR(20) NOT NULL DEFAULT 'online',
                last_heartbeat_at DATETIME,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """)
        )
        conn.execute(
            sa.text(
                "CREATE INDEX ix_daemon_instances_user_server "
                "ON daemon_instances (user_id, server_url, hostname)"
            )
        )

    with engine.begin() as conn:
        insp = sa.inspect(conn)
        assert "daemon_instances" in insp.get_table_names()
        indexes = {i["name"] for i in insp.get_indexes("daemon_instances")}
        assert "ix_daemon_instances_user_server" in indexes

        cols = {c["name"]: c for c in insp.get_columns("daemon_instances")}
        for name in (
            "id",
            "user_id",
            "hostname",
            "display_alias",
            "server_url",
            "os",
            "arch",
            "version",
            "allowed_roots",
            "capabilities",
            "status",
            "last_heartbeat_at",
            "created_at",
            "updated_at",
        ):
            assert name in cols, f"Column {name} not found in daemon_instances"

    # Downgrade: drop table
    with engine.begin() as conn:
        conn.execute(sa.text("DROP TABLE daemon_instances"))

    with engine.begin() as conn:
        insp = sa.inspect(conn)
        assert "daemon_instances" not in insp.get_table_names()


# ---------------------------------------------------------------------------
# Migration 2: daemon_runtimes add/remove columns
# ---------------------------------------------------------------------------


def test_migration_202607031301_metadata():
    mod = _load_migration("202607031301")
    assert mod.revision == "202607031301"
    assert mod.down_revision == "202607031200"
    assert mod.branch_labels is None
    assert mod.depends_on is None
    assert callable(mod.upgrade)
    assert callable(mod.downgrade)


def test_migration_202607031301_add_drop_columns_smoke():
    """Verify add-column / drop-column works on SQLite (FK clause stripped)."""
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(
            sa.text("""
                CREATE TABLE daemon_runtimes (
                    id CHAR(32) PRIMARY KEY NOT NULL,
                    user_id CHAR(32) NOT NULL,
                    os VARCHAR(50),
                    arch VARCHAR(50),
                    capabilities JSON,
                    allowed_roots JSON,
                    display_alias VARCHAR(200)
                )
            """)
        )

    # Manually replay the upgrade operations without FK clause
    with engine.begin() as conn:
        conn.execute(sa.text("ALTER TABLE daemon_runtimes ADD COLUMN daemon_instance_id CHAR(32)"))
        conn.execute(
            sa.text(
                "CREATE INDEX idx_daemon_runtimes_instance ON daemon_runtimes (daemon_instance_id)"
            )
        )
        conn.execute(sa.text("ALTER TABLE daemon_runtimes DROP COLUMN allowed_roots"))
        conn.execute(sa.text("ALTER TABLE daemon_runtimes DROP COLUMN capabilities"))
        conn.execute(sa.text("ALTER TABLE daemon_runtimes DROP COLUMN arch"))
        conn.execute(sa.text("ALTER TABLE daemon_runtimes DROP COLUMN os"))
        conn.execute(sa.text("ALTER TABLE daemon_runtimes DROP COLUMN display_alias"))

    with engine.begin() as conn:
        insp = sa.inspect(conn)
        cols = {c["name"] for c in insp.get_columns("daemon_runtimes")}
        assert "daemon_instance_id" in cols, "daemon_instance_id should exist"
        assert "os" not in cols
        assert "arch" not in cols
        assert "capabilities" not in cols
        assert "allowed_roots" not in cols
        assert "display_alias" not in cols

        indexes = {i["name"] for i in insp.get_indexes("daemon_runtimes")}
        assert "idx_daemon_runtimes_instance" in indexes

    # Downgrade: restore
    with engine.begin() as conn:
        conn.execute(sa.text("DROP INDEX idx_daemon_runtimes_instance"))
        conn.execute(sa.text("ALTER TABLE daemon_runtimes DROP COLUMN daemon_instance_id"))
        conn.execute(sa.text("ALTER TABLE daemon_runtimes ADD COLUMN display_alias VARCHAR(200)"))
        conn.execute(sa.text("ALTER TABLE daemon_runtimes ADD COLUMN os VARCHAR(50)"))
        conn.execute(sa.text("ALTER TABLE daemon_runtimes ADD COLUMN arch VARCHAR(50)"))
        conn.execute(sa.text("ALTER TABLE daemon_runtimes ADD COLUMN capabilities JSON"))
        conn.execute(
            sa.text(
                "ALTER TABLE daemon_runtimes ADD COLUMN allowed_roots JSON NOT NULL DEFAULT '[\"~/.sillyhub\"]'"
            )
        )

    with engine.begin() as conn:
        insp = sa.inspect(conn)
        cols = {c["name"] for c in insp.get_columns("daemon_runtimes")}
        for col in ("os", "arch", "capabilities", "allowed_roots", "display_alias"):
            assert col in cols, f"Column {col} should be restored after downgrade"
        assert "daemon_instance_id" not in cols


# ---------------------------------------------------------------------------
# Migration 3: workspace_member_runtimes add daemon_id
# ---------------------------------------------------------------------------


def test_migration_202607031302_metadata():
    mod = _load_migration("202607031302")
    assert mod.revision == "202607031302"
    assert mod.down_revision == "202607031301"
    assert mod.branch_labels is None
    assert mod.depends_on is None
    assert callable(mod.upgrade)
    assert callable(mod.downgrade)


def test_migration_202607031302_add_daemon_id_column_smoke():
    """Verify add-column / drop-column on WMR works without FK clause."""
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(
            sa.text("""
                CREATE TABLE workspace_member_runtimes (
                    workspace_id CHAR(32) NOT NULL,
                    user_id CHAR(32) NOT NULL,
                    runtime_id CHAR(32),
                    root_path TEXT NOT NULL,
                    path_source VARCHAR(20) NOT NULL,
                    PRIMARY KEY (workspace_id, user_id)
                )
            """)
        )

    with engine.begin() as conn:
        conn.execute(sa.text("ALTER TABLE workspace_member_runtimes ADD COLUMN daemon_id CHAR(32)"))
        conn.execute(sa.text("CREATE INDEX ix_wmr_daemon ON workspace_member_runtimes (daemon_id)"))

    with engine.begin() as conn:
        insp = sa.inspect(conn)
        cols = {c["name"] for c in insp.get_columns("workspace_member_runtimes")}
        assert "daemon_id" in cols
        indexes = {i["name"] for i in insp.get_indexes("workspace_member_runtimes")}
        assert "ix_wmr_daemon" in indexes

    # Downgrade
    with engine.begin() as conn:
        conn.execute(sa.text("DROP INDEX ix_wmr_daemon"))
        conn.execute(sa.text("ALTER TABLE workspace_member_runtimes DROP COLUMN daemon_id"))

    with engine.begin() as conn:
        cols = {c["name"] for c in sa.inspect(conn).get_columns("workspace_member_runtimes")}
        assert "daemon_id" not in cols
