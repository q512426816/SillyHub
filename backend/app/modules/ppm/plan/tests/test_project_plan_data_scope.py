"""项目计划 / 项目维护 数据范围集成单测 (2026-07-22 权限统一到项目成员角色)。

经理判定来源 = ``PpmProjectMember.role_name``(与任务计划/问题清单同口径),
不再用系统 RBAC 角色 / ``PsProjectPlan.project_manager_id`` / 部门组织树。

覆盖:
- ``build_plan/project_scope_clause`` 纯函数(is_full→None、空→false()、经理+创建人并集)
- ``PlanService.list_ps_project_plans``:经理成员看本项目全部计划(含
  ``project_manager_id`` 是别人的)、多角色逗号拼接、创建人可见、跨项目隔离、
  多项目经理并集、空 scope
- ``ProjectMaintenanceService.page``:同口径(经理命中 / 创建人可见 / 空)
- ``get_ppm_data_scope``:成员经理角色 → manager_project_ids 命中
- ``can_operate_plan`` 写校验:经理/创建人/超管放行,局外人 ``PlanForbidden`` (403)
- ``compute_plan_can_operate`` 批量

用根 conftest 的 ``db_session``(in-memory SQLite),plan/tests/conftest 已注册
plan+project model。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import User
from app.modules.ppm.data_scope import (
    DataScope,
    build_plan_scope_clause,
    build_project_scope_clause,
    can_operate_plan,
    compute_plan_can_operate,
    get_ppm_data_scope,
    plan_operable,
    plan_operable_by_scope,
)
from app.modules.ppm.plan.model import PsProjectPlan
from app.modules.ppm.plan.schema import PsProjectPlanListReq
from app.modules.ppm.plan.service import PlanForbidden, PlanService
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.ppm.project.schema import ProjectMaintenancePageReq
from app.modules.ppm.project.service import ProjectMaintenanceService

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


async def _user(db: AsyncSession, *, is_admin: bool = False, name: str = "u") -> User:
    u = User(
        id=uuid.uuid4(),
        username=f"{name}-{uuid.uuid4().hex[:6]}",
        password_hash="x",
        display_name=name,
        status="active",
        is_platform_admin=is_admin,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


async def _project(db: AsyncSession, code: str = "p") -> PpmProjectMaintenance:
    p = PpmProjectMaintenance(id=uuid.uuid4(), project_code=f"{code}-{uuid.uuid4().hex[:6]}")
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


async def _member(
    db: AsyncSession, project: PpmProjectMaintenance, user: User, role_name: str
) -> PpmProjectMember:
    m = PpmProjectMember(pm_project_id=project.id, user_id=user.id, role_name=role_name)
    db.add(m)
    await db.commit()
    return m


async def _plan(
    db: AsyncSession,
    *,
    project_id: uuid.UUID | None = None,
    manager_id: uuid.UUID | None = None,
    created_by: uuid.UUID | None = None,
) -> PsProjectPlan:
    p = PsProjectPlan(
        id=uuid.uuid4(), project_id=project_id, project_manager_id=manager_id, created_by=created_by
    )
    db.add(p)
    await db.commit()
    return p


def _req() -> PsProjectPlanListReq:
    return PsProjectPlanListReq(page=1, page_size=20)


# ---------------------------------------------------------------------------
# build_*_scope_clause 纯函数
# ---------------------------------------------------------------------------


def test_build_plan_scope_full_returns_none() -> None:
    assert build_plan_scope_clause(DataScope(is_full=True)) is None


def test_build_plan_scope_empty_returns_false() -> None:
    clause = build_plan_scope_clause(DataScope(is_full=False))
    assert clause is not None  # false()


def test_build_project_scope_full_returns_none() -> None:
    assert build_project_scope_clause(DataScope(is_full=True)) is None


def test_build_project_scope_empty_returns_false() -> None:
    clause = build_project_scope_clause(DataScope(is_full=False))
    assert clause is not None  # false()


# ---------------------------------------------------------------------------
# get_ppm_data_scope:成员经理角色 → manager_project_ids 命中
# ---------------------------------------------------------------------------


async def test_get_scope_super_admin_is_full(db_session: AsyncSession) -> None:
    admin = await _user(db_session, is_admin=True, name="admin")
    scope = await get_ppm_data_scope(admin, db_session)
    assert scope.is_full is True


async def test_get_scope_manager_member_hits_project(db_session: AsyncSession) -> None:
    """项目成员配「项目经理」→ manager_project_ids 含该项目。"""
    pm = await _user(db_session, name="pm")
    proj = await _project(db_session, "A")
    await _member(db_session, proj, pm, "项目经理")
    scope = await get_ppm_data_scope(pm, db_session)
    assert scope.is_full is False
    assert proj.id in scope.manager_project_ids
    assert scope.creator_user_id == pm.id


async def test_get_scope_non_manager_member_empty(db_session: AsyncSession) -> None:
    """项目成员但非经理角色(开发)→ manager_project_ids 空(仅创建人可见)。"""
    dev = await _user(db_session, name="dev")
    proj = await _project(db_session, "A")
    await _member(db_session, proj, dev, "开发")
    scope = await get_ppm_data_scope(dev, db_session)
    assert scope.manager_project_ids == frozenset()


# ---------------------------------------------------------------------------
# PlanService.list_ps_project_plans 集成
# ---------------------------------------------------------------------------


async def test_full_scope_sees_all(db_session: AsyncSession) -> None:
    proj = await _project(db_session, "A")
    await _plan(db_session, project_id=proj.id)
    await _plan(db_session, project_id=proj.id)
    res = await PlanService(db_session).list_ps_project_plans(_req(), DataScope(is_full=True))
    assert res.total == 2


async def test_manager_sees_all_plans_of_project_regardless_of_pm_field(
    db_session: AsyncSession,
) -> None:
    """经理成员看本项目全部计划,含 project_manager_id 是别人的(不再依赖该字段)。"""
    pm = await _user(db_session, name="pm")
    other = await _user(db_session, name="other")
    proj = await _project(db_session, "A")
    await _member(db_session, proj, pm, "项目经理")
    # 3 条计划:project_manager_id 全是 other,created_by 也是 other
    await _plan(db_session, project_id=proj.id, manager_id=other.id, created_by=other.id)
    await _plan(db_session, project_id=proj.id, manager_id=other.id, created_by=other.id)
    scope = DataScope(
        is_full=False, manager_project_ids=frozenset({proj.id}), creator_user_id=pm.id
    )
    res = await PlanService(db_session).list_ps_project_plans(_req(), scope)
    assert res.total == 2  # 全部可见(经理项目集)


async def test_multi_role_comma_split_still_manager(db_session: AsyncSession) -> None:
    """role_name 逗号拼接含「开发经理」→ 仍是经理,看本项目全部。"""
    pm = await _user(db_session, name="pm")
    other = await _user(db_session, name="other")
    proj = await _project(db_session, "A")
    await _member(db_session, proj, pm, "开发经理,前端开发人员")
    await _plan(db_session, project_id=proj.id, manager_id=other.id, created_by=other.id)
    scope = DataScope(
        is_full=False, manager_project_ids=frozenset({proj.id}), creator_user_id=pm.id
    )
    res = await PlanService(db_session).list_ps_project_plans(_req(), scope)
    assert res.total == 1


async def test_non_manager_member_only_sees_own_created(db_session: AsyncSession) -> None:
    """非经理角色成员只看自己创建的(看不到本项目别人的计划)。"""
    dev = await _user(db_session, name="dev")
    other = await _user(db_session, name="other")
    proj = await _project(db_session, "A")
    await _member(db_session, proj, dev, "开发")  # 非经理角色
    mine = await _plan(db_session, project_id=proj.id, created_by=dev.id)
    await _plan(db_session, project_id=proj.id, created_by=other.id)  # 别人的 → 不可见
    # dev 非经理 → manager_project_ids 空,仅 created_by==dev 可见
    scope = DataScope(is_full=False, manager_project_ids=frozenset(), creator_user_id=dev.id)
    res = await PlanService(db_session).list_ps_project_plans(_req(), scope)
    assert res.total == 1
    assert {p.id for p in res.items} == {mine.id}


async def test_creator_visible_without_manager_role(db_session: AsyncSession) -> None:
    """创建人可见自己创建的计划(即使非经理、项目不在其名下)。"""
    creator = await _user(db_session, name="creator")
    proj = await _project(db_session, "A")
    mine = await _plan(db_session, project_id=proj.id, created_by=creator.id)
    scope = DataScope(is_full=False, manager_project_ids=frozenset(), creator_user_id=creator.id)
    res = await PlanService(db_session).list_ps_project_plans(_req(), scope)
    assert res.total == 1
    assert {p.id for p in res.items} == {mine.id}


async def test_multiple_manager_projects_union(db_session: AsyncSession) -> None:
    """多项目经理取并集。"""
    pm = await _user(db_session, name="pm")
    other = await _user(db_session, name="other")
    pa = await _project(db_session, "A")
    pb = await _project(db_session, "B")
    await _plan(db_session, project_id=pa.id, created_by=other.id)
    await _plan(db_session, project_id=pb.id, created_by=other.id)
    scope = DataScope(
        is_full=False, manager_project_ids=frozenset({pa.id, pb.id}), creator_user_id=pm.id
    )
    res = await PlanService(db_session).list_ps_project_plans(_req(), scope)
    assert res.total == 2


async def test_cross_project_isolation(db_session: AsyncSession) -> None:
    """仅 A 项目经理 → 看不到 B 项目的计划。"""
    pm = await _user(db_session, name="pm")
    other = await _user(db_session, name="other")
    pa = await _project(db_session, "A")
    pb = await _project(db_session, "B")
    await _plan(db_session, project_id=pa.id, created_by=other.id)
    await _plan(db_session, project_id=pb.id, created_by=other.id)
    scope = DataScope(is_full=False, manager_project_ids=frozenset({pa.id}), creator_user_id=pm.id)
    res = await PlanService(db_session).list_ps_project_plans(_req(), scope)
    assert res.total == 1


async def test_empty_scope_sees_nothing(db_session: AsyncSession) -> None:
    """空 scope(非超管/非经理/无创建人,仅测试可手搓)→ 0。"""
    other = await _user(db_session, name="other")
    proj = await _project(db_session, "A")
    await _plan(db_session, project_id=proj.id, created_by=other.id)
    res = await PlanService(db_session).list_ps_project_plans(_req(), DataScope(is_full=False))
    assert res.total == 0


# ---------------------------------------------------------------------------
# ProjectMaintenanceService.page 集成
# ---------------------------------------------------------------------------


async def test_project_page_full(db_session: AsyncSession) -> None:
    await _project(db_session, "A")
    await _project(db_session, "B")
    svc = ProjectMaintenanceService(db_session)
    res = await svc.page(ProjectMaintenancePageReq(page=1, page_size=20), DataScope(is_full=True))
    assert res.total == 2


async def test_project_page_manager_hits(db_session: AsyncSession) -> None:
    """经理成员命中其经理项目(id in manager_project_ids)。"""
    pa = await _project(db_session, "A")
    pb = await _project(db_session, "B")
    scope = DataScope(
        is_full=False, manager_project_ids=frozenset({pa.id}), creator_user_id=uuid.uuid4()
    )
    svc = ProjectMaintenanceService(db_session)
    res = await svc.page(ProjectMaintenancePageReq(page=1, page_size=20), scope)
    assert res.total == 1
    assert res.items[0].id == pa.id
    _ = pb  # pb 不在 manager_project_ids → 不可见


async def test_project_page_creator_visible(db_session: AsyncSession) -> None:
    """创建人可见自己创建的项目。"""
    creator = await _user(db_session, name="creator")
    proj = PpmProjectMaintenance(id=uuid.uuid4(), project_code="C-x", created_by=creator.id)
    db_session.add(proj)
    await db_session.commit()
    scope = DataScope(is_full=False, manager_project_ids=frozenset(), creator_user_id=creator.id)
    svc = ProjectMaintenanceService(db_session)
    res = await svc.page(ProjectMaintenancePageReq(page=1, page_size=20), scope)
    assert res.total == 1
    assert res.items[0].id == proj.id


async def test_project_page_empty(db_session: AsyncSession) -> None:
    await _project(db_session, "A")
    svc = ProjectMaintenanceService(db_session)
    res = await svc.page(ProjectMaintenancePageReq(page=1, page_size=20), DataScope(is_full=False))
    assert res.total == 0


# ---------------------------------------------------------------------------
# can_operate_plan 写校验 (service update/delete)
# 放行 = 超管 ‖ 创建人 ‖ 本计划所属项目的经理
# ---------------------------------------------------------------------------


async def test_can_operate_manager_allowed(db_session: AsyncSession) -> None:
    """本项目经理可编辑/删除(非创建人)。"""
    pm = await _user(db_session, name="pm")
    other = await _user(db_session, name="other")
    proj = await _project(db_session, "A")
    await _member(db_session, proj, pm, "项目经理")
    plan = await _plan(db_session, project_id=proj.id, created_by=other.id)
    assert await can_operate_plan(db_session, pm, plan) is True
    svc = PlanService(db_session)
    await svc.update_ps_project_plan(plan.id, {"company_name": "改"}, user=pm)
    await svc.delete_ps_project_plan(plan.id, user=pm)


async def test_can_operate_creator_allowed(db_session: AsyncSession) -> None:
    """创建人可编辑/删除(非经理)。"""
    creator = await _user(db_session, name="creator")
    proj = await _project(db_session, "A")
    plan = await _plan(db_session, project_id=proj.id, created_by=creator.id)
    assert await can_operate_plan(db_session, creator, plan) is True
    svc = PlanService(db_session)
    await svc.update_ps_project_plan(plan.id, {"company_name": "改"}, user=creator)


async def test_can_operate_admin_allowed(db_session: AsyncSession) -> None:
    """超管放行。"""
    admin = await _user(db_session, is_admin=True, name="admin")
    other = await _user(db_session, name="other")
    proj = await _project(db_session, "A")
    plan = await _plan(db_session, project_id=proj.id, created_by=other.id)
    assert await can_operate_plan(db_session, admin, plan) is True


async def test_can_operate_denied_for_outsider(db_session: AsyncSession) -> None:
    """局外人(非创建人/非本项目经理/非超管)拒绝。"""
    outsider = await _user(db_session, name="outsider")
    other = await _user(db_session, name="other")
    proj = await _project(db_session, "A")
    plan = await _plan(db_session, project_id=proj.id, created_by=other.id)
    assert await can_operate_plan(db_session, outsider, plan) is False
    svc = PlanService(db_session)
    with pytest.raises(PlanForbidden):
        await svc.update_ps_project_plan(plan.id, {"company_name": "改"}, user=outsider)
    with pytest.raises(PlanForbidden):
        await svc.delete_ps_project_plan(plan.id, user=outsider)


async def test_can_operate_weibao_manager_denied(db_session: AsyncSession) -> None:
    """维保经理非经理角色 → 不放行(对齐 MANAGER_ROLE_NAMES 不含维保经理)。"""
    boss = await _user(db_session, name="wboss")
    other = await _user(db_session, name="other")
    proj = await _project(db_session, "A")
    await _member(db_session, proj, boss, "维保经理")
    plan = await _plan(db_session, project_id=proj.id, created_by=other.id)
    assert await can_operate_plan(db_session, boss, plan) is False


# ---------------------------------------------------------------------------
# compute_plan_can_operate / plan_operable_by_scope (批量+纯函数)
# ---------------------------------------------------------------------------


def test_plan_operable_pure_creator_or_manager() -> None:
    me = uuid.uuid4()
    other = uuid.uuid4()
    proj = uuid.uuid4()
    mine = PsProjectPlan(id=uuid.uuid4(), created_by=me)  # 创建人
    mgr = PsProjectPlan(id=uuid.uuid4(), project_id=proj, created_by=other)  # 经理项目
    unrelated = PsProjectPlan(id=uuid.uuid4(), project_id=uuid.uuid4(), created_by=other)
    pids = frozenset({proj})
    assert plan_operable(mine, me, pids) is True
    assert plan_operable(mgr, me, pids) is True
    assert plan_operable(unrelated, me, pids) is False


def test_plan_operable_by_scope_full() -> None:
    plan = PsProjectPlan(id=uuid.uuid4())
    assert plan_operable_by_scope(plan, DataScope(is_full=True)) is True


def test_compute_plan_can_operate_batch() -> None:
    me = uuid.uuid4()
    other = uuid.uuid4()
    proj = uuid.uuid4()
    p_creator = PsProjectPlan(id=uuid.uuid4(), created_by=me)
    p_manager = PsProjectPlan(id=uuid.uuid4(), project_id=proj, created_by=other)
    p_other = PsProjectPlan(id=uuid.uuid4(), project_id=uuid.uuid4(), created_by=other)
    scope = DataScope(is_full=False, manager_project_ids=frozenset({proj}), creator_user_id=me)
    can_map = compute_plan_can_operate([p_creator, p_manager, p_other], scope)
    assert can_map[p_creator.id] is True
    assert can_map[p_manager.id] is True
    assert can_map[p_other.id] is False
    # 超管全 True
    full_map = compute_plan_can_operate([p_other], DataScope(is_full=True))
    assert full_map[p_other.id] is True
