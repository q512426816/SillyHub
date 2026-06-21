"""plan 子域 service 单测 (task-04 验收)。

覆盖 task-04.md 验收:
- 模板/ps CRUD (create/get/list/update/delete)
- 子表明细 list-by-plan-node-id
- save_process 全主流程 (草稿→审核→审批→完成)
- reject_process 驳回 + 返工
- change_process 变更版本链 (新建 parent_id 版本,旧版本 archived)
- process 履历表每次流转插入一行
- 非法迁移抛 InvalidTransition

使用根 conftest 的 in-memory SQLite ``db_session`` fixture。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidTransition
from app.modules.ppm.common.crud import PageReq
from app.modules.ppm.plan.fsm import PROCESS_BUSINESS_TYPE, PlanNodeDetailStatus
from app.modules.ppm.plan.model import (
    PsPlanNodeDetail,
)
from app.modules.ppm.plan.service import PlanError, PlanNotFound, PlanService

# FK 字段已改为 uuid.UUID (migration 202607220900),测试用合法 UUID 字符串。
_ACTOR = ("00000000-0000-0000-0000-000000000001", "张三")
_AUDIT_USER_ID = "00000000-0000-0000-0000-000000000003"


# ===========================================================================
# CRUD
# ===========================================================================


class TestPlanNodeCrud:
    async def test_create_get_update_delete(self, db_session: AsyncSession) -> None:
        svc = PlanService(db_session)
        node = await svc.create_plan_node(
            {"overall_stage": "立项", "project_type": "软件", "no": 1}
        )
        assert node.overall_stage == "立项"

        got = await svc.get_plan_node(node.id)
        assert got.id == node.id

        updated = await svc.update_plan_node(
            node.id, {"overall_stage": "设计", "project_type": "硬件"}
        )
        assert updated.overall_stage == "设计"
        assert updated.project_type == "硬件"

        await svc.delete_plan_node(node.id)
        # 再取应抛 PlanNotFound
        with pytest.raises(PlanNotFound):
            await svc.get_plan_node(node.id)

    async def test_list_paged(self, db_session: AsyncSession) -> None:
        svc = PlanService(db_session)
        for i in range(5):
            await svc.create_plan_node(
                {"overall_stage": f"阶段{i}", "project_type": "软件", "no": i}
            )
        page = await svc.list_plan_nodes(PageReq(page=1, page_size=3))
        assert page.total == 5
        assert len(page.items) == 3
        assert page.page == 1


class TestSubTables:
    async def test_detail_and_module_by_node(self, db_session: AsyncSession) -> None:
        svc = PlanService(db_session)
        node_id = str(uuid.uuid4())
        await svc.create_plan_node_detail(
            {"plan_node_id": node_id, "no": "1", "task_theme": "需求调研"}
        )
        await svc.create_plan_node_detail(
            {"plan_node_id": node_id, "no": "2", "task_theme": "方案设计"}
        )
        await svc.create_module(
            {"plan_node_id": node_id, "module_name": "前端", "plan_workload": "10"}
        )
        details = await svc.list_plan_node_details_by_node(node_id)
        assert len(details) == 2
        modules = await svc.list_modules_by_node(node_id)
        assert len(modules) == 1
        assert modules[0].module_name == "前端"


class TestPsProjectPlan:
    async def test_crud(self, db_session: AsyncSession) -> None:
        svc = PlanService(db_session)
        proj_id = str(uuid.uuid4())
        plan = await svc.create_ps_project_plan(
            {"project_id": proj_id, "project_name": "项目甲", "status": "draft"}
        )
        got = await svc.get_ps_project_plan(plan.id)
        assert got.project_name == "项目甲"
        updated = await svc.update_ps_project_plan(plan.id, {"project_name": "项目乙"})
        assert updated.project_name == "项目乙"
        # 里程碑子表
        node = await svc.create_ps_plan_node(
            {"ps_project_plan_id": str(plan.id), "no": "1", "task_theme": "里程碑1"}
        )
        nodes = await svc.list_ps_plan_nodes_by_plan(str(plan.id))
        assert len(nodes) == 1
        assert nodes[0].id == node.id
        await svc.delete_ps_plan_node(node.id)
        assert await svc.list_ps_plan_nodes_by_plan(str(plan.id)) == []

    async def test_export_rows(self, db_session: AsyncSession) -> None:
        """P2-3:ps_project_plan 导出行 dict。"""
        svc = PlanService(db_session)
        await svc.create_ps_project_plan(
            {
                "project_id": str(uuid.uuid4()),
                "project_name": "导出计划",
                "contract_name": "合同X",
            }
        )
        rows = await svc.list_ps_project_plans_for_export()
        assert any(r["project_name"] == "导出计划" for r in rows)
        assert any(r["contract_name"] == "合同X" for r in rows)


# ===========================================================================
# 状态机流程
# ===========================================================================


async def _create_detail(svc: PlanService, plan_node_id: str | None = None) -> PsPlanNodeDetail:
    return await svc.create_detail(
        {
            "plan_node_id": plan_node_id or str(uuid.uuid4()),
            "no": "1",
            "task_theme": "里程碑明细1",
            "plan_workload": "5",
        }
    )


async def test_list_plan_node_details_for_export(db_session: AsyncSession) -> None:
    """P2-3:里程碑明细导出行(仅非 archived)。"""
    svc = PlanService(db_session)
    await _create_detail(svc)
    rows = await svc.list_plan_node_details_for_export()
    assert any(r["task_theme"] == "里程碑明细1" for r in rows)
    # 全部行都不是 archived
    assert all(r["status"] != "archived" for r in rows)


class TestSaveProcess:
    async def test_full_flow(self, db_session: AsyncSession) -> None:
        svc = PlanService(db_session)
        detail = await _create_detail(svc)
        assert detail.status == PlanNodeDetailStatus.DRAFT.value

        d = await svc.save_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert d.status == PlanNodeDetailStatus.REVIEW.value
        d = await svc.save_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert d.status == PlanNodeDetailStatus.APPROVE.value
        d = await svc.save_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert d.status == PlanNodeDetailStatus.DONE.value

    async def test_done_no_next(self, db_session: AsyncSession) -> None:
        svc = PlanService(db_session)
        detail = await _create_detail(svc)
        for _ in range(3):
            await svc.save_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        with pytest.raises(PlanError):
            await svc.save_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

    async def test_records_audit_approve_user(self, db_session: AsyncSession) -> None:
        svc = PlanService(db_session)
        detail = await _create_detail(svc)
        await svc.save_process(
            detail.id,
            actor_id=_ACTOR[0],
            actor_name=_ACTOR[1],
            next_user_id=_AUDIT_USER_ID,
            next_user_name="审核员",
        )
        got = await svc.get_detail(detail.id)
        assert got.audit_user_id == uuid.UUID(_AUDIT_USER_ID)
        assert got.audit_user_name == "审核员"

    async def test_process_log_inserted_each_step(self, db_session: AsyncSession) -> None:
        svc = PlanService(db_session)
        detail = await _create_detail(svc)
        await svc.save_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        await svc.save_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        procs = await svc.list_processes(str(detail.id))
        assert len(procs) == 2
        assert all(p.business_type == PROCESS_BUSINESS_TYPE for p in procs)
        # node_key 形如 "draft->review"
        assert "->" in (procs[0].node_key or "")


class TestRejectProcess:
    async def test_review_reject(self, db_session: AsyncSession) -> None:
        svc = PlanService(db_session)
        detail = await _create_detail(svc)
        await svc.save_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        d = await svc.reject_process(
            detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1], handle_info="不通过"
        )
        assert d.status == PlanNodeDetailStatus.REJECTED.value

    async def test_reject_then_rework(self, db_session: AsyncSession) -> None:
        svc = PlanService(db_session)
        detail = await _create_detail(svc)
        await svc.save_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        await svc.reject_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        d = await svc.save_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        # rejected -> draft
        assert d.status == PlanNodeDetailStatus.DRAFT.value

    async def test_illegal_reject_on_draft(self, db_session: AsyncSession) -> None:
        svc = PlanService(db_session)
        detail = await _create_detail(svc)  # draft
        with pytest.raises(InvalidTransition):
            await svc.reject_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])


# ===========================================================================
# 变更版本链 (核心验收 D-002@v1)
# ===========================================================================


class TestChangeProcess:
    async def test_change_creates_new_version_and_archives_old(
        self, db_session: AsyncSession
    ) -> None:
        svc = PlanService(db_session)
        old = await _create_detail(svc)
        # 推到完成
        for _ in range(3):
            await svc.save_process(old.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert (await svc.get_detail(old.id)).status == PlanNodeDetailStatus.DONE.value

        # 发起变更
        new = await svc.change_process(
            old.id,
            actor_id=_ACTOR[0],
            actor_name=_ACTOR[1],
            change_reason="需求变更",
            overrides={"task_theme": "里程碑明细1-v2"},
        )

        # 旧版本归档
        old_after = await svc.get_detail(old.id)
        assert old_after.status == PlanNodeDetailStatus.ARCHIVED.value
        # 新版本是 draft,parent_id 指向旧版本,字段已复制 + override 生效
        assert new.status == PlanNodeDetailStatus.DRAFT.value
        assert new.parent_id == old.id
        assert new.task_theme == "里程碑明细1-v2"
        assert new.plan_node_id == old.plan_node_id  # 复制
        assert new.change_reason == "需求变更"

    async def test_change_only_allowed_from_done(self, db_session: AsyncSession) -> None:
        svc = PlanService(db_session)
        detail = await _create_detail(svc)  # draft
        with pytest.raises(PlanError):
            await svc.change_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

    async def test_version_chain(self, db_session: AsyncSession) -> None:
        svc = PlanService(db_session)
        old = await _create_detail(svc)
        for _ in range(3):
            await svc.save_process(old.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        v2 = await svc.change_process(old.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        # 把 v2 也推完成,再变更一次 → v3
        for _ in range(3):
            await svc.save_process(v2.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        v3 = await svc.change_process(v2.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

        chain = await svc.list_versions(v3.id)
        # v3 -> v2 -> old (3 条)
        assert len(chain) == 3
        assert chain[0].id == v3.id
        assert chain[1].id == v2.id
        assert chain[2].id == old.id

    async def test_change_logs_process(self, db_session: AsyncSession) -> None:
        svc = PlanService(db_session)
        old = await _create_detail(svc)
        for _ in range(3):
            await svc.save_process(old.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        new = await svc.change_process(
            old.id,
            actor_id=_ACTOR[0],
            actor_name=_ACTOR[1],
            change_reason="why",
        )
        procs = await svc.list_processes(str(new.id))
        change_procs = [p for p in procs if p.node_key == "change"]
        assert len(change_procs) == 1
        assert change_procs[0].handle_info == "why"


class TestListDetailsExcludesArchived:
    async def test_archived_hidden_from_list(self, db_session: AsyncSession) -> None:
        svc = PlanService(db_session)
        old = await _create_detail(svc)
        node_id = old.plan_node_id
        for _ in range(3):
            await svc.save_process(old.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        new = await svc.change_process(old.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

        rows = await svc.list_details_by_node(node_id)
        ids = {r.id for r in rows}
        assert new.id in ids
        assert old.id not in ids  # 旧版本归档后不再出现在有效明细列表


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
