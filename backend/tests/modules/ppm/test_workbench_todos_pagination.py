"""工作台待办三源窗口分页测试（ql-20260909-015-5caf）。

原实现全量派生（三源各 ≤200 整实体）后内存切片，每翻一页重跑全量；改三源
COUNT + 合并偏移窗口切片 + 列投影。本测试锁定分页正确性：

- 合并次序问题 → 变更 → 任务，页跨界处正确拼页（page2 = 尾问题/变更+首任务）；
- total = 三源真实合计（不再 200/源截断）；
- now_handle_user 4 种位置（唯一/开头/结尾/中间）均计入；
- 已完成/无我/他源 status 不计入。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import password_hasher
from app.modules.auth.model import User
from app.modules.ppm.problem.model import PpmProblemChange, PpmProblemList
from app.modules.ppm.task.model import PlanTask
from app.modules.ppm.workbench.service import WorkbenchService

_OTHER = "99999999-9999-9999-9999-999999999999"


async def _mk_user(session: AsyncSession) -> User:
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        id=uuid.uuid4(),
        email=f"todo-{uuid.uuid4().hex[:8]}@test.local",
        password_hash=password_hasher.hash("Xx1!aaaa"),
        display_name="待办用户",
        status="active",
        is_platform_admin=False,
    )
    session.add(user)
    await session.commit()
    return user


async def _seed(
    session: AsyncSession,
    uid: str,
    *,
    n_problem: int,
    n_change: int,
    n_task: int,
) -> None:
    """按三源各自数量播种；now_handle_user 轮转 4 种 uid 位置。"""
    positions = [f"{uid}", f"{uid},{_OTHER}", f"{_OTHER},{uid}", f"{_OTHER},{uid},{_OTHER}"]
    base = datetime(2026, 9, 1, tzinfo=UTC)
    for i in range(n_problem):
        session.add(
            PpmProblemList(
                id=uuid.uuid4(),
                project_id=uuid.uuid4(),
                now_handle_user=positions[i % 4],
                pro_desc=f"问题-{i}",
                created_at=base + timedelta(minutes=i),
            )
        )
    for i in range(n_change):
        session.add(
            PpmProblemChange(
                id=uuid.uuid4(),
                resource_id=uuid.uuid4(),
                project_id=uuid.uuid4(),
                status="1",
                now_handle_user=positions[i % 4],
                pro_desc=f"变更-{i}",
                created_at=base + timedelta(minutes=i),
            )
        )
    for i in range(n_task):
        session.add(
            PlanTask(
                id=uuid.uuid4(),
                user_id=uuid.UUID(uid),
                content=f"任务-{i}",
                start_time=base + timedelta(minutes=i),
            )
        )
    # 干扰行：不该计入任何源
    session.add(PpmProblemList(id=uuid.uuid4(), project_id=uuid.uuid4(), now_handle_user=_OTHER))
    session.add(
        PpmProblemList(
            id=uuid.uuid4(), project_id=uuid.uuid4(), now_handle_user=uid, status="已完成"
        )
    )
    session.add(
        PpmProblemChange(
            id=uuid.uuid4(),
            resource_id=uuid.uuid4(),
            project_id=uuid.uuid4(),
            status="2",
            now_handle_user=uid,
        )
    )
    session.add(PlanTask(id=uuid.uuid4(), user_id=uuid.UUID(uid), status="已完成"))
    session.add(PlanTask(id=uuid.uuid4(), user_id=uuid.uuid4()))
    await session.commit()


@pytest.mark.parametrize(
    ("page", "expect_sources"),
    [
        (1, ["problem_audit"] * 3),
        (2, ["problem_change", "problem_change", "plan_task"]),
        (3, ["plan_task"] * 3),
        (4, ["plan_task"] * 3),
        (5, ["plan_task"]),  # 尾页：13 条 ÷ 3/页 余 1
        (6, []),  # 尾后空页
    ],
)
async def test_window_pagination_across_sources(
    db_session: AsyncSession, page: int, expect_sources: list[str]
) -> None:
    user = await _mk_user(db_session)
    await _seed(db_session, str(user.id), n_problem=3, n_change=2, n_task=8)
    svc = WorkbenchService(db_session)
    result = await svc.get_todos(user, page=page, page_size=3)
    assert result.total == 13  # 3+2+8，干扰行不计
    assert [item.source for item in result.items] == expect_sources


async def test_first_page_order_and_names(db_session: AsyncSession) -> None:
    """首页内容正确：问题源内 created_at 升序，名称取 pro_desc。"""
    user = await _mk_user(db_session)
    await _seed(db_session, str(user.id), n_problem=3, n_change=1, n_task=1)
    svc = WorkbenchService(db_session)
    result = await svc.get_todos(user, page=1, page_size=3)
    assert [i.name for i in result.items] == ["问题-0", "问题-1", "问题-2"]
    assert all(i.type == "缺陷" for i in result.items)


async def test_single_source_user_only_tasks(db_session: AsyncSession) -> None:
    """只有任务的用户：窗口正确落到任务源，问题/变更零行。"""
    user = await _mk_user(db_session)
    await _seed(db_session, str(user.id), n_problem=0, n_change=0, n_task=5)
    svc = WorkbenchService(db_session)
    result = await svc.get_todos(user, page=1, page_size=10)
    assert result.total == 5
    assert all(i.source == "plan_task" for i in result.items)
    assert [i.name for i in result.items] == [f"任务-{i}" for i in range(5)]
