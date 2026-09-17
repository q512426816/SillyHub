"""Permission enum + group resolution tests.

Covers change ``2026-06-16-admin-org-role-center`` task-02 AC-01..AC-12,
AC-19, AC-20.
"""

from __future__ import annotations

import importlib
import os
from enum import StrEnum
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.modules.auth.permissions import Permission, PermissionGroup


def test_permission_is_str_enum() -> None:
    assert issubclass(Permission, StrEnum)


def test_permission_group_is_str_enum() -> None:
    assert issubclass(PermissionGroup, StrEnum)


def test_permission_group_has_seven_members() -> None:
    members = list(PermissionGroup)
    assert len(members) == 7
    expected = {
        PermissionGroup.PLATFORM,
        PermissionGroup.ADMIN,
        PermissionGroup.WORKSPACE,
        PermissionGroup.AGENT,
        PermissionGroup.CHANGE,
        PermissionGroup.AUDIT,
        PermissionGroup.PPM,
    }
    assert set(members) == expected


def test_permission_count_is_67() -> None:
    """46 历史 + 17 PPM_* 菜单/读 + daemon:borrow + llm_provider:read + weekly-plan = 66。

    cbd258eb/1f5e6ebe 菜单 unique-key 扩容回升到 63；change
    2026-07-25-daemon-borrow-for-business task-03 / D-006@v2 再加
    ``DAEMON_BORROW``（业务人员借用开发人员 daemon 回退授权）→ 64；
    change 2026-07-29-sidebar-menu-restructure task-01 / D-002@v1 再加
    ``LLM_PROVIDER_READ``（前端「我的供应商」菜单显隐 + 角色分配）→ 65；
    change 2026-07-30-sidebar-menu-restructure task-06 / ql-20260730-005 再加
    ``PPM_WEEKLY_PLAN_VIEW``（实施计划汇总独立菜单权限）→ 66；
    change 2026-09-17-knowledge-precipitation task-02 / FR-02 再加
    ``KNOWLEDGE_WRITE``（知识库写权限，管理员/owner 播种走 migration
    20260917104400）→ 67。
    """
    assert len(list(Permission)) == 67


@pytest.mark.parametrize(
    "perm,expected_group",
    [
        # New admin group
        (Permission.USER_READ, PermissionGroup.ADMIN),
        (Permission.USER_WRITE, PermissionGroup.ADMIN),
        (Permission.USER_LOGIN_MANAGE, PermissionGroup.ADMIN),
        (Permission.ORGANIZATION_READ, PermissionGroup.ADMIN),
        (Permission.ORGANIZATION_WRITE, PermissionGroup.ADMIN),
        (Permission.ROLE_READ, PermissionGroup.ADMIN),
        (Permission.ROLE_WRITE, PermissionGroup.ADMIN),
        # Historical platform — audit special-case
        (Permission.PLATFORM_AUDIT_READ, PermissionGroup.AUDIT),
        (Permission.PLATFORM_ADMIN, PermissionGroup.PLATFORM),
        (Permission.PLATFORM_BILLING, PermissionGroup.PLATFORM),
        # ql-004: platform management submenu admin perms
        (Permission.SETTINGS_ADMIN, PermissionGroup.PLATFORM),
        (Permission.API_KEY_ADMIN, PermissionGroup.PLATFORM),
        (Permission.RUNTIME_ADMIN, PermissionGroup.PLATFORM),
        # ql-005: git_identity admin perm
        (Permission.GIT_IDENTITY_ADMIN, PermissionGroup.PLATFORM),
        # ql-003: workspace submenu independent read perms
        (Permission.COMPONENT_READ, PermissionGroup.WORKSPACE),
        (Permission.TOPOLOGY_READ, PermissionGroup.WORKSPACE),
        (Permission.SCAN_DOCS_READ, PermissionGroup.WORKSPACE),
        (Permission.RUNTIME_READ, PermissionGroup.WORKSPACE),
        (Permission.KNOWLEDGE_READ, PermissionGroup.WORKSPACE),
        # task-02（2026-09-17-knowledge-precipitation / FR-02）：knowledge 前缀
        # 写权限命中既有 group 分支，自动归 WORKSPACE 组。
        (Permission.KNOWLEDGE_WRITE, PermissionGroup.WORKSPACE),
        (Permission.INCIDENT_READ, PermissionGroup.WORKSPACE),
        # Workspace
        (Permission.WORKSPACE_READ, PermissionGroup.WORKSPACE),
        (Permission.WORKSPACE_ADMIN, PermissionGroup.WORKSPACE),
        # Change
        (Permission.CHANGE_CREATE, PermissionGroup.CHANGE),
        # Agent (task/code/tool/deploy)
        (Permission.TASK_READ, PermissionGroup.AGENT),
        (Permission.CODE_REVIEW, PermissionGroup.AGENT),
        (Permission.TOOL_NETWORK, PermissionGroup.AGENT),
        (Permission.DEPLOY_PRODUCTION, PermissionGroup.AGENT),
        # task-03: daemon 前缀归 AGENT 组（业务借用回退授权）
        (Permission.DAEMON_BORROW, PermissionGroup.AGENT),
        # task-01: llm_provider 前缀无特判分支，落默认 PLATFORM 组
        (Permission.LLM_PROVIDER_READ, PermissionGroup.PLATFORM),
    ],
)
def test_permission_group_resolution(perm: Permission, expected_group: PermissionGroup) -> None:
    assert perm.group == expected_group


def test_every_permission_has_non_default_group() -> None:
    """All 63 permissions must resolve to a stable group (no KeyError)."""
    for perm in Permission:
        group = perm.group
        assert isinstance(group, PermissionGroup)


def test_new_permission_string_values() -> None:
    """7 new admin permission string values match design §8.4."""
    assert Permission.USER_READ.value == "user:read"
    assert Permission.USER_WRITE.value == "user:write"
    assert Permission.USER_LOGIN_MANAGE.value == "user:login:manage"
    assert Permission.ORGANIZATION_READ.value == "organization:read"
    assert Permission.ORGANIZATION_WRITE.value == "organization:write"
    assert Permission.ROLE_READ.value == "role:read"
    assert Permission.ROLE_WRITE.value == "role:write"


def test_existing_permission_string_values_unchanged() -> None:
    """Sanity: historical 25 entries retain their original string values."""
    assert Permission.PLATFORM_ADMIN.value == "platform:admin"
    assert Permission.WORKSPACE_ADMIN.value == "workspace:admin"
    assert Permission.CHANGE_CREATE.value == "change:create"
    assert Permission.TASK_RUN_AGENT.value == "task:run_agent"
    assert Permission.DEPLOY_ROLLBACK.value == "deploy:rollback"
    assert Permission.TOOL_SECRET_READ.value == "tool:secret:read"


def test_daemon_borrow_permission_value() -> None:
    """task-03 / D-006@v2：DAEMON_BORROW 权限点字符串值落地。"""
    assert Permission.DAEMON_BORROW.value == "daemon:borrow"


def test_llm_provider_read_permission() -> None:
    """change 2026-07-29-sidebar-menu-restructure task-01 / D-002@v1 / FR-05。

    LLM_PROVIDER_READ 字符串值必须与前端 menu-permissions.ts 约定的
    ``llm_provider:read`` 完全一致；group 落默认 PLATFORM 组
    （llm_provider 前缀无特判分支）。该权限仅用于前端菜单显隐 +
    角色管理分配，不改任何接口鉴权。
    """
    assert Permission.LLM_PROVIDER_READ.value == "llm_provider:read"
    assert Permission.LLM_PROVIDER_READ.group is PermissionGroup.PLATFORM


def test_knowledge_write_permission_value() -> None:
    """task-02（2026-09-17-knowledge-precipitation / FR-02 / D-005@v1）。

    KNOWLEDGE_WRITE 字符串值必须与 migration 20260917104400 播种的
    ``knowledge:write`` 完全一致（迁移内为字面量复写，两处以本断言对齐）。
    """
    assert Permission.KNOWLEDGE_WRITE.value == "knowledge:write"


# ---------------------------------------------------------------------------
# task-02：KNOWLEDGE_WRITE 角色-权限播种 migration（20260917104400）
#
# 范式沿用 tests/modules/auth/test_business_member_role.py：通过
# ``alembic.migration.MigrationContext`` + ``Operations.context`` 在 SQLite
# 内存库上把真实迁移 upgrade()/downgrade() 跑起来（比手写 replay 忠实于
# 迁移本体）；PG 上 ``alembic upgrade head`` 列为部署期 manual verify。
# ---------------------------------------------------------------------------

KNOWLEDGE_WRITE_REVISION_ID = "20260917104400"
KNOWLEDGE_WRITE_DOWN_REVISION_ID = "20260914100000"


def _load_knowledge_write_migration():
    """按 revision ID 在文件名里匹配导入迁移模块（borrow-shared 测试范式）。"""
    backend_root = Path(__file__).resolve().parent.parent.parent.parent
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and KNOWLEDGE_WRITE_REVISION_ID in f and f != "__init__.py":
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {KNOWLEDGE_WRITE_REVISION_ID}")


def _bootstrap_roles_tables_sqlite(conn) -> None:
    """从 ORM 元数据建 roles + role_permissions（Uuid 结果处理器与 PG 行为一致）。"""
    from app.models.base import BaseModel
    from app.modules.auth import model as _auth_model

    BaseModel.metadata.create_all(
        conn,
        tables=[
            _auth_model.Role.__table__,
            _auth_model.RolePermission.__table__,
        ],
    )


def _seed_role(conn, key: str, permissions: list[str]) -> object:
    """插入一个存量角色 + 既有权限行，返回角色 id。"""
    import uuid as _uuid
    from datetime import UTC, datetime

    role_id = _uuid.uuid4()
    now = datetime.now(UTC).isoformat()
    conn.execute(
        sa.text(
            "INSERT INTO roles (id, key, name, is_system, is_active, created_at, updated_at) "
            "VALUES (:id, :key, :name, 1, 1, :now, :now)"
        ).bindparams(id=role_id, key=key, name=key, now=now),
    )
    for perm in permissions:
        conn.execute(
            sa.text(
                "INSERT INTO role_permissions (role_id, permission) VALUES (:rid, :perm)"
            ).bindparams(rid=role_id, perm=perm),
        )
    return role_id


def test_knowledge_write_migration_metadata() -> None:
    """revision 链接正确（down 接实测单头 20260914100000）、模块可导入。"""
    mod = _load_knowledge_write_migration()
    assert mod.revision == KNOWLEDGE_WRITE_REVISION_ID
    assert mod.down_revision == KNOWLEDGE_WRITE_DOWN_REVISION_ID
    assert mod.branch_labels is None
    assert mod.depends_on is None
    assert callable(mod.upgrade)
    assert callable(mod.downgrade)
    assert mod.KNOWLEDGE_WRITE_PERMISSION == "knowledge:write"
    assert set(mod.TARGET_ROLE_KEYS) == {"platform_admin", "workspace_owner"}


def test_knowledge_write_migration_upgrade_seeds_and_is_idempotent() -> None:
    """upgrade 按 roles.key 授 platform_admin/workspace_owner knowledge:write：
    两角色各 +1 行、其它角色与既有权限零变化；重跑不重复插（幂等）。"""
    mod = _load_knowledge_write_migration()
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        _bootstrap_roles_tables_sqlite(conn)
        admin_id = _seed_role(conn, "platform_admin", ["platform:admin"])
        owner_id = _seed_role(conn, "workspace_owner", ["workspace:read", "workspace:write"])
        # 对照组：未被授予的角色既有权限集合必须零变化
        viewer_id = _seed_role(conn, "viewer", ["workspace:read", "change:read"])

        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            mod.upgrade()
            # 二次 upgrade：幂等（重跑不重复插）
            mod.upgrade()

        def perms_of(rid) -> set[str]:
            return {
                r[0]
                for r in conn.execute(
                    sa.text(
                        "SELECT permission FROM role_permissions WHERE role_id = :rid"
                    ).bindparams(rid=rid)
                )
            }

        assert "knowledge:write" in perms_of(admin_id)
        assert "knowledge:write" in perms_of(owner_id)
        # 只增授权不删改：既有权限保留 + 无重复行
        assert perms_of(admin_id) == {"platform:admin", "knowledge:write"}
        assert perms_of(owner_id) == {"workspace:read", "workspace:write", "knowledge:write"}
        assert perms_of(viewer_id) == {"workspace:read", "change:read"}
        # 幂等：每角色 knowledge:write 恰好 1 行（主键 (role_id, permission) 本身也拦重复）
        for rid in (admin_id, owner_id):
            count = conn.execute(
                sa.text(
                    "SELECT COUNT(*) FROM role_permissions "
                    "WHERE role_id = :rid AND permission = 'knowledge:write'"
                ).bindparams(rid=rid)
            ).scalar()
            assert count == 1


def test_knowledge_write_migration_downgrade_deletes_rows_keeps_roles() -> None:
    """downgrade 显式 DELETE 授权行：roles 本体与其它权限不动；空库/角色缺失时安全 no-op。"""
    mod = _load_knowledge_write_migration()
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        _bootstrap_roles_tables_sqlite(conn)
        admin_id = _seed_role(conn, "platform_admin", ["platform:admin"])
        owner_id = _seed_role(conn, "workspace_owner", ["workspace:read"])

        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            mod.upgrade()
            mod.downgrade()

        # knowledge:write 授权行全删；两角色本体与既有权限保留
        assert (
            conn.execute(
                sa.text(
                    "SELECT COUNT(*) FROM role_permissions WHERE permission = 'knowledge:write'"
                )
            ).scalar()
            == 0
        )
        role_keys = {r[0] for r in conn.execute(sa.text("SELECT key FROM roles"))}
        assert role_keys == {"platform_admin", "workspace_owner"}

        def perms_of(rid) -> set[str]:
            return {
                r[0]
                for r in conn.execute(
                    sa.text(
                        "SELECT permission FROM role_permissions WHERE role_id = :rid"
                    ).bindparams(rid=rid)
                )
            }

        assert perms_of(admin_id) == {"platform:admin"}
        assert perms_of(owner_id) == {"workspace:read"}

        # 角色本体缺失（空库）时 downgrade 安全 no-op：不抛、不留残
        conn.execute(sa.text("DELETE FROM role_permissions"))
        conn.execute(sa.text("DELETE FROM roles"))
        with Operations.context(ctx):
            mod.downgrade()
        assert conn.execute(sa.text("SELECT COUNT(*) FROM role_permissions")).scalar() == 0
        assert conn.execute(sa.text("SELECT COUNT(*) FROM roles")).scalar() == 0
