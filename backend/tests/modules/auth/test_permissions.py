"""Permission enum + group resolution tests.

Covers change ``2026-06-16-admin-org-role-center`` task-02 AC-01..AC-12,
AC-19, AC-20.
"""

from __future__ import annotations

from enum import StrEnum

import pytest

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


def test_permission_count_is_65() -> None:
    """46 历史 + 17 PPM_* 菜单/读 + daemon:borrow + llm_provider:read = 65。

    cbd258eb/1f5e6ebe 菜单 unique-key 扩容回升到 63；change
    2026-07-25-daemon-borrow-for-business task-03 / D-006@v2 再加
    ``DAEMON_BORROW``（业务人员借用开发人员 daemon 回退授权）→ 64；
    change 2026-07-29-sidebar-menu-restructure task-01 / D-002@v1 再加
    ``LLM_PROVIDER_READ``（前端「我的供应商」菜单显隐 + 角色分配）→ 65。
    """
    assert len(list(Permission)) == 65


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
