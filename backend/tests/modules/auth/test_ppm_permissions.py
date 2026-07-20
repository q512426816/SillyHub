"""PPM_* 权限枚举 + platform_admin 种子回归测试。

覆盖 change ``2026-07-20-ppm-permission-simplify`` task-04 验收
(承 ``2026-06-20-ppm-module-migration`` task-02 之后精简):
- PPM_* 菜单枚举全部存在且值以 ``ppm:`` 前缀
- 所有 PPM_* 归入 PermissionGroup.PPM
- platform_admin 角色种子后拥有全部 PPM_* 菜单权限
- 非系统角色不含 PPM_*(回归)

原 22 Controller 的 write/delete/export/assign 动作权限为摆设(router 改走
get_current_principal 数据范围鉴权)，本 task 删除 17 个动作成员仅留 8 个菜单/读权限。
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlmodel import col

from app.modules.auth.model import Role, RolePermission
from app.modules.auth.permissions import Permission, PermissionGroup
from app.modules.auth.service import seed_platform_admin_role

# task-04 design §6 指定的 8 个 PPM_* 菜单/读成员(精简后：删除 17 个
# write/delete/export/assign 摆设动作权限，只保留前端菜单折叠所需的 read/stat/view)
EXPECTED_PPM_PERMISSIONS: dict[str, str] = {
    # 项目(pm:project-maintenance:read + pm:project-member:read 复用 project:read)
    "PPM_PROJECT_READ": "ppm:project:read",
    # 客户(pm:customer-maintenance:read)
    "PPM_CUSTOMER_READ": "ppm:customer:read",
    # 计划(ps:project-plan:read + plan:plan-node:read + plan:node:read)
    "PPM_PLAN_READ": "ppm:plan:read",
    # 问题(problem:list:read + problem:change:read + problem:*-process-*)
    "PPM_PROBLEM_READ": "ppm:problem:read",
    # 任务(task:plan:read + ppm:personal-task-plan:read + ppm:task-execute:read)
    "PPM_TASK_READ": "ppm:task:read",
    # 工时(ppm:work-hour:read)
    "PPM_WORKHOUR_READ": "ppm:work-hour:read",
    # 工时统计(ppm:work-hour:stat)
    "PPM_WORKHOUR_STAT": "ppm:work-hour:stat",
    # 看板(ppm:task:kanban:view)
    "PPM_KANBAN_VIEW": "ppm:kanban:view",
    # ── 菜单专属权限（change 2026-07-20-ppm-menu-unique-keys：14 菜单各独立 key）──
    # 上方 plan/problem/task:read 3 个旧共享 key 悬空保留（D-002），以下 9 个为细分菜单专属。
    # 工作台
    "PPM_WORKBENCH_VIEW": "ppm:workbench:view",
    # 项目成员
    "PPM_PROJECT_MEMBER_READ": "ppm:project-member:read",
    # 干系人
    "PPM_PROJECT_STAKEHOLDER_READ": "ppm:project-stakeholder:read",
    # 项目计划
    "PPM_PROJECT_PLAN_READ": "ppm:project-plan:read",
    # 计划节点
    "PPM_PLAN_NODE_READ": "ppm:plan-node:read",
    # 里程碑明细
    "PPM_MILESTONE_DETAIL_READ": "ppm:milestone-detail:read",
    # 问题清单
    "PPM_PROBLEM_LIST_READ": "ppm:problem-list:read",
    # 问题变更
    "PPM_PROBLEM_CHANGE_READ": "ppm:problem-change:read",
    # 任务计划
    "PPM_TASK_PLAN_READ": "ppm:task-plan:read",
}


def test_ppm_permission_member_count_is_17() -> None:
    """change 2026-07-20-ppm-menu-unique-keys 扩容后共 17 个 PPM_* 成员（14 菜单 key + 3 悬空旧 key）。"""
    assert len(EXPECTED_PPM_PERMISSIONS) == 17


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
