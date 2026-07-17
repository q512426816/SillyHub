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


class TestHasModuleAndDetailOwnership:
    """has_module 标志 + 明细 module_id 归属校验 (plan-node-module-restructure / D-001/D-004)。

    覆盖验收:
    - has_module 新建默认 false、update 忽略 (不可改)
    - 明细 module_id 归属校验正/反例 (has_module=true/false、跨模板、update 改归属)
    - list_plan_node_details_by_node 按 module_id 过滤 (design §5.2)
    """

    async def test_create_plan_node_has_module_default_false(
        self, db_session: AsyncSession
    ) -> None:
        """service 层建模板不传 has_module → ORM default False (兼容既有调用)。"""
        svc = PlanService(db_session)
        node = await svc.create_plan_node({"overall_stage": "立项", "no": 1})
        assert node.has_module is False

    async def test_update_plan_node_can_change_has_module(self, db_session: AsyncSession) -> None:
        """v3: has_module 编辑时可改 (D-001 取消)。"""
        svc = PlanService(db_session)
        node = await svc.create_plan_node({"overall_stage": "立项", "has_module": False})
        updated = await svc.update_plan_node(node.id, {"has_module": True, "overall_stage": "设计"})
        assert updated.has_module is True  # 已改
        assert updated.overall_stage == "设计"

    async def test_detail_no_module_when_has_module_false(self, db_session: AsyncSession) -> None:
        """无模块模板:明细 module_id=None 通过 (二层,design §5.1)。"""
        svc = PlanService(db_session)
        node = await svc.create_plan_node({"overall_stage": "立项", "has_module": False})
        detail = await svc.create_plan_node_detail(
            {"plan_node_id": str(node.id), "no": "1", "task_theme": "明细1"}
        )
        assert detail.module_id is None

    async def test_detail_with_module_when_has_module_true(self, db_session: AsyncSession) -> None:
        """有模块模板:明细 module_id 挂同模板下模块通过 (三层,D-002)。"""
        svc = PlanService(db_session)
        node = await svc.create_plan_node({"overall_stage": "立项", "has_module": True})
        module = await svc.create_module({"plan_node_id": str(node.id), "module_name": "前端"})
        detail = await svc.create_plan_node_detail(
            {
                "plan_node_id": str(node.id),
                "module_id": str(module.id),
                "no": "1",
                "task_theme": "明细",
            }
        )
        assert detail.module_id == module.id

    async def test_detail_has_module_true_allows_null_module(
        self, db_session: AsyncSession
    ) -> None:
        """v2:has_module 仅记录,不再要求明细必填 module_id —— True 模板 + null 通过。"""
        svc = PlanService(db_session)
        node = await svc.create_plan_node({"overall_stage": "立项", "has_module": True})
        detail = await svc.create_plan_node_detail(
            {"plan_node_id": str(node.id), "no": "1", "task_theme": "明细"}
        )
        assert detail.module_id is None

    async def test_detail_has_module_false_allows_module_id(self, db_session: AsyncSession) -> None:
        """v2:has_module 仅记录,不再禁止挂 module_id —— False 模板 + 属同模板 module_id 通过。"""
        svc = PlanService(db_session)
        node = await svc.create_plan_node({"overall_stage": "立项", "has_module": False})
        module = await svc.create_module({"plan_node_id": str(node.id), "module_name": "前端"})
        detail = await svc.create_plan_node_detail(
            {
                "plan_node_id": str(node.id),
                "module_id": str(module.id),
                "no": "1",
                "task_theme": "明细",
            }
        )
        assert detail.module_id == module.id

    async def test_detail_module_id_not_belonging(self, db_session: AsyncSession) -> None:
        """明细 module_id 必须属于同模板:指向别的模板的模块 → PlanError (400,D-004)。"""
        svc = PlanService(db_session)
        node = await svc.create_plan_node({"overall_stage": "立项", "has_module": True})
        other = await svc.create_plan_node({"overall_stage": "设计", "has_module": True})
        other_module = await svc.create_module(
            {"plan_node_id": str(other.id), "module_name": "别模块"}
        )
        with pytest.raises(PlanError):
            await svc.create_plan_node_detail(
                {
                    "plan_node_id": str(node.id),
                    "module_id": str(other_module.id),
                    "no": "1",
                    "task_theme": "明细",
                }
            )

    async def test_update_detail_changes_module_id(self, db_session: AsyncSession) -> None:
        """update 明细改 module_id 到同模板另一模块 → 通过 (重校验 D-004)。"""
        svc = PlanService(db_session)
        node = await svc.create_plan_node({"overall_stage": "立项", "has_module": True})
        m1 = await svc.create_module({"plan_node_id": str(node.id), "module_name": "前端"})
        m2 = await svc.create_module({"plan_node_id": str(node.id), "module_name": "后端"})
        detail = await svc.create_plan_node_detail(
            {
                "plan_node_id": str(node.id),
                "module_id": str(m1.id),
                "no": "1",
                "task_theme": "明细",
            }
        )
        updated = await svc.update_plan_node_detail(detail.id, {"module_id": str(m2.id)})
        assert updated.module_id == m2.id

    async def test_update_detail_module_id_to_foreign_rejected(
        self, db_session: AsyncSession
    ) -> None:
        """update 明细 module_id 指向别的模板模块 → PlanError (400,D-004)。"""
        svc = PlanService(db_session)
        node = await svc.create_plan_node({"overall_stage": "立项", "has_module": True})
        other = await svc.create_plan_node({"overall_stage": "设计", "has_module": True})
        m1 = await svc.create_module({"plan_node_id": str(node.id), "module_name": "前端"})
        other_module = await svc.create_module(
            {"plan_node_id": str(other.id), "module_name": "别模块"}
        )
        detail = await svc.create_plan_node_detail(
            {
                "plan_node_id": str(node.id),
                "module_id": str(m1.id),
                "no": "1",
                "task_theme": "明细",
            }
        )
        with pytest.raises(PlanError):
            await svc.update_plan_node_detail(detail.id, {"module_id": str(other_module.id)})

    async def test_list_details_filter_by_module_id(self, db_session: AsyncSession) -> None:
        """list_plan_node_details_by_node 加 module_id 过滤 (design §5.2 三层按模块拉)。"""
        svc = PlanService(db_session)
        node = await svc.create_plan_node({"overall_stage": "立项", "has_module": True})
        m1 = await svc.create_module({"plan_node_id": str(node.id), "module_name": "前端"})
        m2 = await svc.create_module({"plan_node_id": str(node.id), "module_name": "后端"})
        await svc.create_plan_node_detail(
            {
                "plan_node_id": str(node.id),
                "module_id": str(m1.id),
                "no": "1",
                "task_theme": "前1",
            }
        )
        await svc.create_plan_node_detail(
            {
                "plan_node_id": str(node.id),
                "module_id": str(m1.id),
                "no": "2",
                "task_theme": "前2",
            }
        )
        await svc.create_plan_node_detail(
            {
                "plan_node_id": str(node.id),
                "module_id": str(m2.id),
                "no": "1",
                "task_theme": "后1",
            }
        )
        # 不过滤 → 全部 3 条
        all_rows = await svc.list_plan_node_details_by_node(str(node.id))
        assert len(all_rows) == 3
        # 按 m1 过滤 → 2 条
        m1_rows = await svc.list_plan_node_details_by_node(str(node.id), str(m1.id))
        assert len(m1_rows) == 2
        assert all(r.module_id == m1.id for r in m1_rows)
        # 按 m2 过滤 → 1 条
        m2_rows = await svc.list_plan_node_details_by_node(str(node.id), str(m2.id))
        assert len(m2_rows) == 1
        assert m2_rows[0].task_theme == "后1"


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

    async def test_create_plan_fills_project_name_from_project(
        self, db_session: AsyncSession
    ) -> None:
        """project_name 为空时按 project_id 关联取项目名(修复新建列表显示 id)。

        依据:create_ps_project_plan 兜底;前端表单无 project_name 字段致提交为空。
        """
        from app.modules.ppm.project.model import PpmProjectMaintenance

        svc = PlanService(db_session)
        proj = PpmProjectMaintenance(
            id=uuid.uuid4(), project_code="PP-FILL-006", project_name="关联项目名"
        )
        db_session.add(proj)
        await db_session.commit()

        # 不传 project_name → 兜底从关联项目取
        plan = await svc.create_ps_project_plan({"project_id": str(proj.id), "status": "draft"})
        assert plan.project_name == "关联项目名"

        # 显式传 project_name 不被覆盖
        plan2 = await svc.create_ps_project_plan(
            {"project_id": str(proj.id), "project_name": "显式名", "status": "draft"}
        )
        assert plan2.project_name == "显式名"

        # project_id 不对应真实项目 → 保持 None,不报错
        plan3 = await svc.create_ps_project_plan(
            {"project_id": str(uuid.uuid4()), "status": "draft"}
        )
        assert plan3.project_name is None

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


class TestDetailsToResp:
    """details_to_resp:派生 execute_user_name / module_name 填充(只读展示用)。

    覆盖 ql-里程碑明细名称展示:只读视图下即便执行人已离场/模块已删,也按
    execute_user_id / module_id 反查出名称,不再裸露 UUID。
    """

    async def test_fills_user_and_module_names(self, db_session: AsyncSession) -> None:
        from app.modules.auth.model import User
        from app.modules.ppm.plan.model import PlanNodeModule

        svc = PlanService(db_session)
        node_id = str(uuid.uuid4())

        user = User(
            id=uuid.uuid4(),
            username="zhang",
            display_name="张执行",
            email="zhang@x.com",
            password_hash="x",
        )
        module = PlanNodeModule(
            id=uuid.uuid4(), plan_node_id=uuid.UUID(node_id), module_name="前端模块"
        )
        db_session.add(user)
        db_session.add(module)
        await db_session.commit()

        detail = await svc.create_detail(
            {
                "plan_node_id": node_id,
                "no": "1",
                "task_theme": "明细A",
                "plan_workload": "5",
                "execute_user_id": str(user.id),
                "module_id": str(module.id),
            }
        )
        resps = await svc.details_to_resp([detail])
        assert len(resps) == 1
        assert resps[0].execute_user_name == "张执行"
        assert resps[0].module_name == "前端模块"

    async def test_missing_module_falls_back_to_id(self, db_session: AsyncSession) -> None:
        """模块被删/跨里程碑:module_id 找不到对应模块 → 兜底展示原 ID。"""
        from app.modules.auth.model import User

        svc = PlanService(db_session)
        user = User(id=uuid.uuid4(), username="li", display_name="李", password_hash="x")
        db_session.add(user)
        await db_session.commit()

        orphan_module_id = str(uuid.uuid4())  # 不存在的模块
        detail = await svc.create_detail(
            {
                "plan_node_id": str(uuid.uuid4()),
                "no": "1",
                "task_theme": "明细B",
                "plan_workload": "1",
                "execute_user_id": str(user.id),
                "module_id": orphan_module_id,
            }
        )
        resps = await svc.details_to_resp([detail])
        assert resps[0].execute_user_name == "李"
        assert resps[0].module_name == orphan_module_id

    async def test_empty_ids_yield_none(self, db_session: AsyncSession) -> None:
        """execute_user_id / module_id 均为空 → name 为 None(不报错)。"""
        svc = PlanService(db_session)
        detail = await _create_detail(svc)
        resps = await svc.details_to_resp([detail])
        assert resps[0].execute_user_name is None
        assert resps[0].module_name is None


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


class TestProjectPlanInitFromTemplate:
    """新建项目计划按模板初始化里程碑 (task-03/04, design §5.2)。"""

    async def test_create_plan_inits_milestones_from_all_templates(
        self, db_session: AsyncSession
    ) -> None:
        """新建项目计划 → 每个模板一个里程碑;无模块含明细(draft),有模块空。"""
        svc = PlanService(db_session)
        tpl_no = await svc.create_plan_node({"overall_stage": "需求", "no": 1, "has_module": False})
        await svc.create_plan_node_detail(
            {"plan_node_id": str(tpl_no.id), "no": "1", "task_theme": "需求调研"}
        )
        tpl_mod = await svc.create_plan_node({"overall_stage": "实施", "no": 2, "has_module": True})
        plan = await svc.create_ps_project_plan(
            {"project_id": str(uuid.uuid4()), "status": "draft"}
        )
        nodes = await svc.list_ps_plan_nodes_by_plan(str(plan.id))
        assert len(nodes) == 2  # 每个模板一个里程碑
        node_no = next(n for n in nodes if n.template_plan_node_id == tpl_no.id)
        assert node_no.has_module is False
        details = await svc.list_details_by_node(str(node_no.id))
        assert len(details) == 1
        assert details[0].task_theme == "需求调研"
        assert details[0].status == "draft"
        assert details[0].module_id is None
        node_mod = next(n for n in nodes if n.template_plan_node_id == tpl_mod.id)
        assert node_mod.has_module is True
        assert await svc.list_details_by_node(str(node_mod.id)) == []

    async def test_milestone_no_str_from_template_int(self, db_session: AsyncSession) -> None:
        """模板 no(int) → PsPlanNode.no(str) 显式转换。"""
        svc = PlanService(db_session)
        await svc.create_plan_node({"overall_stage": "立项", "no": 5, "has_module": False})
        plan = await svc.create_ps_project_plan(
            {"project_id": str(uuid.uuid4()), "status": "draft"}
        )
        nodes = await svc.list_ps_plan_nodes_by_plan(str(plan.id))
        assert nodes[0].no == "5"  # str,不是 int

    async def test_create_module_copies_template_details(self, db_session: AsyncSession) -> None:
        """有模块里程碑新建模块 → 复制模板明细到新模块(draft)。"""
        svc = PlanService(db_session)
        tpl = await svc.create_plan_node({"overall_stage": "实施", "no": 1, "has_module": True})
        await svc.create_plan_node_detail(
            {"plan_node_id": str(tpl.id), "no": "1", "task_theme": "实施明细"}
        )
        plan = await svc.create_ps_project_plan(
            {"project_id": str(uuid.uuid4()), "status": "draft"}
        )
        node = (await svc.list_ps_plan_nodes_by_plan(str(plan.id)))[0]
        module = await svc.create_module({"plan_node_id": str(node.id), "module_name": "前端"})
        details = await svc.list_details_by_node(str(node.id))
        assert len(details) == 1  # 复制了模板明细
        assert details[0].task_theme == "实施明细"
        assert details[0].status == "draft"
        assert details[0].module_id == module.id

    async def test_create_module_manual_node_empty(self, db_session: AsyncSession) -> None:
        """手动里程碑(template_plan_node_id=null)新建模块 → 空模块,不复制。"""
        svc = PlanService(db_session)
        plan = await svc.create_ps_project_plan(
            {"project_id": str(uuid.uuid4()), "status": "draft"}
        )
        # 无模板 → 0 里程碑;手动建一个(template_plan_node_id=null)
        node = await svc.create_ps_plan_node(
            {"ps_project_plan_id": str(plan.id), "overall_stage": "手动", "no": "1"}
        )
        assert node.template_plan_node_id is None
        await svc.create_module({"plan_node_id": str(node.id), "module_name": "手模块"})
        assert await svc.list_details_by_node(str(node.id)) == []  # 不复制


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
