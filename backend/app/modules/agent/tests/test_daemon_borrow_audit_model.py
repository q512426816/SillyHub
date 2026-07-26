"""DaemonBorrowAudit model + migration contract tests.

Change 2026-07-25-daemon-borrow-for-business task-02 / FR-07 / D-004@v1：
daemon_borrow_audit 审计表（不限额度，仅记录每次借用）。

覆盖：
  1. 表契约：表名 / 字段全集 / 类型 / nullable；
  2. FK ondelete 语义：borrower/lender/workspace/agent_run CASCADE，
     daemon_instance RESTRICT（design §8）；
  3. usage_summary JSON nullable（D-004 先记基础字段，不实现额度限额）；
  4. 迁移元数据：revision=202607251500，down_revision=202607251400（接 task-01
     单 head，避免多 head 分叉，见 migration-chain-fragmentation-pattern 记忆）；
  5. 迁移 upgrade/downgrade 在 SQLite 上可逆（replay create_table / drop_table）。

注：SQLite 单测跑不出 alembic 多分支 down_revision 撞 head 的迁移链断裂，
该风险由 PG 上 `alembic upgrade head` verify 覆盖（design §10 R-01）。
"""

from __future__ import annotations

import importlib
import os
import types
import uuid
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.models.base import BaseModel
from app.modules.agent.model import DaemonBorrowAudit

# ---------------------------------------------------------------------------
# 0. 迁移模块加载助手（沿用 task-01 / daemon-entity-binding 测试范式）
# ---------------------------------------------------------------------------


def _load_migration(revision_id: str):
    """按 revision ID 在文件名里匹配，导入迁移模块。"""
    # 本测试文件: backend/app/modules/agent/tests/test_daemon_borrow_audit_model.py
    # → 5 级 parent 到 backend/
    backend_root = Path(__file__).resolve().parent.parent.parent.parent.parent
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and revision_id in f and f != "__init__.py":
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {revision_id} in {versions_dir}")


# ---------------------------------------------------------------------------
# 1. 表契约：表名 / 字段 / 继承 BaseModel
# ---------------------------------------------------------------------------


def test_daemon_borrow_audit_tablename() -> None:
    assert DaemonBorrowAudit.__tablename__ == "daemon_borrow_audit"


def test_daemon_borrow_audit_inherits_basemodel() -> None:
    """继承 BaseModel → 共享 SQLModel metadata（alembic autogenerate 扫描入口）。"""
    assert issubclass(DaemonBorrowAudit, BaseModel)


def test_daemon_borrow_audit_has_all_8_fields() -> None:
    expected = {
        "id",
        "borrower_user_id",
        "lender_user_id",
        "daemon_instance_id",
        "workspace_id",
        "agent_run_id",
        "borrowed_at",
        "usage_summary",
    }
    actual = set(DaemonBorrowAudit.model_fields.keys())
    assert actual == expected, (
        f"DaemonBorrowAudit field mismatch. missing={expected - actual}, extra={actual - expected}"
    )


def test_daemon_borrow_audit_id_is_pk_uuid() -> None:
    col = DaemonBorrowAudit.__table__.columns["id"]
    assert col.primary_key is True
    assert col.nullable is False


# ---------------------------------------------------------------------------
# 2. FK ondelete 语义（design §8：user/workspace/run CASCADE，daemon RESTRICT）
# ---------------------------------------------------------------------------


def _fk_ondelete(field_name: str) -> str | None:
    col = DaemonBorrowAudit.__table__.columns[field_name]
    fks = list(col.foreign_keys)
    assert len(fks) == 1, f"expected 1 FK on {field_name}, got {len(fks)}"
    return fks[0].ondelete


def test_borrower_user_id_fk_users_cascade() -> None:
    """borrower_user_id → users.id，CASCADE（借用人删除则审计随之清理）。"""
    col = DaemonBorrowAudit.__table__.columns["borrower_user_id"]
    assert col.nullable is False
    fk = next(iter(col.foreign_keys))
    assert fk.column.table.name == "users"
    assert fk.column.name == "id"
    assert fk.ondelete == "CASCADE"


def test_lender_user_id_fk_users_cascade() -> None:
    """lender_user_id → users.id，CASCADE。"""
    col = DaemonBorrowAudit.__table__.columns["lender_user_id"]
    assert col.nullable is False
    fk = next(iter(col.foreign_keys))
    assert fk.column.table.name == "users"
    assert fk.column.name == "id"
    assert fk.ondelete == "CASCADE"


def test_daemon_instance_id_fk_restrict() -> None:
    """daemon_instance_id → daemon_instances.id，RESTRICT。

    D-004 审计红线：daemon 实例被引用时禁止删除（保留审计链完整），与
    design §8 一致；区别于其它 CASCADE 外键。
    """
    col = DaemonBorrowAudit.__table__.columns["daemon_instance_id"]
    assert col.nullable is False
    fk = next(iter(col.foreign_keys))
    assert fk.column.table.name == "daemon_instances"
    assert fk.column.name == "id"
    assert fk.ondelete == "RESTRICT"


def test_workspace_id_fk_cascade() -> None:
    col = DaemonBorrowAudit.__table__.columns["workspace_id"]
    assert col.nullable is False
    fk = next(iter(col.foreign_keys))
    assert fk.column.table.name == "workspaces"
    assert fk.column.name == "id"
    assert fk.ondelete == "CASCADE"


def test_agent_run_id_fk_cascade() -> None:
    col = DaemonBorrowAudit.__table__.columns["agent_run_id"]
    assert col.nullable is False
    fk = next(iter(col.foreign_keys))
    assert fk.column.table.name == "agent_runs"
    assert fk.column.name == "id"
    assert fk.ondelete == "CASCADE"


def test_ondelete_contract_summary() -> None:
    """一目了然的 ondelete 矩阵断言（任一漂移立刻定位）。"""
    assert _fk_ondelete("borrower_user_id") == "CASCADE"
    assert _fk_ondelete("lender_user_id") == "CASCADE"
    assert _fk_ondelete("daemon_instance_id") == "RESTRICT"
    assert _fk_ondelete("workspace_id") == "CASCADE"
    assert _fk_ondelete("agent_run_id") == "CASCADE"


# ---------------------------------------------------------------------------
# 3. borrowed_at / usage_summary 类型 + nullable
# ---------------------------------------------------------------------------


def test_borrowed_at_is_tz_datetime_not_null() -> None:
    col = DaemonBorrowAudit.__table__.columns["borrowed_at"]
    assert col.nullable is False
    assert isinstance(col.type, sa.DateTime)
    assert col.type.timezone is True


def test_usage_summary_is_json_nullable() -> None:
    """D-004：先记基础字段，usage_summary 暂存 token/turn 数等明细，nullable。"""
    col = DaemonBorrowAudit.__table__.columns["usage_summary"]
    assert col.nullable is True
    assert isinstance(col.type, sa.JSON)


def test_defaults_borrowed_at_factory_present() -> None:
    """borrowed_at 有默认工厂，service 落库时可不显式传。"""
    field = DaemonBorrowAudit.model_fields["borrowed_at"]
    assert field.default_factory is not None


def test_defaults_id_and_usage_summary() -> None:
    record = DaemonBorrowAudit(
        borrower_user_id=uuid.uuid4(),
        lender_user_id=uuid.uuid4(),
        daemon_instance_id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        agent_run_id=uuid.uuid4(),
    )
    assert record.id is not None  # default_factory uuid4
    assert record.borrowed_at is not None  # default_factory now(UTC)
    assert record.usage_summary is None  # nullable, 默认 None


# ---------------------------------------------------------------------------
# 4. 迁移元数据（revision 链接 task-01 head）
# ---------------------------------------------------------------------------


def test_migration_metadata() -> None:
    """revision=202607251500；down_revision=202607251400（task-01，alembic heads
    实测当前单 head）。单 head 接续，不撞多 head 分叉。renumber ql-20260726-001-ac8a。"""
    mod = _load_migration("202607251500")
    assert mod.revision == "202607251500"
    assert mod.down_revision == "202607251400"
    assert mod.branch_labels is None
    assert mod.depends_on is None
    assert callable(mod.upgrade)
    assert callable(mod.downgrade)


# ---------------------------------------------------------------------------
# 5. 迁移 upgrade/downgrade 在 SQLite 上可逆
# ---------------------------------------------------------------------------


def test_migration_upgrade_downgrade_reversibility_sqlite() -> None:
    """replay 迁移 upgrade() / downgrade()，证明 create_table + 索引可逆。

    直接调 op.create_table（dialect-portable sa.Uuid / sa.DateTime / sa.JSON）
    在 SQLite 内存库可跑；downgrade drop_index + drop_table 反向清理。
    """
    from alembic.operations import Operations

    engine = sa.create_engine("sqlite:///:memory:")
    # 先建被引用的父表（FK 目标），满足引用完整性约束
    parent_ddl = [
        "CREATE TABLE users (id CHAR(32) PRIMARY KEY)",
        "CREATE TABLE daemon_instances (id CHAR(32) PRIMARY KEY)",
        "CREATE TABLE workspaces (id CHAR(32) PRIMARY KEY)",
        "CREATE TABLE agent_runs (id CHAR(32) PRIMARY KEY)",
    ]
    with engine.begin() as conn:
        for ddl in parent_ddl:
            conn.execute(sa.text(ddl))

    mod = _load_migration("202607251500")

    # replay upgrade
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        op_inst = Operations(ctx)
        _run_upgrade(op_inst, mod)

    with engine.connect() as conn:
        insp = sa.inspect(conn)
        tables = set(insp.get_table_names())
        assert "daemon_borrow_audit" in tables
        cols = {c["name"]: c for c in insp.get_columns("daemon_borrow_audit")}
        assert set(cols.keys()) == {
            "id",
            "borrower_user_id",
            "lender_user_id",
            "daemon_instance_id",
            "workspace_id",
            "agent_run_id",
            "borrowed_at",
            "usage_summary",
        }
        # 关键 nullable 断言
        assert cols["borrower_user_id"]["nullable"] is False
        assert cols["lender_user_id"]["nullable"] is False
        assert cols["daemon_instance_id"]["nullable"] is False
        assert cols["workspace_id"]["nullable"] is False
        assert cols["agent_run_id"]["nullable"] is False
        assert cols["borrowed_at"]["nullable"] is False
        assert cols["usage_summary"]["nullable"] is True
        # FK ondelete 在 SQLite introspect 拿不到 ondelete（SQLite 不存），
        # 但 FK 目标表名可校验
        fks = {fk["referred_table"] for fk in insp.get_foreign_keys("daemon_borrow_audit")}
        assert fks == {"users", "daemon_instances", "workspaces", "agent_runs"}

    # replay downgrade
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        op_inst = Operations(ctx)
        _run_downgrade(op_inst, mod)

    with engine.connect() as conn:
        insp = sa.inspect(conn)
        assert "daemon_borrow_audit" not in insp.get_table_names()


def _run_upgrade(op_inst: Operations, mod: types.ModuleType) -> None:
    """把 Operations 实例注入迁移模块的 `op` 全局名，再调 upgrade()。

    迁移体用 `from alembic import op` 在模块加载时绑定 op 全局；覆盖模块属性
    使迁移体内 `op.create_table(...)` 作用于我们的 SQLite conn。
    """
    mod.op = op_inst
    mod.upgrade()


def _run_downgrade(op_inst: Operations, mod: types.ModuleType) -> None:
    mod.op = op_inst
    mod.downgrade()
