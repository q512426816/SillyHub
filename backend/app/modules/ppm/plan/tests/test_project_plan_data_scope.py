"""项目计划 数据范围集成单测 (2026-07-18-project-plan-data-scope task-07)。

覆盖 design AC-1~5:
- AC-1 super_admin / is_platform_admin(is_full) → 全部
- AC-2 部门经理(dept_org_ids 子树) → 相关项目全部计划
- AC-3 项目经理(pm_user_id) → 本人 project_manager_id
- AC-4 其他(空 scope) → 空
- AC-5 多身份并集(dept ∪ pm)

用根 conftest 的 db_session (in-memory SQLite),plan/tests/conftest 已注册
plan+project model。build_plan_scope_clause 是纯函数,这里通过 PlanService
端到端验证 where 注入正确 (覆盖 service 层组装 + 子查询)。
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.ppm.data_scope import (
    DataScope,
    build_plan_scope_clause,
    build_project_scope_clause,
)
from app.modules.ppm.plan.model import PsProjectPlan
from app.modules.ppm.plan.schema import PsProjectPlanListReq
from app.modules.ppm.plan.service import PlanService
from app.modules.ppm.project.model import PpmProjectMaintenance
from app.modules.ppm.project.schema import ProjectMaintenancePageReq
from app.modules.ppm.project.service import ProjectMaintenanceService


async def _seed(db_session: AsyncSession) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    """2 项目(分属 org_a/org_b) + 3 计划。返回 (org_a, org_b, user1, user2)。"""
    org_a, org_b = uuid.uuid4(), uuid.uuid4()
    proj_a = PpmProjectMaintenance(id=uuid.uuid4(), project_code="A", organization_id=org_a)
    proj_b = PpmProjectMaintenance(id=uuid.uuid4(), project_code="B", organization_id=org_b)
    db_session.add_all([proj_a, proj_b])
    user1, user2 = uuid.uuid4(), uuid.uuid4()
    # p1: proj_a + pm=user1; p2: proj_b + pm=user2; p3: proj_a + 无 pm
    # p4: proj_b + 无 pm + created_by=user1 (创建人可见性用例,2026-07-21)
    db_session.add_all(
        [
            PsProjectPlan(id=uuid.uuid4(), project_id=proj_a.id, project_manager_id=user1),
            PsProjectPlan(id=uuid.uuid4(), project_id=proj_b.id, project_manager_id=user2),
            PsProjectPlan(id=uuid.uuid4(), project_id=proj_a.id, project_manager_id=None),
            PsProjectPlan(
                id=uuid.uuid4(),
                project_id=proj_b.id,
                project_manager_id=None,
                created_by=user1,
            ),
        ]
    )
    await db_session.commit()
    return org_a, org_b, user1, user2


def _req() -> PsProjectPlanListReq:
    return PsProjectPlanListReq(page=1, page_size=20)


# ---------- build_*_scope_clause 纯函数 ----------


def test_build_plan_scope_full_returns_none() -> None:
    assert build_plan_scope_clause(DataScope(is_full=True)) is None


def test_build_plan_scope_empty_returns_false() -> None:
    clause = build_plan_scope_clause(DataScope(is_full=False))
    assert clause is not None  # false()


def test_build_project_scope_full_returns_none() -> None:
    assert build_project_scope_clause(DataScope(is_full=True)) is None


# ---------- PlanService.list_ps_project_plans 集成 (AC-1~5) ----------


async def test_full_scope_sees_all(db_session: AsyncSession) -> None:
    await _seed(db_session)
    res = await PlanService(db_session).list_ps_project_plans(_req(), DataScope(is_full=True))
    assert res.total == 4  # AC-1


async def test_dept_boss_sees_subtree_projects(db_session: AsyncSession) -> None:
    org_a, _org_b, _u1, _u2 = await _seed(db_session)
    res = await PlanService(db_session).list_ps_project_plans(
        _req(), DataScope(is_full=False, dept_org_ids=frozenset({org_a}))
    )
    assert res.total == 2  # AC-2: proj_a 的 p1 + p3


async def test_pm_sees_own_plans(db_session: AsyncSession) -> None:
    _org_a, _org_b, u1, _u2 = await _seed(db_session)
    res = await PlanService(db_session).list_ps_project_plans(
        _req(), DataScope(is_full=False, pm_user_id=u1)
    )
    # AC-3: p1(pm=user1) + p4(created_by=user1) = 2 (创建人可见性, 2026-07-21)
    assert res.total == 2


async def test_creator_sees_plan_even_without_pm(db_session: AsyncSession) -> None:
    """创建人可见性:计划无 pm、项目不在创建人部门,创建人仍可见 (2026-07-21)。"""
    _org_a, _org_b, u1, _u2 = await _seed(db_session)
    res = await PlanService(db_session).list_ps_project_plans(
        _req(), DataScope(is_full=False, pm_user_id=u1)
    )
    # p4 的 project_manager_id=None 且 proj_b 不在 user1 部门,仅凭 created_by 可见
    ids = {str(i.id) for i in res.items}
    assert res.total == 2
    assert len(ids) == 2  # p1 + p4


async def test_empty_scope_sees_nothing(db_session: AsyncSession) -> None:
    await _seed(db_session)
    res = await PlanService(db_session).list_ps_project_plans(_req(), DataScope(is_full=False))
    assert res.total == 0  # AC-4


async def test_union_dept_and_pm(db_session: AsyncSession) -> None:
    org_a, _org_b, _u1, u2 = await _seed(db_session)
    # dept=org_a (p1,p3) ∪ pm=u2 (p2) = 3 (并集, AC-5); p4 是 proj_b 无pm created_by=user1 不含
    res = await PlanService(db_session).list_ps_project_plans(
        _req(),
        DataScope(is_full=False, dept_org_ids=frozenset({org_a}), pm_user_id=u2),
    )
    assert res.total == 3


# ---------- ProjectMaintenanceService.page 集成 (AC-7) ----------


async def test_project_page_scope_filters(db_session: AsyncSession) -> None:
    org_a, _org_b, u1, _u2 = await _seed(db_session)
    svc = ProjectMaintenanceService(db_session)
    # full → 2 项目
    full = await svc.page(ProjectMaintenancePageReq(page=1, page_size=20), DataScope(is_full=True))
    assert full.total == 2
    # dept=org_a → 1 项目
    dept = await svc.page(
        ProjectMaintenancePageReq(page=1, page_size=20),
        DataScope(is_full=False, dept_org_ids=frozenset({org_a})),
    )
    assert dept.total == 1
    # pm=u1 → u1 负责的项目(proj_a) = 1
    pm = await svc.page(
        ProjectMaintenancePageReq(page=1, page_size=20),
        DataScope(is_full=False, pm_user_id=u1),
    )
    assert pm.total == 1
    # 空 → 0
    empty = await svc.page(
        ProjectMaintenancePageReq(page=1, page_size=20), DataScope(is_full=False)
    )
    assert empty.total == 0
