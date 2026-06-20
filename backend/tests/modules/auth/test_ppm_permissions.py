"""PPM_* 权限枚举 + platform_admin 种子回归测试。

覆盖 change ``2026-06-20-ppm-module-migration`` task-02 验收:
- PPM_* 枚举全部存在且值以 ``ppm:`` 前缀
- 所有 PPM_* 归入 PermissionGroup.PPM
- platform_admin 角色种子后拥有全部 PPM_* 权限
- 非系统角色不含 PPM_*(回归)

源 @PreAuthorize 归并见 design §6/§7，迁移 ``202607041000_seed_ppm_permissions``。
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlmodel import col

from app.modules.auth.model import Role, RolePermission
from app.modules.auth.permissions import Permission, PermissionGroup
from app.modules.auth.service import seed_platform_admin_role

# task-02 design §6 指定的 24 个 PPM_* 成员
EXPECTED_PPM_PERMISSIONS: dict[str, str] = {
    # 项目(pm:project-maintenance:* + pm:project-member:*)
    "PPM_PROJECT_READ": "ppm:project:read",
    "PPM_PROJECT_WRITE": "ppm:project:write",
    "PPM_PROJECT_DELETE": "ppm:project:delete",
    "PPM_PROJECT_EXPORT": "ppm:project:export",
    # 客户(pm:customer-maintenance:*)
    "PPM_CUSTOMER_READ": "ppm:customer:read",
    "PPM_CUSTOMER_WRITE": "ppm:customer:write",
    "PPM_CUSTOMER_DELETE": "ppm:customer:delete",
    "PPM_CUSTOMER_EXPORT": "ppm:customer:export",
    # 计划(ps:project-plan:* + plan:plan-node:* + plan:node:*)
    "PPM_PLAN_READ": "ppm:plan:read",
    "PPM_PLAN_WRITE": "ppm:plan:write",
    "PPM_PLAN_DELETE": "ppm:plan:delete",
    "PPM_PLAN_EXPORT": "ppm:plan:export",
    # 问题(problem:list:* + problem:change:* + problem:*-process-*)
    "PPM_PROBLEM_READ": "ppm:problem:read",
    "PPM_PROBLEM_WRITE": "ppm:problem:write",
    "PPM_PROBLEM_DELETE": "ppm:problem:delete",
    # 任务(task:plan:* + ppm:personal-task-plan:* + ppm:task-execute:*)
    "PPM_TASK_READ": "ppm:task:read",
    "PPM_TASK_WRITE": "ppm:task:write",
    "PPM_TASK_DELETE": "ppm:task:delete",
    "PPM_TASK_EXPORT": "ppm:task:export",
    # 工时(ppm:work-hour:*)
    "PPM_WORKHOUR_READ": "ppm:work-hour:read",
    "PPM_WORKHOUR_WRITE": "ppm:work-hour:write",
    "PPM_WORKHOUR_STAT": "ppm:work-hour:stat",
    # 看板(ppm:task:kanban:view / assign)
    "PPM_KANBAN_VIEW": "ppm:kanban:view",
    "PPM_KANBAN_ASSIGN": "ppm:kanban:assign",
}


def test_ppm_permission_member_count_is_24() -> None:
    """task-02 design §6 共 24 个 PPM_* 成员。"""
    assert len(EXPECTED_PPM_PERMISSIONS) == 24


@pytest.mark.parametrize("name,value", list(EXPECTED_PPM_PERMISSIONS.items()))
def test_ppm_permission_members_exist(name: str, value: str) -> None:
    """每个 PPM_* 成员都存在于 Permission 枚举且值正确。"""
    assert hasattr(Permission, name), f"Permission 缺少成员 {name}"
    member = getattr(Permission, name)
    assert member.value == value


def test_all_ppm_permission_values_prefixed() -> None:
    """所有 PPM_* 值都以 ppm: 前缀(便于迁移 down 按 LIKE 'ppm:%' 删除)。"""
    for value in EXPECTED_PPM_PERMISSIONS.values():
        assert value.startswith("ppm:"), f"{value} 缺少 ppm: 前缀"


def test_no_duplicate_ppm_permission_values() -> None:
    """PPM_* 值无重复(枚举本身会去重，这里额外断言源定义无笔误)。"""
    values = list(EXPECTED_PPM_PERMISSIONS.values())
    assert len(values) == len(set(values))


def test_ppm_permissions_resolve_to_ppm_group() -> None:
    """所有 PPM_* 成员归入 PermissionGroup.PPM(前端菜单折叠)。"""
    for name in EXPECTED_PPM_PERMISSIONS:
        member = getattr(Permission, name)
        assert member.group is PermissionGroup.PPM, f"{name} 应归入 PPM 组"


@pytest.mark.asyncio
async def test_platform_admin_seed_grants_all_ppm_permissions(db_session) -> None:
    """seed_platform_admin_role 后 platform_admin 拥有全部 PPM_* 权限。

    对应迁移 ``202607041000_seed_ppm_permissions`` 的 up 行为 —— service 层
    ``seed_platform_admin_role`` 以 ``Permission`` 枚举为单一真源，迁移与启动
    种子必须保持一致。
    """
    await seed_platform_admin_role(db_session)

    role = (
        (await db_session.execute(select(Role).where(col(Role.key) == "platform_admin")))
        .scalars()
        .first()
    )
    assert role is not None

    perms = {
        row[0]
        for row in (
            await db_session.execute(
                select(col(RolePermission.permission)).where(col(RolePermission.role_id) == role.id)
            )
        ).all()
    }

    for value in EXPECTED_PPM_PERMISSIONS.values():
        assert value in perms, f"platform_admin 缺少权限 {value}"


@pytest.mark.asyncio
async def test_non_system_role_has_no_ppm_permissions(db_session) -> None:
    """普通角色不应自动获得 PPM_*(回归：种子只写 platform_admin)。"""
    await seed_platform_admin_role(db_session)

    # 构造一个普通角色，不绑定任何权限
    other = Role(
        key="ppm_outsider",
        name="测试外部角色",
        description="不持有 PPM_*",
        is_system=False,
        is_active=True,
    )
    db_session.add(other)
    await db_session.commit()
    await db_session.refresh(other)

    perms = {
        row[0]
        for row in (
            await db_session.execute(
                select(col(RolePermission.permission)).where(
                    col(RolePermission.role_id) == other.id
                )
            )
        ).all()
    }
    for value in EXPECTED_PPM_PERMISSIONS.values():
        assert value not in perms
