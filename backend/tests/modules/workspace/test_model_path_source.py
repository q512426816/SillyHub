"""Model field/type tests for path_source / daemon_runtime_id (task-01)."""

from __future__ import annotations

import uuid

from sqlalchemy import String, Uuid

from app.modules.workspace.model import Workspace


def _make_workspace(**overrides):
    base = {
        "name": "demo",
        "slug": "demo",
        "root_path": "/tmp/demo",
    }
    base.update(overrides)
    return Workspace(**base)


def test_model_defaults():
    ws = _make_workspace()
    assert ws.path_source == "server-local"
    assert ws.daemon_runtime_id is None


def test_model_accepts_daemon_client():
    rid = uuid.uuid4()
    ws = _make_workspace(path_source="daemon-client", daemon_runtime_id=rid)
    assert ws.path_source == "daemon-client"
    assert ws.daemon_runtime_id == rid


def test_column_types():
    table = Workspace.__table__
    path_source_col = table.c.path_source
    assert isinstance(path_source_col.type, String)
    assert path_source_col.type.length == 20
    assert path_source_col.nullable is False

    daemon_col = table.c.daemon_runtime_id
    assert isinstance(daemon_col.type, Uuid)
    assert daemon_col.nullable is True
    fks = {fk.target_fullname for fk in daemon_col.foreign_keys}
    assert "daemon_runtimes.id" in fks


def test_daemon_runtime_id_index_exists():
    index_names = {idx.name for idx in Workspace.__table__.indexes}
    assert "ix_workspaces_daemon_runtime_id" in index_names


def test_path_source_server_default_text():
    """server_default must be 'server-local' so brownfield add-column backfills."""
    col = Workspace.__table__.c.path_source
    assert col.server_default is not None
    # SQLModel/SQLAlchemy stores a plain-string server_default as-is.
    assert col.server_default.arg == "server-local"
