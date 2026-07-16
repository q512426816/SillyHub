"""ppm task 子域测试。

覆盖:
- PlanTask / TaskExecute / WorkHour CRUD
- ``execute_plan`` 联动生成 TaskExecute + 状态机 (10→30→90)
- ``stat_by_user`` / ``stat_by_project`` 聚合 SQL
- personal-task-plan 仅返回当前登录用户
- 端点鉴权 (require_permission_any)
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.modules.ppm.task.schema import (
    ExecutePlanReq,
    PlanTaskCreate,
    PlanTaskPageReq,
    PlanTaskUpdate,
    TaskExecuteCreate,
    WorkHourCreate,
    WorkHourPageReq,
    WorkHourUpdate,
)
from app.modules.ppm.task.service import (
    STATUS_DOING,
    STATUS_END,
    STATUS_NOT_SUBMIT,
    PlanTaskNotFound,
    PlanTaskService,
    TaskExecuteService,
    WorkHourNotFound,
    WorkHourService,
)

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


async def _seed_plan(db_session, user_id: uuid.UUID, status: str = "未开始") -> uuid.UUID:
    svc = PlanTaskService(db_session)
    plan = await svc.create(
        PlanTaskCreate(
            user_id=user_id,
            user_name="张三",
            status=status,
            project_id=uuid.uuid4(),
            project_name="P1",
            content="写单测",
            work_load="1",
            start_time=datetime(2026, 6, 20, 9, tzinfo=UTC),
            end_time=datetime(2026, 6, 20, 18, tzinfo=UTC),
            month="2026-06",
            year="2026",
        )
    )
    return plan.id


async def _seed_work_hour(
    db_session,
    user_id: uuid.UUID,
    project_id: uuid.UUID,
    hours: float,
    day_offset: int = 0,
    wh_type: int = 1,
) -> uuid.UUID:
    svc = WorkHourService(db_session)
    wh = await svc.create(
        WorkHourCreate(
            project_id=project_id,
            user_id=user_id,
            work_date=(datetime(2026, 6, 1, tzinfo=UTC).date() + timedelta(days=day_offset)),
            hours=hours,
            type=wh_type,
            description="d",
        )
    )
    return wh.id


async def _seed_task_execute(
    db_session,
    user_id: uuid.UUID,
    *,
    time_spent: float,
    project_id: uuid.UUID | None = None,
    day_offset: int = 0,
) -> uuid.UUID:
    """构造一条 TaskExecute + 关联 PlanTask (可选 project_id) 供 stat 测试用。"""
    plan_svc = PlanTaskService(db_session)
    plan = await plan_svc.create(
        PlanTaskCreate(
            user_id=user_id,
            user_name="张三",
            status="进行中",
            project_id=project_id or uuid.uuid4(),
            project_name="P1",
            content="写单测",
            work_load="1",
            start_time=datetime(2026, 6, 20, 9, tzinfo=UTC),
            end_time=datetime(2026, 6, 20, 18, tzinfo=UTC),
            month="2026-06",
            year="2026",
        )
    )
    exc_svc = TaskExecuteService(db_session)
    base = datetime(2026, 6, 1, tzinfo=UTC) + timedelta(days=day_offset)
    exc = await exc_svc.create(
        TaskExecuteCreate(
            plan_task_id=plan.id,
            execute_user_id=user_id,
            time_spent=time_spent,
            actual_start_time=base,
            actual_end_time=base + timedelta(hours=8),
            status="30",
        )
    )
    return exc.id


# ---------------------------------------------------------------------------
# PlanTask CRUD
# ---------------------------------------------------------------------------


async def test_plan_task_crud_lifecycle(db_session):
    user_id = uuid.uuid4()
    plan_id = await _seed_plan(db_session, user_id)
    svc = PlanTaskService(db_session)

    # get
    plan = await svc.get(plan_id)
    assert plan.user_name == "张三"
    assert plan.status == "未开始"
    assert plan.file_urls == []

    # update
    plan = await svc.update(plan_id, PlanTaskUpdate(content="写集成测试", status="进行中"))
    assert plan.content == "写集成测试"
    assert plan.status == "进行中"

    # page filter by user
    page = await svc.page(PlanTaskPageReq(user_id=user_id))
    assert page.total == 1
    assert page.items[0].id == plan_id

    # delete
    await svc.delete(plan_id)
    with pytest.raises(PlanTaskNotFound):
        await svc.get(plan_id)


async def test_plan_task_page_filter_by_project_and_status(db_session):
    user_id = uuid.uuid4()
    pid_a = uuid.uuid4()
    pid_b = uuid.uuid4()
    svc = PlanTaskService(db_session)
    await svc.create(
        PlanTaskCreate(user_id=user_id, project_id=pid_a, status="未开始", content="a")
    )
    await svc.create(
        PlanTaskCreate(user_id=user_id, project_id=pid_a, status="进行中", content="b")
    )
    await svc.create(
        PlanTaskCreate(user_id=user_id, project_id=pid_b, status="未开始", content="c")
    )

    by_project = await svc.page(PlanTaskPageReq(project_id=pid_a))
    assert by_project.total == 2
    by_status = await svc.page(PlanTaskPageReq(project_id=pid_a, status=["进行中"]))
    assert by_status.total == 1
    assert by_status.items[0].content == "b"


async def test_plan_task_page_filter_by_module(db_session):
    """page 支持 module_id 过滤(工作台"我的任务"模块筛选)。"""
    user_id = uuid.uuid4()
    mod_a = uuid.uuid4()
    mod_b = uuid.uuid4()
    svc = PlanTaskService(db_session)
    await svc.create(PlanTaskCreate(user_id=user_id, module_id=mod_a, content="a1"))
    await svc.create(PlanTaskCreate(user_id=user_id, module_id=mod_a, content="a2"))
    await svc.create(PlanTaskCreate(user_id=user_id, module_id=mod_b, content="b1"))

    page = await svc.page(PlanTaskPageReq(user_id=user_id, module_id=mod_a))
    assert page.total == 2
    assert all(t.module_id == mod_a for t in page.items)


async def test_plan_task_page_enrich_module_name(db_session):
    """page 补 module_name:表里 module_name 空(历史从未填)但 module_id 有值时,
    按 module_id 反查 ppm_plan_node_module 内存补值;补值不入库(仅展示)。"""
    from sqlalchemy import select as sa_select

    from app.modules.ppm.plan.model import PlanNodeModule
    from app.modules.ppm.task.model import PlanTask as PlanTaskModel

    user_id = uuid.uuid4()
    mod_id = uuid.uuid4()
    db_session.add(PlanNodeModule(id=mod_id, module_name="需求分析"))
    await db_session.commit()

    svc = PlanTaskService(db_session)
    await svc.create(PlanTaskCreate(user_id=user_id, module_id=mod_id, content="t1"))
    await svc.create(PlanTaskCreate(user_id=user_id, content="t2"))

    page = await svc.page(PlanTaskPageReq(user_id=user_id))
    t1 = next(t for t in page.items if t.content == "t1")
    t2 = next(t for t in page.items if t.content == "t2")
    assert t1.module_name == "需求分析"  # 按 module_id 反查补出
    assert t2.module_name is None  # 无 module_id 不补

    # 内存补值未写库:直接读 DB 列仍全为 None
    db_names = (
        (
            await db_session.execute(
                sa_select(PlanTaskModel.module_name).where(PlanTaskModel.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    assert all(v is None for v in db_names)


# ---------------------------------------------------------------------------
# execute_plan 联动 + 状态机
# ---------------------------------------------------------------------------


async def test_execute_plan_creates_execute_and_advances_status(db_session):
    user_id = uuid.uuid4()
    plan_id = await _seed_plan(db_session, user_id)
    plan_svc = PlanTaskService(db_session)

    # 第一次执行(非提交):创建 TaskExecute,状态 10 → 30 处置中
    exc = await plan_svc.execute_plan(
        ExecutePlanReq(
            plan_task_id=plan_id,
            execute_info="开始执行",
            execute_user_id=user_id,
            actual_start_time=datetime(2026, 6, 20, 10, tzinfo=UTC),
        ),
        current_user_id=user_id,
    )
    assert exc.status == STATUS_DOING
    assert exc.plan_task_id == plan_id
    assert exc.execute_info == "开始执行"
    # 计划状态推进为进行中
    plan = await plan_svc.get(plan_id)
    assert plan.status == "进行中"
    assert plan.actual_start_time is not None

    # 第二次执行(submit=True):状态 30 → 90 已完成
    exc2 = await plan_svc.execute_plan(
        ExecutePlanReq(
            plan_task_id=plan_id,
            task_execute_id=exc.id,
            submit=True,
            actual_end_time=datetime(2026, 6, 20, 17, tzinfo=UTC),
            end_remark="完成",
        ),
        current_user_id=user_id,
    )
    assert exc2.status == STATUS_END
    plan = await plan_svc.get(plan_id)
    assert plan.status == "已完成"
    assert plan.actual_end_time is not None

    # 终态后再执行应抛 IllegalStatusTransition
    from app.modules.ppm.task.service import IllegalStatusTransition

    with pytest.raises(IllegalStatusTransition):
        await plan_svc.execute_plan(
            ExecutePlanReq(plan_task_id=plan_id, task_execute_id=exc.id, submit=True),
            current_user_id=user_id,
        )


async def test_execute_plan_delete_cascades_execute(db_session):
    user_id = uuid.uuid4()
    plan_id = await _seed_plan(db_session, user_id)
    plan_svc = PlanTaskService(db_session)
    exc = await plan_svc.execute_plan(
        ExecutePlanReq(plan_task_id=plan_id, execute_user_id=user_id),
        current_user_id=user_id,
    )
    await plan_svc.delete(plan_id)
    # 关联执行记录应被级联删除
    from sqlalchemy import select as sa_select

    from app.modules.ppm.task.model import TaskExecute

    result = await db_session.execute(
        sa_select(TaskExecute).where(TaskExecute.plan_task_id == plan_id)
    )
    assert result.scalars().first() is None
    assert exc.id  # 仅确认返回了对象


# ---------------------------------------------------------------------------
# TaskExecute CRUD
# ---------------------------------------------------------------------------


async def test_task_execute_crud(db_session):
    svc = TaskExecuteService(db_session)
    exc = await svc.create(TaskExecuteCreate(status=STATUS_NOT_SUBMIT, execute_info="init"))
    assert exc.status == STATUS_NOT_SUBMIT

    fetched = await svc.get(exc.id)
    assert fetched.id == exc.id

    # 非法 status
    from app.modules.ppm.task.service import TaskError

    with pytest.raises(TaskError):
        await svc.create(TaskExecuteCreate(status="999"))

    await svc.delete(exc.id)
    from app.modules.ppm.task.service import TaskExecuteNotFound

    with pytest.raises(TaskExecuteNotFound):
        await svc.get(exc.id)


# ---------------------------------------------------------------------------
# WorkHour CRUD + 统计
# ---------------------------------------------------------------------------


async def test_work_hour_crud(db_session):
    user_id = uuid.uuid4()
    project_id = uuid.uuid4()
    wh_id = await _seed_work_hour(db_session, user_id, project_id, hours=8.0)
    svc = WorkHourService(db_session)

    wh = await svc.get(wh_id)
    assert wh.hours == 8.0

    updated = await svc.update(wh_id, WorkHourUpdate(hours=6.5, description="half day"))
    assert updated.hours == 6.5

    await svc.delete(wh_id)
    with pytest.raises(WorkHourNotFound):
        await svc.get(wh_id)


async def test_work_hour_stat_by_user_aggregation(db_session):
    """stat_by_user 数据源为 ppm_task_execute.time_spent (work_hour 表为空)。"""
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()
    await _seed_task_execute(db_session, user_a, time_spent=8.0, day_offset=0)
    await _seed_task_execute(db_session, user_a, time_spent=4.0, day_offset=1)
    await _seed_task_execute(db_session, user_b, time_spent=6.0, day_offset=0)

    svc = WorkHourService(db_session)
    rows = await svc.stat_by_user(start=None, end=None)
    by_key = {r["key"]: r for r in rows}
    assert by_key[user_a]["total_hours"] == pytest.approx(12.0)
    assert by_key[user_a]["count"] == 2
    assert by_key[user_b]["total_hours"] == pytest.approx(6.0)

    # 过滤单个用户
    rows = await svc.stat_by_user(start=None, end=None, user_id=user_a)
    assert len(rows) == 1
    assert rows[0]["total_hours"] == pytest.approx(12.0)


async def test_work_hour_stat_by_project_aggregation(db_session):
    """stat_by_project JOIN ppm_plan_task,按 project_id 聚合 time_spent。"""
    user_id = uuid.uuid4()
    proj_a = uuid.uuid4()
    proj_b = uuid.uuid4()
    await _seed_task_execute(db_session, user_id, project_id=proj_a, time_spent=5.0)
    await _seed_task_execute(db_session, user_id, project_id=proj_a, time_spent=3.0)
    await _seed_task_execute(db_session, user_id, project_id=proj_b, time_spent=2.0)

    svc = WorkHourService(db_session)
    rows = await svc.stat_by_project(start=None, end=None)
    by_key = {r["key"]: r for r in rows}
    assert by_key[proj_a]["total_hours"] == pytest.approx(8.0)
    assert by_key[proj_b]["total_hours"] == pytest.approx(2.0)
    # 按 total_hours desc 排序
    assert rows[0]["total_hours"] >= rows[1]["total_hours"]


async def test_work_hour_page_date_range_filter(db_session):
    user_id = uuid.uuid4()
    project_id = uuid.uuid4()
    await _seed_work_hour(db_session, user_id, project_id, 8.0, day_offset=0)
    await _seed_work_hour(db_session, user_id, project_id, 8.0, day_offset=10)

    svc = WorkHourService(db_session)
    from datetime import date

    page = await svc.page(
        WorkHourPageReq(
            user_id=user_id,
            work_date_start=date(2026, 6, 1),
            work_date_end=date(2026, 6, 5),
        )
    )
    assert page.total == 1  # 只有 day_offset=0 落在区间内


# ---------------------------------------------------------------------------
# personal-task-plan 过滤 (service 层)
# ---------------------------------------------------------------------------


async def test_personal_filter_by_user(db_session):
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()
    await _seed_plan(db_session, user_a)
    await _seed_plan(db_session, user_a)
    await _seed_plan(db_session, user_b)

    svc = PlanTaskService(db_session)
    page_a = await svc.page(PlanTaskPageReq(user_id=user_a))
    page_b = await svc.page(PlanTaskPageReq(user_id=user_b))
    assert page_a.total == 2
    assert page_b.total == 1
    for item in page_a.items:
        assert item.user_id == user_a


async def test_page_invalid_uuid_query_tolerated(db_session):
    """前端传占位符/非法值 (如 "-"、空串、"not-a-uuid") 时 service 层 try-parse
    为 None → 不过滤,返回全量 (不抛异常 / 不 422)。"""
    user_id = uuid.uuid4()
    await _seed_plan(db_session, user_id)
    await _seed_plan(db_session, user_id)
    svc = PlanTaskService(db_session)

    for invalid in ("-", "", "not-a-uuid", None):
        page = await svc.page(PlanTaskPageReq(user_id=invalid))
        assert page.total == 2, f"user_id={invalid!r} 应视为不过滤"


async def test_personal_list_by_date_range(db_session):
    user_id = uuid.uuid4()
    svc = PlanTaskService(db_session)
    await svc.create(
        PlanTaskCreate(
            user_id=user_id,
            start_time=datetime(2026, 6, 20, 9, tzinfo=UTC),
            end_time=datetime(2026, 6, 20, 18, tzinfo=UTC),
        )
    )
    await svc.create(
        PlanTaskCreate(
            user_id=user_id,
            start_time=datetime(2026, 7, 1, 9, tzinfo=UTC),
            end_time=datetime(2026, 7, 1, 18, tzinfo=UTC),
        )
    )
    items = await svc.list_by_user_and_date_range(
        user_id,
        datetime(2026, 6, 1, tzinfo=UTC),
        datetime(2026, 6, 30, tzinfo=UTC),
    )
    assert len(items) == 1
    assert items[0].start_time.month == 6


# ---------------------------------------------------------------------------
# HTTP 层:鉴权 + 端点
# ---------------------------------------------------------------------------


async def test_endpoints_require_auth(client):
    """无 token 应 401。"""
    resp = await client.get("/api/ppm/task-plan/page")
    assert resp.status_code == 401


async def test_plan_task_http_crud(client, auth_headers):
    user_id = str(uuid.uuid4())
    # create
    resp = await client.post(
        "/api/ppm/task-plan/create",
        json={"user_id": user_id, "user_name": "张三", "content": "HTTP CRUD"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    plan_id = resp.json()["id"]

    # get
    resp = await client.get(
        "/api/ppm/task-plan/get", params={"plan_id": plan_id}, headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["content"] == "HTTP CRUD"

    # page
    resp = await client.get(
        "/api/ppm/task-plan/page", params={"user_id": user_id}, headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["total"] >= 1

    # delete
    resp = await client.delete(
        "/api/ppm/task-plan/delete", params={"plan_id": plan_id}, headers=auth_headers
    )
    assert resp.status_code == 204


async def test_work_hour_stat_endpoints(client, auth_headers):
    """stat 端点数据源为 task_execute.time_spent (work_hour 表空)。"""
    user_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    # 建计划 + execute_plan 写入两条 time_spent
    for hours in (4.0, 6.0):
        resp = await client.post(
            "/api/ppm/task-plan/create",
            json={
                "user_id": user_id,
                "project_id": project_id,
                "content": "执行",
                "start_time": "2026-06-01T09:00:00Z",
                "end_time": "2026-06-01T18:00:00Z",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        plan_id = resp.json()["id"]
        resp = await client.put(
            "/api/ppm/task-plan/execute",
            json={
                "plan_task_id": plan_id,
                "execute_user_id": user_id,
                "time_spent": hours,
                "actual_start_time": "2026-06-01T09:00:00Z",
                "actual_end_time": "2026-06-01T18:00:00Z",
                "submit": True,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text

    # stat-by-user
    resp = await client.get(
        "/api/ppm/work-hour/stat-by-user",
        params={"user_id": user_id},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dimension"] == "user"
    assert body["total_hours"] == 10.0
    assert len(body["items"]) == 1

    # stat-by-project
    resp = await client.get(
        "/api/ppm/work-hour/stat-by-project",
        params={"project_id": project_id},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["total_hours"] == 10.0


async def test_page_endpoints_tolerate_invalid_uuid_query(client, auth_headers):
    """前端传占位符 "-" / 空串 / 非法字符串到 page/stat 端点 → 200 (不过滤),不 422。"""
    invalid_values = ["-", "", "not-a-uuid"]
    endpoints = [
        "/api/ppm/task-plan/page",
        "/api/ppm/task-execute/page",
        "/api/ppm/work-hour/page",
        "/api/ppm/work-hour/stat-by-user",
        "/api/ppm/work-hour/stat-by-project",
        "/api/ppm/personal-task-plan/page",
    ]
    for ep in endpoints:
        for val in invalid_values:
            resp = await client.get(
                ep,
                params={"user_id": val, "project_id": val},
                headers=auth_headers,
            )
            assert resp.status_code == 200, (
                f"{ep}?user_id={val!r} 应容错返回 200,实际 {resp.status_code}: {resp.text}"
            )


async def test_personal_task_plan_only_returns_current_user(client, db_session, auth_headers):
    """personal-task-plan 应仅返回 token 持有者 (admin@example.com) 的数据。"""
    from sqlalchemy import select

    from app.modules.auth.model import User

    # token 对应的 admin 用户
    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None

    # admin 自己一条 + 别人一条
    svc = PlanTaskService(db_session)
    await svc.create(PlanTaskCreate(user_id=admin.id, content="mine"))
    await svc.create(PlanTaskCreate(user_id=uuid.uuid4(), content="others"))

    resp = await client.get("/api/ppm/personal-task-plan/page", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["content"] == "mine"


async def test_execute_plan_http_endpoint(client, auth_headers):
    user_id = str(uuid.uuid4())
    # 先建计划
    resp = await client.post(
        "/api/ppm/task-plan/create",
        json={"user_id": user_id, "content": "to execute"},
        headers=auth_headers,
    )
    plan_id = resp.json()["id"]

    # 执行(非提交)
    resp = await client.put(
        "/api/ppm/task-plan/execute",
        json={
            "plan_task_id": plan_id,
            "execute_info": "开始",
            "execute_user_id": user_id,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    exec_id = resp.json()["id"]
    assert resp.json()["status"] == STATUS_DOING

    # 提交完成
    resp = await client.put(
        "/api/ppm/task-plan/execute",
        json={
            "plan_task_id": plan_id,
            "task_execute_id": exec_id,
            "submit": True,
            "end_remark": "done",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == STATUS_END
