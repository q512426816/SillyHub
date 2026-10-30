"""business_member 补 ``change:read`` 迁移测试（2026-10-30-business-member-change-read）。

背景：``business_member`` 是 ``is_system=true`` 的系统内置角色，管理后台
``roles_service.update`` 抛 ``RoleSystemProtected`` 禁止编辑，因此补权限必须走迁移。
本测试在 SQLite 上真实执行迁移本体（``Operations.context``，非 replay），覆盖：

1. revision 链接（``20261030160000`` → ``20261023090100``，单 head 接续）；
2. upgrade 幂等——连续两次执行只留一行 ``change:read``，权限集 8 → 9；
3. downgrade 只删本授权，角色行与其他 3 条权限不动；
4. 角色不存在时 upgrade/downgrade 安全 no-op。
"""

from __future__ import annotations

import importlib
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

REVISION_ID = "20261030160000"
DOWN_REVISION_ID = "20261023090100"

BUSINESS_MEMBER_KEY = "business_member"
BASE_PERMISSIONS = ("task:run_agent", "daemon:borrow", "workspace:read")
GRANTED_PERMISSION = "change:read"


def _load_migration(revision_id: str):
    """按 revision ID 在文件名里匹配，导入迁移模块（沿用 test_business_member_role 范式）。"""
    # 本测试文件: backend/tests/modules/auth/test_business_member_change_read_migration.py
    # → 4 级 parent 到 backend/
    backend_root = Path(__file__).resolve().parent.parent.parent.parent
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and revision_id in f and f != "__init__.py":
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {revision_id} in {versions_dir}")


def _bootstrap_roles_tables_sqlite(conn) -> None:
    """用 ORM 元数据建 roles + role_permissions（含 ``Uuid`` 结果处理器）。"""
    from app.models.base import BaseModel
    from app.modules.auth import model as _auth_model

    BaseModel.metadata.create_all(
        conn,
        tables=[
            _auth_model.Role.__table__,
            _auth_model.RolePermission.__table__,
        ],
    )


def _seed_business_member(conn) -> uuid.UUID:
    """种 business_member 角色 + 迁移前的 3 条基础权限（对齐 202607251600）。"""
    from app.modules.auth.model import Role, RolePermission

    now = datetime.now(UTC)
    role_id = uuid.uuid4()
    conn.execute(
        Role.__table__.insert().values(
            id=role_id,
            key=BUSINESS_MEMBER_KEY,
            name="业务成员",
            description="业务/管理人员：可触发 agent 并借用工作空间共享 daemon。",
            is_system=True,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
    )
    conn.execute(
        RolePermission.__table__.insert(),
        [{"role_id": role_id, "permission": perm} for perm in BASE_PERMISSIONS],
    )
    return role_id


def _permissions_of(conn, role_id: uuid.UUID) -> set[str]:
    return {
        row[0]
        for row in conn.execute(
            sa.text("SELECT permission FROM role_permissions WHERE role_id = :rid").bindparams(
                rid=role_id
            )
        ).all()
    }


# ---------------------------------------------------------------------------
# 1. 迁移元数据
# ---------------------------------------------------------------------------


def test_migration_metadata() -> None:
    """revision 链接正确、模块可导入、upgrade/downgrade 可调用。"""
    mod = _load_migration(REVISION_ID)
    assert mod.revision == REVISION_ID
    assert mod.down_revision == DOWN_REVISION_ID
    assert mod.branch_labels is None
    assert mod.depends_on is None
    assert callable(mod.upgrade)
    assert callable(mod.downgrade)


# ---------------------------------------------------------------------------
# 2. upgrade 幂等
# ---------------------------------------------------------------------------


def test_upgrade_grants_change_read_idempotently() -> None:
    """upgrade 两次：权限集 8 → 9，change:read 只有一行且不抛唯一键错误。"""
    mod = _load_migration(REVISION_ID)
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        _bootstrap_roles_tables_sqlite(conn)
        role_id = _seed_business_member(conn)
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            mod.upgrade()
            mod.upgrade()  # 幂等重跑

        perms = _permissions_of(conn, role_id)
        assert perms == set(BASE_PERMISSIONS) | {GRANTED_PERMISSION}
        assert len(perms) == 4
        assert (
            conn.execute(
                sa.text(
                    "SELECT COUNT(*) FROM role_permissions "
                    "WHERE role_id = :rid AND permission = 'change:read'"
                ).bindparams(rid=role_id)
            ).scalar()
            == 1
        )


def test_upgrade_noop_when_role_absent() -> None:
    """角色不存在时 upgrade 不插入孤儿行、不抛错。"""
    mod = _load_migration(REVISION_ID)
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        _bootstrap_roles_tables_sqlite(conn)
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            mod.upgrade()
        assert conn.execute(sa.text("SELECT COUNT(*) FROM role_permissions")).scalar() == 0


# ---------------------------------------------------------------------------
# 3. downgrade 只删本授权
# ---------------------------------------------------------------------------


def test_downgrade_removes_only_change_read() -> None:
    """downgrade 后权限集回到 3 项，角色行与其他权限不受影响。"""
    mod = _load_migration(REVISION_ID)
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        _bootstrap_roles_tables_sqlite(conn)
        role_id = _seed_business_member(conn)
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            mod.upgrade()
            mod.downgrade()
            mod.downgrade()  # 幂等重跑

        assert _permissions_of(conn, role_id) == set(BASE_PERMISSIONS)
        assert (
            conn.execute(
                sa.text("SELECT COUNT(*) FROM roles WHERE key = 'business_member'")
            ).scalar()
            == 1
        )


def test_downgrade_noop_when_role_absent() -> None:
    """角色不存在时 downgrade 安全 no-op。"""
    mod = _load_migration(REVISION_ID)
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        _bootstrap_roles_tables_sqlite(conn)
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            mod.downgrade()
        assert conn.execute(sa.text("SELECT COUNT(*) FROM role_permissions")).scalar() == 0
