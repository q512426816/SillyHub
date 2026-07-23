"""PPM 数据查询范围过滤(按角色)。

设计依据:change ``2026-07-18-ppm-data-scope`` design.md §5 / decisions.md D-001~D-011。

5 档角色可见范围:
- 超级管理员(``is_platform_admin`` 或 ``super_admin`` 角色)→ 全部(返回 None,不加 where)
- 经理(部门经理/项目经理/开发经理/业务经理,在某项目成员 ``role_name`` 含对应角色)→
  该项目集合下的全部任务/问题
- 其余人 → 只看自己负责的(任务 ``user_id``=自己;问题 ``duty``/``audit``/``now_handle`` 含自己)

经理判定基于 ``PpmProjectMember.role_name``(逗号拼接中文角色名),应用层拆分后
精确匹配 :data:`MANAGER_ROLE_NAMES`——SQL 模糊匹配易误伤(如 ``ilike '%经理%'``
会命中"维保经理"),故 Python 拆分精确比对。
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.permission_cache import get_cached_ppm_scope, set_cached_ppm_scope
from app.modules.admin.model import UserRole
from app.modules.auth.model import Role, User
from app.modules.ppm.problem.model import PpmProblemList
from app.modules.ppm.project.model import PpmProjectMember
from app.modules.ppm.task.model import PlanTask

# 经理角色名(项目成员 role_name 逗号拆分后精确匹配)。
# 对应系统角色 key:部门经理=DEPTBOSS / 项目经理=XMJL / 开发经理=KFJL / 业务经理=YWJL。
# 注:不含"维保经理(WBJL)"——用户需求未列入(D-003)。
MANAGER_ROLE_NAMES: frozenset[str] = frozenset({"部门经理", "项目经理", "开发经理", "业务经理"})

SUPER_ADMIN_KEY = "super_admin"


async def _compute_ppm_scope(session: AsyncSession, user: User) -> dict:
    """查库计算 PPM 数据范围(``manager_project_ids`` + ``is_super_admin``)并回填缓存。

    把 :func:`manager_project_ids` / :func:`is_super_admin` 的查库逻辑集中在此
    (避免散落重复),供两者共享 ``ppm-scope`` 一键缓存——miss 时一次查库同时算出
    两值回填,后续任一入口命中即直接返回。

    注:``is_platform_admin`` 短路不进入本函数(在 :func:`is_super_admin` 调用方
    保留);此处 ``is_super_admin`` 仅算"是否持 ``super_admin`` 角色"。
    """
    stmt_member = select(
        col(PpmProjectMember.pm_project_id), col(PpmProjectMember.role_name)
    ).where(col(PpmProjectMember.user_id) == user.id)
    manager_ids: set[uuid.UUID] = set()
    for pm_project_id, role_name in (await session.execute(stmt_member)).all():
        names = {s.strip() for s in (role_name or "").split(",") if s.strip()}
        if names & MANAGER_ROLE_NAMES:
            manager_ids.add(pm_project_id)

    stmt_role = (
        select(col(UserRole.role_id))
        .join(Role, col(Role.id) == col(UserRole.role_id))
        .where(col(UserRole.user_id) == user.id)
        .where(col(Role.key) == SUPER_ADMIN_KEY)
    )
    super_admin = (await session.execute(stmt_role)).first() is not None

    scope = {"manager_project_ids": manager_ids, "is_super_admin": super_admin}
    await set_cached_ppm_scope(user.id, scope)
    return scope


async def is_super_admin(session: AsyncSession, user: User) -> bool:
    """超管 = ``is_platform_admin`` 或持 ``super_admin`` 角色(D-006)。

    复用现有 RBAC 短路口径(``rbac.has_permission`` 的第一分支),并补 ``super_admin``
    角色判定——DB 实测 ``is_platform_admin=true`` 与 ``super_admin`` 角色持有集不重合。

    缓存(FR-03/D-005@v1):``is_platform_admin`` 短路保留(不查 DB/缓存);否则读
    ``ppm-scope`` 缓存的 ``is_super_admin`` 字段,miss 时 :func:`_compute_ppm_scope`
    查库回填。降级范式——Redis 故障 get 返回 None,自动回退查库。
    """
    if user.is_platform_admin:
        return True
    cached = await get_cached_ppm_scope(user.id)
    if cached is not None:
        return cached["is_super_admin"]
    return (await _compute_ppm_scope(session, user))["is_super_admin"]


async def manager_project_ids(session: AsyncSession, user: User) -> set[uuid.UUID]:
    """当前用户作为经理(任一经理角色)的项目 id 集合(D-002/D-003)。

    ``role_name`` 是逗号拼接多角色字符串(如"开发经理,项目经理,前端开发人员"),
    应用层拆分后精确匹配 :data:`MANAGER_ROLE_NAMES`——避免 SQL ``ilike '%经理%'``
    误伤维保经理等非目标角色。

    缓存(FR-03/D-005@v1):读 ``ppm-scope`` 缓存的 ``manager_project_ids``(helper
    已保证反序列化为 ``set[uuid.UUID]``,直接用),miss 时 :func:`_compute_ppm_scope`
    查库回填。降级范式——Redis 故障 get 返回 None,自动回退查库。
    """
    cached = await get_cached_ppm_scope(user.id)
    if cached is not None:
        return cached["manager_project_ids"]
    return (await _compute_ppm_scope(session, user))["manager_project_ids"]


async def task_scope_clause(session: AsyncSession, user: User):
    """返回 ``PlanTask`` 的范围 where 子句;``None`` 表示不加(超管看全部)(D-005/D-007)。

    非超管:经理项目集的全部任务 OR 自己负责的(``user_id``==自己)。
    ``project_id`` 为 NULL 的任务不在经理集,仅当 ``user_id``==自己 时命中(D-009)。
    """
    if await is_super_admin(session, user):
        return None
    manager_pids = await manager_project_ids(session, user)
    clauses: list = []
    if manager_pids:
        clauses.append(PlanTask.project_id.in_(manager_pids))
    clauses.append(PlanTask.user_id == user.id)
    return or_(*clauses)


async def problem_scope_clause(session: AsyncSession, user: User):
    """返回 ``PpmProblemList`` 的范围 where 子句;``None`` 表示不加(超管看全部)(D-005/D-007)。

    非超管:经理项目集的全部问题 OR 自己是 ``created_by``(创建人) /
    ``duty_user_id``(责任人) / ``audit_user_id``(验证人) / ``now_handle_user``
    (处置人,逗号分隔含自己)任一(D-005 + ql-20260722 创建人可见)。

    创建人也纳入可见范围:``can_operate_problem`` 放行创建人编辑/删除,若可见
    范围不含创建人,会出现"能编辑却在列表看不见自己创建的问题"的矛盾。

    ``now_handle_user`` 是 UUID 逗号字符串,两侧补逗号后 ``like`` 精确匹配
    ``%,uid,%``,避免 UUID 子串误匹配;NULL 经 ``coalesce``→空串不命中。
    """
    if await is_super_admin(session, user):
        return None
    manager_pids = await manager_project_ids(session, user)
    uid_str = str(user.id)
    uid_csv = f"%,{uid_str},%"
    wrapped = func.concat(",", func.coalesce(PpmProblemList.now_handle_user, ""), ",")
    clauses: list = []
    if manager_pids:
        clauses.append(PpmProblemList.project_id.in_(manager_pids))
    clauses.append(PpmProblemList.created_by == user.id)
    clauses.append(PpmProblemList.duty_user_id == user.id)
    clauses.append(PpmProblemList.audit_user_id == user.id)
    clauses.append(wrapped.like(uid_csv))
    return or_(*clauses)


async def can_operate_problem(session: AsyncSession, user: User, problem: PpmProblemList) -> bool:
    """编辑/删除放行判断(2026-07-20 权限改造)。

    满足其一即放行:
    - 超级管理员(``is_platform_admin`` 或 ``super_admin`` 角色)
    - 创建人(``problem.created_by == user.id``)
    - 本问题所属项目的经理(部门/项目/开发/业务经理,``manager_project_ids`` 含
      ``problem.project_id``)
    - 责任人(``problem.duty_user_id == user.id``,保留旧逻辑)

    复用 :func:`is_super_admin` / :func:`manager_project_ids`。前端按钮显示
    (``can_edit``/``can_delete``)与后端写操作鉴权共用本函数,避免两端分叉。
    """
    if await is_super_admin(session, user):
        return True
    manager_pids = await manager_project_ids(session, user)
    return problem_operable(problem, user.id, manager_pids)


def problem_operable(
    problem: PpmProblemList, user_id: uuid.UUID, manager_pids: set[uuid.UUID]
) -> bool:
    """单条放行判断(纯函数,超管已在调用方排除;供单/批量共用避免逻辑分叉)。

    创建人 ‖ 责任人 ‖ 本问题所属项目的经理(``manager_pids`` 含 ``project_id``),
    满足其一即放行。调用方需先判超管(超管恒 True,无需查经理项目集)。
    """
    return (
        (problem.created_by is not None and problem.created_by == user_id)
        or (problem.duty_user_id is not None and problem.duty_user_id == user_id)
        or (bool(manager_pids) and problem.project_id in manager_pids)
    )
