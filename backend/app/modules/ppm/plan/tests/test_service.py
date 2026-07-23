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
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidTransition
from app.modules.auth.model import User
from app.modules.ppm.common.crud import PageReq
from app.modules.ppm.data_scope import DataScope
from app.modules.ppm.plan.fsm import PROCESS_BUSINESS_TYPE, PlanNodeDetailStatus
from app.modules.ppm.plan.model import (
    PsPlanNodeDetail,
    PsProjectPlan,
)
from app.modules.ppm.plan.schema import PsProjectPlanListReq
from app.modules.ppm.plan.service import PlanError, PlanNotFound, PlanService
from app.modules.ppm.project.model import PpmProjectMaintenance

FULL_SCOPE = DataScope(is_full=True)

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
        proj = PpmProjectMaintenance(id=uuid.uuid4(), project_code="PP-CRUD", project_name="项目甲")
        db_session.add(proj)
        await db_session.commit()
        proj_id = str(proj.id)
        plan = await svc.create_ps_project_plan(
            {"project_id": proj_id, "project_name": "项目甲", "status": "draft"}
        )
        got = await svc.get_ps_project_plan(plan.id)
        assert got.project_name == "项目甲"
        # update 需有权限:用超管 (can_operate 放行)。
        admin = User(
            id=uuid.uuid4(),
            username="crud-admin",
            password_hash="x",
            display_name="admin",
            status="active",
            is_platform_admin=True,
        )
        db_session.add(admin)
        await db_session.commit()
        updated = await svc.update_ps_project_plan(plan.id, {"project_name": "项目乙"}, user=admin)
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

    async def test_create_ps_plan_node_copies_template_details_when_stage_matches(
        self, db_session: AsyncSession
    ) -> None:
        """新建里程碑:overall_stage 匹配计划节点模板时,复制模板明细(draft) +
        记 template_plan_node_id/has_module(同新建项目计划 _init_milestones_from_template 逻辑)。"""
        svc = PlanService(db_session)
        proj = PpmProjectMaintenance(id=uuid.uuid4(), project_code="P-TPL", project_name="项目模板")
        db_session.add(proj)
        await db_session.commit()
        # 先建项目计划(此时无模板,不产里程碑),再种子一个独特阶段模板 + 明细。
        plan = await svc.create_ps_project_plan(
            {"project_id": str(proj.id), "project_name": "项目模板", "status": "draft"}
        )
        tpl = await svc.create_plan_node({"overall_stage": "独特阶段XYZ", "has_module": False})
        await svc.create_plan_node_detail(
            {
                "plan_node_id": str(tpl.id),
                "detailed_stage": "子阶段",
                "task_theme": "模板任务",
            }
        )
        # 新建里程碑,overall_stage 匹配模板
        node = await svc.create_ps_plan_node(
            {
                "ps_project_plan_id": str(plan.id),
                "no": "1",
                "overall_stage": "独特阶段XYZ",
            }
        )
        assert node.template_plan_node_id == tpl.id
        assert node.has_module is False
        details = await svc.list_details_by_node(str(node.id))
        assert len(details) == 1
        assert details[0].task_theme == "模板任务"
        assert details[0].status == PlanNodeDetailStatus.DRAFT.value

    async def test_create_ps_plan_node_no_copy_when_stage_not_in_template(
        self, db_session: AsyncSession
    ) -> None:
        """新建里程碑:overall_stage 不匹配任何模板 → 不复制,空里程碑。"""
        svc = PlanService(db_session)
        proj = PpmProjectMaintenance(
            id=uuid.uuid4(), project_code="P-NM", project_name="项目不匹配"
        )
        db_session.add(proj)
        await db_session.commit()
        plan = await svc.create_ps_project_plan({"project_id": str(proj.id), "status": "draft"})
        node = await svc.create_ps_plan_node(
            {
                "ps_project_plan_id": str(plan.id),
                "no": "1",
                "overall_stage": "自定义阶段",
            }
        )
        assert node.template_plan_node_id is None
        assert await svc.list_details_by_node(str(node.id)) == []

    async def test_list_plan_node_details_for_export_filters_by_plan(
        self, db_session: AsyncSession
    ) -> None:
        """导出按 plan_id 过滤:只返回该项目计划下里程碑的明细(ql-20260723-006)。"""
        svc = PlanService(db_session)
        proj = PpmProjectMaintenance(id=uuid.uuid4(), project_code="P-EXP", project_name="项目导出")
        db_session.add(proj)
        await db_session.commit()
        plan_a = await svc.create_ps_project_plan({"project_id": str(proj.id), "status": "draft"})
        plan_b = await svc.create_ps_project_plan({"project_id": str(proj.id), "status": "draft"})
        node_a = await svc.create_ps_plan_node({"ps_project_plan_id": str(plan_a.id), "no": "1"})
        node_b = await svc.create_ps_plan_node({"ps_project_plan_id": str(plan_b.id), "no": "1"})
        await svc.create_detail(
            {"plan_node_id": str(node_a.id), "task_theme": "A的明细", "status": "draft"}
        )
        await svc.create_detail(
            {"plan_node_id": str(node_b.id), "task_theme": "B的明细", "status": "draft"}
        )
        # 不传 plan_id → 全量(2 条)
        all_rows = await svc.list_plan_node_details_for_export()
        assert len(all_rows) == 2
        # 传 plan_a → 只 A 计划的明细(1 条)
        a_rows = await svc.list_plan_node_details_for_export(plan_a.id)
        assert len(a_rows) == 1
        assert a_rows[0]["task_theme"] == "A的明细"

    async def test_create_plan_writes_created_by_from_operator(
        self, db_session: AsyncSession
    ) -> None:
        """operator 写入 created_by (2026-07-21 创建人可见性修复)。

        数据范围 build_plan_scope_clause 的项目经理分支 OR created_by,
        依赖创建时落库 operator;不传 operator 时 created_by 为 None。
        """
        svc = PlanService(db_session)
        operator = uuid.uuid4()
        plan = await svc.create_ps_project_plan(
            {"project_id": str(uuid.uuid4()), "status": "draft"}, operator=operator
        )
        assert plan.created_by == operator

        plan_no_op = await svc.create_ps_project_plan(
            {"project_id": str(uuid.uuid4()), "status": "draft"}
        )
        assert plan_no_op.created_by is None

    async def test_create_plan_fills_project_name_from_project(
        self, db_session: AsyncSession
    ) -> None:
        """project_name 为空时按 project_id 关联取项目名(修复新建列表显示 id)。

        依据:create_ps_project_plan 兜底;前端表单无 project_name 字段致提交为空。
        """
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
        # export 取项目表真名 (W1 join),需先建对应项目行。
        proj = PpmProjectMaintenance(
            id=uuid.uuid4(), project_code="PP-EXP", project_name="导出计划"
        )
        db_session.add(proj)
        await db_session.commit()
        await svc.create_ps_project_plan(
            {
                "project_id": str(proj.id),
                "project_name": "导出计划",
                "contract_name": "合同X",
            }
        )
        rows = await svc.list_ps_project_plans_for_export(FULL_SCOPE)
        assert any(r["project_name"] == "导出计划" for r in rows)
        assert any(r["contract_name"] == "合同X" for r in rows)

    async def test_list_default_sorts_by_created_at_desc(self, db_session: AsyncSession) -> None:
        """前端不传 order_by → 默认 created_at desc (最新创建在前, ql-20260722-001)。

        显式给三条计划递增的 created_at,验证默认拉取顺序为最新在前;避免 apply_sort
        遇空 order_by 跳过排序致列表顺序不可预测。
        """
        svc = PlanService(db_session)
        base = datetime(2026, 1, 1, tzinfo=UTC)
        for i in range(3):
            # list 取项目表真名 (W1 join),每条计划配一个同名项目行。
            proj = PpmProjectMaintenance(
                id=uuid.uuid4(), project_code=f"P{i}", project_name=f"P{i}"
            )
            db_session.add(proj)
            plan = PsProjectPlan(
                id=uuid.uuid4(),
                project_id=proj.id,
                project_name=f"P{i}",
                created_at=base + timedelta(hours=i),  # P0 最早 → P2 最新
            )
            db_session.add(plan)
        await db_session.commit()

        res = await svc.list_ps_project_plans(
            PsProjectPlanListReq(page=1, page_size=20), FULL_SCOPE
        )
        assert res.total == 3
        names = [r.project_name for r in res.items]
        assert names == ["P2", "P1", "P0"]  # created_at desc → 最新在前

    async def test_list_explicit_order_by_not_overridden(self, db_session: AsyncSession) -> None:
        """显式传 order_by → 尊重前端,不被 created_at 兜底覆盖 (ql-20260722-001)。"""
        svc = PlanService(db_session)
        base = datetime(2026, 1, 1, tzinfo=UTC)
        for i, name in enumerate(["Bravo", "Alpha", "Charlie"]):
            # list 排序/取值基于项目表真名 (W1 join),每条计划配一个同名项目行。
            proj = PpmProjectMaintenance(id=uuid.uuid4(), project_code=name, project_name=name)
            db_session.add(proj)
            db_session.add(
                PsProjectPlan(
                    id=uuid.uuid4(),
                    project_id=proj.id,
                    project_name=name,
                    created_at=base + timedelta(hours=i),
                )
            )
        await db_session.commit()

        res = await svc.list_ps_project_plans(
            PsProjectPlanListReq(page=1, page_size=20, order_by="project_name", order="asc"),
            FULL_SCOPE,
        )
        names = [r.project_name for r in res.items]
        assert names == ["Alpha", "Bravo", "Charlie"]  # 按名升序,非 created_at


# Wave 2 join 测试共用基准时间 (排序走 project_name join 字段,created_at 无关)。
_JOIN_BASE_DT = datetime(2026, 1, 1, tzinfo=UTC)


def _add_project_plan(
    db_session: AsyncSession,
    *,
    real_name: str,
    redundant_name: str | None = None,
) -> tuple[PpmProjectMaintenance, PsProjectPlan]:
    """造一对 (项目表真名, 计划冗余名) 并 add(不 commit,调用方负责)。

    供 Wave 2 join 测试 (design D-3 显式 outerjoin 单一可信源):
    real_name(项目表)与 redundant_name(PsProjectPlan 冗余列)可故意不一致,
    验证 list/get/export 取的是项目表真名,非冗余列。
    redundant_name 缺省 = real_name。
    """
    proj = PpmProjectMaintenance(
        id=uuid.uuid4(), project_code=f"C-{real_name}", project_name=real_name
    )
    plan = PsProjectPlan(
        id=uuid.uuid4(),
        project_id=proj.id,
        project_name=redundant_name if redundant_name is not None else real_name,
        created_at=_JOIN_BASE_DT,
    )
    db_session.add(proj)
    db_session.add(plan)
    return proj, plan


class TestProjectNameJoinRealName:
    """Wave 2 单测 (task-06/07/08):list/get/export 的 project_name 取项目表真名。

    依据 design D-3 (显式 outerjoin PpmProjectMaintenance, 单一可信源):
    - task-06:list/get/export 返回项目表真名 (非 PsProjectPlan 冗余列值)。
    - task-07:改 PpmProjectMaintenance.project_name → list 自动反映新名
      (无需同步逻辑,印证 task-05 删改名同步后 join 仍实时一致)。
    - task-08:按 project_name 筛选 / 排序基于 join 字段 (非冗余列)。

    核心手法:把 PsProjectPlan.project_name (冗余) 与项目表真名设成不同值,
    断言返回的是项目表真名。
    """

    async def test_list_returns_real_name_not_redundant(self, db_session: AsyncSession) -> None:
        """task-06:list 返回项目表真名,非 PsProjectPlan 冗余字段。

        冗余列写错值 / None 时,list 仍须返回 join 真名 (非冗余 / 非 null / 非 id)。
        """
        svc = PlanService(db_session)
        proj = PpmProjectMaintenance(id=uuid.uuid4(), project_code="C-真名A", project_name="真名A")
        db_session.add(proj)
        # 两条计划挂同一项目:冗余列分别写错值 / None
        db_session.add(
            PsProjectPlan(
                id=uuid.uuid4(),
                project_id=proj.id,
                project_name="坏冗余A",
                created_at=_JOIN_BASE_DT,
            )
        )
        db_session.add(
            PsProjectPlan(
                id=uuid.uuid4(), project_id=proj.id, project_name=None, created_at=_JOIN_BASE_DT
            )
        )
        await db_session.commit()

        res = await svc.list_ps_project_plans(
            PsProjectPlanListReq(page=1, page_size=20), FULL_SCOPE
        )
        assert len(res.items) == 2
        for item in res.items:
            # join 真名,非冗余错值 / 非 None / 非 project_id uuid
            assert item.project_name == "真名A"

    async def test_get_returns_real_name_not_redundant(self, db_session: AsyncSession) -> None:
        """task-06:get 返回项目表真名,非冗余字段。"""
        svc = PlanService(db_session)
        _proj, plan = _add_project_plan(db_session, real_name="真名B", redundant_name="冗余旧名B")
        await db_session.commit()

        got = await svc.get_ps_project_plan(plan.id)
        assert got.project_name == "真名B"

    async def test_export_returns_real_name_not_redundant(self, db_session: AsyncSession) -> None:
        """task-06:export 返回项目表真名 (task-03 导出列同走 join)。"""
        svc = PlanService(db_session)
        _add_project_plan(db_session, real_name="真名C", redundant_name="冗余旧名C")
        await db_session.commit()

        rows = await svc.list_ps_project_plans_for_export(FULL_SCOPE)
        assert len(rows) == 1
        assert rows[0]["project_name"] == "真名C"

    async def test_rename_project_reflects_in_list(self, db_session: AsyncSession) -> None:
        """task-07:改 PpmProjectMaintenance.project_name → list 返回新名(无需同步)。

        印证 task-05 删改名同步后,join 实时取项目表真名,改名自动反映。
        """
        svc = PlanService(db_session)
        proj, _plan = _add_project_plan(db_session, real_name="改名前", redundant_name="改名前")
        await db_session.commit()

        # 直接改项目表名 (不碰计划,无同步逻辑)
        proj.project_name = "改名后"
        await db_session.commit()

        res = await svc.list_ps_project_plans(
            PsProjectPlanListReq(page=1, page_size=20), FULL_SCOPE
        )
        assert res.items[0].project_name == "改名后"

    async def test_filter_by_project_name_uses_join_field(self, db_session: AsyncSession) -> None:
        """task-08:按 project_name 筛选命中项目表真名 (非冗余列)。

        两条计划冗余名都是"同冗余",真名 Alpha/Beta 不同;筛 Beta 只命中 Beta。
        若筛冗余列则两条都会命中。
        """
        svc = PlanService(db_session)
        _add_project_plan(db_session, real_name="Alpha项目", redundant_name="同冗余")
        _add_project_plan(db_session, real_name="Beta项目", redundant_name="同冗余")
        await db_session.commit()

        res = await svc.list_ps_project_plans(
            PsProjectPlanListReq(page=1, page_size=20, project_name="Beta"), FULL_SCOPE
        )
        assert len(res.items) == 1
        assert res.items[0].project_name == "Beta项目"

    async def test_sort_by_project_name_uses_join_field(self, db_session: AsyncSession) -> None:
        """task-08:按 project_name 排序基于项目表真名 (非冗余列)。

        三条计划冗余名故意乱序 (X3/X1/X2),真名 Charlie/Alpha/Bravo;
        order_by=project_name asc → 按真名升序。
        """
        svc = PlanService(db_session)
        for real, redundant in [("Charlie", "X3"), ("Alpha", "X1"), ("Bravo", "X2")]:
            _add_project_plan(db_session, real_name=real, redundant_name=redundant)
        await db_session.commit()

        res = await svc.list_ps_project_plans(
            PsProjectPlanListReq(page=1, page_size=20, order_by="project_name", order="asc"),
            FULL_SCOPE,
        )
        names = [r.project_name for r in res.items]
        assert names == ["Alpha", "Bravo", "Charlie"]  # 按项目表真名升序,非冗余列


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
        """quick 修复(无审核流程):draft save→done 一步到位。"""
        svc = PlanService(db_session)
        detail = await _create_detail(svc)
        assert detail.status == PlanNodeDetailStatus.DRAFT.value

        d = await svc.save_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert d.status == PlanNodeDetailStatus.DONE.value  # draft→done(无审核)

    async def test_done_no_next(self, db_session: AsyncSession) -> None:
        """done 后再 save 抛 PlanError(无下一态)。"""
        svc = PlanService(db_session)
        detail = await _create_detail(svc)
        await svc.save_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])  # draft→done
        assert (await svc.get_detail(detail.id)).status == PlanNodeDetailStatus.DONE.value
        with pytest.raises(PlanError):
            await svc.save_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

    async def test_done_records_approve_user(self, db_session: AsyncSession) -> None:
        """draft→done 记录 approve_user(完成人)。"""
        svc = PlanService(db_session)
        detail = await _create_detail(svc)
        await svc.save_process(
            detail.id,
            actor_id=_ACTOR[0],
            actor_name=_ACTOR[1],
            next_user_id=_AUDIT_USER_ID,
            next_user_name="完成人",
        )
        got = await svc.get_detail(detail.id)
        assert got.status == PlanNodeDetailStatus.DONE.value
        assert got.approve_user_id == uuid.UUID(_AUDIT_USER_ID)
        assert got.approve_user_name == "完成人"

    async def test_process_log_inserted(self, db_session: AsyncSession) -> None:
        """draft→done 写一行履历。"""
        svc = PlanService(db_session)
        detail = await _create_detail(svc)
        await svc.save_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        procs = await svc.list_processes(str(detail.id))
        assert len(procs) == 1
        assert all(p.business_type == PROCESS_BUSINESS_TYPE for p in procs)
        assert "->" in (procs[0].node_key or "")  # "draft->done"


class TestRejectProcess:
    async def test_review_reject(self, db_session: AsyncSession) -> None:
        """review 明细可驳回(手动建 review;新流程 save draft→done 跳过 review)。"""
        svc = PlanService(db_session)
        detail = await svc.create_detail(
            {"plan_node_id": str(uuid.uuid4()), "no": "1", "task_theme": "d", "status": "review"}
        )
        d = await svc.reject_process(
            detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1], handle_info="不通过"
        )
        assert d.status == PlanNodeDetailStatus.REJECTED.value

    async def test_reject_then_rework(self, db_session: AsyncSession) -> None:
        """review→reject→rework(rejected→draft)。"""
        svc = PlanService(db_session)
        detail = await svc.create_detail(
            {"plan_node_id": str(uuid.uuid4()), "no": "1", "task_theme": "d", "status": "review"}
        )
        await svc.reject_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        d = await svc.save_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert d.status == PlanNodeDetailStatus.DRAFT.value  # rejected → draft

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
        await svc.save_process(old.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        v2 = await svc.change_process(old.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        # 把 v2 也推完成,再变更一次 → v3
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


# service 未暴露模板明细的公开 get,这里直接用 _Crud(PlanNodeDetail).get
# 从库再取一次,校验「清空/未传」是否真正落库 (非仅 update 返回值)。
async def _get_detail_from_db(svc: PlanService, item_id: uuid.UUID):
    from app.modules.ppm.plan.model import PlanNodeDetail
    from app.modules.ppm.plan.service import _Crud

    return await _Crud(svc._session, PlanNodeDetail).get(item_id)


class TestUpdateClearVsKeep:
    """task-05:`_Crud.update` 清空/部分更新语义 (清空→null,未传→不动)。

    覆盖 task-05.md 验收:
    - update 传 ``{field: None}`` → 库中该字段 ``is None`` (清空)。
    - update 不含该字段 (dict 只有别的字段) → 库中该字段保持原值 (未传不动)。

    依据:``_Crud.update`` 逐 key ``setattr`` —— key 在 dict 里才写、
    value 为 None 即写 None (清空);key 缺席则不触碰该字段。
    走 ``update_plan_node_detail`` → ``_Crud(PlanNodeDetail).update``。
    字段选 ``PlanNodeDetail.task_theme`` (``str | None``,可清空)。
    """

    async def test_update_clear_nullable_field_to_none(self, db_session: AsyncSession) -> None:
        """清空:update 传 task_theme=None → 库中 task_theme is None。"""
        svc = PlanService(db_session)
        node_id = str(uuid.uuid4())
        detail = await svc.create_plan_node_detail(
            {"plan_node_id": node_id, "no": "1", "task_theme": "原始主题"}
        )
        assert detail.task_theme == "原始主题"

        updated = await svc.update_plan_node_detail(detail.id, {"task_theme": None})
        assert updated.task_theme is None

        # 再从库取一次,确认持久化 (非仅返回值)
        got = await _get_detail_from_db(svc, detail.id)
        assert got.task_theme is None

    async def test_update_keep_field_when_absent(self, db_session: AsyncSession) -> None:
        """未传:update 不含 task_theme (只改别的字段) → task_theme 保持原值。"""
        svc = PlanService(db_session)
        node_id = str(uuid.uuid4())
        detail = await svc.create_plan_node_detail(
            {"plan_node_id": node_id, "no": "1", "task_theme": "保留主题"}
        )
        assert detail.task_theme == "保留主题"

        # 只改 no,不含 task_theme
        updated = await svc.update_plan_node_detail(detail.id, {"no": "9"})
        assert updated.no == "9"
        assert updated.task_theme == "保留主题"  # 未传 → 不动

        got = await _get_detail_from_db(svc, detail.id)
        assert got.task_theme == "保留主题"


class TestUpdateDetailClearsField:
    """task-06:`PlanService.update_detail` (项目里程碑明细) 清空字段落 null。

    覆盖 task-06.md 验收:
    - update_detail 传 ``{nullable_field: None}`` → 返回值 + 库中该字段 ``is None``。

    依据:``update_detail`` 逐 key ``setattr(obj, k, v)`` 后 refresh ——
    key 在 dict 里且 value 为 None 即写 None (清空落库)。
    字段选普通 nullable 业务字段 ``task_theme`` (``str | None``),
    避开 ``execute_user_id`` / ``duty_user_id`` (它们走 ``_sync_task_fields``
    的 uid 守卫兜底,清空不会落 null 到任务表,无法直接验证 update_detail 本身)。

    与 TestUpdateClearVsKeep 区别:那条测 ``update_plan_node_detail`` (模板明细),
    本类测 ``update_detail`` (项目里程碑明细 PsPlanNodeDetail)。
    """

    async def test_update_detail_clears_nullable_field(self, db_session: AsyncSession) -> None:
        """清空:update_detail 传 task_theme=None → 返回值 + 库中 task_theme is None。"""
        svc = PlanService(db_session)
        detail = await _create_detail(svc)  # task_theme="里程碑明细1"
        assert detail.task_theme == "里程碑明细1"

        updated = await svc.update_detail(detail.id, {"task_theme": None})
        assert updated.task_theme is None

        # 再从库取一次,确认持久化 (非仅返回值)。
        # 注意:_get_detail_from_db helper 查的是模板明细表 PlanNodeDetail,
        # 这里测的是项目里程碑明细 PsPlanNodeDetail (另一张表),直接 session.get。
        from app.modules.ppm.plan.service import _Crud

        got = await _Crud(svc._session, PsPlanNodeDetail).get(detail.id)
        assert got.task_theme is None


class TestListDetailsExcludesArchived:
    async def test_archived_hidden_from_list(self, db_session: AsyncSession) -> None:
        svc = PlanService(db_session)
        old = await _create_detail(svc)
        node_id = old.plan_node_id
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
