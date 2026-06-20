"""list-by-date-range 端点 + service 单测 (task-06 / FR-06)。

覆盖:
- 区间过滤 (find_time 落在区间内才返回)
- find_time 为空的 problem 不返回
- 反向区间 (start > end) service 自动 swap
- 区间无数据返回 []
- 有未关闭变更的 problem 内存态 effective_status=7
- 端点路由顺序:list-by-date-range 不被 /{item_id} 吞 (返回 200 非 422)

设计依据:tasks/task-06.md §实现要求 / §边界处理 / §验收标准 AC-01~06。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.ppm.problem.fsm import ProblemStatus
from app.modules.ppm.problem.service import ProblemService

# ===========================================================================
# helper (复用 test_problem_flow 的建项目 / 建问题范式,独立定义避免 import 耦合)
# ===========================================================================


async def _make_project(session: AsyncSession) -> str:
    import uuid as _uuid

    from app.modules.ppm.project.model import PpmProjectMaintenance

    proj_id = _uuid.uuid4()
    session.add(
        PpmProjectMaintenance(
            id=proj_id, project_code=f"P-{proj_id.hex[:6]}", project_name="项目甲"
        )
    )
    await session.commit()
    return str(proj_id)


async def _make_problem_with_find_time(
    svc: ProblemService,
    project_id: str,
    *,
    find_time: datetime | None,
    pro_desc: str = "一个问题",
) -> object:
    return await svc.create_problem(
        {
            "project_id": project_id,
            "project_name": "项目甲",
            "pro_desc": pro_desc,
            "pro_type": "bug",
            "duty_user_id": "duty-001",
            "duty_user_name": "钱责任",
            "audit_user_id": "audit-001",
            "audit_user_name": "孙验证",
            "find_time": find_time,
        }
    )


# ===========================================================================
# service 层:list_problems_by_date_range
# ===========================================================================


class TestListByDateRangeService:
    async def test_filter_by_range(self, db_session: AsyncSession) -> None:
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        base = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)
        in_range = base + timedelta(days=10)  # 6/11
        before = base - timedelta(days=10)  # 5/22
        after = base + timedelta(days=30)  # 7/1
        await _make_problem_with_find_time(svc, proj_id, find_time=in_range, pro_desc="命中")
        await _make_problem_with_find_time(svc, proj_id, find_time=before, pro_desc="早于")
        await _make_problem_with_find_time(svc, proj_id, find_time=after, pro_desc="晚于")

        start = datetime(2026, 6, 5, tzinfo=UTC)
        end = datetime(2026, 6, 20, tzinfo=UTC)
        items = await svc.list_problems_by_date_range(start, end)
        assert len(items) == 1
        assert items[0].pro_desc == "命中"

    async def test_null_find_time_excluded(self, db_session: AsyncSession) -> None:
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        # find_time 为空的问题
        await _make_problem_with_find_time(svc, proj_id, find_time=None, pro_desc="无发现时间")

        start = datetime(2020, 1, 1, tzinfo=UTC)
        end = datetime(2030, 1, 1, tzinfo=UTC)
        items = await svc.list_problems_by_date_range(start, end)
        assert items == []

    async def test_reverse_range_swap(self, db_session: AsyncSession) -> None:
        """反向区间 (start > end) service 内自动 swap,不报错,返回一致结果。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        t = datetime(2026, 6, 10, 12, 0, tzinfo=UTC)
        await _make_problem_with_find_time(svc, proj_id, find_time=t, pro_desc="命中")

        start = datetime(2026, 6, 1, tzinfo=UTC)
        end = datetime(2026, 6, 20, tzinfo=UTC)
        forward = await svc.list_problems_by_date_range(start, end)
        backward = await svc.list_problems_by_date_range(end, start)  # 反向
        assert len(forward) == 1
        assert len(backward) == 1
        assert forward[0].id == backward[0].id

    async def test_empty_result(self, db_session: AsyncSession) -> None:
        svc = ProblemService(db_session)
        start = datetime(2026, 6, 1, tzinfo=UTC)
        end = datetime(2026, 6, 20, tzinfo=UTC)
        items = await svc.list_problems_by_date_range(start, end)
        assert items == []

    async def test_order_desc_by_find_time(self, db_session: AsyncSession) -> None:
        """按 find_time 倒序返回 (最近优先)。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        t1 = datetime(2026, 6, 1, tzinfo=UTC)
        t2 = datetime(2026, 6, 5, tzinfo=UTC)
        t3 = datetime(2026, 6, 10, tzinfo=UTC)
        await _make_problem_with_find_time(svc, proj_id, find_time=t1, pro_desc="早")
        await _make_problem_with_find_time(svc, proj_id, find_time=t2, pro_desc="中")
        await _make_problem_with_find_time(svc, proj_id, find_time=t3, pro_desc="晚")

        start = datetime(2026, 5, 1, tzinfo=UTC)
        end = datetime(2026, 7, 1, tzinfo=UTC)
        items = await svc.list_problems_by_date_range(start, end)
        assert [i.pro_desc for i in items] == ["晚", "中", "早"]

    async def test_changing_flag_marked(self, db_session: AsyncSession) -> None:
        """有未关闭变更的 problem 内存态 effective_status=7 变更中。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        t = datetime(2026, 6, 10, 12, 0, tzinfo=UTC)
        p = await _make_problem_with_find_time(svc, proj_id, find_time=t)
        # 建一条未关闭变更 (status=1 审核中)
        await svc.create_change(
            {"resource_id": str(p.id), "project_id": proj_id, "change_reason": "x"}
        )

        start = datetime(2026, 6, 1, tzinfo=UTC)
        end = datetime(2026, 6, 20, tzinfo=UTC)
        items = await svc.list_problems_by_date_range(start, end)
        assert len(items) == 1
        # effective_status 内存态被标记为 7 变更中,持久化 status 不变
        assert items[0].effective_status == ProblemStatus.CHANGING.value
        assert items[0].status == ProblemStatus.SAVED.value


# ===========================================================================
# 端点层:路由顺序 + 真实 HTTP 往返
# ===========================================================================


@pytest.mark.usefixtures("auth_headers")
class TestListByDateRangeEndpoint:
    async def test_route_not_swallowed_by_item_id(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        auth_headers: dict[str, str],
    ) -> None:
        """AC-05:固定路径不被 /problem-list/{item_id} 吞 (返回 200 非 422)。

        若 list-by-date-range 注册在 /{item_id} 之后,FastAPI 会把
        ``list-by-date-range`` 当 item_id 解析,返回 422 而非 200。
        """
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        t = datetime(2026, 6, 10, 12, 0, tzinfo=UTC)
        await _make_problem_with_find_time(svc, proj_id, find_time=t)

        start = datetime(2026, 6, 1, tzinfo=UTC).isoformat()
        end = datetime(2026, 6, 20, tzinfo=UTC).isoformat()
        resp = await client.get(
            "/api/ppm/problem-list/list-by-date-range",
            params={"start_date": start, "end_date": end},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["pro_desc"] == "一个问题"

    async def test_empty_result_endpoint(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        start = datetime(2026, 6, 1, tzinfo=UTC).isoformat()
        end = datetime(2026, 6, 20, tzinfo=UTC).isoformat()
        resp = await client.get(
            "/api/ppm/problem-list/list-by-date-range",
            params={"start_date": start, "end_date": end},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == []
