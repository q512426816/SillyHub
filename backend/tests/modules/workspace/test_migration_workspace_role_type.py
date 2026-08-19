"""Migration test for workspace description column + legacy type CASE normalization.

Change 2026-08-18-workspace-role-type task-02（design §5.2/§8）：
workspaces 加 description TEXT NULL + 存量非空 type 幂等 CASE 收编（仅明确映射，
ELSE 保留原值——D-003@v1）。

覆盖（沿用 test_migration_borrow_shared 的 _load_migration 范式）：
  1. 迁移元数据：revision=20260818150000，down_revision 接 20260817100000
     （merge_quicklog_and_run_sender，当前唯一 head，单 head 接续）；
  2. ORM 表元数据：Workspace 表含 nullable 的 description 列；
  3. SQLite 内存库 replay：建旧形态表（无 description）跑 upgrade——
     插 web 与未知 legacy 值验证收编（web→frontend-code、未知值原样保留）、
     NULL 行不动、二次跑结果不变（幂等）、downgrade 删列。

注：SQLite replay 不跑 alembic 环境（直接调 upgrade()/downgrade()），PG 上
`alembic upgrade head` 的链路风险由 verify 阶段覆盖。
"""

from __future__ import annotations

import importlib
import os
from pathlib import Path

import sqlalchemy as sa

from app.modules.workspace.model import Workspace


def _load_migration(revision_id: str):
    """按 revision ID 在文件名里匹配，导入迁移模块（沿用 test_migration_borrow_shared 范式）。"""
    # 本测试文件: backend/tests/modules/workspace/test_migration_workspace_role_type.py
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
    """revision = 20260818150000；down_revision = 20260817100000（当前唯一 head）。

    多 agent 并行下 build 时已复核 alembic get_heads 为单值 20260817100000，
    本迁移接续后仍单 head（不撞 migration-chain-fragmentation-pattern）。
    """
    mod = _load_migration("20260818150000")
    assert mod.revision == "20260818150000"
    assert mod.down_revision == "20260817100000"
    assert mod.branch_labels is None
    assert mod.depends_on is None
    assert callable(mod.upgrade)
    assert callable(mod.downgrade)


# ---------------------------------------------------------------------------
# 2. ORM 表元数据已声明 description 列
# ---------------------------------------------------------------------------


def test_orm_table_declares_description():
    """Workspace 表元数据含 description 列且 nullable（dialect 无关 introspect）。"""
    cols = {c.name: c for c in Workspace.__table__.columns}
    assert "description" in cols
    assert cols["description"].nullable is True


# ---------------------------------------------------------------------------
# 3. upgrade / downgrade 在 SQLite 上 replay：收编 + 幂等 + 可逆
# ---------------------------------------------------------------------------

# 旧形态表：迁移前 workspaces 的最小列集（覆盖 upgrade 涉及的列即可）
_OLD_FORM_SQL = """
CREATE TABLE workspaces (
    id CHAR(32) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(50),
    role VARCHAR(100)
)
"""


def _run_upgrade(engine) -> None:
    """replay 迁移 upgrade() 本体（add_column + 收编 UPDATE）。

    迁移文件用裸 ``op.*`` 调用——proxy 函数在 ``alembic.op`` 模块 globals 里
    解析 ``_proxy`` 名（alembic Operations.create_module_class_proxy 机制），
    故 setattr 挂载 Operations 实例即可让迁移体在一个已 bind 的连接上执行。
    """
    mod = _load_migration("20260818150000")
    with engine.begin() as conn:
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        ctx = MigrationContext.configure(conn)
        ops = Operations(ctx)
        import alembic

        prev = getattr(alembic.op, "_proxy", None)
        alembic.op._proxy = ops
        try:
            mod.upgrade()
        finally:
            if prev is None:
                if getattr(alembic.op, "_proxy", None) is ops:
                    delattr(alembic.op, "_proxy")
            else:
                alembic.op._proxy = prev


def _query_types(conn) -> list[tuple[str, str | None]]:
    rows = conn.execute(sa.text("SELECT name, type FROM workspaces ORDER BY name")).fetchall()
    return [(r[0], r[1]) for r in rows]


def test_migration_replay_normalize_idempotent_downgrade():
    """SQLite replay：web→frontend-code 收编、未知值原样、NULL 不动、幂等、downgrade 删列。"""
    engine = sa.create_engine("sqlite:///:memory:")

    # 建旧形态表（无 description 列）并插存量数据
    with engine.begin() as conn:
        conn.execute(sa.text(_OLD_FORM_SQL))
        conn.execute(
            sa.text(
                "INSERT INTO workspaces (id, name, type, role) VALUES "
                "('a', 'web-ws', 'web', NULL), "
                "('b', 'unknown-ws', 'custom-thing', NULL), "
                "('c', 'null-type-ws', NULL, NULL), "
                "('d', 'already-new', 'backend-code', NULL), "
                "('e', 'service-ws', 'service', NULL)"
            )
        )

    # replay upgrade：加列 + 收编
    _run_upgrade(engine)

    with engine.begin() as conn:
        insp = sa.inspect(conn)
        cols = {c["name"]: c for c in insp.get_columns("workspaces")}
        assert "description" in cols
        assert cols["description"]["nullable"] is True

        assert _query_types(conn) == [
            ("already-new", "backend-code"),  # 已是词表值，CASE ELSE 原样
            ("null-type-ws", None),  # NULL 行不动（WHERE type IS NOT NULL）
            ("service-ws", "backend-code"),  # service → backend-code
            ("unknown-ws", "custom-thing"),  # 未知值保留原值（D-003@v1）
            ("web-ws", "frontend-code"),  # web → frontend-code
        ]
        # 新列对旧行为 NULL（无 server_default）
        desc = conn.execute(
            sa.text("SELECT description FROM workspaces WHERE name = 'web-ws'")
        ).scalar()
        assert desc is None

    # 幂等：再跑一遍 upgrade 的收编 UPDATE + add_column 不在（列已存在则报错，
    # 故只重放 UPDATE 语义）——直接再调 mod.upgrade() 会因列已存在失败，
    # 用原始 SQL 重放收编子句验证幂等。
    mod = _load_migration("20260818150000")
    with engine.begin() as conn:
        # 从迁移模块抽 CASE 主体重放（同一段 SQL 跑两遍结果不变）
        conn.execute(
            sa.text(
                f"""
                UPDATE workspaces SET type = CASE type{mod._CASE_WHEN}
                ELSE type END
                WHERE type IS NOT NULL
                """
            )
        )
        assert _query_types(conn) == [
            ("already-new", "backend-code"),
            ("null-type-ws", None),
            ("service-ws", "backend-code"),
            ("unknown-ws", "custom-thing"),
            ("web-ws", "frontend-code"),
        ]

    # replay downgrade：删 description 列（type 不回滚——不可逆）
    with engine.begin() as conn:
        import alembic
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        ctx = MigrationContext.configure(conn)
        ops = Operations(ctx)
        prev = getattr(alembic.op, "_proxy", None)
        alembic.op._proxy = ops
        try:
            mod.downgrade()
        finally:
            if prev is None:
                if getattr(alembic.op, "_proxy", None) is ops:
                    delattr(alembic.op, "_proxy")
            else:
                alembic.op._proxy = prev

    with engine.begin() as conn:
        insp = sa.inspect(conn)
        cols = {c["name"] for c in insp.get_columns("workspaces")}
        assert "description" not in cols
        # 收编后的 type 保留（不可逆语义）
        assert _query_types(conn)[4] == ("web-ws", "frontend-code")
