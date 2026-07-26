"""Model tests for WorkspaceMemberRuntime (task-01, change 2026-07-01-collaborative-workspace)."""

from __future__ import annotations

from sqlalchemy import Boolean, DateTime, String, inspect
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
    # task-01 (2026-07-25-daemon-borrow-for-business / D-005@v1):
    # 借用查询走部分索引 ix_wmr_shared（WHERE shared=TRUE），仅命中共享行。
    assert "ix_wmr_shared" in idx
    shared_idx = next(
        i for i in WorkspaceMemberRuntime.__table__.indexes if i.name == "ix_wmr_shared"
    )
    # 部分索引仅在 shared=TRUE 时生效（design §8）；postgresql_where 为 PG 方言 kw，
    # SQLite dialect 会在 create_all 时忽略它（建为全索引），但 kw 必须挂上供 PG 取用。
    assert shared_idx.dialect_options["postgresql"]["where"] is not None


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


def test_shared_column_bool_not_null_default_false():
    """task-01 / D-005@v1：shared 列存在，Boolean，nullable=False，server_default=false。

    server_default=false 保证既有 binding 行迁移后默认非共享（零回归核心），
    业务/管理人员的借用查询仅命中 lender 主动 shared=True 的行。
    """
    c = WorkspaceMemberRuntime.__table__.c
    assert "shared" in set(c.keys())
    shared = c.shared
    assert isinstance(shared.type, Boolean)
    assert shared.nullable is False
    # server_default=false：迁移给旧行回填 false，新行不显式赋值也落 false
    assert shared.server_default is not None
    assert shared.server_default.arg.text == "false"


def test_shared_field_defaults_false_on_construct():
    """task-01：未显式给 shared 时构造实例，默认 False（Python 层默认值）。"""
    # 只给必填最小字段即可构造（PK + root_path + path_source）
    binding = WorkspaceMemberRuntime(root_path="/tmp/x", path_source="daemon_client")
    assert binding.shared is False
