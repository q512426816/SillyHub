"""daemon_instances.started_at migration 可逆性单测（task-06 / FR-02 / D-002@v1）.

直接驱动 migration 模块的 ``upgrade()`` / ``downgrade()`` 函数，绑定到一个临时
SQLite 连接的 ``alembic.op`` 上下文（``MigrationContext`` + ``EnvironmentContext``），
不依赖完整 alembic 树 / env.py / async engine。upgrade 后 inspector 看到
``started_at`` 列；downgrade 后列消失；再 upgrade 恢复。

这与 task-06 constraints「inspector 列结构」路径一致，且不绑死 PG 方言函数名
（``add_column`` / ``drop_column`` 在 SQLite 上的支持由 SQLAlchemy 方言提供）。

注：``DateTime(timezone=True)`` 在 SQLite 上仅作为列类型字符串 ``DATETIME`` 落库
（SQLite 不强制时区），不影响 add/drop 可逆性本身。
"""

from __future__ import annotations

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect


def _load_migration_module():
    """动态 import migration 文件（文件名 ``20260805110000_daemon_started_at.py``）。

    migration 模块在文件系统里、不在任何 package __init__ 链路上，用
    ``importlib.util.spec_from_file_location`` 加载。
    """
    import importlib.util
    from pathlib import Path

    migration_path = (
        Path(__file__).resolve().parents[4]
        / "migrations"
        / "versions"
        / "20260805110000_daemon_started_at.py"
    )
    assert migration_path.exists(), f"migration file not found: {migration_path}"
    spec = importlib.util.spec_from_file_location("daemon_started_at_migration", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_with_op(conn, fn) -> None:
    """在 ``op`` 绑定到 conn 的上下文里执行 migration 函数（upgrade/downgrade）。

    alembic 的 ``op`` 是模块级代理，由 ``Operations.context(ops)`` 设为当前目标。
    migration 函数里 ``op.add_column/drop_column`` → ``Operations.invoke`` →
    ``SchemaObjects`` 构造内部 schema 对象，期间读 ``migration_context.opts``。

    关键：``MigrationContext.configure(conn, opts={...})`` 必须显式给一个 ``opts``
    dict（哪怕空 dict）；不传时 ``opts`` 为 None，``SchemaObjects`` 取
    ``opts['target_metadata']`` 触发 ``AttributeError``。这里传 ``{}`` 即可，
    add_column/drop_column 不依赖 target_metadata。
    """
    mc = MigrationContext.configure(conn, opts={})
    # ``Operations.context(mc)`` 是 alembic 推荐的注入入口（contextmanager classmethod），
    # 内部 ``Operations(mc)`` + ``_install_proxy()`` 把 ``from alembic import op``
    # 的代理指向此 ops。注意参数是 ``MigrationContext``，不是 Operations。
    with Operations.context(mc):
        fn()


def _has_started_at_column(conn) -> bool:
    return "started_at" in {c["name"] for c in inspect(conn).get_columns("daemon_instances")}


def _seed_daemon_instances_table(conn) -> None:
    """在临时 SQLite 里建一个最小化的 daemon_instances 表（迁移前的基线 schema）。

    不需要完整复刻所有列 / 约束——本测试只验证 ``started_at`` 列的 add/drop 可逆性，
    inspector 只看列名集合里是否含 ``started_at``。基线表给一个 id 主键 + 几个必备
    NOT NULL 列即可（migration 的 add_column 不依赖其它列）。
    """
    from sqlalchemy import Column, MetaData, String, Table
    from sqlalchemy import types as sa_types

    metadata = MetaData()
    Table(
        "daemon_instances",
        metadata,
        Column("id", sa_types.String(36), primary_key=True),
        Column("hostname", String(255), nullable=False),
        Column("server_url", String(255), nullable=False),
        Column("status", String(20), nullable=False),
    )
    metadata.create_all(conn)


def test_migration_upgrade_adds_started_at_then_downgrade_drops_then_re_adds() -> None:
    """upgrade → ``started_at`` 列出现；downgrade → 列消失；再 upgrade → 恢复。"""
    migration = _load_migration_module()

    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        _seed_daemon_instances_table(conn)
        # 基线：迁移前无 started_at 列
        assert not _has_started_at_column(conn), "基线不应有 started_at 列"

        # upgrade head：列出现
        _run_with_op(conn, migration.upgrade)
        assert _has_started_at_column(conn), "upgrade 后应有 started_at 列"

        # downgrade -1：列消失
        _run_with_op(conn, migration.downgrade)
        assert not _has_started_at_column(conn), "downgrade 后 started_at 列应消失"

        # 再 upgrade head：列恢复（可重入，幂等）
        _run_with_op(conn, migration.upgrade)
        assert _has_started_at_column(conn), "再 upgrade 后 started_at 列应恢复"


def test_migration_revision_chain_intact() -> None:
    """migration 文件结构 sanity：revision / down_revision 非空且 revision 唯一标识。

    guardrail：避免误把同一 revision id 用在另一条迁移上（alembic 会冲突）。
    """
    migration = _load_migration_module()
    assert migration.revision == "20260805110000"
    assert migration.down_revision is not None, "down_revision 应指向前一个 head"
    # upgrade / downgrade 是可调用对象
    assert callable(migration.upgrade)
    assert callable(migration.downgrade)
