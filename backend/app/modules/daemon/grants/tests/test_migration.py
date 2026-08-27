"""20260828120000 迁移单测（task-01 / D-006@v1 / D-008@v1）。

沿用 tests/modules/workspace/test_migration_workspace_role_type.py 的
``_load_migration`` + ``alembic.op._proxy`` replay 范式：

1. 迁移元数据：revision/down_revision 接续（单 head 链）；
2. PG 方言 mock engine 断言建表 DDL 含 UNIQUE NULLS NOT DISTINCT（SQLite
   replay 下方言 kwarg 被忽略，此项只能对 PG 方言编译验证）；
3. SQLite 内存库 replay 完整 upgrade：存量 shared=TRUE 且 daemon_id 非空的行
   逐条生成 workspace grant（enabled=true）、daemon_id NULL 行跳过且日志含跳过
   计数、shared=FALSE 行不迁移、daemon_borrow_audit.grant_id 列存在且 nullable；
4. downgrade 对称删列删表。

注：SQLite replay 不跑 alembic 环境（直接调 upgrade()/downgrade()），真实 PG
``alembic upgrade head`` 的链路风险由 verify 阶段覆盖。
"""

from __future__ import annotations

import importlib
import os
import uuid
from pathlib import Path

import sqlalchemy as sa


def _load_migration(revision_id: str):
    """按 revision ID 在文件名里匹配，导入迁移模块（沿用 workspace 迁移测试范式）。"""
    # 本测试文件:
    # backend/app/modules/daemon/grants/tests/test_migration.py
    # → 6 级 parent 到 backend/（比 tests/modules/... 范式深一级，注意层级）
    backend_root = Path(__file__).resolve().parents[5]
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and revision_id in f and f != "__init__.py":
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {revision_id} in {versions_dir}")


def _bind_op(conn):
    """把 ``alembic.op`` proxy 挂到已 bind 的连接（迁移体用裸 ``op.*`` 调用）。

    返回 (prev, ops)：prev 为挂载前的 proxy（通常 None），供 _unbind_op 恢复。
    """
    import alembic
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    ctx = MigrationContext.configure(conn)
    ops = Operations(ctx)
    prev = getattr(alembic.op, "_proxy", None)
    alembic.op._proxy = ops
    return prev, ops


def _unbind_op(prev, ops) -> None:
    import alembic

    if prev is None:
        if getattr(alembic.op, "_proxy", None) is ops:
            delattr(alembic.op, "_proxy")
    else:
        alembic.op._proxy = prev


# ---------------------------------------------------------------------------
# 1. 迁移元数据
# ---------------------------------------------------------------------------


def test_migration_metadata():
    """revision = 20260828120000；down_revision = 20260827230000（接当前唯一 head）。"""
    mod = _load_migration("20260828120000")
    assert mod.revision == "20260828120000"
    assert mod.down_revision == "20260827230000"
    assert mod.branch_labels is None
    assert mod.depends_on is None
    assert callable(mod.upgrade)
    assert callable(mod.downgrade)


# ---------------------------------------------------------------------------
# 2. PG 方言 DDL：UNIQUE NULLS NOT DISTINCT 真的下发
# ---------------------------------------------------------------------------


def test_create_tables_pg_ddl_contains_nulls_not_distinct():
    """D-008@v1：_create_tables 在 PG 方言 mock engine 下的建表 DDL 含
    NULLS NOT DISTINCT（platform 行 grantee_id=NULL 唯一性的唯一保障）。"""
    mod = _load_migration("20260828120000")
    statements: list[str] = []

    def _dump(sql, *args, **kwargs):
        statements.append(str(sql.compile(dialect=pg_engine.dialect)).strip() + ";")

    pg_engine = sa.create_mock_engine("postgresql://", _dump)
    # MockConnection 不支持 with（无上下文管理器协议），直连直用。
    conn = pg_engine.connect()
    prev, ops = _bind_op(conn)
    try:
        mod._create_tables()
    finally:
        _unbind_op(prev, ops)

    ddl = "\n".join(statements)
    assert "CREATE TABLE daemon_runtime_grants" in ddl
    assert "UNIQUE NULLS NOT DISTINCT" in ddl, (
        f"PG 建表 DDL 缺 NULLS NOT DISTINCT（D-008@v1）：{ddl}"
    )
    assert "uq_daemon_runtime_grants" in ddl
    # 审计加列也在 DDL 段。
    assert any("daemon_borrow_audit" in s and "grant_id" in s for s in statements)


# ---------------------------------------------------------------------------
# 3. SQLite replay：存量迁移两分支 + 审计加列
# ---------------------------------------------------------------------------

# 迁移前旧形态表：仅覆盖 upgrade 涉及的列（workspace_member_runtimes 的
# workspace_id/user_id/daemon_id/shared + daemon_borrow_audit 最小列集）。
# 每条一个元素——SQLite 经 SQLAlchemy 一次只能执行一条语句（precedent 同款约束）。
_OLD_FORM_STATEMENTS = (
    """
    CREATE TABLE workspace_member_runtimes (
        workspace_id CHAR(32) NOT NULL,
        user_id CHAR(32) NOT NULL,
        daemon_id CHAR(32),
        shared BOOLEAN NOT NULL DEFAULT 0
    )
    """,
    """
    CREATE TABLE daemon_borrow_audit (
        id CHAR(32) PRIMARY KEY,
        borrowed_at DATETIME
    )
    """,
)


def _seed_bindings(conn) -> dict[str, str]:
    """三类存量行：正常 shared 行 / daemon_id NULL 的 shared 行 / 未共享行。"""
    ids = {
        "ws_ok": uuid.uuid4().hex,
        "ws_null_daemon": uuid.uuid4().hex,
        "ws_not_shared": uuid.uuid4().hex,
        "lender": uuid.uuid4().hex,
        "lender2": uuid.uuid4().hex,
        "daemon": uuid.uuid4().hex,
    }
    conn.execute(
        sa.text(
            "INSERT INTO workspace_member_runtimes "
            "(workspace_id, user_id, daemon_id, shared) VALUES "
            f"('{ids['ws_ok']}', '{ids['lender']}', '{ids['daemon']}', 1), "
            f"('{ids['ws_null_daemon']}', '{ids['lender']}', NULL, 1), "
            f"('{ids['ws_not_shared']}', '{ids['lender2']}', '{ids['daemon']}', 0)"
        )
    )
    return ids


def test_sqlite_replay_backfill_and_skip(capsys):
    """正常行迁移 / daemon_id NULL 行跳过（日志含计数）/ 未共享行不动（D-008@v1）。"""
    mod = _load_migration("20260828120000")
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        for stmt in _OLD_FORM_STATEMENTS:
            conn.execute(sa.text(stmt))
        ids = _seed_bindings(conn)

    with engine.begin() as conn:
        prev, ops = _bind_op(conn)
        try:
            mod.upgrade()
        finally:
            _unbind_op(prev, ops)

    out = capsys.readouterr().out
    assert "migrated 1 shared binding(s)" in out
    assert "skipped 1 row(s) with daemon_id IS NULL" in out

    with engine.begin() as conn:
        insp = sa.inspect(conn)
        # grants 表结构：grant_id 相关列 + grantee 可空 + enabled 默认 true。
        cols = {c["name"]: c for c in insp.get_columns("daemon_runtime_grants")}
        assert set(cols) >= {
            "id",
            "daemon_instance_id",
            "grantee_type",
            "grantee_id",
            "granted_by_user_id",
            "agent_profile_id",
            "source_workspace_id",
            "pinned_runtime_id",
            "writable_dir",
            "enabled",
            "created_at",
            "updated_at",
        }
        assert cols["grantee_id"]["nullable"] is True

        # 迁移产物：仅正常 shared 行生成一条 workspace grant。
        rows = conn.execute(
            sa.text(
                "SELECT daemon_instance_id, grantee_type, grantee_id, "
                "granted_by_user_id, enabled FROM daemon_runtime_grants"
            )
        ).fetchall()
        assert len(rows) == 1
        daemon_id, grantee_type, grantee_id, granted_by, enabled = rows[0]
        assert daemon_id == ids["daemon"]
        assert grantee_type == "workspace"
        assert grantee_id == ids["ws_ok"]
        assert granted_by == ids["lender"]
        assert enabled in (1, True)  # SQLite 存 0/1

        # 审计表加列：nullable、无 FK。
        audit_cols = {c["name"]: c for c in insp.get_columns("daemon_borrow_audit")}
        assert "grant_id" in audit_cols
        assert audit_cols["grant_id"]["nullable"] is True
        audit_fks = [
            fk
            for fk in insp.get_foreign_keys("daemon_borrow_audit")
            if "grant_id" in fk["constrained_columns"]
        ]
        assert audit_fks == []


def test_sqlite_replay_downgrade_drops_table_and_column():
    """downgrade 对称：删 daemon_borrow_audit.grant_id + 删 daemon_runtime_grants 表。"""
    mod = _load_migration("20260828120000")
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        for stmt in _OLD_FORM_STATEMENTS:
            conn.execute(sa.text(stmt))
        _seed_bindings(conn)

    with engine.begin() as conn:
        prev, ops = _bind_op(conn)
        try:
            mod.upgrade()
        finally:
            _unbind_op(prev, ops)
    with engine.begin() as conn:
        prev, ops = _bind_op(conn)
        try:
            mod.downgrade()
        finally:
            _unbind_op(prev, ops)

    with engine.begin() as conn:
        insp = sa.inspect(conn)
        assert "daemon_runtime_grants" not in insp.get_table_names()
        audit_cols = {c["name"] for c in insp.get_columns("daemon_borrow_audit")}
        assert "grant_id" not in audit_cols
        # 源表不动（shared 列保留为 UI 缓存，本卡不碰）。
        assert "workspace_member_runtimes" in insp.get_table_names()
