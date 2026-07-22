"""PPM 项目计划/项目维护 数据范围解析。

按当前用户身份产出 ``DataScope``,供 plan/project service 注入 where 过滤。
与功能权限 (``require_permission_any``) 正交:功能权限管"能不能进接口",
``DataScope`` 管"能看哪些数据"。

经理判定统一基于「项目成员角色」(``PpmProjectMember.role_name`` 逗号拆分后
精确匹配 部门经理/项目经理/开发经理/业务经理),复用 ``common.data_scope`` 的
``manager_project_ids`` / ``is_super_admin``——与任务计划/问题清单口径完全一致
(2026-07-22 权限统一:单一可信源 = 项目成员角色,不再用系统 RBAC 角色 /
``PsProjectPlan.project_manager_id`` / 部门组织树)。

身份判定:
- 超级管理员: ``is_platform_admin`` 或 ``super_admin`` 角色 → ``is_full=True`` (看全部)
- 经理(项目成员含任一经理角色): ``manager_project_ids`` = 这些项目的 id 集合,
  可见其名下全部计划/项目(含 ``project_manager_id`` 是别人的——不再依赖该字段)
- 其余: ``manager_project_ids`` 空,仅凭 ``created_by`` 可见自己创建的

author: qinyi
created_at: 2026-07-18 17:30:00
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Annotated, Any

from fastapi import Depends
from sqlalchemy import false, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.ppm.common.data_scope import is_super_admin, manager_project_ids
from app.modules.ppm.plan.model import PsProjectPlan
from app.modules.ppm.project.model import PpmProjectMaintenance


@dataclass(frozen=True)
class DataScope:
    """当前用户在 PPM 项目计划/项目维护 的可见数据范围。

    - is_full: 超管 → True,service 不加范围 where (全部)。
    - manager_project_ids: 当前用户作为经理(项目成员含任一经理角色)的项目 id 集合。
    - creator_user_id: 当前用户 id;非超管时 ``build_*_scope_clause`` 用
      ``created_by == creator_user_id`` 保证创建人可见自己建的计划/项目
      (对齐任务/问题的创建人可见性)。
    """

    is_full: bool
    manager_project_ids: frozenset[uuid.UUID] = field(default_factory=frozenset)
    creator_user_id: uuid.UUID | None = None


async def get_ppm_data_scope(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> DataScope:
    """FastAPI 依赖项:解析当前用户的 PPM 项目计划/项目维护 数据范围。

    经理判定复用 ``common.data_scope.manager_project_ids``(项目成员 role_name),
    与任务/问题同一口径。``manager_project_ids`` 返回 ``set``,这里转 ``frozenset``
    落入 frozen dataclass。
    """
    if await is_super_admin(session, user):
        return DataScope(is_full=True)
    manager_pids = await manager_project_ids(session, user)
    return DataScope(
        is_full=False,
        manager_project_ids=frozenset(manager_pids),
        creator_user_id=user.id,
    )


def build_plan_scope_clause(scope: DataScope) -> Any | None:
    """构造 ``PsProjectPlan`` 的数据范围 where 子句。

    - 返回 None:``is_full`` → 不加 where (看全部)。
    - 返回 ``false()``:无任何身份(非超管/非经理/无创建人,仅测试可手搓)→ 强制空集。
    - 否则:``or_(经理项目集的全部计划, 创建人本人)``。

    经理分支:``project_id IN manager_project_ids``(我当经理的项目下的全部计划,
    含 ``project_manager_id`` 是别人的——不再依赖该字段)。创建人分支:
    ``created_by == creator_user_id``(对齐 projects/problem 创建人可见性)。
    """
    if scope.is_full:
        return None
    clauses: list[Any] = []
    if scope.manager_project_ids:
        clauses.append(PsProjectPlan.project_id.in_(scope.manager_project_ids))
    if scope.creator_user_id is not None:
        clauses.append(PsProjectPlan.created_by == scope.creator_user_id)
    if not clauses:
        return false()
    return or_(*clauses)


def build_project_scope_clause(scope: DataScope) -> Any | None:
    """构造 ``PpmProjectMaintenance`` 的数据范围 where 子句 (语义同 build_plan_scope_clause)。

    经理分支:``id IN manager_project_ids``(主键直接命中);创建人分支:
    ``created_by == creator_user_id``。
    """
    if scope.is_full:
        return None
    clauses: list[Any] = []
    if scope.manager_project_ids:
        clauses.append(PpmProjectMaintenance.id.in_(scope.manager_project_ids))
    if scope.creator_user_id is not None:
        clauses.append(PpmProjectMaintenance.created_by == scope.creator_user_id)
    if not clauses:
        return false()
    return or_(*clauses)


# ===========================================================================
# 项目计划 编辑/删除放行 (can_operate, 对齐问题清单 can_operate_problem)
# 放行 = 超管 ‖ 创建人 ‖ 本计划所属项目的经理 (满足其一)
# ===========================================================================


def plan_operable(
    plan: PsProjectPlan,
    user_id: uuid.UUID,
    manager_pids: frozenset[uuid.UUID] | set[uuid.UUID],
) -> bool:
    """单条放行判断(纯函数,超管已在调用方排除;供单/批量共用避免逻辑分叉)。

    创建人(``plan.created_by == user_id``) ‖ 本计划所属项目的经理
    (``plan.project_id in manager_pids``),满足其一即放行。
    """
    return (plan.created_by is not None and plan.created_by == user_id) or (
        bool(manager_pids) and plan.project_id in manager_pids
    )


def plan_operable_by_scope(plan: PsProjectPlan, scope: DataScope) -> bool:
    """按已解析的 ``DataScope`` 判定单条放行(router list/get 用,免再查库)。

    超管(``scope.is_full``)直通;否则用 scope 内的 ``manager_project_ids`` +
    ``creator_user_id`` 本地判定。
    """
    if scope.is_full:
        return True
    if scope.creator_user_id is None:
        return False
    return plan_operable(plan, scope.creator_user_id, scope.manager_project_ids)


def compute_plan_can_operate(plans: list[PsProjectPlan], scope: DataScope) -> dict[uuid.UUID, bool]:
    """批量计算各计划的编辑/删除放行(供列表/详情响应填 ``can_edit``/``can_delete``)。

    纯函数:超管全 True,否则逐条 ``plan_operable_by_scope``。无 N+1
    (``manager_project_ids`` 已在 ``get_ppm_data_scope`` 查好并随 scope 传入)。
    """
    if scope.is_full:
        return {p.id: True for p in plans}
    return {p.id: plan_operable_by_scope(p, scope) for p in plans}


async def can_operate_plan(session: AsyncSession, user: User, plan: PsProjectPlan) -> bool:
    """单条异步入口(service 写路径用,镜像 ``can_operate_problem``)。

    超管直通;否则查一次 ``manager_project_ids`` 再 ``plan_operable``。
    """
    if await is_super_admin(session, user):
        return True
    manager_pids = await manager_project_ids(session, user)
    return plan_operable(plan, user.id, manager_pids)


__all__ = [
    "DataScope",
    "build_plan_scope_clause",
    "build_project_scope_clause",
    "can_operate_plan",
    "compute_plan_can_operate",
    "get_ppm_data_scope",
    "plan_operable",
    "plan_operable_by_scope",
]
