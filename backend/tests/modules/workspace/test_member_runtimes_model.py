"""Model tests for WorkspaceMemberRuntime (task-01, change 2026-07-01-collaborative-workspace)."""

from __future__ import annotations

from sqlalchemy import DateTime, String, inspect
from sqlmodel import SQLModel

from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime


def test_primary_key_composite():
    """D-005@V1: PK is (workspace_id, user_id) — one member one binding per workspace."""
    pk_cols = {c.name for c in WorkspaceMemberRuntime.__table__.primary_key.columns}
    assert pk_cols == {"workspace_id", "user_id"}


def test_fk_cascade_and_restrict():
    """workspace/user CASCADE; runtime_id RESTRICT + nullable (server-local has no daemon)."""
    ws = {
        fk.target_fullname: fk.ondelete
        for fk in WorkspaceMemberRuntime.__table__.c.workspace_id.foreign_keys
    }
    assert ws.get("workspaces.id") == "CASCADE"
    user = {
        fk.target_fullname: fk.ondelete
        for fk in WorkspaceMemberRuntime.__table__.c.user_id.foreign_keys
    }
    assert user.get("users.id") == "CASCADE"
    rt = {
        fk.target_fullname: fk.ondelete
        for fk in WorkspaceMemberRuntime.__table__.c.runtime_id.foreign_keys
    }
    assert rt.get("daemon_runtimes.id") == "RESTRICT"
    assert WorkspaceMemberRuntime.__table__.c.runtime_id.nullable is True


def test_indexes():
    idx = {i.name for i in WorkspaceMemberRuntime.__table__.indexes}
    assert "ix_wmr_workspace" in idx
    assert "ix_wmr_runtime" in idx


def test_column_types():
    c = WorkspaceMemberRuntime.__table__.c
    assert isinstance(c.root_path.type, String) and c.root_path.nullable is False
    assert isinstance(c.path_source.type, String) and c.path_source.type.length == 20
    assert isinstance(c.synced_at.type, DateTime) and c.synced_at.nullable is True
    assert isinstance(c.last_scan_at.type, DateTime) and c.last_scan_at.nullable is True


def test_create_all_builds_table(tmp_path):
    """AC6: model registers on shared metadata and create_all builds the table."""
    from sqlalchemy import create_engine

    eng = create_engine(f"sqlite:///{tmp_path}/wmr.db")
    SQLModel.metadata.create_all(eng, tables=[WorkspaceMemberRuntime.__table__])
    assert "workspace_member_runtimes" in set(inspect(eng).get_table_names())
