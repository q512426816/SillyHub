"""ppm kanban 看板子域测试。

覆盖 task-07 验收项:
- 人员列聚合 (project_member + task 统计),可按 Organization 分组 (X-001)
- 任务卡片按 kanban_order 排序
- assign 更新 PlanTask.user_id + user_name
- reorder 持久化 kanban_order
- search 模糊搜人
- 端点鉴权 (无 token 401)
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.modules.admin.model import Organization, UserOrganization
from app.modules.ppm.kanban.schema import (
    KanbanQueryReq,
    TaskAssignReq,
)
from app.modules.ppm.kanban.service import PpdKanbanService, TaskNotFound
from app.modules.ppm.project.model import (
    PpmProjectMaintenance,
    PpmProjectMember,
)
from app.modules.ppm.task.model import PlanTask

# ---------------------------------------------------------------------------
# seed helpers
# ---------------------------------------------------------------------------


async def _seed_project(db_session, name: str = "P1") -> uuid.UUID:
    proj = PpmProjectMaintenance(project_code=f"CODE-{name}", project_name=name)
    db_session.add(proj)
    await db_session.commit()
    await db_session.refresh(proj)
    return proj.id


async def _seed_member(
    db_session,
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    user_name: str,
) -> uuid.UUID:
    m = PpmProjectMember(
        pm_project_id=project_id,
        user_id=user_id,
        user_name=user_name,
        role_name="开发",
    )
    db_session.add(m)
    await db_session.commit()
    await db_session.refresh(m)
    return m.id


async def _seed_task(
    db_session,
    user_id: uuid.UUID,
    user_name: str = "张三",
    status: str = "未开始",
    content: str = "写文档",
    work_load: str = "8",
    kanban_order: int = 0,
    project_id: uuid.UUID | None = None,
    project_name: str | None = "P1",
) -> uuid.UUID:
    t = PlanTask(
        user_id=user_id,
        user_name=user_name,
        status=status,
        content=content,
        work_load=work_load,
        kanban_order=kanban_order,
        project_id=project_id,
        project_name=project_name,
    )
    db_session.add(t)
    await db_session.commit()
    await db_session.refresh(t)
    return t.id


async def _seed_org(db_session, name: str, code: str, sort_order: int = 0) -> uuid.UUID:
    org = Organization(name=name, code=code, sort_order=sort_order)
    db_session.add(org)
    await db_session.commit()
    await db_session.refresh(org)
    return org.id


async def _bind_user_org(db_session, user_id: uuid.UUID, org_id: uuid.UUID) -> None:
    db_session.add(UserOrganization(user_id=user_id, organization_id=org_id))
    await db_session.commit()


# ---------------------------------------------------------------------------
# service: 人员列聚合
# ---------------------------------------------------------------------------


async def test_user_columns_aggregates_task_count_and_ids(db_session):
    proj_id = await _seed_project(db_session)
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()
    await _seed_member(db_session, proj_id, user_a, "张三")
    await _seed_member(db_session, proj_id, user_b, "李四")
    await _seed_task(db_session, user_a, "张三", content="t1", project_id=proj_id)
    await _seed_task(db_session, user_a, "张三", content="t2", project_id=proj_id)
    await _seed_task(db_session, user_b, "李四", content="t3", project_id=proj_id)

    svc = PpdKanbanService(db_session)
    columns = await svc.get_user_columns(KanbanQueryReq())
    by_user = {c.user_id: c for c in columns}
    assert len(columns) == 2
    assert by_user[user_a].task_count == 2
    assert by_user[user_b].task_count == 1
    assert len(by_user[user_a].task_ids) == 2
    # 预估工时合计 (work_load "8" * 2)
    assert by_user[user_a].total_hours == 16.0


async def test_user_columns_filters_by_project_and_status(db_session):
    proj_a = await _seed_project(db_session, "PA")
    proj_b = await _seed_project(db_session, "PB")
    user_a = uuid.uuid4()
    await _seed_member(db_session, proj_a, user_a, "张三")
    await _seed_member(db_session, proj_b, user_a, "张三")  # 同人不同项目
    await _seed_task(db_session, user_a, status="未开始", project_id=proj_a)
    await _seed_task(db_session, user_a, status="进行中", project_id=proj_b)

    svc = PpdKanbanService(db_session)
    # 按 project 过滤:member 仅返回 PA 的(同人去重为 1),task 仅 PA 的
    cols = await svc.get_user_columns(KanbanQueryReq(project_id=proj_a))
    assert len(cols) == 1
    assert cols[0].task_count == 1
    # 按 status 过滤:跨项目统计该 user 的"进行中"任务
    cols = await svc.get_user_columns(KanbanQueryReq(status="进行中"))
    assert len(cols) == 1
    assert cols[0].task_count == 1


async def test_user_columns_grouped_by_org(db_session):
    """X-001:group_by_org=True 时返回 OrgGroup 列表。"""
    proj_id = await _seed_project(db_session)
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()
    user_c = uuid.uuid4()  # 无组织
    await _seed_member(db_session, proj_id, user_a, "张三")
    await _seed_member(db_session, proj_id, user_b, "李四")
    await _seed_member(db_session, proj_id, user_c, "王五")
    await _seed_task(db_session, user_a, project_id=proj_id)
    await _seed_task(db_session, user_b, project_id=proj_id)

    org1 = await _seed_org(db_session, "研发部", "RD", sort_order=1)
    org2 = await _seed_org(db_session, "产品部", "PD", sort_order=2)
    await _bind_user_org(db_session, user_a, org1)
    await _bind_user_org(db_session, user_b, org2)

    svc = PpdKanbanService(db_session)
    groups = await svc.get_user_columns(KanbanQueryReq(group_by_org=True))
    assert isinstance(groups, list)
    by_org = {g.org_id: g for g in groups}
    assert by_org[org1].org_name == "研发部"
    assert len(by_org[org1].members) == 1
    assert by_org[org1].members[0].username == "张三"
    assert by_org[org2].org_name == "产品部"
    # user_c 无组织 → org_id=None 分组
    none_group = by_org.get(None)
    assert none_group is not None
    assert len(none_group.members) == 1
    assert none_group.members[0].username == "王五"


# ---------------------------------------------------------------------------
# service: 任务卡片
# ---------------------------------------------------------------------------


async def test_task_cards_ordered_by_kanban_order(db_session):
    user_a = uuid.uuid4()
    await _seed_task(db_session, user_a, content="c3", kanban_order=3)
    await _seed_task(db_session, user_a, content="c1", kanban_order=1)
    await _seed_task(db_session, user_a, content="c2", kanban_order=2)

    svc = PpdKanbanService(db_session)
    cards = await svc.get_task_cards(KanbanQueryReq())
    titles = [c.title for c in cards]
    assert titles == ["c1", "c2", "c3"]


async def test_task_cards_filter_by_keyword_and_user(db_session):
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()
    await _seed_task(db_session, user_a, content="需求文档A")
    await _seed_task(db_session, user_a, content="测试用例")
    await _seed_task(db_session, user_b, content="需求文档B")

    svc = PpdKanbanService(db_session)
    # keyword 过滤
    cards = await svc.get_task_cards(KanbanQueryReq(keyword="需求"))
    assert len(cards) == 2
    # user_ids 过滤
    cards = await svc.get_task_cards(KanbanQueryReq(user_ids=[user_b]))
    assert len(cards) == 1
    assert cards[0].user_id == user_b


# ---------------------------------------------------------------------------
# service: assign
# ---------------------------------------------------------------------------


async def test_assign_task_updates_user_and_name(db_session):
    proj_id = await _seed_project(db_session)
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()
    await _seed_member(db_session, proj_id, user_a, "张三")
    await _seed_member(db_session, proj_id, user_b, "李四")
    task_id = await _seed_task(db_session, user_a, "张三", content="t1")

    svc = PpdKanbanService(db_session)
    await svc.assign_task(TaskAssignReq(task_id=task_id, assignee_id=user_b, kanban_order=5))

    task = await db_session.get(PlanTask, task_id)
    assert task.user_id == user_b
    assert task.user_name == "李四"  # 同步冗余名 (取自 project_member)
    assert task.kanban_order == 5


async def test_assign_task_not_found_raises(db_session):
    svc = PpdKanbanService(db_session)
    with pytest.raises(TaskNotFound):
        await svc.assign_task(TaskAssignReq(task_id=uuid.uuid4(), assignee_id=uuid.uuid4()))


# ---------------------------------------------------------------------------
# service: reorder
# ---------------------------------------------------------------------------


async def test_reorder_persists_kanban_order(db_session):
    """拖拽排序:task_ids 顺序即新 kanban_order。"""
    user_a = uuid.uuid4()
    t1 = await _seed_task(db_session, user_a, content="t1", kanban_order=0)
    t2 = await _seed_task(db_session, user_a, content="t2", kanban_order=1)
    t3 = await _seed_task(db_session, user_a, content="t3", kanban_order=2)

    svc = PpdKanbanService(db_session)
    # 把 t3 拖到第一位
    await svc.reorder_tasks(user_a, [t3, t1, t2])

    result = await db_session.execute(
        select(PlanTask).where(PlanTask.user_id == user_a).order_by(PlanTask.kanban_order)
    )
    ordered = list(result.scalars().all())
    assert [t.id for t in ordered] == [t3, t1, t2]
    assert ordered[0].kanban_order == 0
    assert ordered[1].kanban_order == 1
    assert ordered[2].kanban_order == 2


async def test_reorder_scoped_to_user_only(db_session):
    """reorder 仅更新传入 user 下的任务,不影响他人。"""
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()
    ta = await _seed_task(db_session, user_a, content="a1", kanban_order=0)
    tb = await _seed_task(db_session, user_b, content="b1", kanban_order=7)

    svc = PpdKanbanService(db_session)
    await svc.reorder_tasks(user_a, [ta])

    # user_b 的任务 kanban_order 不变
    b_task = await db_session.get(PlanTask, tb)
    assert b_task.kanban_order == 7


async def test_reorder_empty_list_noop(db_session):
    svc = PpdKanbanService(db_session)
    await svc.reorder_tasks(uuid.uuid4(), [])  # 不应报错


# ---------------------------------------------------------------------------
# service: search
# ---------------------------------------------------------------------------


async def test_search_users_by_name_fuzzy(db_session):
    proj_id = await _seed_project(db_session)
    u1 = uuid.uuid4()
    u2 = uuid.uuid4()
    u3 = uuid.uuid4()
    await _seed_member(db_session, proj_id, u1, "张三")
    await _seed_member(db_session, proj_id, u2, "张伟")
    await _seed_member(db_session, proj_id, u3, "李四")

    svc = PpdKanbanService(db_session)
    # 模糊匹配 "张"
    results = await svc.search_users("张")
    names = {r.username for r in results}
    assert names == {"张三", "张伟"}
    # 搜索结果不含任务统计
    for r in results:
        assert r.task_count == 0
    # 无匹配
    assert await svc.search_users("不存在的名字") == []
    # 空关键词
    assert await svc.search_users("") == []


# ---------------------------------------------------------------------------
# HTTP 层:鉴权 + happy path
# ---------------------------------------------------------------------------


async def test_kanban_endpoints_require_auth(db_engine):
    """无 token 应 401 (所有 kanban 端点)。"""
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.core.errors import register_exception_handlers
    from app.modules.ppm.kanban.router import router as kanban_router

    app = FastAPI()
    app.include_router(kanban_router, prefix="/api/ppm")
    # 复用全局异常处理器,把 AppError (如 AuthTokenMissing) 转 HTTP 响应
    register_exception_handlers(app)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/ppm/kanban/users")
        assert resp.status_code == 401
        resp = await ac.get("/api/ppm/kanban/tasks")
        assert resp.status_code == 401
        resp = await ac.post("/api/ppm/kanban/task/assign", json={})
        assert resp.status_code == 401


async def test_kanban_users_http_returns_columns(kanban_client, db_session):
    proj_id = await _seed_project(db_session)
    user_a = uuid.uuid4()
    await _seed_member(db_session, proj_id, user_a, "张三")
    await _seed_task(db_session, user_a, "张三", content="t1", project_id=proj_id)

    resp = await kanban_client.get("/api/ppm/kanban/users")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["username"] == "张三"
    assert body[0]["task_count"] == 1


async def test_kanban_users_group_by_org_http(kanban_client, db_session):
    """X-001 HTTP:group_by_org=true 返回分组结构。"""
    proj_id = await _seed_project(db_session)
    user_a = uuid.uuid4()
    await _seed_member(db_session, proj_id, user_a, "张三")
    await _seed_task(db_session, user_a, project_id=proj_id)
    org1 = await _seed_org(db_session, "研发部", "RD")
    await _bind_user_org(db_session, user_a, org1)

    resp = await kanban_client.get("/api/ppm/kanban/users", params={"group_by_org": True})
    assert resp.status_code == 200, resp.text
    groups = resp.json()
    rd = [g for g in groups if g.get("org_name") == "研发部"]
    assert len(rd) == 1
    assert len(rd[0]["members"]) == 1


async def test_kanban_tasks_http(kanban_client, db_session):
    user_a = uuid.uuid4()
    await _seed_task(db_session, user_a, content="卡片1", kanban_order=1)
    await _seed_task(db_session, user_a, content="卡片2", kanban_order=0)

    resp = await kanban_client.get("/api/ppm/kanban/tasks")
    assert resp.status_code == 200, resp.text
    cards = resp.json()
    # 按 kanban_order 升序
    assert [c["title"] for c in cards] == ["卡片2", "卡片1"]


async def test_kanban_assign_http(kanban_client, db_session):
    proj_id = await _seed_project(db_session)
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()
    await _seed_member(db_session, proj_id, user_a, "张三")
    await _seed_member(db_session, proj_id, user_b, "李四")
    task_id = await _seed_task(db_session, user_a, "张三", content="t1")

    resp = await kanban_client.post(
        "/api/ppm/kanban/task/assign",
        json={"task_id": str(task_id), "assignee_id": str(user_b), "kanban_order": 2},
    )
    assert resp.status_code == 200, resp.text

    # 持久化验证
    task = await db_session.get(PlanTask, task_id)
    assert task.user_id == user_b
    assert task.user_name == "李四"
    assert task.kanban_order == 2


async def test_kanban_reorder_http_persists(kanban_client, db_session):
    """HTTP reorder 持久化 kanban_order。"""
    user_a = uuid.uuid4()
    t1 = await _seed_task(db_session, user_a, content="t1", kanban_order=0)
    t2 = await _seed_task(db_session, user_a, content="t2", kanban_order=1)

    resp = await kanban_client.put(
        "/api/ppm/kanban/task/reorder",
        json={"user_id": str(user_a), "task_ids": [str(t2), str(t1)]},
    )
    assert resp.status_code == 200, resp.text

    result = await db_session.execute(
        select(PlanTask).where(PlanTask.user_id == user_a).order_by(PlanTask.kanban_order)
    )
    ordered = list(result.scalars().all())
    assert [t.id for t in ordered] == [t2, t1]


async def test_kanban_search_users_http(kanban_client, db_session):
    proj_id = await _seed_project(db_session)
    u1 = uuid.uuid4()
    await _seed_member(db_session, proj_id, u1, "张三")

    resp = await kanban_client.get("/api/ppm/kanban/search/users", params={"keyword": "张"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["username"] == "张三"
