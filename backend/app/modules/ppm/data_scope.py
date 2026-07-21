"""PPM 项目计划/项目维护 数据范围解析 (2026-07-18-project-plan-data-scope)。

按当前用户身份产出 ``DataScope``,供 plan/project service 注入 where 过滤。
与功能权限 (``require_permission_any``) 正交:功能权限管"能不能进接口",
``DataScope`` 管"能看哪些数据" (D-009@v1)。

身份判定 (D-001@v1,复用现有 RBAC 角色 key,不新建角色):
- 超级管理员: 持 ``super_admin`` 角色 OR ``is_platform_admin`` → ``is_full=True`` (看全部, D-002@v1)
- 部门经理: 持 ``DEPTBOSS`` 角色 → ``dept_org_ids`` = UserOrganization 部门+子树 (D-003@v1)
- 项目经理: 持 ``XMJL`` 角色 → ``pm_user_id`` = 本人 (D-004@v1)
- 多身份并存: ``DataScope`` 双字段同时有值,service where 用 ``or_`` 合并 (D-005@v1)
- 三者皆无 → ``is_full=False`` / ``dept_org_ids`` 空 / ``pm_user_id`` None
  → service ``where(false())`` 返回空集

author: qinyi
created_at: 2026-07-18 17:30:00
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Annotated, Any

from fastapi import Depends
from sqlalchemy import false, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user
from app.core.db import get_session
from app.modules.admin.model import UserOrganization, UserRole
from app.modules.admin.organizations_service import _descendant_ids
from app.modules.auth.model import Role, User
from app.modules.ppm.plan.model import PsProjectPlan
from app.modules.ppm.project.model import PpmProjectMaintenance

# 复用现有 RBAC 角色 key (D-001@v1,不新建角色)
SUPER_ADMIN_KEY = "super_admin"
DEPT_BOSS_KEY = "DEPTBOSS"
PROJECT_MANAGER_KEY = "XMJL"


@dataclass(frozen=True)
class DataScope:
    """当前用户在 PPM 项目计划/项目维护 的可见数据范围。

    - is_full: 超管 → True,service 不加范围 where (全部)。
    - dept_org_ids: 部门经理可见的部门(含子树)集合;非部门经理为空集。
    - pm_user_id: 项目经理本人 id;非项目经理为 None。
    多身份并存:部门经理+项目经理 → dept_org_ids 非空且 pm_user_id 有值 (D-005@v1 并集)。
    """

    is_full: bool
    dept_org_ids: frozenset[uuid.UUID] = field(default_factory=frozenset)
    pm_user_id: uuid.UUID | None = None


async def get_user_role_keys(session: AsyncSession, user: User) -> set[str]:
    """返回当前用户的所有平台角色 key (JOIN user_roles + roles)。"""
    rows = (
        (
            await session.execute(
                select(Role.key)
                .join(UserRole, UserRole.role_id == Role.id)
                .where(UserRole.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )
    return set(rows)


async def _user_org_subtree(session: AsyncSession, user: User) -> frozenset[uuid.UUID]:
    """用户所属(UserOrganization)的所有部门 + 各自下级部门(子树)。

    复用 ``organizations_service._descendant_ids`` (BFS,SQLite/PG 兼容)。
    """
    direct_orgs = (
        (
            await session.execute(
                select(UserOrganization.organization_id).where(UserOrganization.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )
    org_ids: set[uuid.UUID] = set(direct_orgs)
    for org_id in direct_orgs:
        org_ids |= await _descendant_ids(session, org_id)
    return frozenset(org_ids)


async def get_ppm_data_scope(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> DataScope:
    """FastAPI 依赖项:解析当前用户的 PPM 项目计划/项目维护 数据范围。"""
    roles = await get_user_role_keys(session, user)
    if SUPER_ADMIN_KEY in roles or user.is_platform_admin:  # D-002@v1
        return DataScope(is_full=True)
    dept_org_ids = await _user_org_subtree(session, user) if DEPT_BOSS_KEY in roles else frozenset()
    pm_user_id = user.id if PROJECT_MANAGER_KEY in roles else None
    return DataScope(is_full=False, dept_org_ids=dept_org_ids, pm_user_id=pm_user_id)


def build_plan_scope_clause(scope: DataScope) -> Any | None:
    """构造 ``PsProjectPlan`` 的数据范围 where 子句。

    - 返回 None:``is_full`` → 不加 where (看全部)。
    - 返回 ``false()``:无任何身份 → 强制空集。
    - 否则:``or_(部门经理项目集, 项目经理本人)`` (D-005@v1 并集)。

    部门经理用 ``project_id.in_(SELECT id FROM project WHERE org_id IN dept_org_ids)``
    子查询,避免改 ``_Crud.list_paged`` 的 join 能力 (D-003@v1)。
    """
    if scope.is_full:
        return None
    clauses: list[Any] = []
    if scope.dept_org_ids:
        clauses.append(
            PsProjectPlan.project_id.in_(
                select(PpmProjectMaintenance.id).where(
                    PpmProjectMaintenance.organization_id.in_(scope.dept_org_ids)
                )
            )
        )
    if scope.pm_user_id is not None:
        clauses.append(PsProjectPlan.project_manager_id == scope.pm_user_id)
    if not clauses:
        return false()
    return or_(*clauses)


def build_project_scope_clause(scope: DataScope) -> Any | None:
    """构造 ``PpmProjectMaintenance`` 的数据范围 where 子句 (语义同 build_plan_scope_clause)。

    项目经理分支:项目主表无 manager 字段,反查 ``PsProjectPlan.project_manager_id``
    得到 project_id 集合 (D-008@v1)。
    """
    if scope.is_full:
        return None
    clauses: list[Any] = []
    if scope.dept_org_ids:
        clauses.append(PpmProjectMaintenance.organization_id.in_(scope.dept_org_ids))
    if scope.pm_user_id is not None:
        clauses.append(
            PpmProjectMaintenance.id.in_(
                select(PsProjectPlan.project_id).where(
                    PsProjectPlan.project_manager_id == scope.pm_user_id
                )
            )
            | (PpmProjectMaintenance.created_by == scope.pm_user_id)
        )
    if not clauses:
        return false()
    return or_(*clauses)


__all__ = [
    "DEPT_BOSS_KEY",
    "PROJECT_MANAGER_KEY",
    "SUPER_ADMIN_KEY",
    "DataScope",
    "build_plan_scope_clause",
    "build_project_scope_clause",
    "get_ppm_data_scope",
    "get_user_role_keys",
]
