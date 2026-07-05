"""Model tests for scan_documents source columns + ScanDocConflictHistory (task-01)."""

from __future__ import annotations

from sqlalchemy import DateTime, String, inspect
from sqlmodel import SQLModel

from app.modules.scan_docs.conflict_model import ScanDocConflictHistory
from app.modules.scan_docs.model import ScanDocument


def test_source_member_fk_set_null():
    """Grill 点 5: source_member_id FK users ondelete=SET NULL (not CASCADE)."""
    fk = {
        fk.target_fullname: fk.ondelete
        for fk in ScanDocument.__table__.c.source_member_id.foreign_keys
    }
    assert fk.get("users.id") == "SET NULL"
    assert ScanDocument.__table__.c.source_member_id.nullable is True


def test_source_runtime_fk_set_null():
    fk = {
        fk.target_fullname: fk.ondelete
        for fk in ScanDocument.__table__.c.source_runtime_id.foreign_keys
    }
    assert fk.get("daemon_runtimes.id") == "SET NULL"
    assert ScanDocument.__table__.c.source_runtime_id.nullable is True


def test_source_aux_columns_types():
    c = ScanDocument.__table__.c
    assert isinstance(c.source_synced_at.type, DateTime) and c.source_synced_at.nullable is True
    assert isinstance(c.source_mtime.type, DateTime) and c.source_mtime.nullable is True
    assert isinstance(c.content_hash.type, String) and c.content_hash.type.length == 64
    assert c.content_hash.nullable is True


def test_unique_key_unchanged_single_authoritative_tree():
    """D-002@V1: unique key stays (workspace_id, path) — no per-member partition."""
    uniq_keys = []
    for idx in ScanDocument.__table__.indexes:
        if idx.unique:
            uniq_keys.append(frozenset(c.name for c in idx.columns))
    assert frozenset({"workspace_id", "path"}) in uniq_keys


def test_conflict_history_table():
    t = ScanDocConflictHistory.__table__
    assert t.name == "scan_doc_conflict_history"
    ws_fk = {fk.target_fullname: fk.ondelete for fk in t.c.workspace_id.foreign_keys}
    assert ws_fk.get("workspaces.id") == "CASCADE"
    # Source ids are plain columns (no FK) — audit records survive user/runtime deletion.
    for col in ("old_source_member_id", "old_source_runtime_id", "new_source_member_id"):
        assert not list(t.c[col].foreign_keys), f"{col} must have no FK (audit-only)"


def test_conflict_history_index():
    names = {i.name for i in ScanDocConflictHistory.__table__.indexes}
    assert "ix_scan_doc_conflict_ws_path" in names


def test_create_all_builds_conflict_table(tmp_path):
    from sqlalchemy import create_engine

    eng = create_engine(f"sqlite:///{tmp_path}/conflict.db")
    SQLModel.metadata.create_all(eng, tables=[ScanDocConflictHistory.__table__])
    assert "scan_doc_conflict_history" in set(inspect(eng).get_table_names())
