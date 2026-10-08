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


def test_permission_group_has_six_members() -> None:
    members = list(PermissionGroup)
    assert len(members) == 6
    expected = {
        PermissionGroup.PLATFORM,
        PermissionGroup.ADMIN,
        PermissionGroup.WORKSPACE,
        PermissionGroup.AGENT,
        PermissionGroup.CHANGE,
        PermissionGroup.PPM,
    }
    assert set(members) == expected


def test_permission_count_is_58() -> None:
    """72 历史 + 增量见前注；2026-10-08-rbac-dead-permissions-cleanup 删除
    14 个零端点消费死权限（code:*×4 / tool:*×4 / task:cancel / task:approve /
    platform:audit:read / platform:billing / component:read / change:update，
    AUDIT 组随 platform:audit:read 移除）→ 58。
    """
    assert len(list(Permission)) == 58


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
        (Permission.PLATFORM_ADMIN, PermissionGroup.PLATFORM),
        # ql-004: platform management submenu admin perms
        (Permission.SETTINGS_ADMIN, PermissionGroup.PLATFORM),
        (Permission.API_KEY_ADMIN, PermissionGroup.PLATFORM),
        (Permission.RUNTIME_ADMIN, PermissionGroup.PLATFORM),
        # ql-005: git_identity admin perm
        (Permission.GIT_IDENTITY_ADMIN, PermissionGroup.PLATFORM),
        # ql-003: workspace submenu independent read perms
        # （2026-10-08-rbac-dead-permissions-cleanup：component:read 删除）
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
        # Agent (task/deploy；2026-10-08 清理删 code:*/tool:* 死键)
        (Permission.TASK_READ, PermissionGroup.AGENT),
        (Permission.DEPLOY_PRODUCTION, PermissionGroup.AGENT),
        # task-03: daemon 前缀归 AGENT 组（业务借用回退授权）
        (Permission.DAEMON_BORROW, PermissionGroup.AGENT),
        # task-01: llm_provider 前缀无特判分支，落默认 PLATFORM 组
        (Permission.LLM_PROVIDER_READ, PermissionGroup.PLATFORM),
        # task-01（2026-09-18-web-menu-management / FR-01）：4 个常显菜单独立
        # 读权限前缀归 AGENT 组；menu 前缀无特判分支，落默认 PLATFORM 组。
        (Permission.SKILL_READ, PermissionGroup.AGENT),
        (Permission.MCP_READ, PermissionGroup.AGENT),
        (Permission.AGENT_PROFILE_READ, PermissionGroup.AGENT),
        (Permission.AGENT_SESSION_READ, PermissionGroup.AGENT),
        (Permission.MENU_ADMIN, PermissionGroup.PLATFORM),
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
    """Sanity: historical entries retain their original string values."""
    assert Permission.PLATFORM_ADMIN.value == "platform:admin"
    assert Permission.WORKSPACE_ADMIN.value == "workspace:admin"
    assert Permission.CHANGE_CREATE.value == "change:create"
    assert Permission.TASK_RUN_AGENT.value == "task:run_agent"
    assert Permission.DEPLOY_ROLLBACK.value == "deploy:rollback"


def test_dead_permissions_removed_from_catalog() -> None:
    """2026-10-08-rbac-dead-permissions-cleanup：14 个零端点消费死键出目录。

    删除后这些字符串不得再以 Permission 成员存在（角色写路径 list[Permission]
    校验域随之收窄；存量授权行由迁移 20261008100000 清理）。
    """
    values = {p.value for p in Permission}
    for dead in (
        "code:read",
        "code:write",
        "code:review",
        "code:merge",
        "tool:shell_exec",
        "tool:network",
        "tool:database",
        "tool:secret:read",
        "task:cancel",
        "task:approve",
        "platform:audit:read",
        "platform:billing",
        "component:read",
        "change:update",
    ):
        assert dead not in values


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


def test_menu_management_permission_values() -> None:
    """task-01（2026-09-18-web-menu-management / FR-01）。

    4 个常显菜单读权限 + 菜单管理门控的字符串值必须与 task-03 种子迁移
    内硬编码字面量逐字一致（迁移内为字面量复写，两处以本断言对齐）；
    MENU_ADMIN 供 task-05 路由门控 require_permission(Permission.MENU_ADMIN) 消费。
    """
    assert Permission.SKILL_READ.value == "skill:read"
    assert Permission.MCP_READ.value == "mcp:read"
    assert Permission.AGENT_PROFILE_READ.value == "agent_profile:read"
    assert Permission.AGENT_SESSION_READ.value == "agent_session:read"
    assert Permission.MENU_ADMIN.value == "menu:admin"


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


# ---------------------------------------------------------------------------
# 2026-10-08-rbac-dead-permissions-cleanup：死权限授权行清理迁移
# （20261008100000_drop_dead_rbac_permissions）。范式沿用上方
# knowledge_write 迁移测试：MigrationContext + Operations 在 SQLite 内存库
# 上回放真实 upgrade()/downgrade()。
# ---------------------------------------------------------------------------

DROP_DEAD_REVISION_ID = "20261008100000"


def _load_drop_dead_migration():
    """按 revision ID 在文件名里匹配导入迁移模块（borrow-shared 测试范式）。"""
    backend_root = Path(__file__).resolve().parent.parent.parent.parent
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and DROP_DEAD_REVISION_ID in f and f != "__init__.py":
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {DROP_DEAD_REVISION_ID}")


def test_drop_dead_rbac_migration_metadata() -> None:
    mod = _load_drop_dead_migration()
    assert mod.revision == DROP_DEAD_REVISION_ID
    assert mod.down_revision == "20261006200000"
    assert len(mod.DROPPED_DEAD_PERMISSIONS) == 16
    # 16 字符串互不重复
    assert len(set(mod.DROPPED_DEAD_PERMISSIONS)) == 16


def test_drop_dead_rbac_migration_upgrade_deletes_and_downgrade_replants() -> None:
    """upgrade 删 16 死字符串全量行（其它权限保留，幂等）；downgrade 对称
    回植 platform_admin 各 1 行（其它角色不回植，角色缺失安全 no-op）。"""
    mod = _load_drop_dead_migration()
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        _bootstrap_roles_tables_sqlite(conn)
        admin_id = _seed_role(conn, "platform_admin", ["platform:admin", "code:read"])
        owner_id = _seed_role(
            conn, "workspace_owner", ["workspace:read", "task:approve", "component:admin"]
        )

        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            mod.upgrade()
            # 幂等：重跑不抛
            mod.upgrade()

        def perms_of(rid) -> set[str]:
            stmt = sa.text(
                "SELECT permission FROM role_permissions WHERE role_id = :rid"
            ).bindparams(rid=rid)
            return {r[0] for r in conn.execute(stmt)}

        # 死行全删、存活权限保留
        assert perms_of(admin_id) == {"platform:admin"}
        assert perms_of(owner_id) == {"workspace:read"}

        with Operations.context(ctx):
            mod.downgrade()

        # 回植：platform_admin 持全部 16 键各 1 行（含原有 platform:admin）
        admin_perms = perms_of(admin_id)
        assert admin_perms == {"platform:admin", *mod.DROPPED_DEAD_PERMISSIONS}
        assert len(admin_perms) == 17
        # 其它角色不回植
        assert perms_of(owner_id) == {"workspace:read"}

        # 角色表缺失时 downgrade 安全 no-op
        conn.execute(sa.text("DELETE FROM role_permissions"))
        conn.execute(sa.text("DELETE FROM roles"))
        with Operations.context(ctx):
            mod.downgrade()
        assert conn.execute(sa.text("SELECT COUNT(*) FROM role_permissions")).scalar() == 0
