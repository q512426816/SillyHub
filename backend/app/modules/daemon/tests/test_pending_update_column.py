"""daemon_instances.pending_update 列 + 迁移可逆性单测（task-02 / FR-04 / D-004@v1）.

覆盖两层：

* **模型层**（root ``conftest.db_session``，SQLite in-memory create_all）：列声明
  存在 / JSON 类型 / nullable；新行默认 NULL；心跳携带的 pending dict
  ``{reason, current_version, target_version, since}``（design §5 心跳体 + since
  语义）写读往返；置 None 落回 NULL（升级执行/取消的清除语义，task-06 消费）。
* **迁移层**（照 ``test_daemon_started_at.py`` 惯例）：直接驱动 migration 模块的
  ``upgrade()`` / ``downgrade()``，绑定到临时 SQLite 连接的 ``alembic.op`` 上下文
  （``MigrationContext`` + ``Operations.context``），不依赖完整 alembic 树 /
  env.py / async engine。upgrade 后 inspector 见列，downgrade 后列消失，再
  upgrade 恢复（幂等可逆）。
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import JSON, create_engine, inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance

_MIGRATION_FILENAME = "202608291500_add_daemon_pending_update.py"
_REVISION = "20260829150000"

# design §5：心跳体 {reason, current_version, target_version} + backend 落库补 since。
_PENDING_PAYLOAD = {
    "reason": "server_command",
    "current_version": "0.9.0",
    "target_version": "0.9.1",
    "since": "2026-08-29T15:00:00+08:00",
}


# ---------------------------------------------------------------------------
# 模型层：列声明 / 默认 NULL / JSON dict 往返
# ---------------------------------------------------------------------------


def test_column_declared_json_nullable() -> None:
    """模型声明 pending_update 列：JSON 类型、nullable（照 capabilities 先例）。"""
    columns = DaemonInstance.__table__.columns
    assert "pending_update" in columns, "DaemonInstance 应声明 pending_update 列"
    col = columns["pending_update"]
    assert isinstance(col.type, JSON)
    assert col.nullable is True


async def _seed_instance(
    db_session: AsyncSession, *, pending: dict | None = None
) -> DaemonInstance:
    """种一个 user + DaemonInstance（FK 闭包最小集），pending_update 可注入。"""
    user = User(
        id=uuid.uuid4(),
        email=f"u-{uuid.uuid4()}@example.com",
        password_hash="x",
        display_name="u",
        status="active",
    )
    db_session.add(user)
    await db_session.commit()

    instance = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user.id,
        hostname="host-a",
        server_url="https://example.com",
        pending_update=pending,
    )
    db_session.add(instance)
    await db_session.commit()
    await db_session.refresh(instance)
    return instance


@pytest.mark.asyncio
async def test_new_row_defaults_to_null(db_session: AsyncSession) -> None:
    """不显式赋值时（存量/新行）pending_update 默认 NULL=无待升级。"""
    instance = await _seed_instance(db_session)
    instance_id = instance.id  # expire_all 前取，避免异步下触发 lazy refresh

    db_session.expire_all()
    reloaded = (
        await db_session.execute(select(DaemonInstance).where(DaemonInstance.id == instance_id))
    ).scalar_one()
    assert reloaded.pending_update is None


@pytest.mark.asyncio
async def test_pending_dict_roundtrip_and_clear(db_session: AsyncSession) -> None:
    """心跳携带的 pending dict 写读往返；置 None 落回 NULL（清除语义）。"""
    instance = await _seed_instance(db_session, pending=dict(_PENDING_PAYLOAD))
    instance_id = instance.id  # expire_all 前取，避免异步下触发 lazy refresh

    db_session.expire_all()
    reloaded = (
        await db_session.execute(select(DaemonInstance).where(DaemonInstance.id == instance_id))
    ).scalar_one()
    assert reloaded.pending_update == _PENDING_PAYLOAD

    # 清除：task-06 心跳无该字段置 NULL；列层验证 None 可写且读回 NULL。
    reloaded.pending_update = None
    await db_session.commit()

    db_session.expire_all()
    cleared = (
        await db_session.execute(select(DaemonInstance).where(DaemonInstance.id == instance_id))
    ).scalar_one()
    assert cleared.pending_update is None


# ---------------------------------------------------------------------------
# 迁移层：upgrade / downgrade 幂等可逆（照 test_daemon_started_at.py 惯例）
# ---------------------------------------------------------------------------


def _load_migration_module() -> Any:
    """动态 import migration 文件（文件名 ``202608291500_add_daemon_pending_update.py``）。

    migration 模块在文件系统里、不在任何 package __init__ 链路上，用
    ``importlib.util.spec_from_file_location`` 加载。
    """
    import importlib.util
    from pathlib import Path

    migration_path = (
        Path(__file__).resolve().parents[4] / "migrations" / "versions" / (_MIGRATION_FILENAME)
    )
    assert migration_path.exists(), f"migration file not found: {migration_path}"
    spec = importlib.util.spec_from_file_location("daemon_pending_update_migration", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_with_op(conn: Any, fn: Any) -> None:
    """在 ``op`` 绑定到 conn 的上下文里执行 migration 函数（upgrade/downgrade）。

    alembic 的 ``op`` 是模块级代理，由 ``Operations.context(ops)`` 设为当前目标。
    ``MigrationContext.configure`` 必须显式给 ``opts={}``（不传时 opts 为 None，
    SchemaObjects 取 ``opts['target_metadata']`` 触发 AttributeError）；
    add_column/drop_column 不依赖 target_metadata。
    """
    mc = MigrationContext.configure(conn, opts={})
    with Operations.context(mc):
        fn()


def _has_pending_update_column(conn: Any) -> bool:
    return "pending_update" in {c["name"] for c in inspect(conn).get_columns("daemon_instances")}


def _seed_daemon_instances_table(conn: Any) -> None:
    """在临时 SQLite 里建一个最小化 daemon_instances 表（迁移前基线 schema）。

    不需要完整复刻所有列/约束——本测试只验证 ``pending_update`` 列的 add/drop
    可逆性，inspector 只看列名集合。基线给 id 主键 + 几个必备 NOT NULL 列即可。
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


def test_migration_upgrade_adds_pending_update_then_downgrade_drops_then_re_adds() -> None:
    """upgrade → 列出现；downgrade → 列消失；再 upgrade → 恢复（幂等可逆）。"""
    migration = _load_migration_module()

    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        _seed_daemon_instances_table(conn)
        assert not _has_pending_update_column(conn), "基线不应有 pending_update 列"

        _run_with_op(conn, migration.upgrade)
        assert _has_pending_update_column(conn), "upgrade 后应有 pending_update 列"

        _run_with_op(conn, migration.downgrade)
        assert not _has_pending_update_column(conn), "downgrade 后 pending_update 列应消失"

        _run_with_op(conn, migration.upgrade)
        assert _has_pending_update_column(conn), "再 upgrade 后 pending_update 列应恢复"


def test_migration_revision_chain_intact() -> None:
    """migration 文件结构 sanity：revision 唯一标识且 down_revision 指向前驱。

    guardrail：避免误把同一 revision id 用在另一条迁移上（alembic 会冲突）。
    """
    migration = _load_migration_module()
    assert migration.revision == _REVISION
    assert migration.down_revision is not None, "down_revision 应指向前一个 head"
    assert callable(migration.upgrade)
    assert callable(migration.downgrade)
