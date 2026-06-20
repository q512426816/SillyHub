"""plan 子域 submitDetail 单测 (task-02 验收 AC-6)。

覆盖里程碑明细提交 detail 字段更新 + 白名单 merge + 未知键忽略 +
写一行 PsPlanNodeDetailProcess (node_key="submit_detail")。

使用根 conftest 的 in-memory SQLite ``db_session`` fixture。
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.ppm.plan.fsm import PROCESS_BUSINESS_TYPE
from app.modules.ppm.plan.service import PlanService

_ACTOR = ("actor-001", "张三")


async def _make_detail(svc: PlanService, plan_node_id: str = "ms-1") -> object:
    return await svc.create_detail({"plan_node_id": plan_node_id, "task_theme": "初稿"})


class TestSubmitDetail:
    async def test_submit_detail_updates_fields(self, db_session: AsyncSession) -> None:
        """submit-detail 落库 detail JSON 到明细白名单字段。"""
        svc = PlanService(db_session)
        detail = await _make_detail(svc)
        did = detail.id

        updated = await svc.submit_detail(
            did,
            {
                "task_theme": "需求分析",
                "requirements": "采集用户故事",
                "role_name": "产品经理",
                "plan_workload": "5",
            },
            actor_id=_ACTOR[0],
            actor_name=_ACTOR[1],
        )
        assert updated.task_theme == "需求分析"
        assert updated.requirements == "采集用户故事"
        assert updated.role_name == "产品经理"
        assert updated.plan_workload == "5"

    async def test_submit_detail_ignores_unknown_keys(self, db_session: AsyncSession) -> None:
        """白名单外字段忽略,不报错不落库 (边界 6)。"""
        svc = PlanService(db_session)
        detail = await _make_detail(svc)
        did = detail.id

        updated = await svc.submit_detail(
            did,
            {
                "task_theme": "新主题",
                "unknown_field": "应被忽略",
                "status": "draft",  # status 不在白名单,不可经 submit-detail 改
            },
            actor_id=_ACTOR[0],
            actor_name=_ACTOR[1],
        )
        assert updated.task_theme == "新主题"
        assert (
            not hasattr(updated, "unknown_field") or getattr(updated, "unknown_field", None) is None
        )
        # status 未被改动 (仍是 create_detail 默认 draft)
        assert updated.status == "draft"

    async def test_submit_detail_writes_process(self, db_session: AsyncSession) -> None:
        """写一行 PsPlanNodeDetailProcess (node_key="submit_detail")。"""
        svc = PlanService(db_session)
        detail = await _make_detail(svc)
        did = detail.id

        await svc.submit_detail(
            did,
            {"task_theme": "提交流程"},
            actor_id=_ACTOR[0],
            actor_name=_ACTOR[1],
        )
        procs = await svc.list_processes(str(did))
        # 仅 submit_detail 一行
        submit_procs = [
            p
            for p in procs
            if p.business_type == PROCESS_BUSINESS_TYPE and p.node_key == "submit_detail"
        ]
        assert len(submit_procs) == 1
        assert submit_procs[0].handle_user_id == _ACTOR[0]
