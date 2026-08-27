"""DaemonRuntimeGrant 模型契约 + 持久化单测（task-01 / design §8）。

覆盖：表注册与列映射（可空性/默认值）、索引与唯一约束（含 PG 方言
NULLS NOT DISTINCT 下发断言——D-008@v1）、workspace 行重复插入被拒、
DaemonBorrowAudit.grant_id 列存在且可空无 FK。
"""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateTable
from sqlmodel import SQLModel

from app.modules.agent.model import DaemonBorrowAudit
from app.modules.daemon.grants.model import DaemonRuntimeGrant


def test_grant_is_registered_table_model() -> None:
    """DaemonRuntimeGrant 必须是注册到 metadata 的表模型（create_all/autogenerate 可扫到）。"""
    assert issubclass(DaemonRuntimeGrant, SQLModel)
    assert DaemonRuntimeGrant.__tablename__ == "daemon_runtime_grants"
    assert "daemon_runtime_grants" in SQLModel.metadata.tables


def test_grant_field_contract_design_section8() -> None:
    """字段集与 design §8 一一对应；read_only 列不建（D-002@v2 由 writable_dir 取代）。"""
    fields = set(DaemonRuntimeGrant.model_fields.keys())
    expected = {
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
    assert fields == expected
    assert "read_only" not in fields, "read_only 已废（D-002@v2），写约束由 writable_dir 承载"


def test_grant_column_nullability() -> None:
    """可空性契约：核心授权列 NOT NULL；grantee_id 与 platform 绑定列可空（§8）。"""
    table = DaemonRuntimeGrant.__table__
    cols = {c.name: c for c in table.columns}
    for required in ("id", "daemon_instance_id", "grantee_type", "granted_by_user_id"):
        assert cols[required].nullable is False, f"{required} must be NOT NULL"
    # platform 行为 NULL / workspace 绑定列全 NULL——模型层一律可空（service 校验归 task-04）。
    for optional in (
        "grantee_id",
        "agent_profile_id",
        "source_workspace_id",
        "pinned_runtime_id",
        "writable_dir",
    ):
        assert cols[optional].nullable is True, f"{optional} must be nullable"
    # enabled NOT NULL + server_default true（对齐 member_runtimes.shared 列惯例）。
    assert cols["enabled"].nullable is False
    assert cols["enabled"].server_default is not None
    assert cols["enabled"].server_default.arg.text == "true"


def test_grant_indexes_present() -> None:
    """索引就位：(grantee_type, grantee_id) 授权查询 + (granted_by_user_id) lender 视图。"""
    index_names = {idx.name for idx in DaemonRuntimeGrant.__table__.indexes}
    assert "ix_daemon_runtime_grants_grantee" in index_names
    assert "ix_daemon_runtime_grants_lender" in index_names


def test_grant_unique_constraint_nulls_not_distinct_on_pg() -> None:
    """D-008@v1：唯一约束四列齐全，且 PG 方言下 DDL 含 NULLS NOT DISTINCT。

    SQLite create_all 时该方言 kwarg 被忽略退化为普通 UNIQUE（platform 行
    grantee_id=NULL 的唯一性在 SQLite 下不生效，属方言限制——PG 部署方言才保证，
    故 platform 行重复插入的唯一性断言只对 PG DDL 生效，不在 SQLite 上测）。
    """
    table = DaemonRuntimeGrant.__table__
    uq = [c for c in table.constraints if c.__class__.__name__ == "UniqueConstraint"]
    assert len(uq) == 1
    constraint = uq[0]
    assert [col.name for col in constraint.columns] == [
        "daemon_instance_id",
        "grantee_type",
        "grantee_id",
        "granted_by_user_id",
    ]
    # 方言选项断言：PG 下启用 NULLS NOT DISTINCT。
    assert constraint.dialect_options["postgresql"]["nulls_not_distinct"] is True
    # PG 方言真实编译 DDL——NULLS NOT DISTINCT 字样必须出现。
    ddl = str(CreateTable(table).compile(dialect=postgresql.dialect()))
    assert "UNIQUE NULLS NOT DISTINCT" in ddl, (
        f"PG DDL 缺 NULLS NOT DISTINCT（platform 行将可重复插入，D-008@v1）：{ddl}"
    )


def test_grant_defaults_on_instantiation() -> None:
    """默认值：id 自动 uuid4、enabled 默认 True、时间戳自动填充。"""
    grant = DaemonRuntimeGrant(
        daemon_instance_id=uuid.uuid4(),
        grantee_type="platform",
        granted_by_user_id=uuid.uuid4(),
    )
    assert isinstance(grant.id, uuid.UUID)
    assert grant.enabled is True
    assert isinstance(grant.created_at, datetime)
    assert isinstance(grant.updated_at, datetime)


def test_platform_row_constructible_with_null_binding_columns() -> None:
    """platform 行形态：grantee_id=None + 绑定列可空可填（service 强制归 task-04）。"""
    profile_id, ws_id, runtime_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    grant = DaemonRuntimeGrant(
        daemon_instance_id=uuid.uuid4(),
        grantee_type="platform",
        grantee_id=None,
        granted_by_user_id=uuid.uuid4(),
        agent_profile_id=profile_id,
        source_workspace_id=ws_id,
        pinned_runtime_id=runtime_id,
        writable_dir="/srv/share/out",
    )
    assert grant.grantee_id is None
    assert grant.agent_profile_id == profile_id
    assert grant.source_workspace_id == ws_id
    assert grant.pinned_runtime_id == runtime_id
    assert grant.writable_dir == "/srv/share/out"


@pytest.mark.asyncio
async def test_grant_persist_and_query(db_session) -> None:
    """SQLite 内存库插入 + 回读（selected metadata 建表，ORM 全链路可用）."""
    daemon_id, ws_id, lender = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    grant = DaemonRuntimeGrant(
        daemon_instance_id=daemon_id,
        grantee_type="workspace",
        grantee_id=ws_id,
        granted_by_user_id=lender,
    )
    db_session.add(grant)
    await db_session.commit()
    await db_session.refresh(grant)

    rows = (
        (
            await db_session.execute(
                select(DaemonRuntimeGrant).where(DaemonRuntimeGrant.grantee_id == ws_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    row = rows[0]
    assert row.daemon_instance_id == daemon_id
    assert row.grantee_type == "workspace"
    assert row.granted_by_user_id == lender
    assert row.enabled is True
    # workspace 行不携带 platform 绑定列。
    assert row.agent_profile_id is None
    assert row.writable_dir is None


@pytest.mark.asyncio
async def test_workspace_grant_duplicate_rejected(db_session) -> None:
    """workspace 行（grantee_id 非 NULL）重复插入被唯一约束拒绝——SQLite 即可验证。"""
    daemon_id, ws_id, lender = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    first = DaemonRuntimeGrant(
        daemon_instance_id=daemon_id,
        grantee_type="workspace",
        grantee_id=ws_id,
        granted_by_user_id=lender,
    )
    db_session.add(first)
    await db_session.commit()

    dup = DaemonRuntimeGrant(
        daemon_instance_id=daemon_id,
        grantee_type="workspace",
        grantee_id=ws_id,
        granted_by_user_id=lender,
    )
    db_session.add(dup)
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()

    # granted_by 不同（第二个 lender）不触发唯一约束——同工作区允许多人共享（design §5）。
    second_lender = DaemonRuntimeGrant(
        daemon_instance_id=daemon_id,
        grantee_type="workspace",
        grantee_id=ws_id,
        granted_by_user_id=uuid.uuid4(),
    )
    db_session.add(second_lender)
    await db_session.commit()
    count = len((await db_session.execute(select(DaemonRuntimeGrant))).scalars().all())
    assert count == 2


def test_borrow_audit_grant_id_column_contract() -> None:
    """DaemonBorrowAudit.grant_id：存在、nullable、无 FK 硬约束（模型侧同步，design §8）。"""
    table = DaemonBorrowAudit.__table__
    cols = {c.name: c for c in table.columns}
    assert "grant_id" in cols
    grant_col = cols["grant_id"]
    assert grant_col.nullable is True
    # 无 FK 硬约束：grant 物理删除后审计行仍可读（与 borrower/lender 等 CASCADE FK 区分）。
    assert not list(grant_col.foreign_keys)
    # 模型字段默认 None（旧行/非借用路径不回填）。
    assert "grant_id" in DaemonBorrowAudit.model_fields
    assert DaemonBorrowAudit.model_fields["grant_id"].default is None
