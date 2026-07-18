"""data_scope + service 数据范围过滤单测。

覆盖 5 档角色(超管 is_platform_admin / super_admin 角色 / 项目经理 / 部门经理 /
开发经理·业务经理 / 普通人)在【任务计划】+【问题清单】两个列表的可见范围。

设计依据:change ``2026-07-18-ppm-data-scope`` design.md §6 AC-1~9。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.admin.model import UserRole
from app.modules.auth.model import Role, User
from app.modules.ppm.common.crud import PageReq
from app.modules.ppm.common.data_scope import (
    MANAGER_ROLE_NAMES,
    is_super_admin,
    manager_project_ids,
)
from app.modules.ppm.problem.model import PpmProblemList
from app.modules.ppm.problem.service import ProblemService
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.ppm.task.model import PlanTask
from app.modules.ppm.task.schema import PlanTaskPageReq
from app.modules.ppm.task.service import PlanTaskService

pytestmark = pytest.mark.asyncio


@pytest.fixture()
async def db(db_session: AsyncSession) -> AsyncSession:
    """``db_session`` 的短别名,供本模块测试用。"""
    return db_session


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


async def _user(db: AsyncSession, *, is_admin: bool = False, name: str = "u") -> User:
    u = User(
        id=uuid.uuid4(),
        email=f"{name}-{uuid.uuid4().hex[:6]}@x.com",
        password_hash="x",
        display_name=name,
        status="active",
        is_platform_admin=is_admin,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


async def _grant_role(db: AsyncSession, user: User, key: str, name: str) -> None:
    r = Role(id=uuid.uuid4(), key=key, name=name, is_system=False, is_active=True)
    db.add(r)
    await db.flush()
    db.add(UserRole(user_id=user.id, role_id=r.id))
    await db.commit()


async def _project(db: AsyncSession, code: str = "p") -> PpmProjectMaintenance:
    p = PpmProjectMaintenance(project_code=f"{code}-{uuid.uuid4().hex[:6]}")
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


async def _task(
    db: AsyncSession, user_id: uuid.UUID, project_id: uuid.UUID | None = None
) -> PlanTask:
    t = PlanTask(user_id=user_id, project_id=project_id)
    db.add(t)
    await db.commit()
    return t


async def _problem(
    db: AsyncSession,
    project_id: uuid.UUID,
    *,
    duty: uuid.UUID | None = None,
    audit: uuid.UUID | None = None,
    now_handle: str | None = None,
) -> PpmProblemList:
    p = PpmProblemList(
        project_id=project_id,
        duty_user_id=duty,
        audit_user_id=audit,
        now_handle_user=now_handle,
    )
    db.add(p)
    await db.commit()
    return p


# ---------------------------------------------------------------------------
# data_scope 常量与函数层
# ---------------------------------------------------------------------------


async def test_manager_role_names_constant() -> None:
    """D-003:经理集 = 4 类,不含维保经理。"""
    assert frozenset({"部门经理", "项目经理", "开发经理", "业务经理"}) == MANAGER_ROLE_NAMES


async def test_is_super_admin_platform(db: AsyncSession) -> None:
    """D-006:is_platform_admin → 超管。"""
    u = await _user(db, is_admin=True)
    assert await is_super_admin(db, u) is True


async def test_is_super_admin_by_role(db: AsyncSession) -> None:
    """D-006:持 super_admin 角色 → 超管(兜底 admin2 场景)。"""
    u = await _user(db)
    await _grant_role(db, u, "super_admin", "超级管理员")
    assert await is_super_admin(db, u) is True


async def test_is_super_admin_false_for_normal(db: AsyncSession) -> None:
    u = await _user(db)
    assert await is_super_admin(db, u) is False


async def test_manager_project_ids_single_role(db: AsyncSession) -> None:
    """D-002:项目经理成员 → 命中该项目。"""
    u = await _user(db)
    proj = await _project(db)
    await _member(db, proj, u, "项目经理")
    assert proj.id in await manager_project_ids(db, u)


async def test_manager_project_ids_multi_role_split(db: AsyncSession) -> None:
    """D-002:role_name 逗号拼接多角色,拆分后命中"开发经理"。"""
    u = await _user(db)
    proj = await _project(db)
    await _member(db, proj, u, "开发经理,前端开发人员,后端开发人员")
    assert proj.id in await manager_project_ids(db, u)


async def test_manager_project_ids_excludes_developer(db: AsyncSession) -> None:
    """非经理角色(开发)不命中。"""
    u = await _user(db)
    proj = await _project(db)
    await _member(db, proj, u, "开发")
    assert await manager_project_ids(db, u) == set()


async def test_manager_project_ids_excludes_weibao(db: AsyncSession) -> None:
    """D-003:维保经理不在经理集。"""
    u = await _user(db)
    proj = await _project(db)
    await _member(db, proj, u, "维保经理")
    assert await manager_project_ids(db, u) == set()


async def test_manager_project_ids_dept_boss(db: AsyncSession) -> None:
    """D-004:部门经理同项目经理,命中项目。"""
    u = await _user(db)
    proj = await _project(db)
    await _member(db, proj, u, "部门经理")
    assert proj.id in await manager_project_ids(db, u)


# ---------------------------------------------------------------------------
# 任务计划 service 层(AC-1~4, AC-8, AC-9)
# ---------------------------------------------------------------------------


async def test_task_super_admin_sees_all(db: AsyncSession) -> None:
    """AC-1:超管看全部(含别人负责、无项目的)。"""
    other = await _user(db, name="other")
    admin = await _user(db, is_admin=True, name="admin")
    proj = await _project(db)
    await _task(db, other.id, proj.id)
    await _task(db, other.id, None)
    res = await PlanTaskService(db).page(PlanTaskPageReq(page=1, page_size=100), user=admin)
    assert res.total == 2


async def test_task_manager_sees_full_project_incl_others(db: AsyncSession) -> None:
    """AC-2:项目经理看管辖项目全部任务(含非自己负责的)。"""
    pm = await _user(db, name="pm")
    other = await _user(db, name="other")
    proj = await _project(db, "A")
    await _member(db, proj, pm, "项目经理")
    await _task(db, other.id, proj.id)  # other 负责,pm 作为经理应能看到
    await _task(db, other.id, proj.id)
    res = await PlanTaskService(db).page(PlanTaskPageReq(page=1, page_size=100), user=pm)
    assert res.total == 2


async def test_task_manager_in_non_manager_project_only_own(db: AsyncSession) -> None:
    """AC-3:经理在另一项目是普通成员 → 只看自己负责的。"""
    pm = await _user(db, name="pm")
    other = await _user(db, name="other")
    proj_a = await _project(db, "A")
    proj_b = await _project(db, "B")
    await _member(db, proj_a, pm, "项目经理")  # 仅 A 项目经理
    t_a_other = await _task(db, other.id, proj_a.id)  # A 项目 other 的 → 经理可见
    t_b_other = await _task(db, other.id, proj_b.id)  # B 项目 other 的 → 不可见
    t_b_pm = await _task(db, pm.id, proj_b.id)  # B 项目 pm 自己的 → 可见(user_id==pm)
    res = await PlanTaskService(db).page(PlanTaskPageReq(page=1, page_size=100), user=pm)
    ids = {t.id for t in res.items}
    assert t_a_other.id in ids
    assert t_b_pm.id in ids
    assert t_b_other.id not in ids
    assert res.total == 2


async def test_task_normal_user_only_own(db: AsyncSession) -> None:
    """AC-4/AC-8:普通人只看自己负责的(含 project_id 为 NULL 的)。"""
    u = await _user(db, name="normal")
    other = await _user(db, name="other")
    proj = await _project(db)
    await _task(db, other.id, proj.id)  # 别人的 → 看不到
    await _task(db, u.id, proj.id)  # 自己的
    await _task(db, u.id, None)  # 自己的(无项目,AC-8)
    res = await PlanTaskService(db).page(PlanTaskPageReq(page=1, page_size=100), user=u)
    assert res.total == 2


async def test_task_dept_manager_same_as_pm(db: AsyncSession) -> None:
    """AC-5:部门经理同项目经理看相关项目全部。"""
    boss = await _user(db, name="boss")
    other = await _user(db, name="other")
    proj = await _project(db)
    await _member(db, proj, boss, "部门经理")
    await _task(db, other.id, proj.id)
    res = await PlanTaskService(db).page(PlanTaskPageReq(page=1, page_size=100), user=boss)
    assert res.total == 1


async def test_task_multiple_manager_projects_union(db: AsyncSession) -> None:
    """AC-9:多项目经理取并集。"""
    pm = await _user(db, name="pm")
    other = await _user(db, name="other")
    pa = await _project(db, "A")
    pb = await _project(db, "B")
    await _member(db, pa, pm, "项目经理")
    await _member(db, pb, pm, "项目经理")
    await _task(db, other.id, pa.id)
    await _task(db, other.id, pb.id)
    res = await PlanTaskService(db).page(PlanTaskPageReq(page=1, page_size=100), user=pm)
    assert res.total == 2  # A ∪ B


# ---------------------------------------------------------------------------
# 问题清单 service 层(AC-1~4, AC-6, AC-7)
# ---------------------------------------------------------------------------


async def test_problem_super_admin_sees_all(db: AsyncSession) -> None:
    admin = await _user(db, is_admin=True)
    proj = await _project(db)
    await _problem(db, proj.id)
    await _problem(db, proj.id)
    page = await ProblemService(db).list_problems(PageReq(page=1, page_size=100), user=admin)
    assert page.total == 2


async def test_problem_manager_sees_full_project(db: AsyncSession) -> None:
    """经理看管辖项目全部问题(含别人负责的)。"""
    pm = await _user(db, name="pm")
    other = await _user(db, name="other")
    proj = await _project(db)
    await _member(db, proj, pm, "项目经理")
    await _problem(db, proj.id, duty=other.id)
    page = await ProblemService(db).list_problems(PageReq(page=1, page_size=100), user=pm)
    assert page.total == 1


async def test_problem_normal_user_by_duty_audit_now_handle(db: AsyncSession) -> None:
    """AC:普通人 = 自己是 duty / audit / now_handle 任一。"""
    u = await _user(db, name="normal")
    other = await _user(db, name="other")
    proj = await _project(db)
    p_duty = await _problem(db, proj.id, duty=u.id)
    p_audit = await _problem(db, proj.id, audit=u.id)
    p_handle = await _problem(db, proj.id, now_handle=f"{other.id},{u.id}")
    await _problem(db, proj.id, duty=other.id)  # 别人的 → 看不到
    page = await ProblemService(db).list_problems(PageReq(page=1, page_size=100), user=u)
    assert page.total == 3
    ids = {p.id for p in page.items}
    assert {p_duty.id, p_audit.id, p_handle.id} <= ids


async def test_problem_now_handle_no_false_positive(db: AsyncSession) -> None:
    """now_handle_user 不含自己 → 不命中(逗号包围精确匹配)。"""
    u = await _user(db, name="normal")
    other = await _user(db, name="other")
    proj = await _project(db)
    await _problem(db, proj.id, now_handle=str(other.id))
    page = await ProblemService(db).list_problems(PageReq(page=1, page_size=100), user=u)
    assert page.total == 0


async def test_problem_export_respects_scope(db: AsyncSession) -> None:
    """AC-7:导出同步按范围过滤(防绕过)。"""
    admin = await _user(db, is_admin=True)
    normal = await _user(db, name="normal")
    proj = await _project(db)
    await _problem(db, proj.id, duty=admin.id)
    await _problem(db, proj.id, duty=normal.id)
    svc = ProblemService(db)
    assert len(await svc.list_problems_for_export(user=admin)) == 2
    assert len(await svc.list_problems_for_export(user=normal)) == 1


async def test_task_export_respects_scope_via_page(db: AsyncSession) -> None:
    """AC-7:任务导出走 page,普通用户只导出自己负责的。"""
    admin = await _user(db, is_admin=True)
    normal = await _user(db, name="normal")
    proj = await _project(db)
    await _task(db, admin.id, proj.id)
    await _task(db, normal.id, proj.id)
    svc = PlanTaskService(db)
    admin_total = (await svc.page(PlanTaskPageReq(page=1, page_size=200), user=admin)).total
    normal_total = (await svc.page(PlanTaskPageReq(page=1, page_size=200), user=normal)).total
    assert admin_total == 2
    assert normal_total == 1
