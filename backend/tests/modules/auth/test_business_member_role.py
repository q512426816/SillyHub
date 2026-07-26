"""business_member role seed migration test (task-03).

Change 2026-07-25-daemon-borrow-for-business task-03 / FR-03 / D-006@v2：
新增 ``daemon:borrow`` 权限 + ``business_member`` 工作空间角色种子迁移。

覆盖：
  1. 迁移元数据（revision 202607251300 / down_revision 202607251200、模块可导入）；
  2. 种子常量内容（task:run_agent + daemon:borrow + workspace:read）；
  3. upgrade() 在 SQLite 上真实跑通——bulk_insert role（Python uuid）→ 复用
     role_id → bulk_insert role_permissions，落地 business_member 角色 + 3 条权限，
     且 role_permissions.role_id 关联正确；
  4. downgrade() 可逆，清空 role + role_permissions。

测试范式：通过 ``alembic.migration.MigrationContext`` + ``Operations.context``
在 SQLite 上把真实 ``mod.upgrade()`` 跑起来（比手写 replay 更忠实于迁移代码本体）。
PG 上 ``alembic upgrade head`` / ``--sql`` 离线生成列为 blueprint step-5 manual verify。
"""

from __future__ import annotations

import importlib
import os
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

REVISION_ID = "202607251300"
DOWN_REVISION_ID = "202607251200"


def _load_migration(revision_id: str):
    """按 revision ID 在文件名里匹配，导入迁移模块（沿用 borrow-shared 测试范式）。"""
    # 本测试文件: backend/tests/modules/auth/test_business_member_role.py
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


def test_migration_metadata() -> None:
    """revision = 202607251300；down_revision = 202607251200（task-02 审计表 head）。

    单 head 接续，不撞 migration-chain-fragmentation-pattern 的多 head 分叉。
    """
    mod = _load_migration(REVISION_ID)
    assert mod.revision == REVISION_ID
    assert mod.down_revision == DOWN_REVISION_ID
    assert mod.branch_labels is None
    assert mod.depends_on is None
    assert callable(mod.upgrade)
    assert callable(mod.downgrade)


# ---------------------------------------------------------------------------
# 2. 种子常量内容（D-006@v2：触发端点鉴权 + 借用回退授权 + workspace 读）
# ---------------------------------------------------------------------------


def test_business_member_seed_constant_contents() -> None:
    """business_member 权限组合 = task:run_agent + daemon:borrow + workspace:read。"""
    mod = _load_migration(REVISION_ID)
    assert mod.BUSINESS_MEMBER_KEY == "business_member"
    perms = set(mod.BUSINESS_MEMBER_PERMISSIONS)
    # D-006@v2 三项必需权限
    assert "task:run_agent" in perms
    assert "daemon:borrow" in perms
    assert "workspace:read" in perms
    # 不带全量 agent / code 写权限——business_member 无自有 daemon，仅触发+借用
    assert "code:write" not in perms
    assert "workspace:write" not in perms
    assert "workspace:admin" not in perms


# ---------------------------------------------------------------------------
# 3. upgrade() 在 SQLite 上跑通（真实迁移代码，非 replay）
# ---------------------------------------------------------------------------


def _bootstrap_roles_tables_sqlite(conn) -> None:
    """从 ORM 元数据建 roles + role_permissions（含 ``Uuid`` 列类型）。

    为什么不用裸 ``CHAR(32)`` DDL：迁移本体 ``op.get_bind().execute(SELECT id ...)``
    在 PG 上拿到 ``uuid.UUID``（``roles.id`` 是 ``postgresql.UUID(as_uuid=True)``），
    再喂给第二条 bulk_insert 的 ``sa.column('role_id', sa.Uuid)`` 绑定处理器。SQLite
    裸 ``CHAR(32)`` 列读回是 ``str``，触发 ``'str' object has no attribute 'hex'``。
    用 ORM 元数据建表则 ``sqlalchemy.Uuid`` 注册结果处理器，SELECT 回填 ``uuid.UUID``，
    与 PG 行为一致——既验迁移本体逻辑，又不引入测试伪影。
    """
    from app.models.base import BaseModel
    from app.modules.auth import model as _auth_model

    BaseModel.metadata.create_all(
        conn,
        tables=[
            _auth_model.Role.__table__,
            _auth_model.RolePermission.__table__,
        ],
    )


def test_migration_upgrade_seeds_business_member_on_sqlite() -> None:
    """跑真实 mod.upgrade()：落地 business_member 角色 + 3 条权限，role_id 关联正确。"""
    mod = _load_migration(REVISION_ID)
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        _bootstrap_roles_tables_sqlite(conn)
        ctx = MigrationContext.configure(conn)
        # Operations.context 注册 alembic.op 代理 → mod.upgrade() 内的
        # ``from alembic import op`` 解析到本 ctx（忠实跑迁移本体）。
        with Operations.context(ctx):
            mod.upgrade()

        # 角色行落地
        row = conn.execute(
            sa.text(
                "SELECT id, name, description, is_system, is_active "
                "FROM roles WHERE key = 'business_member'"
            )
        ).one()
        assert row.name == "业务成员"
        assert row.description is not None and "借用" in row.description
        assert bool(row.is_system) is True
        assert bool(row.is_active) is True

        # 权限集合落地（role_id 关联正确——Python 复用 uuid，两条 bulk_insert 同源）
        perms = {
            r[0]
            for r in conn.execute(
                sa.text("SELECT permission FROM role_permissions WHERE role_id = :rid").bindparams(
                    rid=row.id
                )
            ).all()
        }
        assert perms == set(mod.BUSINESS_MEMBER_PERMISSIONS)
        assert len(perms) == 3

        # 唯一性：roles 表只新增了 business_member 一行
        total_roles = conn.execute(sa.text("SELECT COUNT(*) FROM roles")).scalar()
        assert total_roles == 1
        total_perms = conn.execute(sa.text("SELECT COUNT(*) FROM role_permissions")).scalar()
        assert total_perms == 3


def test_migration_downgrade_cleans_up_on_sqlite() -> None:
    """downgrade() 可逆：删 role + role_permissions，二次 upgrade 幂等重建。"""
    mod = _load_migration(REVISION_ID)
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        _bootstrap_roles_tables_sqlite(conn)
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            mod.upgrade()
            mod.downgrade()

        assert (
            conn.execute(
                sa.text("SELECT COUNT(*) FROM roles WHERE key = 'business_member'")
            ).scalar()
            == 0
        )
        assert conn.execute(sa.text("SELECT COUNT(*) FROM role_permissions")).scalar() == 0

        # 二次 upgrade 幂等重建（迁移可重入：downgrade 后再 upgrade 不残留）
        with Operations.context(ctx):
            mod.upgrade()
        assert (
            conn.execute(
                sa.text("SELECT COUNT(*) FROM roles WHERE key = 'business_member'")
            ).scalar()
            == 1
        )
        assert conn.execute(sa.text("SELECT COUNT(*) FROM role_permissions")).scalar() == 3


def test_migration_downgrade_noop_when_role_absent() -> None:
    """downgrade() 在 role 不存在时安全 no-op（不抛、不留残）。"""
    mod = _load_migration(REVISION_ID)
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        _bootstrap_roles_tables_sqlite(conn)
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            # 未 upgrade 直接 downgrade —— SELECT 返回 None，分支 return，不抛
            mod.downgrade()
        assert conn.execute(sa.text("SELECT COUNT(*) FROM roles")).scalar() == 0
        assert conn.execute(sa.text("SELECT COUNT(*) FROM role_permissions")).scalar() == 0
