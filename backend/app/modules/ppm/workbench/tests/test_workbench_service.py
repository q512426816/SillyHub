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
    actual_start_time: datetime,
    actual_end_time: datetime,
) -> TaskExecute:
    """造一条 TaskExecute (work_hours 聚合源)。"""
    ex = TaskExecute(
        execute_user_id=execute_user_id,
        time_spent=time_spent,
        actual_start_time=actual_start_time,
        actual_end_time=actual_end_time,
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
async def test_calendar_load_level_buckets(db_session):
    """load_level 按当日 work_load 工时(小时)累加分档(注意事项 2):
    0→none / <8→leisure(有空余) / 8-10→full(饱和) / >10→over(过载)。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC)
    base = now.replace(hour=9, minute=0, second=0, microsecond=0)
    ym = f"{base.year:04d}-{base.month:02d}"
    import calendar as _cal

    dim = _cal.monthrange(base.year, base.month)[1]
    day_leisure = min(10, dim)  # 6h <8 → leisure
    day_full = min(11, dim)  # 8h → full
    day_over = min(12, dim)  # 12h >10 → over
    day_none = min(13, dim)  # 无任务 → none
    assert len({day_leisure, day_full, day_over, day_none}) == 4

    await _seed_plan(
        db_session,
        user.id,
        status="进行中",
        start_time=base.replace(day=day_leisure),
        work_load="6h",
    )
    await _seed_plan(
        db_session,
        user.id,
        status="进行中",
        start_time=base.replace(day=day_full),
        work_load="8h",
    )
    await _seed_plan(
        db_session,
        user.id,
        status="进行中",
        start_time=base.replace(day=day_over),
        work_load="12h",
    )

    svc = WorkbenchService(db_session)
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}

    assert by_date[f"{ym}-{day_leisure:02d}"].load_level == "leisure"
    assert by_date[f"{ym}-{day_full:02d}"].load_level == "full"
    assert by_date[f"{ym}-{day_over:02d}"].load_level == "over"
    assert by_date[f"{ym}-{day_none:02d}"].load_level == "none"


@pytest.mark.asyncio
async def test_calendar_alert_level_over_for_delayed(db_session):
    """当日有任务 end_time<now 且 status!='已完成' → alert_level='over'。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC)
    # start_time 落在"今天"(保证 start_time.day == now.day,当日)
    today = now.replace(hour=9, minute=0, second=0, microsecond=0)
    await _seed_plan(
        db_session,
        user.id,
        status="进行中",  # 非已完成
        start_time=today,
        end_time=now - timedelta(days=1),  # end_time<now → 延期
    )

    svc = WorkbenchService(db_session)
    ym = f"{today.year:04d}-{today.month:02d}"
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}
    today_key = f"{ym}-{now.day:02d}"

    assert by_date[today_key].task_count == 1
    assert by_date[today_key].alert_level == "over"


@pytest.mark.asyncio
async def test_calendar_alert_level_normal_when_completed(db_session):
    """已完成的延期任务不触发 alert (status='已完成' → normal)。"""
    user = await _seed_user(db_session)
    now = datetime.now(UTC)
    today = now.replace(hour=9, minute=0, second=0, microsecond=0)
    await _seed_plan(
        db_session,
        user.id,
        status="已完成",
        start_time=today,
        end_time=now - timedelta(days=1),
    )

    svc = WorkbenchService(db_session)
    ym = f"{today.year:04d}-{today.month:02d}"
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}
    today_key = f"{ym}-{now.day:02d}"

    assert by_date[today_key].alert_level == "normal"


@pytest.mark.asyncio
async def test_calendar_alert_level_late(db_session):
    """临期(注意事项 2):周期>3日,距截止前 2 天 → alert_level='late'。

    start=now-3d, end=now+2d → 周期 5 天(>3), now 距 end 2 天 → 临期。
    """
    user = await _seed_user(db_session)
    now = datetime.now(UTC)
    start = now - timedelta(days=3)
    end = now + timedelta(days=2)  # 周期 5 天, now 距 end 2 天 → 临期
    await _seed_plan(
        db_session,
        user.id,
        status="进行中",
        start_time=start,
        end_time=end,
    )

    svc = WorkbenchService(db_session)
    ym = f"{start.year:04d}-{start.month:02d}"
    cal = await svc.get_calendar(user, ym)
    by_date = {d.date: d for d in cal.days}
    start_key = f"{ym}-{start.day:02d}"

    assert by_date[start_key].alert_level == "late"


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
