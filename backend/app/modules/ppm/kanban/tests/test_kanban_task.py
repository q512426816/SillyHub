"""task-01 看板任务工作站测试。

覆盖 FR-01 + D-011:
- task CRUD(POST/PUT/DELETE /api/ppm/kanban/task)
- comment 列表 / 新增(空内容 422 / task 不存在 404)
- subtask 列表 / toggle(task_id 不匹配 404)
- delete_task 级联清 comment/subtask
- UserColumnVO saturation 计算(total_hours/40*100,无任务=0.0)

走 kanban_client fixture(platform admin token),HTTP 层验证。
"""

from __future__ import annotations

import uuid

from app.modules.ppm.kanban.model import PpmKanbanComment, PpmKanbanSubtask
from app.modules.ppm.task.model import PlanTask

# 复用 test_kanban.py 的 seed helpers
from .test_kanban import _seed_member, _seed_project, _seed_task

# ---------------------------------------------------------------------------
# task CRUD
# ---------------------------------------------------------------------------


async def test_create_task_returns_card_with_kanban_order_zero(kanban_client):
    """首条任务 kanban_order=0。"""
    resp = await kanban_client.post(
        "/api/ppm/kanban/task",
        json={"content": "新任务A"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["title"] == "新任务A"
    assert body["kanban_order"] == 0


async def test_create_task_assigns_trailing_kanban_order(kanban_client, db_session):
    """同 user 列已有任务时,新任务 kanban_order=列尾+1。"""
    user_a = uuid.uuid4()
    await _seed_task(db_session, user_a, content="t0", kanban_order=0)
    await _seed_task(db_session, user_a, content="t1", kanban_order=1)

    resp = await kanban_client.post(
        "/api/ppm/kanban/task",
        json={"content": "新任务B", "user_id": str(user_a)},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["kanban_order"] == 2


async def test_update_task_changes_content_and_status(kanban_client, db_session):
    task_id = await _seed_task(db_session, uuid.uuid4(), content="原标题")

    resp = await kanban_client.put(
        "/api/ppm/kanban/task",
        json={"task_id": str(task_id), "content": "改后标题", "status": "20"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["title"] == "改后标题"
    assert body["status"] == "20"

    # 持久化验证
    task = await db_session.get(PlanTask, task_id)
    assert task.content == "改后标题"
    assert task.status == "20"


async def test_update_task_not_found_returns_404(kanban_client):
    resp = await kanban_client.put(
        "/api/ppm/kanban/task",
        json={"task_id": str(uuid.uuid4()), "content": "x"},
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "PPM_KANBAN_TASK_NOT_FOUND"


async def test_delete_task_returns_204(kanban_client, db_session):
    user_a = uuid.uuid4()
    task_id = await _seed_task(db_session, user_a, content="t1")

    resp = await kanban_client.delete(
        "/api/ppm/kanban/task",
        params={"task_id": str(task_id)},
    )
    assert resp.status_code == 204, resp.text
    # 持久化验证
    assert await db_session.get(PlanTask, task_id) is None


async def test_delete_task_not_found_returns_404(kanban_client):
    resp = await kanban_client.delete(
        "/api/ppm/kanban/task",
        params={"task_id": str(uuid.uuid4())},
    )
    assert resp.status_code == 404, resp.text


async def test_delete_task_cascades_comment_and_subtask(kanban_client, db_session):
    """删 task 时级联删其 comment + subtask。"""
    task_id = await _seed_task(db_session, uuid.uuid4(), content="t1")
    # 直接落库一条 comment + 一条 subtask
    c = PpmKanbanComment(
        task_id=task_id,
        user_id=uuid.uuid4(),
        user_name="张三",
        content="hello",
    )
    s = PpmKanbanSubtask(task_id=task_id, title="子任务1")
    db_session.add(c)
    db_session.add(s)
    await db_session.commit()
    comment_id, subtask_id = c.id, s.id

    resp = await kanban_client.delete(
        "/api/ppm/kanban/task",
        params={"task_id": str(task_id)},
    )
    assert resp.status_code == 204, resp.text
    # 跨 session(override session 已提交删除),清 identity map 后查库
    db_session.expire_all()
    assert await db_session.get(PpmKanbanComment, comment_id) is None
    assert await db_session.get(PpmKanbanSubtask, subtask_id) is None


# ---------------------------------------------------------------------------
# comment
# ---------------------------------------------------------------------------


async def test_list_comments_returns_chronological(kanban_client, db_session):
    task_id = await _seed_task(db_session, uuid.uuid4(), content="t1")
    user_id = uuid.uuid4()
    await _seed_member_for_comment(db_session, user_id, "张三")
    db_session.add_all(
        [
            PpmKanbanComment(task_id=task_id, user_id=user_id, user_name="张三", content="第一条"),
            PpmKanbanComment(task_id=task_id, user_id=user_id, user_name="张三", content="第二条"),
        ]
    )
    await db_session.commit()

    resp = await kanban_client.get(f"/api/ppm/kanban/task/{task_id}/comments")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 2
    assert [c["content"] for c in body] == ["第一条", "第二条"]


async def test_add_comment_returns_201(kanban_client, db_session):
    task_id = await _seed_task(db_session, uuid.uuid4(), content="t1")
    resp = await kanban_client.post(
        f"/api/ppm/kanban/task/{task_id}/comments",
        json={"content": "一条评论"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["content"] == "一条评论"
    assert body["task_id"] == str(task_id)


async def test_add_comment_empty_returns_422(kanban_client, db_session):
    task_id = await _seed_task(db_session, uuid.uuid4(), content="t1")
    resp = await kanban_client.post(
        f"/api/ppm/kanban/task/{task_id}/comments",
        json={"content": "   "},
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "PPM_KANBAN_COMMENT_EMPTY"


async def test_add_comment_task_not_found_returns_404(kanban_client):
    resp = await kanban_client.post(
        f"/api/ppm/kanban/task/{uuid.uuid4()}/comments",
        json={"content": "x"},
    )
    assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# subtask
# ---------------------------------------------------------------------------


async def test_list_subtasks_returns_by_sort_order(kanban_client, db_session):
    task_id = await _seed_task(db_session, uuid.uuid4(), content="t1")
    db_session.add_all(
        [
            PpmKanbanSubtask(task_id=task_id, title="B", sort_order=1),
            PpmKanbanSubtask(task_id=task_id, title="A", sort_order=0),
        ]
    )
    await db_session.commit()

    resp = await kanban_client.get(f"/api/ppm/kanban/task/{task_id}/subtasks")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [s["title"] for s in body] == ["A", "B"]


async def test_toggle_subtask_flips_done(kanban_client, db_session):
    task_id = await _seed_task(db_session, uuid.uuid4(), content="t1")
    s = PpmKanbanSubtask(task_id=task_id, title="子任务", done=False)
    db_session.add(s)
    await db_session.commit()
    await db_session.refresh(s)

    resp = await kanban_client.put(
        f"/api/ppm/kanban/task/{task_id}/subtask/{s.id}/toggle",
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["done"] is True

    # 再 toggle 翻回 False
    resp2 = await kanban_client.put(
        f"/api/ppm/kanban/task/{task_id}/subtask/{s.id}/toggle",
    )
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["done"] is False


async def test_toggle_subtask_task_mismatch_returns_404(kanban_client, db_session):
    task_a = await _seed_task(db_session, uuid.uuid4(), content="a")
    task_b = await _seed_task(db_session, uuid.uuid4(), content="b")
    s = PpmKanbanSubtask(task_id=task_a, title="子任务")
    db_session.add(s)
    await db_session.commit()
    await db_session.refresh(s)

    # subtask 属 task_a,用 task_b 的 URL toggle → 404
    resp = await kanban_client.put(
        f"/api/ppm/kanban/task/{task_b}/subtask/{s.id}/toggle",
    )
    assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# saturation
# ---------------------------------------------------------------------------


async def test_user_column_saturation_calculation(kanban_client, db_session):
    """total_hours=50(人天) → saturation=125.0(50/40*100)。"""
    proj_id = await _seed_project(db_session)
    user_a = uuid.uuid4()
    await _seed_member(db_session, proj_id, user_a, "张三")
    await _seed_task(db_session, user_a, "张三", content="t1", work_load="20", project_id=proj_id)
    await _seed_task(db_session, user_a, "张三", content="t2", work_load="30", project_id=proj_id)

    resp = await kanban_client.get("/api/ppm/kanban/users")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    col = body[0]
    assert col["task_count"] == 2
    assert col["total_hours"] == 50.0
    assert col["saturation"] == 125.0


async def test_user_column_saturation_zero_when_no_tasks(kanban_client, db_session):
    """无任务的 user saturation=0.0。"""
    proj_id = await _seed_project(db_session)
    user_a = uuid.uuid4()
    await _seed_member(db_session, proj_id, user_a, "张三")

    resp = await kanban_client.get("/api/ppm/kanban/users")
    assert resp.status_code == 200, resp.text
    col = resp.json()[0]
    assert col["task_count"] == 0
    assert col["total_hours"] == 0.0
    assert col["saturation"] == 0.0


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


async def _seed_member_for_comment(db_session, user_id: uuid.UUID, name: str) -> None:
    """为评论的 user_name 解析种一条 project_member。"""
    proj_id = await _seed_project(db_session)
    await _seed_member(db_session, proj_id, user_id, name)
