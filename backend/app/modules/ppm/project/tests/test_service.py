"""ppm project 子域 service 层单测。

覆盖:
- ProjectMaintenanceService CRUD + simple_list + project_code 唯一冲突
- CustomerMaintenanceService CRUD + 分页过滤
- ProjectMemberService CRUD + 同项目同 user 重复 (409)
- ProjectStakeholderService CRUD + 按 project 过滤
- FK 依赖:member/stakeholder 必须先建 project

依据:task-03.md 验收项 + design §8。
"""

from __future__ import annotations

import uuid

import pytest

from app.modules.ppm.project.schema import (
    CustomerMaintenanceCreate,
    CustomerMaintenancePageReq,
    ProjectMaintenanceCreate,
    ProjectMaintenancePageReq,
    ProjectMaintenanceUpdate,
    ProjectMemberCreate,
    ProjectMemberPageReq,
    ProjectMemberUpdate,
    ProjectStakeholderCreate,
    ProjectStakeholderPageReq,
    ProjectStakeholderUpdate,
)
from app.modules.ppm.project.service import (
    CustomerMaintenanceService,
    PpmProjectCodeDuplicate,
    PpmProjectMemberDuplicate,
    PpmProjectMemberNotFound,
    PpmProjectNotFound,
    PpmProjectStakeholderNotFound,
    ProjectMaintenanceService,
    ProjectMemberService,
    ProjectStakeholderService,
)


@pytest.fixture()
def operator() -> uuid.UUID:
    return uuid.uuid4()


# ---------------------------------------------------------------------------
# ProjectMaintenanceService
# ---------------------------------------------------------------------------


async def test_project_crud_and_unique_code(db_session, operator):
    svc = ProjectMaintenanceService(db_session)
    created = await svc.create(
        ProjectMaintenanceCreate(
            project_code="P-001",
            project_name="SillyHub",
            company_name="Anthropic",
            project_status="进行中",
            project_type="研发",
        ),
        operator=operator,
    )
    assert created.id is not None
    assert created.project_code == "P-001"
    assert created.created_by == operator

    got = await svc.get(created.id)
    assert got.project_name == "SillyHub"

    updated = await svc.update(
        created.id,
        ProjectMaintenanceUpdate(project_name="SillyHub v2", project_status="已完成"),
        operator=operator,
    )
    assert updated.project_name == "SillyHub v2"
    assert updated.project_status == "已完成"
    assert updated.updated_by == operator

    # project_code 唯一冲突
    with pytest.raises(PpmProjectCodeDuplicate):
        await svc.create(
            ProjectMaintenanceCreate(project_code="P-001", project_name="dup"),
            operator=operator,
        )

    # 不存在
    with pytest.raises(PpmProjectNotFound):
        await svc.get(uuid.uuid4())

    await svc.delete(created.id)
    with pytest.raises(PpmProjectNotFound):
        await svc.get(created.id)


async def test_project_page_filter_and_sort(db_session, operator):
    svc = ProjectMaintenanceService(db_session)
    for code, name, status in [
        ("A1", "Alpha 项目", "进行中"),
        ("A2", "Alpha 子项目", "已完成"),
        ("B1", "Beta 项目", "进行中"),
    ]:
        await svc.create(
            ProjectMaintenanceCreate(project_code=code, project_name=name, project_status=status),
            operator=operator,
        )

    # 模糊 project_name
    res = await svc.page(ProjectMaintenancePageReq(project_name="Alpha"))
    assert res.total == 2

    # 精确 status
    res = await svc.page(ProjectMaintenancePageReq(project_status="进行中"))
    assert res.total == 2

    # code 模糊 + 排序
    res = await svc.page(
        ProjectMaintenancePageReq(project_code="A", order_by="project_code", order="asc")
    )
    assert res.total == 2
    assert [i.project_code for i in res.items] == ["A1", "A2"]


async def test_project_simple_list(db_session, operator):
    svc = ProjectMaintenanceService(db_session)
    await svc.create(
        ProjectMaintenanceCreate(project_code="C1", project_name="Zeta"),
        operator=operator,
    )
    await svc.create(
        ProjectMaintenanceCreate(project_code="C2", project_name="Alpha"),
        operator=operator,
    )
    items = await svc.simple_list()
    assert len(items) == 2
    # 按 project_name 升序
    assert [i.project_name for i in items] == ["Alpha", "Zeta"]
    # 仅 id + project_name
    assert all(hasattr(i, "id") for i in items)


# ---------------------------------------------------------------------------
# CustomerMaintenanceService
# ---------------------------------------------------------------------------


async def test_customer_crud_and_page(db_session, operator):
    svc = CustomerMaintenanceService(db_session)
    c1 = await svc.create(
        CustomerMaintenanceCreate(
            company_name="Acme",
            contact="张三",
            phone_no="13800000000",
            level="VIP",
        ),
        operator=operator,
    )
    c2 = await svc.create(
        CustomerMaintenanceCreate(company_name="Globex", contact="李四", level="普通"),
        operator=operator,
    )

    res = await svc.page(CustomerMaintenancePageReq(company_name="Acme"))
    assert res.total == 1
    assert res.items[0].contact == "张三"

    res = await svc.page(CustomerMaintenancePageReq(level="普通"))
    assert res.total == 1
    assert res.items[0].id == c2.id

    await svc.delete(c1.id)
    res = await svc.page(CustomerMaintenancePageReq())
    assert res.total == 1


# ---------------------------------------------------------------------------
# ProjectMemberService (FK→project + users, 唯一约束)
# ---------------------------------------------------------------------------


async def test_member_crud_and_duplicate(db_session, operator):
    project_svc = ProjectMaintenanceService(db_session)
    project = await project_svc.create(
        ProjectMaintenanceCreate(project_code="M-1", project_name="Member Test"),
        operator=operator,
    )

    user_a = uuid.uuid4()
    user_b = uuid.uuid4()

    msvc = ProjectMemberService(db_session)
    m1 = await msvc.create(
        ProjectMemberCreate(
            pm_project_id=project.id,
            user_id=user_a,
            user_name="成员A",
            role_name="开发",
            role_id="dev",
        ),
        operator=operator,
    )
    assert m1.pm_project_id == project.id
    assert m1.user_id == user_a

    # 同项目同 user 重复 → 409
    with pytest.raises(PpmProjectMemberDuplicate):
        await msvc.create(
            ProjectMemberCreate(pm_project_id=project.id, user_id=user_a, user_name="成员A dup"),
            operator=operator,
        )

    # 同项目不同 user OK
    m2 = await msvc.create(
        ProjectMemberCreate(
            pm_project_id=project.id, user_id=user_b, user_name="成员B", role_name="项目经理"
        ),
        operator=operator,
    )

    # 按 project 过滤
    res = await msvc.page(ProjectMemberPageReq(pm_project_id=project.id))
    assert res.total == 2

    # 按 role_name 过滤
    res = await msvc.page(ProjectMemberPageReq(pm_project_id=project.id, role_name="开发"))
    assert res.total == 1
    assert res.items[0].id == m1.id

    # update
    updated = await msvc.update(
        m1.id, ProjectMemberUpdate(role_name="测试", phone="13900000000"), operator=operator
    )
    assert updated.role_name == "测试"
    assert updated.phone == "13900000000"

    # delete
    await msvc.delete(m2.id)
    with pytest.raises(PpmProjectMemberNotFound):
        await msvc.get(m2.id)


async def test_member_role_name_ilike_matches_multi_role(db_session, operator):
    """回归:role_name 多角色逗号拼接存储(D-009@v1),page(role_name=)
    用 ilike 模糊匹配,应能命中含该角色的多角色成员。

    复现场景:/ppm/project-plans 编辑/新建时,项目经理下拉 res=projectMember +
    searchData.role_name="项目经理" 拉选项;若成员 role_name 是
    "开发经理,项目经理,前端开发人员,后端开发人员"(逗号拼接),
    精确匹配会漏掉 → 下拉「无数据」。
    """
    project_svc = ProjectMaintenanceService(db_session)
    project = await project_svc.create(
        ProjectMaintenanceCreate(project_code="M-ILIKE", project_name="多角色成员项目"),
        operator=operator,
    )
    msvc = ProjectMemberService(db_session)
    # 单角色项目经理
    await msvc.create(
        ProjectMemberCreate(
            pm_project_id=project.id,
            user_id=uuid.uuid4(),
            user_name="纯PM",
            role_name="项目经理",
        ),
        operator=operator,
    )
    # 多角色逗号拼接,含「项目经理」
    await msvc.create(
        ProjectMemberCreate(
            pm_project_id=project.id,
            user_id=uuid.uuid4(),
            user_name="多角色PM",
            role_name="开发经理,项目经理,前端开发人员,后端开发人员",
        ),
        operator=operator,
    )
    # 不含「项目经理」的成员
    await msvc.create(
        ProjectMemberCreate(
            pm_project_id=project.id,
            user_id=uuid.uuid4(),
            user_name="开发",
            role_name="开发",
        ),
        operator=operator,
    )

    res = await msvc.page(ProjectMemberPageReq(pm_project_id=project.id, role_name="项目经理"))
    assert res.total == 2, f"应命中 2 个项目经理(单/多角色),实得 {res.total}"
    names = {m.user_name for m in res.items}
    assert names == {"纯PM", "多角色PM"}


# ---------------------------------------------------------------------------
# ProjectStakeholderService (FK→project)
# ---------------------------------------------------------------------------


async def test_stakeholder_crud_and_filter(db_session, operator):
    project_svc = ProjectMaintenanceService(db_session)
    project = await project_svc.create(
        ProjectMaintenanceCreate(project_code="S-1", project_name="Stakeholder Test"),
        operator=operator,
    )

    ssvc = ProjectStakeholderService(db_session)
    s1 = await ssvc.create(
        ProjectStakeholderCreate(
            pm_project_id=project.id,
            stakeholder="王五",
            stakeholder_role="甲方代表",
            phone="13700000000",
        ),
        operator=operator,
    )
    s2 = await ssvc.create(
        ProjectStakeholderCreate(
            pm_project_id=project.id,
            stakeholder="赵六",
            stakeholder_role="监理",
        ),
        operator=operator,
    )

    res = await ssvc.page(ProjectStakeholderPageReq(pm_project_id=project.id))
    assert res.total == 2

    res = await ssvc.page(ProjectStakeholderPageReq(stakeholder="王"))
    assert res.total == 1
    assert res.items[0].id == s1.id

    res = await ssvc.page(ProjectStakeholderPageReq(stakeholder_role="监理"))
    assert res.total == 1
    assert res.items[0].id == s2.id

    updated = await ssvc.update(
        s1.id, ProjectStakeholderUpdate(stakeholder_role="甲方总代表"), operator=operator
    )
    assert updated.stakeholder_role == "甲方总代表"

    await ssvc.delete(s1.id)
    with pytest.raises(PpmProjectStakeholderNotFound):
        await ssvc.get(s1.id)
