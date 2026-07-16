"""ppm task 子域 router 层测试(D-002/D-003/D-004/D-005/D-008 新契约)。

覆盖:
- POST /task-plan/start (启动, 创建 in-flight TaskExecute 记 actual_start_time)
- PUT /task-plan/execute action=submit(回未开始)/complete(已完成)
- 跨天校验 TaskError 400(actual 起止不同日)
- 多次填报: submit 回未开始后可再次 start 产生第二条 TaskExecute
- /task-execute/page?problem_task_id 过滤(D-008)
- TaskExecuteCreate model_validator 跨天拒绝(D-004)
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.modules.ppm.task.schema import TaskExecuteCreate


async def _create_plan(client, auth_headers, user_id: str) -> str:
    resp = await client.post(
        "/api/ppm/task-plan/create",
        json={"user_id": user_id, "content": "t", "work_load": "1"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _start(
    client, auth_headers, plan_id: str, user_id: str, actual_start: str | None = None
) -> dict:
    body: dict = {"plan_task_id": plan_id, "execute_user_id": user_id}
    if actual_start:
        body["actual_start_time"] = actual_start
    resp = await client.post("/api/ppm/task-plan/start", json=body, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _execute(client, auth_headers, plan_id: str, exc_id: str, action: str, **extra) -> dict:
    body = {"plan_task_id": plan_id, "action": action, "task_execute_id": exc_id, **extra}
    resp = await client.put("/api/ppm/task-plan/execute", json=body, headers=auth_headers)
    return resp


async def test_start_creates_inflight_task_execute(client, auth_headers):
    user_id = str(uuid.uuid4())
    plan_id = await _create_plan(client, auth_headers, user_id)
    data = await _start(client, auth_headers, plan_id, user_id, actual_start="2026-06-01T09:00:00Z")
    assert data["status"] == "30"  # STATUS_DOING
    assert data["actual_start_time"] is not None
    assert data["plan_task_id"] == plan_id


async def test_execute_complete_returns_status_90(client, auth_headers):
    user_id = str(uuid.uuid4())
    plan_id = await _create_plan(client, auth_headers, user_id)
    exc = await _start(client, auth_headers, plan_id, user_id, actual_start="2026-06-01T09:00:00Z")
    resp = await _execute(
        client,
        auth_headers,
        plan_id,
        exc["id"],
        "complete",
        time_spent=1.0,
        actual_end_time="2026-06-01T18:00:00Z",
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "90"
    assert resp.json()["actual_end_time"] is not None  # D-005 强制回填


async def test_execute_submit_resets_plan_and_supports_refill(client, auth_headers):
    """D-002/D-003 多次填报: submit 回未开始 → 再次 start 产生第二条 TaskExecute → complete。"""
    user_id = str(uuid.uuid4())
    plan_id = await _create_plan(client, auth_headers, user_id)
    # 第一次 start + submit
    exc1 = await _start(client, auth_headers, plan_id, user_id, actual_start="2026-06-01T09:00:00Z")
    resp = await _execute(
        client,
        auth_headers,
        plan_id,
        exc1["id"],
        "submit",
        time_spent=0.5,
        actual_end_time="2026-06-01T12:00:00Z",
    )
    assert resp.status_code == 200, resp.text
    # 再次 start(未开始→进行中) → 第二条 TaskExecute
    exc2 = await _start(client, auth_headers, plan_id, user_id, actual_start="2026-06-02T09:00:00Z")
    assert exc2["id"] != exc1["id"]
    # 第二次 complete
    resp = await _execute(
        client,
        auth_headers,
        plan_id,
        exc2["id"],
        "complete",
        time_spent=1.0,
        actual_end_time="2026-06-02T18:00:00Z",
    )
    assert resp.status_code == 200
    # 两条执行记录均可查(1 plan : N execute)
    resp = await client.get(
        f"/api/ppm/task-execute/page?plan_task_id={plan_id}", headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 2


async def test_execute_crossday_returns_400(client, auth_headers):
    """D-004 跨天校验: start(day1) + execute(day2) → TaskError 400。"""
    user_id = str(uuid.uuid4())
    plan_id = await _create_plan(client, auth_headers, user_id)
    exc = await _start(client, auth_headers, plan_id, user_id, actual_start="2026-06-01T09:00:00Z")
    resp = await _execute(
        client,
        auth_headers,
        plan_id,
        exc["id"],
        "complete",
        actual_end_time="2026-06-02T18:00:00Z",  # 跨天
    )
    assert resp.status_code == 400, resp.text
    assert "跨天" in resp.text


async def test_task_execute_page_filter_problem_task_id(client, auth_headers):
    """D-008 /task-execute/page 支持 problem_task_id 过滤(无匹配返回空)。"""
    resp = await client.get(
        f"/api/ppm/task-execute/page?problem_task_id={uuid.uuid4()}", headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 0
    # 不传 problem_task_id 不影响(返回所有)
    resp = await client.get("/api/ppm/task-execute/page", headers=auth_headers)
    assert resp.status_code == 200


def test_task_execute_create_crossday_validator():
    """D-004 TaskExecuteCreate model_validator: actual 跨天 raise ValidationError。"""
    with pytest.raises(ValidationError):
        TaskExecuteCreate(
            actual_start_time=datetime(2026, 6, 1, 9, tzinfo=UTC),
            actual_end_time=datetime(2026, 6, 2, 18, tzinfo=UTC),
        )
    # 同日通过
    ok = TaskExecuteCreate(
        actual_start_time=datetime(2026, 6, 1, 9, tzinfo=UTC),
        actual_end_time=datetime(2026, 6, 1, 18, tzinfo=UTC),
    )
    assert ok.actual_start_time is not None
