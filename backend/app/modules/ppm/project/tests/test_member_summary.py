"""聚合接口 (member_summary) 与成员接口账号回填 (username) 单测。

覆盖 (task-04.md acceptance):
- 分页 total/items、6 维筛选 (project_name/status/type/owner_name/
  member_keyword/role_name) 各命中;
- 多 PM 取 created_at 最早、无 PM owner_name=None、member_count 计数;
- ProjectMemberService.page 带 username 回填。

夹具约定:PpmProjectMember.user_id 是 users.id NOT NULL FK (model.py:210),
须先 ``db_session.add(User(...))`` 建 user 再建指向它的成员,避免 FK 问题。
SQLite 测试库默认不强制 FK,但 LEFT JOIN users 仍需对应行才能回填 username。

依据:design §7.2 (推算口径) / §10 R-01 (负责人推算边界);conftest.py 的
``db_session`` fixture + pytest-asyncio auto 模式 (无需 @mark.asyncio)。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.modules.auth.model import User
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.ppm.project.schema import (
    ProjectMemberPageReq,
    ProjectMemberSummaryPageReq,
)
from app.modules.ppm.project.service import (
    ProjectMaintenanceService,
    ProjectMemberService,
)


@pytest.fixture()
def operator() -> uuid.UUID:
    return uuid.uuid4()


async def _make_user(db_session, *, username: str | None, user_name: str | None = None) -> User:
    """建一个 users 行并返回 (password_hash 必填,username 可空)。"""
    user = User(
        id=uuid.uuid4(),
        username=username,
        password_hash="x",  # 测试不校验密码
        display_name=user_name,
        status="active",
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _make_member(
    db_session,
    *,
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    user_name: str | None,
    role_name: str | None,
    operator: uuid.UUID,
    created_at: datetime | None = None,
) -> PpmProjectMember:
    member = PpmProjectMember(
        id=uuid.uuid4(),
        pm_project_id=project_id,
        user_id=user_id,
        user_name=user_name,
        role_name=role_name,
        created_by=operator,
        updated_by=operator,
    )
    if created_at is not None:
        member.created_at = created_at
    db_session.add(member)
    return member


# ---------------------------------------------------------------------------
# 聚合分页 + 6 维筛选 + 负责人推算 + member_count
# ---------------------------------------------------------------------------


async def test_member_summary_pagination_and_defaults(db_session, operator):
    """空表分页 total=0;有数据后 total/items、默认 updated_at 倒序。"""
    svc = ProjectMaintenanceService(db_session)
    res = await svc.member_summary(ProjectMemberSummaryPageReq())
    assert res.total == 0
    assert res.items == []

    # 建一个项目 + 一个普通成员 (无 PM → owner_name=None)
    user = await _make_user(db_session, username="u1", user_name="成员1")
    project = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code="SUM-1",
        project_name="聚合项目",
        project_status="进行中",
        project_type="研发",
        company_name="公司A",
        created_by=operator,
        updated_by=operator,
    )
    db_session.add(project)
    await _make_member(
        db_session,
        project_id=project.id,
        user_id=user.id,
        user_name="成员1",
        role_name="开发",
        operator=operator,
    )
    await db_session.commit()

    res = await svc.member_summary(ProjectMemberSummaryPageReq())
    assert res.total == 1
    item = res.items[0]
    assert item.id == project.id
    assert item.project_name == "聚合项目"
    assert item.project_code == "SUM-1"
    assert item.company_name == "公司A"
    assert item.owner_name is None  # 无项目经理
    assert item.member_count == 1


async def test_member_summary_owner_earliest_pm_and_count(db_session, operator):
    """多 PM 取 created_at 最早;member_count 统计全部成员。"""
    svc = ProjectMaintenanceService(db_session)
    project = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code="PM-1",
        project_name="多PM项目",
        created_by=operator,
        updated_by=operator,
    )
    db_session.add(project)

    base = datetime.now(UTC)
    u_early = await _make_user(db_session, username="early", user_name="早PM")
    u_late = await _make_user(db_session, username="late", user_name="晚PM")
    u_dev = await _make_user(db_session, username="dev", user_name="开发甲")

    await _make_member(
        db_session,
        project_id=project.id,
        user_id=u_late.id,
        user_name="晚PM",
        role_name="项目经理",
        operator=operator,
        created_at=base + timedelta(hours=2),
    )
    await _make_member(
        db_session,
        project_id=project.id,
        user_id=u_early.id,
        user_name="早PM",
        role_name="项目经理",
        operator=operator,
        created_at=base + timedelta(hours=1),
    )
    await _make_member(
        db_session,
        project_id=project.id,
        user_id=u_dev.id,
        user_name="开发甲",
        role_name="开发",
        operator=operator,
        created_at=base,
    )
    await db_session.commit()

    res = await svc.member_summary(ProjectMemberSummaryPageReq())
    assert res.total == 1
    item = res.items[0]
    assert item.owner_name == "早PM"  # created_at 最早
    assert item.member_count == 3  # 含非 PM 成员


async def test_member_summary_filter_project_name(db_session, operator):
    """project_name 模糊筛选。"""
    svc = ProjectMaintenanceService(db_session)
    for code, name in [("N1", "Alpha 项目"), ("N2", "Beta 项目")]:
        p = PpmProjectMaintenance(
            id=uuid.uuid4(),
            project_code=code,
            project_name=name,
            created_by=operator,
            updated_by=operator,
        )
        db_session.add(p)
    await db_session.commit()

    res = await svc.member_summary(ProjectMemberSummaryPageReq(project_name="Alpha"))
    assert res.total == 1
    assert res.items[0].project_code == "N1"


async def test_member_summary_filter_status_and_type(db_session, operator):
    """project_status / project_type 精确筛选。"""
    svc = ProjectMaintenanceService(db_session)
    for code, st, ty in [
        ("S1", "进行中", "研发"),
        ("S2", "已完成", "研发"),
        ("S3", "进行中", "实施"),
    ]:
        p = PpmProjectMaintenance(
            id=uuid.uuid4(),
            project_code=code,
            project_name=f"项目{code}",
            project_status=st,
            project_type=ty,
            created_by=operator,
            updated_by=operator,
        )
        db_session.add(p)
    await db_session.commit()

    res = await svc.member_summary(ProjectMemberSummaryPageReq(project_status="进行中"))
    assert res.total == 2

    res = await svc.member_summary(ProjectMemberSummaryPageReq(project_type="实施"))
    assert res.total == 1
    assert res.items[0].project_code == "S3"

    # 组合精确
    res = await svc.member_summary(
        ProjectMemberSummaryPageReq(project_status="已完成", project_type="研发")
    )
    assert res.total == 1
    assert res.items[0].project_code == "S2"


async def test_member_summary_filter_owner_name(db_session, operator):
    """owner_name EXISTS:仅命中含「项目经理且user_name匹配」的项目。"""
    svc = ProjectMaintenanceService(db_session)
    p_with_zhang = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code="O1",
        project_name="有张PM",
        created_by=operator,
        updated_by=operator,
    )
    p_without = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code="O2",
        project_name="无张PM",
        created_by=operator,
        updated_by=operator,
    )
    db_session.add_all([p_with_zhang, p_without])
    u_zhang = await _make_user(db_session, username="zhang", user_name="张三")
    u_li = await _make_user(db_session, username="li", user_name="李四")
    await _make_member(
        db_session,
        project_id=p_with_zhang.id,
        user_id=u_zhang.id,
        user_name="张三",
        role_name="项目经理",
        operator=operator,
    )
    await _make_member(
        db_session,
        project_id=p_without.id,
        user_id=u_li.id,
        user_name="李四",
        role_name="项目经理",
        operator=operator,
    )
    await db_session.commit()

    res = await svc.member_summary(ProjectMemberSummaryPageReq(owner_name="张三"))
    assert res.total == 1
    assert res.items[0].project_code == "O1"


async def test_member_summary_filter_member_keyword(db_session, operator):
    """member_keyword EXISTS:匹配成员 user_name 或 users.username。"""
    svc = ProjectMaintenanceService(db_session)
    p1 = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code="K1",
        project_name="按账号命中",
        created_by=operator,
        updated_by=operator,
    )
    p2 = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code="K2",
        project_name="按姓名命中",
        created_by=operator,
        updated_by=operator,
    )
    p3 = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code="K3",
        project_name="不命中",
        created_by=operator,
        updated_by=operator,
    )
    db_session.add_all([p1, p2, p3])
    # K1:username 含 "alice"
    u_alice = await _make_user(db_session, username="alice", user_name="爱丽丝")
    # K2:user_name 含 "王五"
    u_wang = await _make_user(db_session, username="wang", user_name="王五")
    # K3:都不含 "ali"/"王"
    u_other = await _make_user(db_session, username="bob", user_name="赵六")
    await _make_member(
        db_session,
        project_id=p1.id,
        user_id=u_alice.id,
        user_name="爱丽丝",
        role_name="开发",
        operator=operator,
    )
    await _make_member(
        db_session,
        project_id=p2.id,
        user_id=u_wang.id,
        user_name="王五",
        role_name="开发",
        operator=operator,
    )
    await _make_member(
        db_session,
        project_id=p3.id,
        user_id=u_other.id,
        user_name="赵六",
        role_name="开发",
        operator=operator,
    )
    await db_session.commit()

    # username 匹配
    res = await svc.member_summary(ProjectMemberSummaryPageReq(member_keyword="ali"))
    assert res.total == 1
    assert res.items[0].project_code == "K1"

    # user_name 匹配
    res = await svc.member_summary(ProjectMemberSummaryPageReq(member_keyword="王五"))
    assert res.total == 1
    assert res.items[0].project_code == "K2"


async def test_member_summary_filter_role_name(db_session, operator):
    """role_name EXISTS:命中含该角色的成员所属项目 (多角色逗号拼接)。"""
    svc = ProjectMaintenanceService(db_session)
    p1 = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code="R1",
        project_name="有项目经理",
        created_by=operator,
        updated_by=operator,
    )
    p2 = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code="R2",
        project_name="仅开发",
        created_by=operator,
        updated_by=operator,
    )
    db_session.add_all([p1, p2])
    u1 = await _make_user(db_session, username="multi", user_name="多角色")
    u2 = await _make_user(db_session, username="dev", user_name="开发乙")
    await _make_member(
        db_session,
        project_id=p1.id,
        user_id=u1.id,
        user_name="多角色",
        role_name="开发经理,项目经理,前端",  # 多角色逗号拼接
        operator=operator,
    )
    await _make_member(
        db_session,
        project_id=p2.id,
        user_id=u2.id,
        user_name="开发乙",
        role_name="开发",
        operator=operator,
    )
    await db_session.commit()

    res = await svc.member_summary(ProjectMemberSummaryPageReq(role_name="项目经理"))
    assert res.total == 1
    assert res.items[0].project_code == "R1"


# ---------------------------------------------------------------------------
# 成员接口 username 回填 (LEFT JOIN users)
# ---------------------------------------------------------------------------


async def test_member_page_username_backfill(db_session, operator):
    """ProjectMemberService.page 带 username:有对应用户回填账号。"""
    user = await _make_user(db_session, username="backfill_acct", user_name="回填测试")
    project = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code="MB-1",
        project_name="成员账号项目",
        created_by=operator,
        updated_by=operator,
    )
    db_session.add(project)
    await _make_member(
        db_session,
        project_id=project.id,
        user_id=user.id,
        user_name="回填测试",
        role_name="开发",
        operator=operator,
    )
    await db_session.commit()

    msvc = ProjectMemberService(db_session)
    res = await msvc.page(ProjectMemberPageReq(pm_project_id=project.id))
    assert res.total == 1
    assert res.items[0].username == "backfill_acct"
    assert res.items[0].user_name == "回填测试"


async def test_member_page_username_none_when_no_user(db_session, operator):
    """成员 user_id 在 users 表无对应行 → username=None (LEFT JOIN 兜底)。

    SQLite 测试库不强制 FK,可插入悬空 user_id;LEFT JOIN users 取不到行,
    username 应为 None。
    """
    project = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code="MB-2",
        project_name="悬空成员项目",
        created_by=operator,
        updated_by=operator,
    )
    db_session.add(project)
    await _make_member(
        db_session,
        project_id=project.id,
        user_id=uuid.uuid4(),  # users 表无对应行
        user_name="悬空成员",
        role_name="开发",
        operator=operator,
    )
    await db_session.commit()

    msvc = ProjectMemberService(db_session)
    res = await msvc.page(ProjectMemberPageReq(pm_project_id=project.id))
    assert res.total == 1
    assert res.items[0].username is None
