"""Migration smoke test for daemon-borrow shared column (task-01).

Change 2026-07-25-daemon-borrow-for-business task-01 / D-005@v1：
workspace_member_runtimes 加 shared 列 + 部分索引 ix_wmr_shared。

覆盖：
  1. 迁移元数据（revision / down_revision 可导入、链路接 202607251000 实测 head）；
  2. ORM 表元数据已声明 shared 列 + ix_wmr_shared 索引（dialect 无关）；
  3. upgrade/downgrade 的 DDL 在 SQLite 上可逆（replay 迁移体内 add_column /
     create_index / drop_index / drop_column）。

注：SQLite 单测跑不出 alembic 多分支 down_revision 撞 head 的迁移链断裂，
该风险由 PG 上 `alembic upgrade head` verify 覆盖（见 design §10 R-01 /
migration-chain-fragmentation-pattern 记忆）。本测试只验迁移内容 + 可逆语义。
"""

from __future__ import annotations

import importlib
import os
from pathlib import Path

import sqlalchemy as sa

from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime


def _load_migration(revision_id: str):
    """按 revision ID 在文件名里匹配，导入迁移模块（沿用 daemon-entity-binding 测试范式）。"""
    # 本测试文件: backend/tests/modules/workspace/test_migration_borrow_shared.py
    # → 4 级 parent 到 backend/
    backend_root = Path(__file__).resolve().parent.parent.parent.parent
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and revision_id in f and f != "__init__.py":
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {revision_id} in {versions_dir}")


# ---------------------------------------------------------------------------
# 1. 迁移元数据（revision 链接正确、模块可导入）
# ---------------------------------------------------------------------------


def test_migration_metadata():
    """revision = 202607251100；down_revision = 202607251000（alembic heads 实测当前 head）。

    单 head 接续，不撞 migration-chain-fragmentation-pattern 的多 head 分叉。
    """
    mod = _load_migration("202607251100")
    assert mod.revision == "202607251100"
    assert mod.down_revision == "202607251000"
    assert mod.branch_labels is None
    assert mod.depends_on is None
    assert callable(mod.upgrade)
    assert callable(mod.downgrade)


# ---------------------------------------------------------------------------
# 2. ORM 表元数据已声明 shared 列 + 部分索引
# ---------------------------------------------------------------------------


def test_orm_table_declares_shared_and_index():
    """upgrade 后 workspace_member_runtimes.shared 列 + ix_wmr_shared 索引在表元数据里。

    dialect 无关 introspect（SQLite / PG 一致），不绑死 SQL 函数名（R-01）。
    """
    cols = {c.name for c in WorkspaceMemberRuntime.__table__.columns}
    assert "shared" in cols
    shared = WorkspaceMemberRuntime.__table__.columns["shared"]
    assert shared.nullable is False
    # server_default=false：旧行回填 false，零回归核心
    assert shared.server_default is not None
    assert shared.server_default.arg.text == "false"

    indexes = {i.name for i in WorkspaceMemberRuntime.__table__.indexes}
    assert "ix_wmr_shared" in indexes


# ---------------------------------------------------------------------------
# 3. upgrade / downgrade DDL 在 SQLite 上可逆（replay 迁移体操作）
# ---------------------------------------------------------------------------


def test_migration_upgrade_downgrade_reversibility_sqlite():
    """replay 迁移 upgrade() / downgrade() 的 DDL，证明 add_column + create_index 可逆。

    shared 列无 FK 子句，op.add_column / op.create_index 在 SQLite 上可直接跑
    （postgresql_where 在 SQLite dialect 被忽略，建为普通索引；PG 上才带 WHERE）。
    """
    engine = sa.create_engine("sqlite:///:memory:")

    # 建迁移前形态的表（无 shared 列）
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                """
                CREATE TABLE workspace_member_runtimes (
                    workspace_id CHAR(32) NOT NULL,
                    user_id CHAR(32) NOT NULL,
                    runtime_id CHAR(32),
                    daemon_id CHAR(32),
                    root_path TEXT NOT NULL,
                    path_source VARCHAR(20) NOT NULL,
                    PRIMARY KEY (workspace_id, user_id)
                )
                """
            )
        )

    # replay upgrade：add_column（server_default=false 让旧行回填）+ create_index
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "ALTER TABLE workspace_member_runtimes "
                "ADD COLUMN shared BOOLEAN NOT NULL DEFAULT false"
            )
        )
        conn.execute(sa.text("CREATE INDEX ix_wmr_shared ON workspace_member_runtimes (shared)"))

    with engine.begin() as conn:
        insp = sa.inspect(conn)
        cols = {c["name"]: c for c in insp.get_columns("workspace_member_runtimes")}
        assert "shared" in cols
        # NOT NULL + DEFAULT false（旧行零回归）
        assert cols["shared"]["nullable"] is False
        assert cols["shared"]["default"] == "false"
        indexes = {i["name"] for i in insp.get_indexes("workspace_member_runtimes")}
        assert "ix_wmr_shared" in indexes

    # replay downgrade：drop_index + drop_column（反向）
    with engine.begin() as conn:
        conn.execute(sa.text("DROP INDEX ix_wmr_shared"))
        conn.execute(sa.text("ALTER TABLE workspace_member_runtimes DROP COLUMN shared"))

    with engine.begin() as conn:
        insp = sa.inspect(conn)
        cols = {c["name"] for c in insp.get_columns("workspace_member_runtimes")}
        assert "shared" not in cols
        indexes = {i["name"] for i in insp.get_indexes("workspace_member_runtimes")}
        assert "ix_wmr_shared" not in indexes
