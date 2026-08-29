"""notifications 表模型 + 建表/回退迁移单测（task-01 / FR-01 / D-004@v1）.

覆盖两层（照 ``daemon/tests/test_pending_update_column.py`` 惯例）：

* **模型层**（root ``conftest.db_session``，SQLite in-memory create_all）：
  字段 / 长度 / 默认值与 design §8 一致——read_at 默认 NULL=未读、
  body/link/ref_* /dedupe_key nullable、created_at 自动填充；行写读往返。
* **迁移层**：直接驱动 migration 模块的 ``upgrade()`` / ``downgrade()``
  （MigrationContext + Operations.context 绑定临时 SQLite 连接），upgrade 后
  表 + 三索引存在，downgrade 后表消失，再 upgrade 恢复（幂等可逆）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect

from app.modules.auth.model import User
from app.modules.notification.model import Notification
from app.modules.workspace.model import Workspace

_MIGRATION_FILENAME = "20260829220000_add_notifications_table.py"
_REVISION = "20260829220000"

# design §8 三个普通索引（无唯一约束，D-009@v2 幂等由 service 存在性检查负责）。
_EXPECTED_INDEXES = {
    "ix_notifications_recipient_read_created",
    "ix_notifications_ref",
    "ix_notifications_workspace",
}


# ---------------------------------------------------------------------------
# 模型层：字段声明 / 默认值 / 往返
# ---------------------------------------------------------------------------


def test_model_columns_match_design() -> None:
    """字段集合 / 长度 / 可空性与 design §8 一致。"""
    columns = Notification.__table__.columns
    expected = {
        "id",
        "workspace_id",
        "recipient_user_id",
        "type",
        "title",
        "body",
        "link",
        "ref_type",
        "ref_id",
        "dedupe_key",
        "read_at",
        "created_at",
    }
    assert set(columns.keys()) == expected
    assert columns["type"].nullable is False
    assert columns["title"].nullable is False
    for name in ("body", "link", "ref_type", "ref_id", "dedupe_key", "read_at"):
        assert columns[name].nullable is True, f"{name} 应可空"
    assert columns["read_at"].default is None, "read_at 无默认值（NULL=未读由插入侧决定）"


def test_model_indexes_no_unique_constraint() -> None:
    """三个普通索引、无唯一约束 / dedupe_key 无独立索引（D-009@v2）。"""
    table = Notification.__table__
    index_names = {ix.name for ix in table.indexes}
    assert index_names == _EXPECTED_INDEXES
    for ix in table.indexes:
        assert ix.unique is None or ix.unique is False, f"{ix.name} 不应是唯一索引"
    assert not table.constraints or all(
        getattr(c, "unique", False) is not True for c in table.constraints
    ), "notifications 不设全局唯一约束"


async def test_row_roundtrip_defaults(db_session: Any) -> None:
    """新行 read_at/created_at 落库语义：read_at NULL=未读，created_at 自动填充。"""
    user = User(
        id=uuid.uuid4(),
        email=f"u-{uuid.uuid4()}@example.com",
        password_hash="x",
        display_name="u",
        status="active",
    )
    workspace = Workspace(
        id=uuid.uuid4(),
        name="ws",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/ws",
    )
    db_session.add(user)
    db_session.add(workspace)
    await db_session.commit()

    row = Notification(
        workspace_id=workspace.id,
        recipient_user_id=user.id,
        type="approval_pending",
        title="变更待审核",
        ref_type="change",
        ref_id=str(uuid.uuid4()),
        dedupe_key="c:gate",
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)

    assert row.read_at is None, "新通知默认未读（read_at IS NULL）"
    assert row.created_at is not None and isinstance(row.created_at, datetime)
    assert row.body is None and row.link is None

    # 标记已读后往返。
    row.read_at = datetime.now(UTC)
    await db_session.commit()
    await db_session.refresh(row)
    assert row.read_at is not None


# ---------------------------------------------------------------------------
# 迁移层：upgrade / downgrade 幂等可逆
# ---------------------------------------------------------------------------


def _load_migration_module() -> Any:
    """动态 import migration 文件（不在 package __init__ 链路上）。"""
    import importlib.util
    from pathlib import Path

    migration_path = (
        Path(__file__).resolve().parents[4] / "migrations" / "versions" / _MIGRATION_FILENAME
    )
    assert migration_path.exists(), f"migration file not found: {migration_path}"
    spec = importlib.util.spec_from_file_location("notifications_migration", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_with_op(conn: Any, fn: Any) -> None:
    """在 ``op`` 绑定到 conn 的上下文里执行 migration 函数（upgrade/downgrade）。"""
    mc = MigrationContext.configure(conn, opts={})
    with Operations.context(mc):
        fn()


def _index_names(conn: Any, table: str) -> set[str]:
    inspector = inspect(conn)
    names: set[str] = set()
    for ix in inspector.get_indexes(table):
        name = ix.get("name")
        if name:
            names.add(name)
    return names


def test_migration_upgrade_creates_table_and_indexes_then_downgrade_drops() -> None:
    """upgrade → 表 + 三索引出现；downgrade → 表消失；再 upgrade → 恢复。"""
    migration = _load_migration_module()

    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        assert "notifications" not in inspect(conn).get_table_names(), "基线不应有表"

        _run_with_op(conn, migration.upgrade)
        assert "notifications" in inspect(conn).get_table_names(), "upgrade 后应有表"
        assert _index_names(conn, "notifications") == _EXPECTED_INDEXES

        _run_with_op(conn, migration.downgrade)
        assert "notifications" not in inspect(conn).get_table_names(), "downgrade 后表应消失"

        _run_with_op(conn, migration.upgrade)
        assert "notifications" in inspect(conn).get_table_names(), "再 upgrade 后表应恢复"
        assert _index_names(conn, "notifications") == _EXPECTED_INDEXES


def test_migration_revision_chain_intact() -> None:
    """migration 文件结构 sanity：revision 唯一标识且 down_revision 指向前驱。"""
    migration = _load_migration_module()
    assert migration.revision == _REVISION
    assert migration.down_revision is not None, "down_revision 应指向前一个 head"
    assert callable(migration.upgrade)
    assert callable(migration.downgrade)
