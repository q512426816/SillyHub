"""task-03 三联表查询 + 成本派生单测。

覆盖 task-03.md AC-1 ~ AC-6:
- 嵌套结构 (plan → node → detail → task)
- remaining_person_days / remaining_cost 派生 (D-014@v1)
- null 操作数 → None (不 clamp 0)
- 超支允许负值
- archived 明细被排除
- 孤儿任务不挂载

使用根 conftest 的 ``db_session`` fixture (in-memory SQLite +
plan/tests/conftest.py 注册 plan 模型,根 conftest 已注册 ppm.task 模型)。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.ppm.data_scope import DataScope
from app.modules.ppm.plan.model import (
    PsPlanNode,
    PsPlanNodeDetail,
    PsProjectPlan,
)
from app.modules.ppm.plan.schema import ProjectPlanThreeLevelResp
from app.modules.ppm.plan.service import PlanService
from app.modules.ppm.task.model import PlanTask

FULL_SCOPE = DataScope(is_full=True)


def _now() -> datetime:
    return datetime.now(UTC)


async def _seed_plan(
    session: AsyncSession,
    *,
    budget_person_days: str | None = None,
    actual_consumption_person_days: str | None = None,
    total_cost: str | None = None,
    labor_cost: str | None = None,
) -> PsProjectPlan:
    plan = PsProjectPlan(
        id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        project_name="测试项目",
        budget_person_days=budget_person_days,
        actual_consumption_person_days=actual_consumption_person_days,
        total_cost=total_cost,
        labor_cost=labor_cost,
        status="draft",
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(plan)
    await session.commit()
    await session.refresh(plan)
    return plan


async def _seed_node(session: AsyncSession, plan_id: uuid.UUID, no: str = "1") -> PsPlanNode:
    node = PsPlanNode(
        id=uuid.uuid4(),
        ps_project_plan_id=plan_id,
        overall_stage="阶段一",
        no=no,
        status="draft",
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(node)
    await session.commit()
    await session.refresh(node)
    return node


async def _seed_detail(
    session: AsyncSession,
    plan_node_id: uuid.UUID,
    *,
    no: str = "1",
    status: str = "draft",
) -> PsPlanNodeDetail:
    detail = PsPlanNodeDetail(
        id=uuid.uuid4(),
        plan_node_id=plan_node_id,
        detailed_stage="里程碑",
        no=no,
        status=status,
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(detail)
    await session.commit()
    await session.refresh(detail)
    return detail


async def _seed_task(
    session: AsyncSession,
    *,
    detail_id: uuid.UUID | None = None,
    content: str = "任务内容",
) -> PlanTask:
    task = PlanTask(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        user_name="张三",
        content=content,
        status="未开始",
        ps_plan_node_detail_id=detail_id,
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


# ===========================================================================
# 结构 / 嵌套
# ===========================================================================


class TestThreeLevelStructure:
    async def test_three_level_basic_structure(self, db_session: AsyncSession) -> None:
        """AC-1: plan.nodes[*].details[*].tasks[*] 四层嵌套正确。"""
        plan = await _seed_plan(db_session)
        node = await _seed_node(db_session, plan.id)
        d1 = await _seed_detail(db_session, node.id, no="1")
        d2 = await _seed_detail(db_session, node.id, no="2")
        t1 = await _seed_task(db_session, detail_id=d1.id, content="任务A")
        t2 = await _seed_task(db_session, detail_id=d1.id, content="任务B")
        t3 = await _seed_task(db_session, detail_id=d2.id, content="任务C")

        resp = await PlanService(db_session).get_project_plan_three_level(plan.id, FULL_SCOPE)

        assert isinstance(resp, ProjectPlanThreeLevelResp)
        assert resp.id == plan.id
        assert len(resp.nodes) == 1
        node_resp = resp.nodes[0]
        assert node_resp.id == node.id
        detail_ids = {str(d.id) for d in node_resp.details}
        assert detail_ids == {str(d1.id), str(d2.id)}
        # d1 下两个任务,t3 下一个
        d1_resp = next(d for d in node_resp.details if d.id == d1.id)
        d2_resp = next(d for d in node_resp.details if d.id == d2.id)
        assert {t.id for t in d1_resp.tasks} == {t1.id, t2.id}
        assert {t.id for t in d2_resp.tasks} == {t3.id}

    async def test_empty_nodes_returns_empty_array(self, db_session: AsyncSession) -> None:
        """AC 边界:plan 存在但无子节点 → nodes=[]。"""
        plan = await _seed_plan(db_session)
        resp = await PlanService(db_session).get_project_plan_three_level(plan.id, FULL_SCOPE)
        assert resp.nodes == []

    async def test_archived_detail_excluded(self, db_session: AsyncSession) -> None:
        """AC-6:status='archived' 的明细不出现在 details。"""
        plan = await _seed_plan(db_session)
        node = await _seed_node(db_session, plan.id)
        archived = await _seed_detail(db_session, node.id, no="1", status="archived")
        active = await _seed_detail(db_session, node.id, no="2", status="draft")

        resp = await PlanService(db_session).get_project_plan_three_level(plan.id, FULL_SCOPE)

        detail_ids = {str(d.id) for d in resp.nodes[0].details}
        assert str(active.id) in detail_ids
        assert str(archived.id) not in detail_ids

    async def test_orphan_task_not_attached(self, db_session: AsyncSession) -> None:
        """边界 4:ps_plan_node_detail_id 指向不存在 detail → 不挂载。"""
        plan = await _seed_plan(db_session)
        node = await _seed_node(db_session, plan.id)
        await _seed_detail(db_session, node.id)
        # 指向不存在的 detail id
        await _seed_task(db_session, detail_id=uuid.uuid4(), content="孤儿任务")

        resp = await PlanService(db_session).get_project_plan_three_level(plan.id, FULL_SCOPE)
        # 该孤儿任务不应出现在任何 detail 下
        all_tasks = [t for n in resp.nodes for d in n.details for t in d.tasks]
        assert all(t.content != "孤儿任务" for t in all_tasks)


# ===========================================================================
# 成本派生 (D-014@v1)
# ===========================================================================


class TestCostDerivation:
    async def test_remaining_person_days_calc(self, db_session: AsyncSession) -> None:
        """AC-2:budget="100" / actual="30" → remaining="70"。"""
        plan = await _seed_plan(
            db_session, budget_person_days="100", actual_consumption_person_days="30"
        )
        resp = await PlanService(db_session).get_project_plan_three_level(plan.id, FULL_SCOPE)
        assert resp.remaining_available_person_days == "70"

    async def test_remaining_cost_calc(self, db_session: AsyncSession) -> None:
        """AC-3:total_cost="5000" / labor_cost="1200" → remaining_cost="3800"。"""
        plan = await _seed_plan(db_session, total_cost="5000", labor_cost="1200")
        resp = await PlanService(db_session).get_project_plan_three_level(plan.id, FULL_SCOPE)
        assert resp.remaining_cost == "3800"

    async def test_remaining_null_when_operand_missing(self, db_session: AsyncSession) -> None:
        """AC-4:budget=None → remaining=None (不 clamp 到 0)。"""
        plan = await _seed_plan(
            db_session,
            budget_person_days=None,
            actual_consumption_person_days="30",
            total_cost="5000",
            labor_cost=None,
        )
        resp = await PlanService(db_session).get_project_plan_three_level(plan.id, FULL_SCOPE)
        assert resp.remaining_available_person_days is None
        assert resp.remaining_cost is None

    async def test_remaining_negative_allowed(self, db_session: AsyncSession) -> None:
        """AC-5:超支允许负值 budget="50" / actual="80" → remaining="-30"。"""
        plan = await _seed_plan(
            db_session, budget_person_days="50", actual_consumption_person_days="80"
        )
        resp = await PlanService(db_session).get_project_plan_three_level(plan.id, FULL_SCOPE)
        # Decimal("-30") 规整后字符串化为 "-30"
        assert resp.remaining_available_person_days == "-30"

    async def test_remaining_non_numeric_returns_none(self, db_session: AsyncSession) -> None:
        """边界 6:非数值字符串 → None。"""
        plan = await _seed_plan(
            db_session,
            budget_person_days="N/A",
            actual_consumption_person_days="30",
        )
        resp = await PlanService(db_session).get_project_plan_three_level(plan.id, FULL_SCOPE)
        assert resp.remaining_available_person_days is None
