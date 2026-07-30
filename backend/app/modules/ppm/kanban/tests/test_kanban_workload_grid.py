"""kanban 工时热力网格聚合测试 (2026-07-30-kanban-workload-heatmap, task-04)。

覆盖 tasks/task-04.md 验收项:
- plan 剩余负载摊天仅落到今天及以后 (FR-03, 过去为 0)
- actual time_spent 覆盖日求和含今天, 跨天记录覆盖日全计入 (FR-04)
- project 过滤 join PlanTask, problem 执行 (无 plan_task_id) 被排除 (R-08)
- 记录选取按 actual_start 落点, 跨边界在途记录被排除 (R-01)
- 空数据 / dateRange 上限 (R-03) / HTTP 端点
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest

from app.modules.ppm.kanban.service import DateRangeTooLarge, PpdKanbanService
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.ppm.task.model import PlanTask, TaskExecute

# ---------------------------------------------------------------------------
# seed helpers (对齐 test_kanban.py 模式;日期用测试内当前时间,非模块级常量)
# ---------------------------------------------------------------------------


def _dt(d: date) -> datetime:
    """date → naive datetime (与现有 _parse_date_range 一致,SQLite 存 naive)。"""
    return datetime(d.year, d.month, d.day)


async def _seed_project(db_session, name: str = "P1") -> uuid.UUID:
    proj = PpmProjectMaintenance(project_code=f"CODE-{name}", project_name=name)
    db_session.add(proj)
    await db_session.commit()
    await db_session.refresh(proj)
    return proj.id


async def _seed_member(db_session, project_id, user_id, user_name: str) -> uuid.UUID:
    m = PpmProjectMember(
        pm_project_id=project_id, user_id=user_id, user_name=user_name, role_name="开发"
    )
    db_session.add(m)
    await db_session.commit()
    await db_session.refresh(m)
    return m.id


async def _seed_plan(
    db_session,
    user_id,
    work_load: str,
    start_d: date,
    end_d: date,
    status: str = "进行中",
    project_id=None,
) -> uuid.UUID:
    t = PlanTask(
        user_id=user_id,
        user_name="张三",
        status=status,
        content="任务",
        work_load=work_load,
        kanban_order=0,
        project_id=project_id,
        start_time=_dt(start_d),
        end_time=_dt(end_d),
    )
    db_session.add(t)
    await db_session.commit()
    await db_session.refresh(t)
    return t.id


async def _seed_execute(
    db_session,
    user_id,
    time_spent: float,
    start_d: date,
    end_d: date,
    plan_task_id=None,
    problem_task_id=None,
) -> uuid.UUID:
    ex = TaskExecute(
        plan_task_id=plan_task_id,
        problem_task_id=problem_task_id,
        execute_user_id=user_id,
        time_spent=time_spent,
        actual_start_time=_dt(start_d),
        actual_end_time=_dt(end_d),
        status="20",
    )
    db_session.add(ex)
    await db_session.commit()
    await db_session.refresh(ex)
    return ex.id


def _row(resp, user_id):
    return next(u for u in resp.users if u.user_id == user_id)


# ---------------------------------------------------------------------------
# plan 剩余负载摊天 (FR-03)
# ---------------------------------------------------------------------------


async def test_plan_spreads_remaining_to_today_and_future(db_session):
    """2 人天任务 start=昨天 end=明天,无 execute → 摊到 今天/明天 各 1,昨天(过去)无 plan。

    work_load 纯数字按**人天**解析 (_parse_hours: 纯数字/带 d/天 → 人天原值)。
    """
    today = datetime.now(UTC).date()
    yesterday = today - timedelta(days=1)
    tomorrow = today + timedelta(days=1)
    day_after = today + timedelta(days=2)
    proj = await _seed_project(db_session)
    user_a = uuid.uuid4()
    await _seed_member(db_session, proj, user_a, "张三")
    await _seed_plan(db_session, user_a, "2", yesterday, tomorrow, project_id=proj)

    svc = PpdKanbanService(db_session)
    resp = await svc.get_workload_grid(None, None, yesterday.isoformat(), day_after.isoformat())
    row = _row(resp, user_a)
    assert row.plan_hours.get(today.isoformat()) == 1.0
    assert row.plan_hours.get(tomorrow.isoformat()) == 1.0
    assert yesterday.isoformat() not in row.plan_hours  # 过去无 plan


async def test_plan_subtracts_spent_and_skips_completed(db_session):
    """已用工时从计划扣除;已完成任务不摊。"""
    today = datetime.now(UTC).date()
    tomorrow = today + timedelta(days=1)
    proj = await _seed_project(db_session)
    user_a = uuid.uuid4()
    await _seed_member(db_session, proj, user_a, "张三")
    # 2 人天,已用 1 → 剩 1,lower=today,span=1(仅 today,end=today)
    plan_id = await _seed_plan(db_session, user_a, "2", today, today, project_id=proj)
    await _seed_execute(db_session, user_a, 1.0, today, today, plan_task_id=plan_id)
    # 已完成任务不摊
    await _seed_plan(db_session, user_a, "1", today, tomorrow, status="已完成", project_id=proj)

    svc = PpdKanbanService(db_session)
    resp = await svc.get_workload_grid(None, None, today.isoformat(), tomorrow.isoformat())
    row = _row(resp, user_a)
    assert row.plan_hours.get(today.isoformat()) == 1.0  # 2 - 1 = 1
    assert tomorrow.isoformat() not in row.plan_hours  # 已完成任务不贡献


# ---------------------------------------------------------------------------
# actual 覆盖日求和 (FR-04)
# ---------------------------------------------------------------------------


async def test_actual_covers_each_day_inclusive_today(db_session):
    """time_spent=2 覆盖 昨天~今天 → 每天各计 2 (跨天全计入),明天无记录。"""
    today = datetime.now(UTC).date()
    yesterday = today - timedelta(days=1)
    tomorrow = today + timedelta(days=1)
    proj = await _seed_project(db_session)
    user_a = uuid.uuid4()
    await _seed_member(db_session, proj, user_a, "张三")
    await _seed_execute(db_session, user_a, 2.0, yesterday, today)

    svc = PpdKanbanService(db_session)
    resp = await svc.get_workload_grid(None, None, yesterday.isoformat(), tomorrow.isoformat())
    row = _row(resp, user_a)
    assert row.actual_hours.get(yesterday.isoformat()) == 2.0
    assert row.actual_hours.get(today.isoformat()) == 2.0
    assert tomorrow.isoformat() not in row.actual_hours


async def test_project_filter_excludes_problem_executes(db_session):
    """无过滤计入 plan+problem;project 过滤 join PlanTask,problem 被排除 (R-08)。"""
    today = datetime.now(UTC).date()
    proj_a = await _seed_project(db_session, "PA")
    await _seed_project(db_session, "PB")
    user_a = uuid.uuid4()
    await _seed_member(db_session, proj_a, user_a, "张三")
    plan_a = await _seed_plan(db_session, user_a, "8", today, today, project_id=proj_a)
    await _seed_execute(db_session, user_a, 1.0, today, today, plan_task_id=plan_a)
    await _seed_execute(db_session, user_a, 5.0, today, today, problem_task_id=uuid.uuid4())

    svc = PpdKanbanService(db_session)
    resp_all = await svc.get_workload_grid(None, None, today.isoformat(), today.isoformat())
    assert _row(resp_all, user_a).actual_hours.get(today.isoformat()) == 6.0  # 1+5

    resp_pa = await svc.get_workload_grid(None, proj_a, today.isoformat(), today.isoformat())
    assert _row(resp_pa, user_a).actual_hours.get(today.isoformat()) == 1.0  # problem 排除


async def test_actual_excludes_execute_starting_before_range(db_session):
    """actual_start 在范围前的在途记录被排除 (记录选取按 actual_start 落点,R-01)。"""
    today = datetime.now(UTC).date()
    yesterday = today - timedelta(days=1)
    day_before = today - timedelta(days=2)
    proj = await _seed_project(db_session)
    user_a = uuid.uuid4()
    await _seed_member(db_session, proj, user_a, "张三")
    await _seed_execute(db_session, user_a, 3.0, day_before, today)

    svc = PpdKanbanService(db_session)
    resp = await svc.get_workload_grid(None, None, yesterday.isoformat(), today.isoformat())
    assert _row(resp, user_a).actual_hours == {}


# ---------------------------------------------------------------------------
# 边界: 空数据 / 范围上限 / 人员口径
# ---------------------------------------------------------------------------


async def test_empty_when_no_tasks(db_session):
    today = datetime.now(UTC).date()
    proj = await _seed_project(db_session)
    user_a = uuid.uuid4()
    await _seed_member(db_session, proj, user_a, "张三")
    svc = PpdKanbanService(db_session)
    resp = await svc.get_workload_grid(None, None, today.isoformat(), today.isoformat())
    row = _row(resp, user_a)
    assert row.plan_hours == {}
    assert row.actual_hours == {}


async def test_date_range_too_large(db_session):
    today = datetime.now(UTC).date()
    far = today + timedelta(days=100)
    svc = PpdKanbanService(db_session)
    with pytest.raises(DateRangeTooLarge):
        await svc.get_workload_grid(None, None, today.isoformat(), far.isoformat())


async def test_users_match_visible_members(db_session):
    """人员集合与甘特一致 (_query_visible_members,按 user_id 去重)。"""
    today = datetime.now(UTC).date()
    proj = await _seed_project(db_session)
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()
    await _seed_member(db_session, proj, user_a, "张三")
    await _seed_member(db_session, proj, user_b, "李四")
    svc = PpdKanbanService(db_session)
    resp = await svc.get_workload_grid(None, None, today.isoformat(), today.isoformat())
    assert {u.user_id for u in resp.users} == {user_a, user_b}
    assert resp.days == [today.isoformat()]


# ---------------------------------------------------------------------------
# HTTP 端点 (kanban_client)
# ---------------------------------------------------------------------------


async def test_workload_grid_endpoint(kanban_client, db_session):
    today = datetime.now(UTC).date()
    proj = await _seed_project(db_session)
    user_a = uuid.uuid4()
    await _seed_member(db_session, proj, user_a, "张三")
    await _seed_plan(db_session, user_a, "8", today, today, project_id=proj)

    resp = await kanban_client.get(
        "/api/ppm/kanban/workload-grid",
        params={"start_date": today.isoformat(), "end_date": today.isoformat()},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["start_date"] == today.isoformat()
    assert data["days"] == [today.isoformat()]
    assert any(u["user_id"] == str(user_a) for u in data["users"])
