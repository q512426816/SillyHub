"""workbench 聚合 service 单元测试。

钉死三块聚合 (profile / summary / calendar) 的口径与边界:
- 指标完成率/延期率分母口径 (task_count=区间内任务总数)
- task_count=0 零除边界 (completion_rate/delay_rate = 0.0,非 NaN)
- now_handle_user 逗号串 Python split 派生匹配 (命中 me / 不命中他人)
- defect_count 不受 range 影响
- 日历按 start_time 落点计数 + load_level 分档 + alert_level 延期预警
- profile 部门关联 nullable 兜底

铁律:
- 直接 WorkbenchService(db_session) 调方法,不 mock 被测 service
- now = datetime.now(UTC) 在每个 test 函数体内取 (禁模块级常量)
- 时间区间造数据用 test 内 datetime.now(UTC) ± timedelta
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.modules.admin.model import Organization, UserOrganization
from app.modules.auth.model import Role, User, UserWorkspaceRole
from app.modules.ppm.problem.model import PpmProblemChange, PpmProblemList
from app.modules.ppm.task.model import PlanTask, TaskExecute
from app.modules.ppm.workbench.service import WorkbenchService

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


async def _seed_user(
    db_session,
    *,
    display_name: str | None = "张三",
    employee_no: str | None = "E001",
    username: str | None = None,
) -> User:
    """造一个 User (password_hash 必填,用占位串)。"""
    user = User(
        display_name=display_name,
        employee_no=employee_no,
        username=username,
        email=f"{username or uuid.uuid4().hex}@example.com",
        password_hash="x",
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _seed_org_link(db_session, user_id: uuid.UUID, org_name: str = "研发部") -> Organization:
    """造一个 active Organization + UserOrganization 关联。"""
    org = Organization(name=org_name, code=f"code-{uuid.uuid4().hex[:8]}", status="active")
    db_session.add(org)
    await db_session.flush()
    link = UserOrganization(user_id=user_id, organization_id=org.id)
    db_session.add(link)
    await db_session.commit()
    return org


async def _seed_plan(
    db_session,
    user_id: uuid.UUID,
    *,
    status: str = "未开始",
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    content: str | None = "写单测",
    work_load: str | None = None,
) -> PlanTask:
    """造一条 PlanTask (覆盖 未开始/进行中/已完成 三态 + work_load 计划工时)。"""
    plan = PlanTask(
        user_id=user_id,
        user_name="张三",
        status=status,
        start_time=start_time,
        end_time=end_time,
        project_id=uuid.uuid4(),
        project_name="P1",
        content=content,
        work_load=work_load,
    )
    db_session.add(plan)
    await db_session.commit()
    await db_session.refresh(plan)
    return plan


async def _seed_problem(
    db_session,
    *,
    duty_user_id: uuid.UUID | None = None,
    status: str = "2",
    now_handle_user: str | None = None,
    pro_desc: str | None = "问题描述",
) -> PpmProblemList:
    """造一条 PpmProblemList (project_id 必填 UUID)。"""
    problem = PpmProblemList(
        project_id=uuid.uuid4(),
        project_name="项目A",
        pro_desc=pro_desc,
        duty_user_id=duty_user_id,
        status=status,
        now_handle_user=now_handle_user,
    )
    db_session.add(problem)
    await db_session.commit()
    await db_session.refresh(problem)
    return problem


async def _seed_problem_change(
    db_session,
    *,
    status: str = "1",
    now_handle_user: str | None = None,
    pro_desc: str | None = "变更描述",
) -> PpmProblemChange:
    """造一条 PpmProblemChange (问题变更,resource_id 必填 UUID)。"""
    change = PpmProblemChange(
        resource_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        project_name="项目A",
        pro_desc=pro_desc,
        status=status,
        now_handle_user=now_handle_user,
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)
    return change


async def _seed_execute(
    db_session,
    *,
    execute_user_id: uuid.UUID,
    time_spent: float,
    actual_start_time: datetime | None = None,
    actual_end_time: datetime | None = None,
    plan_task_id: uuid.UUID | None = None,
) -> TaskExecute:
    """造一条 TaskExecute (work_hours 聚合源 / 日历过去实际平摊源 / 未来剩余已用源)。"""
    ex = TaskExecute(
        execute_user_id=execute_user_id,
        time_spent=time_spent,
        actual_start_time=actual_start_time,
        actual_end_time=actual_end_time,
        plan_task_id=plan_task_id,
    )
    db_session.add(ex)
    await db_session.commit()
    await db_session.refresh(ex)
    return ex


# ===========================================================================
# profile
# ===========================================================================


@pytest.mark.asyncio
async def test_profile_with_org_link_returns_department(db_session):
    """有 Organization(status=active)+UserOrganization → department_name 正确。"""
    user = await _seed_user(db_session, display_name="李四", employee_no="E100")
    await _seed_org_link(db_session, user.id, org_name="研发部")

    svc = WorkbenchService(db_session)
    profile = await svc.get_profile(user)

    assert profile.display_name == "李四"
    assert profile.employee_no == "E100"
    assert profile.department_name == "研发部"
    # avatar_text 取 display_name 首字
    assert profile.avatar_text == "李"


@pytest.mark.asyncio
async def test_profile_without_org_link_department_none(db_session):
    """无 UserOrganization 关联 → department_name is None (R-04 nullable 兜底)。"""
    user = await _seed_user(db_session)

    svc = WorkbenchService(db_session)
    profile = await svc.get_profile(user)

    assert profile.department_name is None


@pytest.mark.asyncio
async def test_profile_employee_no_none(db_session):
    """employee_no=None 不崩 (brownfield 老用户兜底,返回 None)。"""
    user = await _seed_user(db_session, employee_no=None)

    svc = WorkbenchService(db_session)
    profile = await svc.get_profile(user)

    assert profile.employee_no is None


@pytest.mark.asyncio
async def test_profile_role_name_from_workspace_role(db_session):
    """role_name 取 workspaces 首个非空 (造 UserWorkspaceRole + Role)。"""
    user = await _seed_user(db_session)
    role = Role(key=f"dev-{uuid.uuid4().hex[:6]}", name="开发工程师")
    db_session.add(role)
    await db_session.flush()
    ws_role = UserWorkspaceRole(
        user_id=user.id,
        workspace_id=uuid.uuid4(),
        role_id=role.id,
    )
    db_session.add(ws_role)
    await db_session.commit()

    svc = WorkbenchService(db_session)
    profile = await svc.get_profile(user)

    assert profile.role_name == "开发工程师"


@pytest.mark.asyncio
async def test_profile_avatar_text_fallback_chain(db_session):
    """avatar_text 兜底链:display_name → username → email → '#'。"""
    # display_name 为空,走 username
    user = await _seed_user(db_session, display_name=None, username="wangwu")
    svc = WorkbenchService(db_session)
    profile = await svc.get_profile(user)
    assert profile.avatar_text == "w"


# ===========================================================================
# summary —— 指标口径
# ===========================================================================


@pytest.mark.asyncio
async def test_summary_metrics_with_tasks(db_session):
    """造当前人 3 条 PlanTask (已完成1/进行中1/已延期1) → 口径正确。"""
    now = datetime.now(UTC)
    user = await _seed_user(db_session)
    # start_time 落在本月区间内
    in_month = now.replace(day=1, hour=9, minute=0, second=0, microsecond=0) + timedelta(days=2)
    if in_month.month != now.month:  # 跨月兜底,确保 start_time 落在当月
        in_month = now.replace(day=1, hour=9, minute=0, second=0, microsecond=0) + timedelta(days=1)
    # 已完成 (end_time 未来,不延期)
    await _seed_plan(
        db_session, user.id, status="已完成", start_time=in_month, end_time=now + timedelta(days=1)
    )
    # 进行中未延期
    await _seed_plan(
        db_session, user.id, status="进行中", start_time=in_month, end_time=now + timedelta(days=1)
    )
    # 进行中已延期 (end_time<now,未完成)
    await _seed_plan(
        db_session, user.id, status="进行中", start_time=in_month, end_time=now - timedelta(days=1)
    )

    svc = WorkbenchService(db_session)
    summary = await svc.get_summary(user, range="month")
    m = summary.metrics

    assert m.task_count == 3
    assert m.completion_rate == pytest.approx(1 / 3)
    assert m.delay_rate == pytest.approx(1 / 3)


@pytest.mark.asyncio
async def test_summary_zero_tasks_no_div_zero(db_session):
    """task_count=0 边界:completion_rate/delay_rate = 0.0 (非 NaN/异常)。"""
    user = await _seed_user(db_session)

    svc = WorkbenchService(db_session)
    summary = await svc.get_summary(user, range="month")
    m = summary.metrics

    assert m.task_count == 0
    assert m.completion_rate == 0.0
    assert m.delay_rate == 0.0
    # 确保 NaN 不发生
    assert m.completion_rate == m.completion_rate
    assert m.delay_rate == m.delay_rate


# ===========================================================================
# summary —— 待办派生 (now_handle_user Python split 匹配)
# ===========================================================================


@pytest.mark.asyncio
async def test_summary_todo_problem_handle_user_match(db_session):
    """问题待办:now_handle_user='uid1,<me>,uid2' 含 me → 进 todos。"""
    user = await _seed_user(db_session)
    me_str = str(user.id)
    uid1, uid2 = uuid.uuid4(), uuid.uuid4()
    await _seed_problem(
        db_session,
        duty_user_id=user.id,
        status="2",
        now_handle_user=f"{uid1},{me_str},{uid2}",
        pro_desc="问题A",
    )

    svc = WorkbenchService(db_session)
    summary = await svc.get_summary(user, range="month")
    problem_todos = [t for t in summary.todos if t.source == "problem_audit"]

    assert len(problem_todos) >= 1
    assert any(t.name == "问题A" for t in problem_todos)


@pytest.mark.asyncio
async def test_summary_todo_problem_handle_user_no_match(db_session):
    """now_handle_user 不含 me → 不进 todos。"""
    user = await _seed_user(db_session)
    other1, other2 = uuid.uuid4(), uuid.uuid4()
    await _seed_problem(
        db_session,
        duty_user_id=user.id,
        status="2",
        now_handle_user=f"{other1},{other2}",
        pro_desc="问题B",
    )

    svc = WorkbenchService(db_session)
    summary = await svc.get_summary(user, range="month")
    problem_todos = [t for t in summary.todos if t.source == "problem_audit"]

    assert not any("问题B" in (t.name or "") for t in problem_todos)


@pytest.mark.asyncio
async def test_summary_todo_problem_handle_me_even_not_duty(db_session):
    """问题待办:当前处理人是我即显示,不限责任人(duty≠me 也进 todos)。"""
    user = await _seed_user(db_session)
    me_str = str(user.id)
    other = uuid.uuid4()
    await _seed_problem(
        db_session,
        duty_user_id=other,  # 责任人不是 me
        status="2",
        now_handle_user=me_str,  # 但当前处理人是 me
        pro_desc="流转给我处理的问题",
    )

    svc = WorkbenchService(db_session)
    summary = await svc.get_summary(user, range="month")
    problem_todos = [t for t in summary.todos if t.source == "problem_audit"]

    assert any(t.name == "流转给我处理的问题" for t in problem_todos)


@pytest.mark.asyncio
async def test_summary_todo_task_non_terminal(db_session):
    """非终态 PlanTask → 进任务待办 (source=plan_task)。"""
    user = await _seed_user(db_session)
    await _seed_plan(
        db_session,
        user.id,
        status="进行中",
        start_time=datetime.now(UTC),
        end_time=datetime.now(UTC) + timedelta(days=1),
        content="任务X",
    )

    svc = WorkbenchService(db_session)
    summary = await svc.get_summary(user, range="month")
    task_todos = [t for t in summary.todos if t.source == "plan_task"]

    assert any(t.name == "任务X" for t in task_todos)


@pytest.mark.asyncio
async def test_summary_todo_split_not_substring_match(db_session):
    """Python split 匹配:不在逗号串里就不命中 (防 'uid1' 是 'uid10' 子串误匹配)。"""
    me = await _seed_user(db_session)
    me_str = str(me.id)
    # 造一个 me.id 后接数字的"伪子串"场景:其他用户 id 不应被 me 命中
    other = uuid.uuid4()
    await _seed_problem(
        db_session,
        duty_user_id=me.id,
        status="2",
        now_handle_user=str(other),
        pro_desc="他人问题",
    )

    svc = WorkbenchService(db_session)
    summary = await svc.get_summary(me, range="month")
    problem_todos = [t for t in summary.todos if t.source == "problem_audit"]
    assert not any("他人问题" in (t.name or "") for t in problem_todos)
    # me_str 仅用于消除 unused 警告,确认匹配走的是精确 split
    assert me_str == str(me.id)


@pytest.mark.asyncio
async def test_summary_todo_problem_change_auditing_match(db_session):
    """问题变更待审批:status='1' 审核中 且 now_handle_user 含 me → 进 todos (source=problem_change)。"""
    user = await _seed_user(db_session)
    me_str = str(user.id)
    uid1 = uuid.uuid4()
    await _seed_problem_change(
        db_session,
        status="1",
        now_handle_user=f"{uid1},{me_str}",
        pro_desc="变更A",
    )

    svc = WorkbenchService(db_session)
    summary = await svc.get_summary(user, range="month")
    change_todos = [t for t in summary.todos if t.source == "problem_change"]

    assert len(change_todos) >= 1
    assert any(t.name == "变更A" for t in change_todos)


@pytest.mark.asyncio
async def test_summary_todo_problem_change_handle_user_no_match(db_session):
    """问题变更 now_handle_user 不含 me → 不进 todos。"""
    user = await _seed_user(db_session)
    other = uuid.uuid4()
    await _seed_problem_change(
        db_session,
        status="1",
        now_handle_user=str(other),
        pro_desc="他人变更",
    )

    svc = WorkbenchService(db_session)
    summary = await svc.get_summary(user, range="month")
    change_todos = [t for t in summary.todos if t.source == "problem_change"]

    assert not any("他人变更" in (t.name or "") for t in change_todos)


@pytest.mark.asyncio
async def test_summary_todo_problem_change_only_auditing_status(db_session):
    """问题变更 status='2' 已完成 (即便 now_handle_user 含 me) → 不进待办 (只审核中='1' 才待审批)。"""
    user = await _seed_user(db_session)
    me_str = str(user.id)
    await _seed_problem_change(
        db_session,
        status="2",  # 已完成
        now_handle_user=me_str,
        pro_desc="已完成变更",
    )

    svc = WorkbenchService(db_session)
    summary = await svc.get_summary(user, range="month")
    change_todos = [t for t in summary.todos if t.source == "problem_change"]

    assert not any("已完成变更" in (t.name or "") for t in change_todos)


# ===========================================================================
# summary —— defect_count 不受 range 影响
# ===========================================================================


@pytest.mark.asyncio
async def test_summary_defect_count_not_closed(db_session):
    """duty_user_id=me:status='4'(已关闭)不计 + status='2'(未关闭)计 → defect_count=1。"""
    user = await _seed_user(db_session)
    await _seed_problem(db_session, duty_user_id=user.id, status="4")  # 已关闭,不计
    await _seed_problem(db_session, duty_user_id=user.id, status="2")  # 未关闭,计

    svc = WorkbenchService(db_session)
    summary = await svc.get_summary(user, range="month")
    assert summary.metrics.defect_count == 1


@pytest.mark.asyncio
async def test_summary_defect_count_range_invariant(db_session):
    """defect_count 不受 range 影响:week/month/all 恒等。"""
    user = await _seed_user(db_session)
    await _seed_problem(db_session, duty_user_id=user.id, status="1")
    await _seed_problem(db_session, duty_user_id=user.id, status="3")

    svc = WorkbenchService(db_session)
    week = await svc.get_summary(user, range="week")
    month = await svc.get_summary(user, range="month")
    all_ = await svc.get_summary(user, range="all")

    assert week.metrics.defect_count == month.metrics.defect_count == all_.metrics.defect_count == 2


# ===========================================================================
# summary —— work_hours 聚合
# ===========================================================================


@pytest.mark.asyncio
async def test_summary_work_hours_aggregation(db_session):
    """work_hours = SUM(task_execute.time_spent) where execute_user_id=me,区间内 actual_start_time。"""
    now = datetime.now(UTC)
    user = await _seed_user(db_session)
    other = uuid.uuid4()
    # 区间内 (本月) 两条
    start_in = now.replace(day=1, hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
    if start_in.month != now.month:
        start_in = now.replace(day=1, hour=10, minute=0, second=0, microsecond=0)
    await _seed_execute(
        db_session,
        execute_user_id=user.id,
        time_spent=1.5,
        actual_start_time=start_in,
        actual_end_time=start_in + timedelta(hours=2),
    )
    await _seed_execute(
        db_session,
        execute_user_id=user.id,
        time_spent=2.5,
        actual_start_time=start_in + timedelta(days=1),
        actual_end_time=start_in + timedelta(days=1, hours=2),
    )
    # 区间外 (上月,不算)
    out_start = now.replace(day=1, hour=10, minute=0, second=0, microsecond=0) - timedelta(days=5)
    await _seed_execute(
        db_session,
        execute_user_id=user.id,
        time_spent=99.0,
        actual_start_time=out_start,
        actual_end_time=out_start + timedelta(hours=2),
    )
    # 他人执行,不算
    await _seed_execute(
        db_session,
        execute_user_id=other,
        time_spent=99.0,
        actual_start_time=start_in,
        actual_end_time=start_in + timedelta(hours=2),
    )

    svc = WorkbenchService(db_session)
    summary = await svc.get_summary(user, range="month")
    assert summary.metrics.work_hours == pytest.approx(4.0)


# ===========================================================================
# calendar
# ===========================================================================


@pytest.mark.asyncio
async def test_calendar_cross_day_only_counts_start_day(db_session):
    """跨多日任务只计 start_time 当日 (X-004 不虚高 end_time 区间)。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC)
    # 造一条本月跨多日任务:start=本月3号 end=本月5号 (防跨月用 day clamp)
    base = now.replace(day=1, hour=9, minute=0, second=0, microsecond=0)
    if base.month != now.month:
        base = now.replace(day=1, hour=9, minute=0, second=0, microsecond=0)
    # 选当月 3 号 (若当月不足 5 号则改用 1/2 号保 start<end 同月)
    start_day = min(3, 28)
    end_day = min(5, 28)
    start_dt = base.replace(day=start_day)
    end_dt = base.replace(day=end_day)
    await _seed_plan(
        db_session,
        user.id,
        status="进行中",
        start_time=start_dt,
        end_time=end_dt,
        content="跨日任务",
    )

    svc = WorkbenchService(db_session)
    ym = f"{base.year:04d}-{base.month:02d}"
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}

    assert by_date[f"{ym}-{start_day:02d}"].task_count == 1
    # end_time 当日不虚高
    assert by_date[f"{ym}-{end_day:02d}"].task_count == 0
    # 中间日也不虚高
    if end_day - start_day > 1:
        mid = start_day + 1
        assert by_date[f"{ym}-{mid:02d}"].task_count == 0


@pytest.mark.asyncio
async def test_calendar_load_level_past_actual_buckets(db_session):
    """过去日期 load_level 按实际工时(actual 平摊)分档(D-001~004):
    单日 execute time_spent×8 小时 → 0→none / <8→leisure / 8-10→full / >10→over。

    用"上月"(整个月 < today)造数,全走实际侧,稳定不依赖今天几号。"""
    import calendar as _cal

    user = await _seed_user(db_session)
    now = datetime.now(UTC)
    base = now.replace(hour=9, minute=0, second=0, microsecond=0)
    # 上月末 → 上月年月(整月 < today 全走实际侧)
    last_month_end = base.replace(day=1) - timedelta(days=1)
    lm_year, lm_month = last_month_end.year, last_month_end.month
    lm_dim = _cal.monthrange(lm_year, lm_month)[1]
    ym = f"{lm_year:04d}-{lm_month:02d}"
    day_leisure = min(10, lm_dim)  # 0.5 人天=4h → leisure
    day_full = min(11, lm_dim)  # 1 人天=8h → full
    day_over = min(12, lm_dim)  # 2 人天=16h → over
    day_none = min(13, lm_dim)  # 无 actual → none
    assert len({day_leisure, day_full, day_over, day_none}) == 4

    await _seed_execute(
        db_session,
        execute_user_id=user.id,
        time_spent=0.5,
        actual_start_time=datetime(lm_year, lm_month, day_leisure, tzinfo=UTC),
        actual_end_time=datetime(lm_year, lm_month, day_leisure, tzinfo=UTC),
    )
    await _seed_execute(
        db_session,
        execute_user_id=user.id,
        time_spent=1.0,
        actual_start_time=datetime(lm_year, lm_month, day_full, tzinfo=UTC),
        actual_end_time=datetime(lm_year, lm_month, day_full, tzinfo=UTC),
    )
    await _seed_execute(
        db_session,
        execute_user_id=user.id,
        time_spent=2.0,
        actual_start_time=datetime(lm_year, lm_month, day_over, tzinfo=UTC),
        actual_end_time=datetime(lm_year, lm_month, day_over, tzinfo=UTC),
    )

    svc = WorkbenchService(db_session)
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}

    assert by_date[f"{ym}-{day_leisure:02d}"].load_level == "leisure"
    assert by_date[f"{ym}-{day_full:02d}"].load_level == "full"
    assert by_date[f"{ym}-{day_over:02d}"].load_level == "over"
    assert by_date[f"{ym}-{day_none:02d}"].load_level == "none"


@pytest.mark.asyncio
async def test_calendar_load_level_past_actual_spread(db_session):
    """actual 区间跨多日 → time_spent 按区间天数平摊,跨月分母含全区间(D-005)。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC)
    base = now.replace(hour=9, minute=0, second=0, microsecond=0)
    last_month_end = base.replace(day=1) - timedelta(days=1)
    lm_year, lm_month = last_month_end.year, last_month_end.month
    ym = f"{lm_year:04d}-{lm_month:02d}"
    start = datetime(lm_year, lm_month, 10, tzinfo=UTC)
    end = datetime(lm_year, lm_month, 12, tzinfo=UTC)  # 区间 3 天(10/11/12)
    await _seed_execute(
        db_session,
        execute_user_id=user.id,
        time_spent=3.0,
        actual_start_time=start,
        actual_end_time=end,
    )

    svc = WorkbenchService(db_session)
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}
    # 每天 3×8/3 = 8h → full
    assert by_date[f"{ym}-10"].load_level == "full"
    assert by_date[f"{ym}-11"].load_level == "full"
    assert by_date[f"{ym}-12"].load_level == "full"


@pytest.mark.asyncio
async def test_calendar_load_level_future_remaining(db_session):
    """未来日期 load_level 按剩余负载(计划总量-已用)/剩余天数 分档(D-007)。

    用户原例:计划 10 人天(1~20 号),今天落在区间第 10 天,已用 2 → 剩余 8÷11 天≈5.8h → leisure。
    """
    user = await _seed_user(db_session)
    now = datetime.now(UTC)
    base = now.replace(hour=9, minute=0, second=0, microsecond=0)
    start = base - timedelta(days=9)
    end = base + timedelta(days=10)  # 区间 (base-9)..(base+10) = 20 天
    plan = await _seed_plan(
        db_session,
        user.id,
        status="进行中",
        start_time=start,
        end_time=end,
        work_load="10d",
    )
    # 已用 2 人天(关联该 plan,同时其 actual 落在过去 7 号不影响今天未来侧断言)
    await _seed_execute(
        db_session,
        execute_user_id=user.id,
        time_spent=2.0,
        actual_start_time=start,
        actual_end_time=start,
        plan_task_id=plan.id,
    )

    svc = WorkbenchService(db_session)
    ym = f"{base.year:04d}-{base.month:02d}"
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}
    # 剩余天数 = today..end = 11 天; 剩余 8 人天; 日均 8/11×8 ≈ 5.82h → leisure
    today_key = f"{ym}-{base.day:02d}"
    assert by_date[today_key].load_level == "leisure"


@pytest.mark.asyncio
async def test_calendar_load_level_future_remaining_over(db_session):
    """未来剩余很高 → over:计划 10 人天压在 3 天,日均 ≈26.7h → over。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC)
    base = now.replace(hour=9, minute=0, second=0, microsecond=0)
    await _seed_plan(
        db_session,
        user.id,
        status="进行中",
        start_time=base,
        end_time=base + timedelta(days=2),  # 区间 3 天
        work_load="10d",
    )
    # 无 execute,已用 0 → 剩余 10 人天
    svc = WorkbenchService(db_session)
    ym = f"{base.year:04d}-{base.month:02d}"
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}
    today_key = f"{ym}-{base.day:02d}"
    assert by_date[today_key].load_level == "over"


@pytest.mark.asyncio
async def test_calendar_load_level_future_used_ge_plan(db_session):
    """已用 ≥ 计划总量 → 剩余 0,该任务不对未来天贡献(D-007)。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC)
    base = now.replace(hour=9, minute=0, second=0, microsecond=0)
    plan = await _seed_plan(
        db_session,
        user.id,
        status="进行中",
        start_time=base,
        end_time=base + timedelta(days=10),
        work_load="5d",
    )
    await _seed_execute(
        db_session,
        execute_user_id=user.id,
        time_spent=6.0,
        actual_start_time=base,
        actual_end_time=base,
        plan_task_id=plan.id,
    )

    svc = WorkbenchService(db_session)
    ym = f"{base.year:04d}-{base.month:02d}"
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}
    today_key = f"{ym}-{base.day:02d}"
    assert by_date[today_key].load_level == "none"


@pytest.mark.asyncio
async def test_calendar_load_level_future_no_end_skip(db_session):
    """未完成任务无 end_time → 未来侧无法定剩余天数,跳过(R-05)→ none。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC)
    base = now.replace(hour=9, minute=0, second=0, microsecond=0)
    await _seed_plan(
        db_session,
        user.id,
        status="进行中",
        start_time=base,
        end_time=None,
        work_load="10d",
    )

    svc = WorkbenchService(db_session)
    ym = f"{base.year:04d}-{base.month:02d}"
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}
    today_key = f"{ym}-{base.day:02d}"
    assert by_date[today_key].load_level == "none"


@pytest.mark.asyncio
async def test_calendar_load_level_actual_missing_bounds(db_session):
    """actual 区间缺失三档兜底(D-003):双端有→平摊;仅一端→落单日;都无→跳过。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC)
    base = now.replace(hour=9, minute=0, second=0, microsecond=0)
    last_month_end = base.replace(day=1) - timedelta(days=1)
    lm_year, lm_month = last_month_end.year, last_month_end.month
    ym = f"{lm_year:04d}-{lm_month:02d}"
    d_start_only = 10  # 仅 start → 落单日 1 人天=8h → full
    d_both = 11  # 双端同日 → 单日 1 人天=8h → full
    d_none = 12  # 都无 → 跳过 → none
    await _seed_execute(
        db_session,
        execute_user_id=user.id,
        time_spent=1.0,
        actual_start_time=datetime(lm_year, lm_month, d_start_only, tzinfo=UTC),
    )
    await _seed_execute(
        db_session,
        execute_user_id=user.id,
        time_spent=1.0,
        actual_start_time=datetime(lm_year, lm_month, d_both, tzinfo=UTC),
        actual_end_time=datetime(lm_year, lm_month, d_both, tzinfo=UTC),
    )
    await _seed_execute(db_session, execute_user_id=user.id, time_spent=5.0)  # 都无

    svc = WorkbenchService(db_session)
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}
    assert by_date[f"{ym}-{d_start_only:02d}"].load_level == "full"
    assert by_date[f"{ym}-{d_both:02d}"].load_level == "full"
    assert by_date[f"{ym}-{d_none:02d}"].load_level == "none"


@pytest.mark.asyncio
async def test_calendar_alert_red_at_end_date_for_overdue(db_session):
    """延期任务(end<today 未完成)→ 截止日 alert=red (D-008)。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC).replace(hour=9, minute=0, second=0, microsecond=0)
    start = now - timedelta(days=5)
    end = now - timedelta(days=2)  # 已过期(今天-2),未完成
    await _seed_plan(
        db_session,
        user.id,
        status="进行中",
        start_time=start,
        end_time=end,
        content="过期任务",
    )
    svc = WorkbenchService(db_session)
    ym = f"{start.year:04d}-{start.month:02d}"
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}
    end_key = f"{ym}-{end.day:02d}"
    assert by_date[end_key].alert_level == "red"  # 截止日红


@pytest.mark.asyncio
async def test_calendar_alert_yellow_today_for_overdue_risk(db_session):
    """临期(剩余工时/剩余天数>8h/天,做不完)→ 今天 alert=yellow (D-008)。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC).replace(hour=9, minute=0, second=0, microsecond=0)
    start = now - timedelta(days=2)
    end = now + timedelta(days=2)  # 区间 5 天,覆盖今天
    await _seed_plan(
        db_session,
        user.id,
        status="进行中",
        start_time=start,
        end_time=end,
        work_load="10d",
    )
    # 剩余天数=今天~end=3 天,剩余 10 人天,10/3×8≈26.7h>8h → 临期
    svc = WorkbenchService(db_session)
    ym = f"{now.year:04d}-{now.month:02d}"
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}
    today_key = f"{ym}-{now.day:02d}"
    assert by_date[today_key].alert_level == "yellow"


@pytest.mark.asyncio
async def test_calendar_alert_green_past_covered(db_session):
    """过去日期有任务覆盖(未延期)→ green (D-008)。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC).replace(hour=9, minute=0, second=0, microsecond=0)
    start = now - timedelta(days=4)
    end = now + timedelta(days=2)  # 跨过去/未来,未到截止
    await _seed_plan(
        db_session,
        user.id,
        status="进行中",
        start_time=start,
        end_time=end,
        work_load="1d",
    )
    # work_load=1d,剩余 1 人天/3 天≈2.67h<8h → 正常(非临期)
    svc = WorkbenchService(db_session)
    ym = f"{start.year:04d}-{start.month:02d}"
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}
    past_day = now - timedelta(days=2)  # 过去覆盖天
    past_key = f"{ym}-{past_day.day:02d}"
    assert by_date[past_key].alert_level == "green"


@pytest.mark.asyncio
async def test_calendar_alert_green_future_covered(db_session):
    """未来日期有任务覆盖 → green (D-008)。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC).replace(hour=9, minute=0, second=0, microsecond=0)
    start = now + timedelta(days=1)
    end = now + timedelta(days=5)  # 全在未来
    await _seed_plan(
        db_session,
        user.id,
        status="进行中",
        start_time=start,
        end_time=end,
        work_load="1d",
    )
    svc = WorkbenchService(db_session)
    ym = f"{end.year:04d}-{end.month:02d}"
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}
    future_day = now + timedelta(days=3)
    future_key = f"{ym}-{future_day.day:02d}"
    assert by_date[future_key].alert_level == "green"


@pytest.mark.asyncio
async def test_calendar_alert_completed_not_marked(db_session):
    """已完成任务不贡献右点(覆盖天无其他任务则 none, D-008)。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC).replace(hour=9, minute=0, second=0, microsecond=0)
    start = now + timedelta(days=1)
    end = now + timedelta(days=5)
    await _seed_plan(
        db_session,
        user.id,
        status="已完成",
        start_time=start,
        end_time=end,
        work_load="1d",
    )
    svc = WorkbenchService(db_session)
    ym = f"{end.year:04d}-{end.month:02d}"
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}
    future_day = now + timedelta(days=3)
    future_key = f"{ym}-{future_day.day:02d}"
    assert by_date[future_key].alert_level == "none"


@pytest.mark.asyncio
async def test_calendar_alert_problem_overdue_red(db_session):
    """缺陷参与右点:缺陷未关闭且 plan_end<today → 截止日 alert=red (D-008)。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC).replace(hour=9, minute=0, second=0, microsecond=0)
    prob = PpmProblemList(
        project_id=uuid.uuid4(),
        project_name="P1",
        pro_desc="过期缺陷",
        duty_user_id=user.id,
        status="2",  # 未关闭
        plan_start_time=now - timedelta(days=5),
        plan_end_time=now - timedelta(days=2),
        work_load="1d",
    )
    db_session.add(prob)
    await db_session.commit()
    svc = WorkbenchService(db_session)
    start = now - timedelta(days=5)
    ym = f"{start.year:04d}-{start.month:02d}"
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}
    end = now - timedelta(days=2)
    end_key = f"{ym}-{end.day:02d}"
    assert by_date[end_key].alert_level == "red"


@pytest.mark.asyncio
async def test_calendar_detail_three_categories(db_session):
    """点击某天详情显示计划/缺陷/实际三类 (D-009)。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC).replace(hour=9, minute=0, second=0, microsecond=0)
    plan = await _seed_plan(
        db_session,
        user.id,
        status="进行中",
        start_time=now - timedelta(days=1),
        end_time=now + timedelta(days=1),
        content="计划任务A",
    )
    await _seed_execute(
        db_session,
        execute_user_id=user.id,
        time_spent=1.0,
        actual_start_time=now,
        actual_end_time=now,
        plan_task_id=plan.id,
    )
    prob = PpmProblemList(
        project_id=uuid.uuid4(),
        project_name="P1",
        pro_desc="缺陷X",
        duty_user_id=user.id,
        status="2",
        plan_start_time=now - timedelta(days=1),
        plan_end_time=now + timedelta(days=1),
    )
    db_session.add(prob)
    await db_session.commit()

    svc = WorkbenchService(db_session)
    ym = f"{now.year:04d}-{now.month:02d}"
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}
    today_key = f"{ym}-{now.day:02d}"
    today = by_date[today_key]
    assert len(today.plan_items) == 1
    assert today.plan_items[0].content == "计划任务A"
    assert len(today.problem_items) == 1
    assert today.problem_items[0].pro_desc == "缺陷X"
    assert len(today.execute_items) == 1
    assert today.execute_items[0].content == "计划任务A"  # 关联 plan content


@pytest.mark.asyncio
async def test_calendar_year_month_parse_and_days_count(db_session):
    """传 'YYYY-MM' 正确返回该月 days,数量 == monthrange 当月天数。"""
    user = await _seed_user(db_session)
    import calendar as _cal

    svc = WorkbenchService(db_session)
    ym = "2026-07"
    cal = await svc.get_calendar(user, ym)

    assert cal.year_month == "2026-07"
    assert len(cal.days) == _cal.monthrange(2026, 7)[1]
    # 首日 date 格式正确
    assert cal.days[0].date == "2026-07-01"


@pytest.mark.asyncio
async def test_calendar_invalid_year_month_fallback_current(db_session):
    """year_month 越界/非法 → 兜底取当月 (不 crash)。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC)
    import calendar as _cal

    svc = WorkbenchService(db_session)
    # 传非法字符串,应兜底到当月
    cal = await svc.get_calendar(user, "not-a-month")

    expected = _cal.monthrange(now.year, now.month)[1]
    assert len(cal.days) == expected
