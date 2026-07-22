"""plan 子域 service。

职责：
- 模板簇 CRUD (PlanNode / PlanNodeDetail / PlanNodeModule) + 子表明细
- ps 计划簇 CRUD (PsProjectPlan / PsPlanNode / PsPlanNodeDetail)
- 里程碑明细状态机驱动流程：
  - ``save_process``  : 推进到下一合法状态 (草稿→审核→审批→完成)
  - ``reject_process`` : 驳回到 rejected
  - ``change_process`` : 变更 — 新建 parent_id 版本链,旧版本归档 (D-002@v1)
- 每次状态流转写一行 ``PsPlanNodeDetailProcess`` 履历

复用 ``common.crud`` 的分页/排序 helper 与 ``common.fsm.StateMachine``。
平台级,无 workspace 过滤。

设计依据：``tasks/task-04.md`` service.py 段 + ``design.md`` §8。
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

import anyio
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.expression import asc, desc

from app.core.errors import AppError, PermissionDenied
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.ppm.common.crud import (
    Page,
    PageReq,
    SortOrder,
    apply_pagination,
    apply_sort,
    count_total,
)
from app.modules.ppm.common.fsm import StateMachine
from app.modules.ppm.data_scope import DataScope, build_plan_scope_clause
from app.modules.ppm.plan.fsm import (
    PROCESS_BUSINESS_TYPE,
    TRANSITIONS,
    PlanNodeDetailStatus,
)
from app.modules.ppm.plan.importer import ParsedRow, ParsedSheet, parse_workbook
from app.modules.ppm.plan.model import (
    PlanNode,
    PlanNodeDetail,
    PlanNodeModule,
    PsPlanNode,
    PsPlanNodeDetail,
    PsPlanNodeDetailProcess,
    PsProjectPlan,
)
from app.modules.ppm.plan.schema import (
    ImportCommitReq,
    ImportPreviewResp,
    ImportPreviewRow,
    ImportPreviewSheet,
    ImportResultResp,
    PlanTaskSimple,
    ProjectPlanThreeLevelResp,
    PsPlanNodeDetailResp,
    PsPlanNodeDetailWithTasks,
    PsPlanNodeWithDetail,
    PsProjectPlanListReq,
)
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.ppm.task.model import PlanTask

log = get_logger(__name__)


class PlanError(AppError):
    """plan 子域通用业务错误。"""

    code = "PPM_PLAN_ERROR"
    http_status = 400


class PlanNotFound(AppError):
    """plan 子域资源不存在 (404)。"""

    code = "HTTP_404_PPM_PLAN_NOT_FOUND"
    http_status = 404


def _now() -> datetime:
    return datetime.now(UTC)


def _to_decimal(value: str | None) -> Decimal | None:
    """字符串安全转 Decimal,null / 空串 / 非数值 → None。

    成本字段源为 String (前端直传),计算 remaining 时统一 Decimal 解析,
    失败返回 None (不抛异常,见 task-03 边界 6)。
    """
    if value is None or str(value).strip() == "":
        return None
    try:
        return Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        return None


def _derive_remaining(budget: str | None, actual: str | None) -> str | None:
    """计算 remaining = budget − actual (D-014@v1)。

    - 任一操作数为 null / 非数值 → None (不 clamp 0)
    - 允许负值 (超支),如实反映
    - 结果规整:去掉无意义尾零,保留 Decimal 语义
    """
    b = _to_decimal(budget)
    a = _to_decimal(actual)
    if b is None or a is None:
        return None
    r = b - a
    # 整数结果去掉尾零 (Decimal("70.00") → "70",Decimal("70") → "70")。
    # 注意 normalize() 会把 "70" 变 "7E+1",故用 format 规整:
    # - 若结果为整数,scale 取 0
    # - 否则保留原 Decimal 精度
    if r == r.to_integral_value():
        return format(r.to_integral_value(), "f")
    return format(r, "f")


def _date_to_datetime(value: date | None) -> datetime | None:
    """把导入解析得到的 ``date`` 转成 ``datetime`` (当日 00:00:00, UTC)。

    导入 DTO ``ImportPreviewRow.plan_begin_time`` / ``plan_complete_time`` 为
    ``datetime | None`` (对齐 ORM ``DateTime(timezone=True)``);importer 产出
    的是 ``date`` (R-08 Excel 日期),这里统一补全为带 UTC tz 的 datetime。
    """
    if value is None:
        return None
    return datetime.combine(value, time.min, tzinfo=UTC)


# ===========================================================================
# 通用 CRUD 工厂
# ===========================================================================


class _Crud[T]:
    """泛型 CRUD helper — 封装 create/get/list(paged)/update/delete。

    子域 7 张表字段差异大,但 CRUD 形状一致,抽出复用以减少重复
    (design.md §4 半批量判断)。平台级,无 workspace 过滤。
    """

    def __init__(self, session: AsyncSession, model: type[T]) -> None:
        self._session = session
        self._model = model

    async def get(self, item_id: uuid.UUID) -> T:
        obj = await self._session.get(self._model, item_id)
        if obj is None:
            raise PlanNotFound(f"{self._model.__name__} '{item_id}' 不存在")
        return obj

    async def create(self, data: dict[str, Any]) -> T:
        obj = self._model(id=uuid.uuid4(), **data)
        obj = self._set_created_updated(obj)
        self._session.add(obj)
        await self._session.commit()
        await self._session.refresh(obj)
        return obj

    async def update(self, item_id: uuid.UUID, data: dict[str, Any]) -> T:
        obj = await self.get(item_id)
        for k, v in data.items():
            setattr(obj, k, v)
        obj = self._touch_updated(obj)
        await self._session.commit()
        await self._session.refresh(obj)
        return obj

    async def delete(self, item_id: uuid.UUID) -> None:
        obj = await self.get(item_id)
        await self._session.delete(obj)
        await self._session.commit()

    async def list_paged(
        self,
        *,
        where_clauses: list[Any] | None = None,
        req: PageReq,
        allowed_sort: set[str],
    ) -> Page[T]:
        stmt: Select[Any] = select(self._model)
        for clause in where_clauses or []:
            stmt = stmt.where(clause)
        total = await count_total(self._session, stmt)
        stmt = apply_sort(
            stmt,
            self._model,
            req.order_by,
            allowed_sort,
            req.order,
        )
        stmt = apply_pagination(stmt, req)
        rows = (await self._session.execute(stmt)).scalars().all()
        return Page[Any].build(items=list(rows), total=total, req=req)

    # ---------- audit touch ----------
    def _set_created_updated(self, obj: T) -> T:
        now = _now()
        if hasattr(obj, "created_at"):
            obj.created_at = now
        if hasattr(obj, "updated_at"):
            obj.updated_at = now
        return obj

    def _touch_updated(self, obj: T) -> T:
        if hasattr(obj, "updated_at"):
            obj.updated_at = _now()
        return obj


# ===========================================================================
# service
# ===========================================================================


class PlanService:
    """plan 子域统一 service 入口 (模板簇 + ps 计划簇 + 流程)。"""

    # 主流程状态推进的「下一态」映射 (saveProcess 用)。
    # 不直接拿 TRANSITIONS 的 next_states,因为有的状态有多个出口
    # (review/approve 都可驳回),主流程只取「往前走」那一条;
    # rejected 走返工回 draft (驳回后重新提交)。
    _FORWARD_NEXT: dict[PlanNodeDetailStatus, PlanNodeDetailStatus] = {
        PlanNodeDetailStatus.DRAFT: PlanNodeDetailStatus.DONE,
        PlanNodeDetailStatus.REVIEW: PlanNodeDetailStatus.APPROVE,
        PlanNodeDetailStatus.APPROVE: PlanNodeDetailStatus.DONE,
        PlanNodeDetailStatus.REJECTED: PlanNodeDetailStatus.DRAFT,
    }

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ---------- 模板簇 CRUD ----------
    async def list_plan_nodes(self, req: PageReq) -> Page[PlanNode]:
        return await _Crud(self._session, PlanNode).list_paged(
            req=req,
            allowed_sort={"no", "overall_stage", "created_at"},
        )

    async def create_plan_node(self, data: dict[str, Any]) -> PlanNode:
        return await _Crud(self._session, PlanNode).create(data)

    async def get_plan_node(self, item_id: uuid.UUID) -> PlanNode:
        return await _Crud(self._session, PlanNode).get(item_id)

    async def update_plan_node(self, item_id: uuid.UUID, data: dict[str, Any]) -> PlanNode:
        # v3: has_module 编辑时可改 (D-001 取消),正常透传更新。
        return await _Crud(self._session, PlanNode).update(item_id, data)

    async def delete_plan_node(self, item_id: uuid.UUID) -> None:
        await _Crud(self._session, PlanNode).delete(item_id)

    # ---------- 模板明细 (子表,按 plan_node_id 列表) ----------
    async def list_plan_node_details_by_node(
        self, plan_node_id: str, module_id: str | None = None
    ) -> list[PlanNodeDetail]:
        """列出某模板下的明细 (design §5.2)。

        - ``module_id`` 为 None → 返回该模板下全部明细 (无模块模板用此;
          因无模块模板明细 module_id 全为 null,等价于返回 module_id 为 null 的)。
        - ``module_id`` 指定 → 仅返回挂该模块的明细 (有模块模板按模块拉,D-002 三层)。
        """
        stmt = (
            select(PlanNodeDetail)
            .where(PlanNodeDetail.plan_node_id == self._safe_uuid(plan_node_id))
            .order_by(PlanNodeDetail.no)
        )
        if module_id is not None:
            stmt = stmt.where(PlanNodeDetail.module_id == self._safe_uuid(module_id))
        return list((await self._session.execute(stmt)).scalars().all())

    async def create_plan_node_detail(self, data: dict[str, Any]) -> PlanNodeDetail:
        # 归属校验 (D-004):module_id 必须与模板 has_module 一致。
        await self._validate_detail_module(
            self._safe_uuid(data.get("plan_node_id")),
            self._safe_uuid(data.get("module_id")),
        )
        return await _Crud(self._session, PlanNodeDetail).create(data)

    async def update_plan_node_detail(
        self, item_id: uuid.UUID, data: dict[str, Any]
    ) -> PlanNodeDetail:
        # 归属校验 (D-004):plan_node_id 从现有明细读 (update body 无此字段),
        # module_id 取「data 指定 (exclude_unset 语义) 否则保持现有」的最终值校验。
        existing = await _Crud(self._session, PlanNodeDetail).get(item_id)
        final_module_id = data.get("module_id", existing.module_id)
        await self._validate_detail_module(
            existing.plan_node_id,
            self._safe_uuid(final_module_id),
        )
        return await _Crud(self._session, PlanNodeDetail).update(item_id, data)

    async def delete_plan_node_detail(self, item_id: uuid.UUID) -> None:
        await _Crud(self._session, PlanNodeDetail).delete(item_id)

    async def _validate_detail_module(
        self, plan_node_id: uuid.UUID | None, module_id: uuid.UUID | None
    ) -> None:
        """校验明细 module_id 归属 (v2: has_module 仅记录,不参与校验,design §13)。

        v2 简化 (has_module 从「驱动展开」降为「纯记录」后):
        - module_id 为 null: 一律放行 (UI 统一二层,明细挂 plan_node_id)。
        - module_id 非 null: 必须属于同一 plan_node 下的 PlanNodeModule (防脏数据)。

        违例抛 ``PlanError`` (400)。
        """
        if module_id is None:
            return  # v2: UI 统一二层,module_id 一律允许为 null
        if plan_node_id is None:
            raise PlanError(
                "明细未指定模板(plan_node_id),不能挂模块(module_id)",
                details={"module_id": str(module_id)},
            )
        # module_id 非 null: 校验归属 (防脏数据;has_module 不参与判定)
        belongs = await self._session.scalar(
            select(PlanNodeModule.id).where(
                PlanNodeModule.id == module_id,
                PlanNodeModule.plan_node_id == plan_node_id,
            )
        )
        if belongs is None:
            raise PlanError(
                f"module_id '{module_id}' 不属于模板 '{plan_node_id}'",
                details={"module_id": str(module_id), "plan_node_id": str(plan_node_id)},
            )

    # ---------- 模块 (子表,按 plan_node_id 列表) ----------
    async def list_modules_by_node(self, plan_node_id: str) -> list[PlanNodeModule]:
        stmt = (
            select(PlanNodeModule)
            .where(PlanNodeModule.plan_node_id == self._safe_uuid(plan_node_id))
            .order_by(PlanNodeModule.created_at)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def list_modules_by_project(self, project_id: uuid.UUID) -> list[PlanNodeModule]:
        """按项目列出其下所有模块 (problem 表单下拉用)。

        反查链: project → ppm_ps_project_plan.project_id →
        ppm_ps_plan_node.ps_project_plan_id →
        ppm_plan_node_module.plan_node_id。同一模块可能挂在多个里程碑下,
        按 id 去重,按 module_name 升序 (None 排最后)。
        """
        stmt = (
            select(PlanNodeModule)
            .join(PsPlanNode, PsPlanNode.id == PlanNodeModule.plan_node_id)
            .join(PsProjectPlan, PsProjectPlan.id == PsPlanNode.ps_project_plan_id)
            .where(PsProjectPlan.project_id == project_id)
            .distinct()
            .order_by(PlanNodeModule.module_name.asc())
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def create_module(self, data: dict[str, Any]) -> PlanNodeModule:
        # task-04:建模块 + 同事务复制模板明细到新模块 (design §5.2)
        # 不复用 _Crud.create (单独 commit 破坏原子性),改 session.add + 末尾单 commit。
        module = PlanNodeModule(id=uuid.uuid4(), **data)
        module.created_at = _now()
        module.updated_at = _now()
        self._session.add(module)
        # 反查挂的 PsPlanNode.template_plan_node_id → 复制模板明细 (draft)
        node_id = self._safe_uuid(data.get("plan_node_id"))
        if node_id is not None:
            node = await self._session.get(PsPlanNode, node_id)
            if node is not None and node.template_plan_node_id is not None:
                await self._copy_template_details_to_node(
                    node.template_plan_node_id, node, module_id=module.id
                )
        await self._session.commit()
        await self._session.refresh(module)
        return module

    async def update_module(self, item_id: uuid.UUID, data: dict[str, Any]) -> PlanNodeModule:
        return await _Crud(self._session, PlanNodeModule).update(item_id, data)

    async def delete_module(self, item_id: uuid.UUID) -> None:
        await _Crud(self._session, PlanNodeModule).delete(item_id)

    # ---------- ps 项目计划 CRUD ----------
    async def list_ps_project_plans(
        self, req: PsProjectPlanListReq, scope: DataScope
    ) -> Page[PsProjectPlan]:
        # project_name 改 outerjoin ppm_project_maintenance 取真名 (design D-3):
        # 不再用 PsProjectPlan 冗余字段 (易写坏),单一可信源 = 项目表。
        # 自写 query (不再走 _Crud.list_paged),分页/排序/计数复用 common helper。
        real_name = PpmProjectMaintenance.project_name
        stmt: Select[Any] = select(PsProjectPlan, real_name.label("real_project_name")).outerjoin(
            PpmProjectMaintenance, PsProjectPlan.project_id == PpmProjectMaintenance.id
        )
        # 过滤条件:字符串字段 ilike 模糊匹配,时间字段闭区间 [start, end_next_day)。
        # 前端传 YYYY-MM-DD → datetime 是 00:00:00;end 加 1 天用 < 比较保证含当日。
        # 注意:project_name 筛选走 join 真名 (task-04),其余字段仍按 PsProjectPlan。
        if req.project_name:
            stmt = stmt.where(real_name.ilike(f"%{req.project_name}%"))
        if req.contract_name:
            stmt = stmt.where(PsProjectPlan.contract_name.ilike(f"%{req.contract_name}%"))
        if req.company_name:
            stmt = stmt.where(PsProjectPlan.company_name.ilike(f"%{req.company_name}%"))
        if req.contract_sign_time_start:
            stmt = stmt.where(PsProjectPlan.contract_sign_time >= req.contract_sign_time_start)
        if req.contract_sign_time_end:
            stmt = stmt.where(
                PsProjectPlan.contract_sign_time < req.contract_sign_time_end + timedelta(days=1)
            )
        if req.project_start_time_start:
            stmt = stmt.where(PsProjectPlan.project_start_time >= req.project_start_time_start)
        if req.project_start_time_end:
            stmt = stmt.where(
                PsProjectPlan.project_start_time < req.project_start_time_end + timedelta(days=1)
            )
        if req.project_plan_end_time_start:
            stmt = stmt.where(
                PsProjectPlan.project_plan_end_time >= req.project_plan_end_time_start
            )
        if req.project_plan_end_time_end:
            stmt = stmt.where(
                PsProjectPlan.project_plan_end_time
                < req.project_plan_end_time_end + timedelta(days=1)
            )
        # 数据范围过滤 (2026-07-18-project-plan-data-scope D-006@v1)
        plan_scope = build_plan_scope_clause(scope)
        if plan_scope is not None:
            stmt = stmt.where(plan_scope)
        # 默认按创建时间倒序 (最新创建在前,ql-20260722-001):前端 /ppm/project-plans
        # 列表不传 order_by 时兜底,避免 apply_sort 遇空 order_by 直接跳过排序致
        # 列表顺序不可预测。前端显式传 order_by (project_name/status 等) 仍优先尊重。
        if not req.order_by:
            req.order_by = "created_at"
        # 计数:count_total 用 subquery 包裹,兼容 outerjoin。
        total = await count_total(self._session, stmt)
        # 排序:project_name → join 字段 (task-04),其余 (created_at/status) 仍按
        # PsProjectPlan。apply_sort 的 column_map 把业务字段名 project_name 映射到
        # PpmProjectMaintenance 上的真实列;但 apply_sort 只接受单一 model 取列,
        # 故对 project_name 单独 order_by,其余字段仍走 apply_sort(PsProjectPlan)。
        if req.order_by == "project_name":
            direction = asc if SortOrder.normalize(req.order) == SortOrder.ASC else desc
            stmt = stmt.order_by(direction(real_name))
        else:
            stmt = apply_sort(
                stmt,
                PsProjectPlan,
                req.order_by,
                {"created_at", "status"},
                req.order,
            )
        stmt = apply_pagination(stmt, req)
        result = (await self._session.execute(stmt)).all()
        # 每行 (PsProjectPlan, real_project_name):用真名覆盖 ORM 实例的冗余字段值,
        # 使后续 router 的 PsProjectPlanResp.model_validate 直接取到真名。
        # project_name 是 PsProjectPlan 已声明字段,setattr 合法 (区别于未声明字段)。
        items: list[PsProjectPlan] = []
        for plan_obj, real_project_name in result:
            plan_obj.project_name = real_project_name
            items.append(plan_obj)
        return Page[Any].build(items=items, total=total, req=req)

    async def create_ps_project_plan(
        self, data: dict[str, Any], *, operator: uuid.UUID | None = None
    ) -> PsProjectPlan:
        # project_name 兜底:前端表单无 project_name 字段、onProjectChange 回填值
        # 未可靠进入提交体(实测新建记录 project_name=None)。此处按 project_id
        # 关联取项目名,作为单一可信源,避免列表回退显示 id。
        if not data.get("project_name") and data.get("project_id"):
            proj_id = self._safe_uuid(str(data["project_id"]))
            if proj_id is not None:
                proj = await self._session.get(PpmProjectMaintenance, proj_id)
                if proj and proj.project_name:
                    data["project_name"] = proj.project_name
        # project_manager_name 兜底:前端隐藏字段靠下拉 options 反查回填,偶发漏传
        # (选了经理只带 id 不带 name)致落库为空、列表裸露 UUID。有 id 但 name 为空时
        # 按 id 反查 users.display_name 补上;显式传的 name 不覆盖。
        if not (data.get("project_manager_name") or "").strip() and data.get("project_manager_id"):
            looked_up = await self._lookup_user_display_name(data["project_manager_id"])
            if looked_up:
                data["project_manager_name"] = looked_up
        # task-03:建主表 + 同事务按模板批量建里程碑 (design §5.2)
        # 不复用 _Crud.create (单独 commit 破坏原子性),改 session.add + 末尾单 commit。
        plan = PsProjectPlan(id=uuid.uuid4(), **data)
        # 创建人写入 created_by (2026-07-21 项目计划创建人可见性修复)。
        # data 由 router 提供,不含 created_by;此处显式赋值,保证数据范围
        # build_plan_scope_clause 的创建人可见性 (OR created_by == pm_user_id) 生效。
        plan.created_by = operator
        plan.created_at = _now()
        plan.updated_at = _now()
        self._session.add(plan)
        await self._init_milestones_from_template(plan)
        await self._session.commit()
        await self._session.refresh(plan)
        return plan

    async def _init_milestones_from_template(self, plan: PsProjectPlan) -> None:
        """按所有 PlanNode 模板批量建里程碑 (task-03, design §5.2)。

        - has_module=false: 建里程碑 + 复制模板明细 (status=draft, module_id=null)
        - has_module=true: 只建空里程碑 (明细等新建模块时复制, task-04)
        - 无模板: 不建里程碑 (plan 照建, R-04)
        模板 PlanNode.no(int) → PsPlanNode.no(str) 显式 str()。
        """
        templates = list(
            (await self._session.execute(select(PlanNode).order_by(PlanNode.no.asc())))
            .scalars()
            .all()
        )
        for tpl in templates:
            node = PsPlanNode(
                id=uuid.uuid4(),
                ps_project_plan_id=plan.id,
                overall_stage=tpl.overall_stage,
                no=str(tpl.no) if tpl.no is not None else None,
                template_plan_node_id=tpl.id,
                has_module=tpl.has_module,
                status=PlanNodeDetailStatus.DRAFT.value,
                created_at=_now(),
                updated_at=_now(),
            )
            self._session.add(node)
            if not tpl.has_module:
                # has_module=false: 复制模板明细 (draft, module_id=null)
                await self._copy_template_details_to_node(tpl.id, node, module_id=None)

    async def _copy_template_details_to_node(
        self,
        template_plan_node_id: uuid.UUID,
        node: PsPlanNode,
        *,
        module_id: uuid.UUID | None,
    ) -> None:
        """复制模板 PlanNodeDetail → PsPlanNodeDetail (挂 node, module_id, status=draft)。

        task-03 (module_id=None) / task-04 (module_id=新模块) 共用。
        """
        details = list(
            (
                await self._session.execute(
                    select(PlanNodeDetail).where(
                        PlanNodeDetail.plan_node_id == template_plan_node_id
                    )
                )
            )
            .scalars()
            .all()
        )
        for d in details:
            self._session.add(
                PsPlanNodeDetail(
                    id=uuid.uuid4(),
                    plan_node_id=node.id,
                    module_id=module_id,
                    detailed_stage=d.detailed_stage,
                    task_theme=d.task_theme,
                    task_description=d.task_description,
                    requirements=d.requirements,
                    role_name=d.role_name,
                    achievement=d.achievement,
                    overall_stage=d.overall_stage,
                    no=d.no,
                    status=PlanNodeDetailStatus.DRAFT.value,
                    created_at=_now(),
                    updated_at=_now(),
                )
            )

    async def get_ps_project_plan(self, item_id: uuid.UUID) -> PsProjectPlan:
        # project_name 改 outerjoin ppm_project_maintenance 取真名 (design D-3):
        # 不再用 PsProjectPlan 冗余字段。不存在则 PlanNotFound (沿用 _Crud.get 语义)。
        real_name = PpmProjectMaintenance.project_name
        stmt = (
            select(PsProjectPlan, real_name.label("real_project_name"))
            .outerjoin(PpmProjectMaintenance, PsProjectPlan.project_id == PpmProjectMaintenance.id)
            .where(PsProjectPlan.id == item_id)
        )
        row = (await self._session.execute(stmt)).first()
        if row is None:
            raise PlanNotFound(f"PsProjectPlan '{item_id}' 不存在")
        plan_obj, real_project_name = row
        # 用真名覆盖冗余字段,使 router 的 model_validate 取到真名 (task-02)。
        plan_obj.project_name = real_project_name
        return plan_obj

    async def update_ps_project_plan(
        self, item_id: uuid.UUID, data: dict[str, Any]
    ) -> PsProjectPlan:
        # project_manager_name 兜底 (同 create):_Crud.update 跳过 None 值,前端切换
        # 经理漏传 name 时旧 name 会残留。有效经理 id 优先取 data 里的新 id (切换场景),
        # 缺省 (未传/exclude_unset 剔除) 回退 DB 现值;name 为空时按其反查 display_name。
        if not (data.get("project_manager_name") or "").strip():
            manager_id = data.get("project_manager_id")
            if manager_id is None:
                current = await _Crud(self._session, PsProjectPlan).get(item_id)
                manager_id = current.project_manager_id
            if manager_id:
                looked_up = await self._lookup_user_display_name(manager_id)
                if looked_up:
                    data["project_manager_name"] = looked_up
        return await _Crud(self._session, PsProjectPlan).update(item_id, data)

    async def delete_ps_project_plan(self, item_id: uuid.UUID) -> None:
        await _Crud(self._session, PsProjectPlan).delete(item_id)

    # ---------- 里程碑 (ps_plan_node) CRUD ----------
    async def list_ps_plan_nodes_by_plan(self, ps_project_plan_id: str) -> list[PsPlanNode]:
        stmt = (
            select(PsPlanNode)
            .where(PsPlanNode.ps_project_plan_id == self._safe_uuid(ps_project_plan_id))
            .order_by(PsPlanNode.no)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def create_ps_plan_node(self, data: dict[str, Any]) -> PsPlanNode:
        return await _Crud(self._session, PsPlanNode).create(data)

    async def get_ps_plan_node(self, item_id: uuid.UUID) -> PsPlanNode:
        return await _Crud(self._session, PsPlanNode).get(item_id)

    async def update_ps_plan_node(self, item_id: uuid.UUID, data: dict[str, Any]) -> PsPlanNode:
        return await _Crud(self._session, PsPlanNode).update(item_id, data)

    async def delete_ps_plan_node(self, item_id: uuid.UUID) -> None:
        await _Crud(self._session, PsPlanNode).delete(item_id)

    # ---------- 里程碑明细 (核心表) CRUD ----------
    async def list_details_by_node(self, plan_node_id: str) -> list[PsPlanNodeDetail]:
        """列出某里程碑下「最新有效」的明细版本 (排除 archived 旧版本)。"""
        stmt = (
            select(PsPlanNodeDetail)
            .where(
                PsPlanNodeDetail.plan_node_id == self._safe_uuid(plan_node_id),
                PsPlanNodeDetail.status != PlanNodeDetailStatus.ARCHIVED.value,
            )
            .order_by(PsPlanNodeDetail.no)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def get_detail(self, item_id: uuid.UUID) -> PsPlanNodeDetail:
        return await _Crud(self._session, PsPlanNodeDetail).get(item_id)

    async def _collect_detail_name_maps(
        self, details: list[PsPlanNodeDetail]
    ) -> tuple[dict[uuid.UUID, str], dict[uuid.UUID, str]]:
        """批量查 execute_user_id→name / module_id→name 映射(派生,不落库)。

        返回 (user_map, module_map)。name 经 auth.users / plan_node_module
        批量 IN 查询,避免 N+1;User 取 display_name→email→username→id 兜底
        (对齐前端 USER_ADAPTER 展示顺序)。
        """
        user_ids = {d.execute_user_id for d in details if d.execute_user_id}
        module_ids = {d.module_id for d in details if d.module_id}

        user_map: dict[uuid.UUID, str] = {}
        if user_ids:
            user_rows = (
                await self._session.execute(
                    select(User.id, User.display_name, User.email, User.username).where(
                        User.id.in_(user_ids)
                    )
                )
            ).all()
            for r in user_rows:
                user_map[r.id] = r.display_name or r.email or r.username or str(r.id)

        module_map: dict[uuid.UUID, str] = {}
        if module_ids:
            module_rows = (
                await self._session.execute(
                    select(PlanNodeModule.id, PlanNodeModule.module_name).where(
                        PlanNodeModule.id.in_(module_ids)
                    )
                )
            ).all()
            for r in module_rows:
                module_map[r.id] = r.module_name or str(r.id)

        return user_map, module_map

    async def details_to_resp(self, details: list[PsPlanNodeDetail]) -> list[PsPlanNodeDetailResp]:
        """ORM 明细 → ``PsPlanNodeDetailResp``,并填充派生 execute_user_name /
        module_name(不落库)。

        name 在 Resp 实例上 setattr(Resp 声明了这两个字段,合法),确保只读
        视图展示名称而非裸 UUID——即便执行人已不在项目成员表、模块已被删除
        或属于其它里程碑,仍可解析出名字(对齐 audit_user_name/approve_user_name
        的展示语义)。注意:不可 setattr 到 ORM 实例(SQLModel/Pydantic v2 拒绝
        未声明字段赋值),故必须在 model_validate 之后作用于 Resp。
        """
        user_map, module_map = await self._collect_detail_name_maps(details)
        resps = [PsPlanNodeDetailResp.model_validate(d) for d in details]
        for d, resp in zip(details, resps, strict=True):
            # 有 id:优先反查名;记录被物理删除查不到时兜底原 ID(至少不空),
            # 避免只读视图展示 None 造成「未填写」误解。无 id:None。
            resp.execute_user_name = (
                (user_map.get(d.execute_user_id) or str(d.execute_user_id))
                if d.execute_user_id
                else None
            )
            resp.module_name = (
                module_map.get(d.module_id) or str(d.module_id) if d.module_id else None
            )
        return resps

    async def create_detail(self, data: dict[str, Any]) -> PsPlanNodeDetail:
        # 重构为原子事务 (不走 _Crud.create 的单独 commit)，status=done 时
        # 同事务触发 _ensure_task_for_detail 建任务 (FR-01, ql-里程碑明细自动建任务)。
        status = data.setdefault("status", PlanNodeDetailStatus.DRAFT.value)
        obj = PsPlanNodeDetail(id=uuid.uuid4(), **data)
        obj.created_at = _now()
        obj.updated_at = _now()
        self._session.add(obj)
        if status == PlanNodeDetailStatus.DONE.value:
            await self._ensure_task_for_detail(obj)
        await self._session.commit()
        await self._session.refresh(obj)
        return obj

    async def update_detail(self, item_id: uuid.UUID, data: dict[str, Any]) -> PsPlanNodeDetail:
        # 重构为原子事务：更新明细字段 + 同事务同步关联任务字段 (FR-03, D-007)。
        obj = await self.get_detail(item_id)
        for k, v in data.items():
            setattr(obj, k, v)
        obj.updated_at = _now()
        await self._sync_task_fields(obj)
        await self._session.commit()
        await self._session.refresh(obj)
        return obj

    async def delete_detail(self, item_id: uuid.UUID) -> None:
        # 重构为原子事务：先解关联任务 (ps_plan_node_detail_id 置 null, 任务保留)
        # 再删明细 (FR-05, D-004)。
        obj = await self.get_detail(item_id)
        await self._unlink_task(item_id)
        await self._session.delete(obj)
        await self._session.commit()

    # ---------- 版本链查询 ----------
    async def list_versions(self, item_id: uuid.UUID) -> list[PsPlanNodeDetail]:
        """返回一条明细的完整版本链 (自身 + 所有 parent 祖先)。"""
        chain: list[PsPlanNodeDetail] = []
        current = await self.get_detail(item_id)
        chain.append(current)
        visited: set[uuid.UUID] = {current.id}
        while current.parent_id is not None and current.parent_id not in visited:
            parent = await self._session.get(PsPlanNodeDetail, current.parent_id)
            if parent is None:
                break
            chain.append(parent)
            visited.add(parent.id)
            current = parent
        return chain

    # ---------- 三联表查询 (task-03) ----------
    async def get_project_plan_three_level(
        self, plan_id: uuid.UUID, scope: DataScope
    ) -> ProjectPlanThreeLevelResp:
        """三联表查询 + 成本派生注入 (task-03 / D-014@v1)。

        4 层嵌套: ``PsProjectPlan → PsPlanNode → PsPlanNodeDetail → PlanTask``。
        N+1 友好:批量取 nodes / details / tasks,内存组装。

        - 明细层排除 status='archived' (复用 list_details_by_node 过滤,边界 8)
        - 任务经 ``ps_plan_node_detail_id`` 软关联;孤儿任务不挂载 (边界 4)
        - plan 上 remaining_available_person_days / remaining_cost 为
          service 层派生计算值 (不落库)

        Returns:
            组装好的 :class:`ProjectPlanThreeLevelResp` (含派生 + 嵌套)
        """
        plan = await self.get_ps_project_plan(plan_id)

        # 数据范围校验 (2026-07-18-project-plan-data-scope D-006@v1):越权 → 403
        plan_scope = build_plan_scope_clause(scope)
        if plan_scope is not None:
            visible = (
                await self._session.execute(
                    select(func.count())
                    .select_from(PsProjectPlan)
                    .where(PsProjectPlan.id == plan_id, plan_scope)
                )
            ).scalar_one()
            if not visible:
                raise PermissionDenied("无权访问该项目计划")

        # 1. 批量取 nodes (按 ps_project_plan_id,字符串 FK)
        nodes = await self.list_ps_plan_nodes_by_plan(str(plan_id))

        if not nodes:
            # 无子节点 → 空 nodes,但保留 plan 顶层 + 派生
            return self._build_three_level_resp(plan, [], [], [])

        node_ids = [n.id for n in nodes]

        # 2. 批量取 details (按 plan_node_id IN,排除 archived)
        stmt_details = (
            select(PsPlanNodeDetail)
            .where(
                PsPlanNodeDetail.plan_node_id.in_(node_ids),
                PsPlanNodeDetail.status != PlanNodeDetailStatus.ARCHIVED.value,
            )
            .order_by(PsPlanNodeDetail.no)
        )
        details = list((await self._session.execute(stmt_details)).scalars().all())

        # 3. 批量取 tasks (按 ps_plan_node_detail_id IN)
        # detail.id 是 UUID,PlanTask.ps_plan_node_detail_id 也是 UUID
        tasks: list[PlanTask] = []
        if details:
            detail_ids = [d.id for d in details]
            stmt_tasks = select(PlanTask).where(PlanTask.ps_plan_node_detail_id.in_(detail_ids))
            tasks = list((await self._session.execute(stmt_tasks)).scalars().all())

        return self._build_three_level_resp(plan, nodes, details, tasks)

    @staticmethod
    def _build_three_level_resp(
        plan: PsProjectPlan,
        nodes: list[PsPlanNode],
        details: list[PsPlanNodeDetail],
        tasks: list[PlanTask],
    ) -> ProjectPlanThreeLevelResp:
        """把 4 层扁平数据组装为嵌套 ``ProjectPlanThreeLevelResp``。

        - details 按 plan_node_id (字符串) 分组到对应 node
        - tasks 按 ps_plan_node_detail_id 分组到对应 detail
        - plan 顶层注入 remaining_* 派生字段 (D-014@v1)
        """
        # 分组索引 — plan_node_id 已是 UUID (migration 202607220900),key 统一用 UUID。
        details_by_node: dict[uuid.UUID, list[PsPlanNodeDetail]] = {}
        for d in details:
            details_by_node.setdefault(d.plan_node_id, []).append(d)

        tasks_by_detail: dict[uuid.UUID, list[PlanTask]] = {}
        for t in tasks:
            if t.ps_plan_node_detail_id is None:
                continue  # 孤儿任务不挂载 (边界 4)
            tasks_by_detail.setdefault(t.ps_plan_node_detail_id, []).append(t)

        # 组装嵌套 nodes → details → tasks
        node_resps: list[PsPlanNodeWithDetail] = []
        for node in nodes:
            node_details = details_by_node.get(node.id, [])
            detail_resps: list[PsPlanNodeDetailWithTasks] = []
            for d in node_details:
                d_tasks = tasks_by_detail.get(d.id, [])
                task_simples = [PlanTaskSimple.model_validate(t) for t in d_tasks]
                detail_resp = PsPlanNodeDetailWithTasks.model_validate(d)
                detail_resp.tasks = task_simples
                detail_resps.append(detail_resp)
            node_resp = PsPlanNodeWithDetail.model_validate(node)
            node_resp.details = detail_resps
            node_resps.append(node_resp)

        # 顶层 plan + 派生注入
        resp = ProjectPlanThreeLevelResp.model_validate(plan)
        resp.remaining_available_person_days = _derive_remaining(
            plan.budget_person_days, plan.actual_consumption_person_days
        )
        resp.remaining_cost = _derive_remaining(plan.total_cost, plan.labor_cost)
        resp.nodes = node_resps
        return resp

    # ---------- 流程:状态机驱动 ----------
    async def save_process(
        self,
        item_id: uuid.UUID,
        *,
        actor_id: str,
        actor_name: str | None,
        handle_info: str | None = None,
        next_user_id: str | None = None,
        next_user_name: str | None = None,
    ) -> PsPlanNodeDetail:
        """推进到下一状态 (草稿→审核→审批→完成)。

        对 review/approve 状态:save 默认走「往前」分支 (→approve/→done);
        驳回请用 :meth:`reject_process`。
        """
        detail = await self.get_detail(item_id)
        current = PlanNodeDetailStatus(detail.status)
        target = self._FORWARD_NEXT.get(current)
        if target is None:
            raise PlanError(
                f"明细当前状态 {current.value} 无可推进的下一状态",
                details={"current_state": current.value, "entity_id": str(item_id)},
            )
        return await self._transition(
            detail, target, actor_id, actor_name, handle_info, next_user_id, next_user_name
        )

    async def reject_process(
        self,
        item_id: uuid.UUID,
        *,
        actor_id: str,
        actor_name: str | None,
        handle_info: str | None = None,
    ) -> PsPlanNodeDetail:
        """驳回 → rejected。仅 review/approve 可驳回。"""
        detail = await self.get_detail(item_id)
        return await self._transition(
            detail,
            PlanNodeDetailStatus.REJECTED,
            actor_id,
            actor_name,
            handle_info,
        )

    async def _transition(
        self,
        detail: PsPlanNodeDetail,
        target: PlanNodeDetailStatus,
        actor_id: str,
        actor_name: str | None,
        handle_info: str | None = None,
        next_user_id: str | None = None,
        next_user_name: str | None = None,
    ) -> PsPlanNodeDetail:
        """校验迁移 + 落库 + 写履历。"""
        current = PlanNodeDetailStatus(detail.status)
        sm = StateMachine(
            current,
            TRANSITIONS,
            entity="ps_plan_node_detail",
            entity_id=detail.id,
        )
        sm.transition(target)  # 非法抛 InvalidTransition (422)
        detail.status = target.value
        detail.updated_at = _now()
        # 记录审核/审批人
        if target is PlanNodeDetailStatus.REVIEW:
            detail.audit_user_id = self._safe_uuid(next_user_id) or self._safe_uuid(actor_id)
            detail.audit_user_name = next_user_name or actor_name
        elif target is PlanNodeDetailStatus.APPROVE:
            detail.approve_user_id = self._safe_uuid(next_user_id) or self._safe_uuid(actor_id)
            detail.approve_user_name = next_user_name or actor_name
        # 明细推进到 DONE 时，记录完成人 + 同事务触发建/更新关联任务 (FR-01)
        if target is PlanNodeDetailStatus.DONE:
            detail.approve_user_id = self._safe_uuid(next_user_id) or self._safe_uuid(actor_id)
            detail.approve_user_name = next_user_name or actor_name
            await self._ensure_task_for_detail(detail)
        await self._session.commit()
        await self._session.refresh(detail)
        await self._write_process(
            business_id=detail.id,
            node_key=f"{current.value}->{target.value}",
            actor_id=actor_id,
            actor_name=actor_name,
            handle_info=handle_info,
            next_user_id=next_user_id,
            next_user_name=next_user_name,
        )
        log.info(
            "plan_node_detail_transition",
            detail_id=str(detail.id),
            from_state=current.value,
            to_state=target.value,
            actor=actor_id,
        )
        return detail

    async def change_process(
        self,
        item_id: uuid.UUID,
        *,
        actor_id: str,
        actor_name: str | None,
        change_reason: str | None = None,
        overrides: dict[str, object] | None = None,
    ) -> PsPlanNodeDetail:
        """变更 — 新建 parent_id 版本链,旧版本归档 (D-002@v1)。

        步骤：
        1. 读当前明细 (必须是 done 才允许变更,源语义:已完成才走变更)
        2. 旧版本 status='archived'
        3. 新建一条 draft 明细,parent_id 指向旧版本,字段从旧版本复制
           + 应用 overrides
        4. 写一行履历 (node_key="change")
        """
        old = await self.get_detail(item_id)
        if old.status != PlanNodeDetailStatus.DONE.value:
            raise PlanError(
                "仅已完成的明细可发起变更",
                details={
                    "current_state": old.status,
                    "required": PlanNodeDetailStatus.DONE.value,
                },
            )

        # 1. 旧版本归档
        old.status = PlanNodeDetailStatus.ARCHIVED.value
        old.updated_at = _now()

        # 2. 复制字段 → 新版本
        copy_fields = {
            "plan_node_id": old.plan_node_id,
            "detailed_stage": old.detailed_stage,
            "task_theme": old.task_theme,
            "task_description": old.task_description,
            "requirements": old.requirements,
            "role_name": old.role_name,
            "achievement": old.achievement,
            "overall_stage": old.overall_stage,
            "plan_workload": old.plan_workload,
            "plan_begin_time": old.plan_begin_time,
            "plan_complete_time": old.plan_complete_time,
            "no": old.no,
            "execute_user_id": old.execute_user_id,
            "module_id": old.module_id,
            "attach_group_id": old.attach_group_id,
            "file_urls": list(old.file_urls or []),
        }
        if overrides:
            for k, v in overrides.items():
                if v is not None and k in copy_fields:
                    copy_fields[k] = v

        new = PsPlanNodeDetail(
            id=uuid.uuid4(),
            parent_id=old.id,
            status=PlanNodeDetailStatus.DRAFT.value,
            change_reason=change_reason,
            created_at=_now(),
            updated_at=_now(),
            **copy_fields,
        )
        self._session.add(new)
        # 把旧版本关联任务迁移到新版本 (ps_plan_node_detail_id: old→new)，保证
        # 版本链上始终一条任务 (FR-04, D-001)。
        await self._migrate_task_to_version(old.id, new.id)
        await self._session.commit()
        await self._session.refresh(new)

        # 3. 履历
        await self._write_process(
            business_id=new.id,
            node_key="change",
            actor_id=actor_id,
            actor_name=actor_name,
            handle_info=change_reason,
        )
        log.info(
            "plan_node_detail_change",
            old_id=str(old.id),
            new_id=str(new.id),
            actor=actor_id,
        )
        return new

    # ---------- 导出原始行 ----------
    async def list_plan_nodes_for_export(self) -> list[dict[str, Any]]:
        """返回计划节点模板全量行 (dict),供 Excel 导出使用。"""
        rows = (await self._session.execute(select(PlanNode))).scalars().all()
        return [
            {
                "overall_stage": r.overall_stage,
                "project_type": r.project_type,
                "no": r.no,
            }
            for r in rows
        ]

    async def list_ps_project_plans_for_export(self, scope: DataScope) -> list[dict[str, Any]]:
        """返回项目计划行 (按当前用户范围过滤),供 Excel 导出 (P2-3)。

        对照源 projectplan/index.vue 导出列:项目名称 / 项目经理 /
        合同名称 / 合同金额 / 公司既定利润率 / 公司既定利润金额 /
        剩余可用人天 / 总成本 / 剩余成本 / 合同签订时间 / 项目开始时间 /
        预计验收时间。

        project_name 改 outerjoin ppm_project_maintenance 取真名 (design D-3 / task-03),
        不再用 PsProjectPlan 冗余字段。
        """
        real_name = PpmProjectMaintenance.project_name
        stmt = select(PsProjectPlan, real_name.label("real_project_name")).outerjoin(
            PpmProjectMaintenance, PsProjectPlan.project_id == PpmProjectMaintenance.id
        )
        plan_scope = build_plan_scope_clause(scope)
        if plan_scope is not None:
            stmt = stmt.where(plan_scope)
        rows = (await self._session.execute(stmt)).all()
        return [
            {
                "project_name": real_project_name,
                "project_manager_name": r.project_manager_name,
                "contract_name": r.contract_name,
                "contract_amount": r.contract_amount,
                "profit_margin": r.profit_margin,
                "profit_amount": r.profit_amount,
                "remaining_available_person_days": r.remaining_available_person_days,
                "total_cost": r.total_cost,
                "remaining_cost": r.remaining_cost,
                "contract_sign_time": (
                    r.contract_sign_time.isoformat() if r.contract_sign_time else None
                ),
                "project_start_time": (
                    r.project_start_time.isoformat() if r.project_start_time else None
                ),
                "project_plan_end_time": (
                    r.project_plan_end_time.isoformat() if r.project_plan_end_time else None
                ),
            }
            for r, real_project_name in rows
        ]

    async def list_plan_node_details_for_export(self) -> list[dict[str, Any]]:
        """返回里程碑明细全量行 (dict),供 Excel 导出 (P2-3)。

        仅导出非 archived (当前有效版本) 的明细。对照源 psplannodedetail
        列表列:总体阶段 / 明细阶段 / 任务主题 / 计划工作量 / 计划开始 /
        计划完成 / 角色 / 成果 / 状态。
        """
        stmt = select(PsPlanNodeDetail).where(PsPlanNodeDetail.status != "archived")
        rows = (await self._session.execute(stmt)).scalars().all()
        return [
            {
                "overall_stage": r.overall_stage,
                "detailed_stage": r.detailed_stage,
                "task_theme": r.task_theme,
                "plan_workload": r.plan_workload,
                "plan_begin_time": (r.plan_begin_time.isoformat() if r.plan_begin_time else None),
                "plan_complete_time": (
                    r.plan_complete_time.isoformat() if r.plan_complete_time else None
                ),
                "role_name": r.role_name,
                "achievement": r.achievement,
                "status": r.status,
            }
            for r in rows
        ]

    # ---------- submitDetail (task-02):detail JSON 白名单 merge 落库 ----------
    # 提交明细字段更新 (对照源 PsPlanNodeDetailController.submitDetail):
    # detail 中非 None 的白名单字段 merge 到明细,未知键忽略 (边界 6)。
    # 每次提交写一行 PsPlanNodeDetailProcess (node_key="submit_detail"),
    # 并注入 audit_context 触发 audit_hooks (D-012)。
    _SUBMIT_DETAIL_FIELDS: tuple[str, ...] = (
        "task_theme",
        "task_description",
        "requirements",
        "role_name",
        "achievement",
        "plan_workload",
        "plan_begin_time",
        "plan_complete_time",
        "execute_user_id",
        "module_id",
        "file_urls",
    )

    async def submit_detail(
        self,
        item_id: uuid.UUID,
        detail: dict[str, object],
        *,
        actor_id: str,
        actor_name: str | None,
    ) -> PsPlanNodeDetail:
        """提交明细 detail 字段 (白名单 merge + 写履历 + 审计)。

        - 仅 ``_SUBMIT_DETAIL_FIELDS`` 中的非 None 键落库,其余忽略
        - 写一行 ``PsPlanNodeDetailProcess`` (node_key="submit_detail")
        - 注入 ``audit_context`` 触发 audit_hooks 写 audit_logs
        """
        detail_obj = await self.get_detail(item_id)

        # 白名单 merge:只落白名单内且非 None 的字段
        merged = 0
        for field in self._SUBMIT_DETAIL_FIELDS:
            if field in detail:
                val = detail[field]
                if val is not None:
                    setattr(detail_obj, field, val)
                    merged += 1
        detail_obj.updated_at = _now()

        # 注入审计上下文 (D-012:audit_hooks 自动写 audit_logs)
        self._session.info["audit_context"] = {
            "actor_id": self._safe_uuid(actor_id),
            "workspace_id": None,
        }

        await self._session.commit()
        await self._session.refresh(detail_obj)

        # 写一行履历 (node_key="submit_detail")
        await self._write_process(
            business_id=detail_obj.id,
            node_key="submit_detail",
            actor_id=actor_id,
            actor_name=actor_name,
            handle_info=f"提交明细字段 ({merged} 项更新)",
        )

        # 清理审计上下文,避免污染后续同会话操作
        self._session.info.pop("audit_context", None)

        log.info(
            "plan_node_detail_submit",
            detail_id=str(detail_obj.id),
            merged_fields=merged,
            actor=actor_id,
        )
        return detail_obj

    # ---------- 导入预览 (task-05) ----------
    async def import_preview(
        self, file_bytes: bytes, plan_node_id: str, pm_project_id: str
    ) -> ImportPreviewResp:
        """解析 Excel + 责任人反查 → 预览响应 (design §7.3 / D-002@v1)。

        纯解析不入库:不写 DB、不复用 ``_Crud``。

        - 大文件解析丢线程池 (X-002 / R-05):``parse_workbook`` 是同步 openpyxl,
          用 ``anyio.to_thread.run_sync`` 包裹,不阻塞事件循环。
        - 责任人反查走 ORM 全量 (Grill X-005):查 ``PpmProjectMember`` 全量
          (where pm_project_id),建 ``{user_name: user_id}`` 反查表;user_name 为
          空的成员不进表 (不可匹配)。
        - 多人责任人拆分 (ql-20260715-014):顿号/逗号分隔,全部匹配→每人一条
          (duty_user_id 各填、work_load 各=原值);任一未匹配→整行 1 条标红
          ``valid=False`` 不拆;空责任人→1 条标红。
        """
        # 1. 线程池跑同步解析 (X-002,不阻塞事件循环)
        sheets: list[ParsedSheet] = await anyio.to_thread.run_sync(parse_workbook, file_bytes)

        # 2. ORM 全量查项目成员,建 {user_name: user_id} 反查表 (Grill X-005)
        member_map = await self._build_member_name_map(pm_project_id)

        # 3. 逐 Sheet 逐行转 ImportPreviewRow + 责任人反查
        sheet_resps: list[ImportPreviewSheet] = []
        for sheet in sheets:
            row_resps: list[ImportPreviewRow] = []
            for row in sheet.rows:
                # 多责任人拆分:一行可能产出多条预览 (ql-20260715-014)
                row_resps.extend(self._to_preview_rows(sheet, row, member_map))
            sheet_resps.append(
                ImportPreviewSheet(
                    name=sheet.name,
                    plan_type=sheet.plan_type,
                    row_count=len(row_resps),
                    rows=row_resps,
                )
            )

        # 4. 组装响应 (parse_errors 暂空 — importer 已跳过非数据 Sheet)
        return ImportPreviewResp(sheets=sheet_resps, parse_errors=[])

    async def _build_member_name_map(self, pm_project_id: str) -> dict[str, uuid.UUID]:
        """查某项目全部成员,建 ``{user_name: user_id}`` 反查表。

        - 走 ORM 全量,不分页 (Grill X-005,避免 page_size 截断)
        - ``user_name`` 为空的成员不进表 (不可匹配)
        - 同名取最后写入者 (反查表 value 覆盖;R-03 同名重名预览层不阻断)
        """
        project_uuid = self._safe_uuid(pm_project_id)
        if project_uuid is None:
            return {}
        stmt = select(PpmProjectMember.user_id, PpmProjectMember.user_name).where(
            PpmProjectMember.pm_project_id == project_uuid
        )
        result = await self._session.execute(stmt)
        out: dict[str, uuid.UUID] = {}
        for uid, uname in result.all():
            if not uname or not str(uname).strip():
                continue  # user_name 为空不进表 (Grill X-005)
            out[str(uname).strip()] = uid
        return out

    @staticmethod
    def _to_preview_rows(
        sheet: ParsedSheet, row: ParsedRow, member_map: dict[str, uuid.UUID]
    ) -> list[ImportPreviewRow]:
        """单 ParsedRow → 多条 ImportPreviewRow（多责任人拆分, ql-20260715-014）。

        - 多人责任人按顿号/逗号分隔
        - **全部匹配** → 每人一条 (``duty_user_id`` 各填、``work_load`` 各=原值、
          ``valid=True``)，其余字段共享原行值
        - **任一未匹配** → 整行 1 条标红 (``valid=False``、``error`` 注明未匹配者、
          ``duty_user_name`` 保留原文)，不拆分
        - **空责任人** → 1 条标红 (``valid=False``、``error="责任人未填写"``)
        - date → datetime (plan_begin/plan_complete)
        """
        duty_names: list[str] = []
        if row.duty_user_name:
            # 兼容顿号/逗号 (含全角顿号「、」与中英文逗号)。
            raw_split = re.split(r"[、,，;；/]", row.duty_user_name)
            duty_names = [s.strip() for s in raw_split if s and s.strip()]

        # 拆分行共享的基础字段
        base: dict[str, Any] = dict(
            sheet_name=sheet.name,
            plan_type=sheet.plan_type,
            module_name=row.module_name,
            detailed_stage=row.detailed_stage,
            task_theme=row.task_theme,
            task_description=row.task_description,
            plan_workload=row.plan_workload,
            plan_begin_time=_date_to_datetime(row.plan_begin),
            plan_complete_time=_date_to_datetime(row.plan_complete),
        )

        # 空责任人 → 1 条标红
        if not duty_names:
            return [
                ImportPreviewRow(
                    duty_user_name=row.duty_user_name,
                    duty_user_id=None,
                    duty_matched=False,
                    duty_unmatched_note=None,
                    valid=False,
                    error="责任人未填写",
                    **base,
                )
            ]

        # 全匹配判断
        matched_pairs: list[tuple[str, uuid.UUID | None]] = [
            (n, member_map.get(n)) for n in duty_names
        ]
        unmatched = [n for n, uid in matched_pairs if uid is None]

        # 任一未匹配 → 整行 1 条标红 (不拆)
        if unmatched:
            return [
                ImportPreviewRow(
                    duty_user_name=row.duty_user_name,  # 原文 (多人)
                    duty_user_id=None,
                    duty_matched=False,
                    duty_unmatched_note=None,
                    valid=False,
                    error=f"责任人未匹配: {'、'.join(unmatched)}",
                    **base,
                )
            ]

        # 全匹配 → 每人一条 (work_load 各=原值, 不除人数)
        return [
            ImportPreviewRow(
                duty_user_name=name,
                duty_user_id=uid,
                duty_matched=True,
                duty_unmatched_note=None,
                valid=True,
                error=None,
                **base,
            )
            for name, uid in matched_pairs
        ]

    # ---------- 导入提交 (task-06 / D-008@v1) ----------
    async def import_commit(self, req: ImportCommitReq, plan_node_id: str) -> ImportResultResp:
        """原子入库 — 分组合并 + 模块汇总 + 明细逐行 status=draft (design §7.3 / D-008@v1)。

        - ⚠ 不复用 ``_Crud.create`` / ``create_module`` / ``create_detail`` (其每次单独
          commit 破坏原子性);改 ``session.add()`` 批量挂对象 + 末尾**单次** ``commit()``。
        - 先按 ``module_name`` 分组(同 plan_node_id 内):查重命中 → 复用其 id 合并
          (``merged_modules++``);未命中 → 新建 ``PlanNodeModule`` 并写整组汇总
          (``created_modules++``)。合并模块不覆盖其汇总,仅追加明细。
        - 模块汇总(可测试定义,design §7.3 C1-C2;仅新建模块写,汇总基于整组行):
          * plan_begin_time = 组内非空 min;全空 → None
          * plan_complete_time = 组内非空 max;全空 → None
          * plan_workload = 组内工作量经 ``_to_decimal`` 求和(非数字/空→0)转 str;
            全组无有效数字 → None
          * duty_user_id = 组内首个非空 duty_user_id
        - 每个 valid row 建 ``PsPlanNodeDetail`` (status 固定 ``draft``,不触发状态机);
          ``valid=False`` 的 row 计 ``skipped_rows`` 不入库。
        - 任一异常冒泡 → 不 commit → 整体回滚 (无脏数据,R-07)。
        """
        node_uuid = self._safe_uuid(plan_node_id)

        # 1. 遍历所有 Sheet → 分组:仅 valid 行参与,module_name 为 key (None 归 "")
        #    保留行顺序 (dict 自 Python3.7 保序),非 valid 行计 skipped。
        groups: dict[str, list[ImportPreviewRow]] = {}
        sheet_plan_type: dict[str, str] = {}
        skipped_rows = 0
        for sheet in req.sheets:
            for row in sheet.rows:
                if not row.valid:
                    skipped_rows += 1
                    continue
                key = row.module_name if row.module_name is not None else ""
                groups.setdefault(key, []).append(row)
                sheet_plan_type.setdefault(key, sheet.plan_type)

        # 2. 每组:查既有同名模块 → 合并 / 否则新建并写汇总
        created_modules = 0
        merged_modules = 0
        created_details = 0
        module_id_of: dict[str, uuid.UUID] = {}
        done_details: list[PsPlanNodeDetail] = []

        for key, rows in groups.items():
            existing_id = await self._find_existing_module(node_uuid, key)
            if existing_id is not None:
                # 命中同名模块 → 合并,复用其 id,不覆盖其汇总
                module_id_of[key] = existing_id
                merged_modules += 1
            else:
                new_module = self._build_module(
                    node_uuid=node_uuid,
                    module_name=key,
                    plan_type=sheet_plan_type[key],
                    rows=rows,
                )
                self._session.add(new_module)
                module_id_of[key] = new_module.id
                created_modules += 1

            # 3. 逐行建明细 (必填字段齐全→done, 缺失→draft)
            for row in rows:
                # 必填字段: 明细阶段/任务主题/任务描述/工作量/开始/结束/执行人
                required_filled = all(
                    [
                        row.detailed_stage,
                        row.task_theme,
                        row.task_description,
                        row.plan_workload,
                        row.plan_begin_time,
                        row.plan_complete_time,
                        row.duty_user_id,
                    ]
                )
                detail = PsPlanNodeDetail(
                    id=uuid.uuid4(),
                    plan_node_id=node_uuid,
                    module_id=module_id_of[key],
                    detailed_stage=row.detailed_stage,
                    task_theme=row.task_theme,
                    task_description=row.task_description,
                    plan_workload=row.plan_workload,
                    plan_begin_time=row.plan_begin_time,
                    plan_complete_time=row.plan_complete_time,
                    execute_user_id=row.duty_user_id,
                    status=PlanNodeDetailStatus.DONE.value
                    if required_filled
                    else PlanNodeDetailStatus.DRAFT.value,
                    created_at=_now(),
                    updated_at=_now(),
                )
                self._session.add(detail)
                created_details += 1
                if detail.status == PlanNodeDetailStatus.DONE.value:
                    done_details.append(detail)

        # 4. 末尾单次 commit (D-008);异常冒泡不 commit 即整体回滚
        # done 明细批量建关联任务 (FR-02, D-005)；detail.id 为构造时 uuid，无需 flush
        for d in done_details:
            await self._ensure_task_for_detail(d)
        await self._session.commit()

        return ImportResultResp(
            created_modules=created_modules,
            merged_modules=merged_modules,
            created_details=created_details,
            skipped_rows=skipped_rows,
            failed_rows=[],
        )

    async def _find_existing_module(
        self, node_uuid: uuid.UUID | None, module_name: str
    ) -> uuid.UUID | None:
        """查同 plan_node_id + module_name 是否已有 PlanNodeModule (D-004 同名合并)。

        module_name 为空串视为 None 模块名查询。返回命中模块的 id,未命中返回 None。
        """
        target = module_name if module_name != "" else None
        stmt = select(PlanNodeModule.id).where(
            PlanNodeModule.plan_node_id == node_uuid,
            PlanNodeModule.module_name == target,
        )
        return await self._session.scalar(stmt)

    @staticmethod
    def _build_module(
        *,
        node_uuid: uuid.UUID | None,
        module_name: str,
        plan_type: str,
        rows: list[ImportPreviewRow],
    ) -> PlanNodeModule:
        """新建 PlanNodeModule 并按整组行计算汇总 (design §7.3 C1-C2)。

        - plan_begin_time = 组内非空 min;全空 → None
        - plan_complete_time = 组内非空 max;全空 → None
        - plan_workload = 组内经 ``_to_decimal`` 求和(非数字/空→0)转 str;
          全组无有效数字 → None
        - duty_user_id = 组内首个非空值
        """
        begins = [r.plan_begin_time for r in rows if r.plan_begin_time is not None]
        completes = [r.plan_complete_time for r in rows if r.plan_complete_time is not None]

        workload_sum: Decimal | None = None
        has_numeric = False
        total = Decimal(0)
        for r in rows:
            dec = _to_decimal(r.plan_workload)
            if dec is not None:
                has_numeric = True
                total += dec
        if has_numeric:
            # 整数去尾零,否则保留 Decimal 精度 (与 _derive_remaining 规整一致)
            if total == total.to_integral_value():
                workload_sum = total.to_integral_value()
            else:
                workload_sum = total

        first_duty: uuid.UUID | None = None
        for r in rows:
            if r.duty_user_id is not None:
                first_duty = r.duty_user_id
                break

        return PlanNodeModule(
            id=uuid.uuid4(),
            plan_node_id=node_uuid,
            module_name=(module_name if module_name != "" else None),
            plan_workload=(str(workload_sum) if workload_sum is not None else None),
            plan_begin_time=(min(begins) if begins else None),
            plan_complete_time=(max(completes) if completes else None),
            duty_user_id=first_duty,
            plan_type=plan_type,
            created_at=_now(),
            updated_at=_now(),
        )

    @staticmethod
    def _safe_uuid(value: str | uuid.UUID | None) -> uuid.UUID | None:
        """将字符串/UUID 转 uuid.UUID,失败返回 None。

        接受 str (合法 UUID 字符串)、uuid.UUID 原值、None。
        用于 audit_context.actor_id 容错 + FK 字段 (已是 UUID) 查询参数适配。
        """
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return value
        try:
            return uuid.UUID(value)
        except (ValueError, AttributeError, TypeError):
            return None

    # ---------- 流程履历查询 ----------
    async def list_processes(self, business_id: str) -> list[PsPlanNodeDetailProcess]:
        stmt = (
            select(PsPlanNodeDetailProcess)
            .where(
                PsPlanNodeDetailProcess.business_id == self._safe_uuid(business_id),
                PsPlanNodeDetailProcess.business_type == PROCESS_BUSINESS_TYPE,
            )
            .order_by(PsPlanNodeDetailProcess.created_at)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    # ---------- 履历写入 ----------
    async def _write_process(
        self,
        *,
        business_id: uuid.UUID,
        node_key: str,
        actor_id: str,
        actor_name: str | None,
        handle_info: str | None = None,
        next_user_id: str | None = None,
        next_user_name: str | None = None,
    ) -> PsPlanNodeDetailProcess:
        proc = PsPlanNodeDetailProcess(
            id=uuid.uuid4(),
            business_id=business_id,
            business_type=PROCESS_BUSINESS_TYPE,
            node_key=node_key,
            handle_user_id=self._safe_uuid(actor_id),
            handle_user_name=actor_name,
            handle_date=_now(),
            handle_info=handle_info,
            next_user_id=self._safe_uuid(next_user_id) if next_user_id else None,
            next_user_name=next_user_name,
            created_at=_now(),
        )
        self._session.add(proc)
        await self._session.commit()
        await self._session.refresh(proc)
        return proc

    # ---------- 明细-任务联动 helper (task-01 / design §7) ----------
    # 均复用 self._session,内部不 commit —— 由 create_detail/_transition/
    # update_detail/change_process/delete_detail/import_commit 等调用方统一
    # commit,保证明细操作与任务联动在同一事务内原子完成 (design §5.2)。
    async def _lookup_user_display_name(self, user_id: uuid.UUID | None) -> str | None:
        """反查 ``users.display_name`` (与 2026-07-21 生产数据回填 SQL 同口径)。

        用于 ``PsProjectPlan.project_manager_name`` 兜底:项目经理是平台用户,
        名字权威来源是 users 表;区别于 ``_lookup_user_name`` (查项目成员冗余名,
        任务/看板口径)。查不到或 id 非法返回 None。
        """
        uid = self._safe_uuid(user_id)
        if uid is None:
            return None
        stmt = select(User.display_name).where(User.id == uid).limit(1)
        row = (await self._session.execute(stmt)).first()
        if row is None:
            return None
        return row[0]

    async def _lookup_user_name(self, user_id: uuid.UUID | None) -> str | None:
        """反查 ``PpmProjectMember.user_name`` (项目成员冗余名,与 kanban 同口径)。

        口径对齐 ``kanban/service.py`` —— 取项目成员表冗余的 ``user_name`` 而非
        ``User.display_name``,保证任务页/看板姓名一致 (design §5.3 / D-002)。
        缺失返回 None (``PlanTask.user_name`` nullable,合法)。

        ``user_id`` 可能是 UUID 或字符串,用 ``_safe_uuid`` 规整。
        """
        uid = self._safe_uuid(user_id)
        if uid is None:
            return None
        stmt = select(PpmProjectMember.user_name).where(PpmProjectMember.user_id == uid).limit(1)
        row = (await self._session.execute(stmt)).first()
        if row is None:
            return None
        return row[0]

    async def _resolve_project_context(
        self, plan_node_id: uuid.UUID | None
    ) -> tuple[uuid.UUID | None, str | None]:
        """回溯 ``plan_node → ps_project_plan``,取 ``(project_id, project_name)``。

        链路: ``PsPlanNode.id == plan_node_id`` 取 ``ps_project_plan_id`` →
        ``PsProjectPlan.id == ps_project_plan_id`` 取 ``project_id`` / ``project_name``。
        ``plan_node_id`` 为空或任一步缺失返回 ``(None, None)`` (不抛异常)。
        """
        node_uuid = self._safe_uuid(plan_node_id)
        if node_uuid is None:
            return (None, None)
        node_stmt = select(PsPlanNode.ps_project_plan_id).where(PsPlanNode.id == node_uuid)
        ps_project_plan_id = await self._session.scalar(node_stmt)
        if ps_project_plan_id is None:
            return (None, None)
        plan_stmt = select(PsProjectPlan.project_id, PsProjectPlan.project_name).where(
            PsProjectPlan.id == ps_project_plan_id
        )
        plan_row = (await self._session.execute(plan_stmt)).first()
        if plan_row is None:
            return (None, None)
        return (plan_row[0], plan_row[1])

    async def _ensure_task_for_detail(self, detail: PsPlanNodeDetail) -> PlanTask | None:
        """明细变 done 时建/更新关联任务 (版本链查重,D-003)。

        - ``detail.execute_user_id`` 为空 → 返回 None,跳过不建 (D-003:
          ``PlanTask.user_id`` 非空,无执行人的明细不产任务)
        - 查 ``PlanTask where ps_plan_node_detail_id == detail.id``:
          * 命中 → 更新映射字段 (``status`` / ``kanban_order`` **不改**,
            保留任务自身推进)
          * 未命中 → 新建 ``PlanTask`` (``status="未开始"``、
            ``kanban_order`` = 该 user 现有 ``max(kanban_order)+1``,无记录则 1)
        - 字段映射见 design §5.3;项目信息经 ``_resolve_project_context`` 回溯。

        Returns:
            关联的 :class:`PlanTask`,或 None (执行人为空时)。
        """
        uid = self._safe_uuid(detail.execute_user_id)
        if uid is None:
            return None  # D-003:无执行人不建任务

        stmt = select(PlanTask).where(PlanTask.ps_plan_node_detail_id == detail.id).limit(1)
        task = (await self._session.execute(stmt)).scalar_one_or_none()

        project_id, project_name = await self._resolve_project_context(detail.plan_node_id)
        user_name = await self._lookup_user_name(uid)

        if task is not None:
            # 命中 → 更新映射字段 (不改 status/kanban_order)
            task.user_id = uid
            task.user_name = user_name
            task.content = detail.task_theme
            task.task_description = detail.task_description
            task.start_time = detail.plan_begin_time
            task.end_time = detail.plan_complete_time
            task.work_load = detail.plan_workload
            task.project_id = project_id
            task.project_name = project_name
            task.module_id = detail.module_id
            task.updated_at = _now()
            return task

        # 未命中 → 新建 (kanban_order = 该 user 现有 max+1,无记录则 1)
        max_stmt = select(func.max(PlanTask.kanban_order)).where(PlanTask.user_id == uid)
        current_max = await self._session.scalar(max_stmt)
        next_order = (current_max or 0) + 1

        task = PlanTask(
            id=uuid.uuid4(),
            user_id=uid,
            user_name=user_name,
            status="未开始",
            content=detail.task_theme,
            task_description=detail.task_description,
            start_time=detail.plan_begin_time,
            end_time=detail.plan_complete_time,
            work_load=detail.plan_workload,
            ps_plan_node_detail_id=detail.id,
            module_id=detail.module_id,
            project_id=project_id,
            project_name=project_name,
            kanban_order=next_order,
            created_at=_now(),
            updated_at=_now(),
        )
        self._session.add(task)
        return task

    async def _sync_task_fields(self, detail: PsPlanNodeDetail) -> None:
        """编辑明细后同步关联任务字段 (不改 ``task.status``,D-007)。

        查 ``ps_plan_node_detail_id == detail.id`` 的任务,命中则更新
        ``content``/``start_time``/``end_time``/``work_load``/``project_id``/
        ``project_name``/``module_id``;``user_id``/``user_name`` 仅在明细
        ``execute_user_id`` 非空时同步 (清空执行人时保留任务原执行人,避免违反
        ``PlanTask.user_id`` 非空约束)。
        未命中 → 不新建,直接返回 (编辑不触发建任务,仅同步既有绑定)。
        """
        stmt = select(PlanTask).where(PlanTask.ps_plan_node_detail_id == detail.id).limit(1)
        task = (await self._session.execute(stmt)).scalar_one_or_none()
        if task is None:
            return  # 未关联任务,编辑不新建

        uid = self._safe_uuid(detail.execute_user_id)
        project_id, project_name = await self._resolve_project_context(detail.plan_node_id)
        # 执行人被编辑清空时不同步 user_id/user_name: PlanTask.user_id 非空,
        # 清空会违反约束致事务回滚;保留任务原执行人 (延伸 D-003「执行人为空不建任务」语义)。
        if uid is not None:
            task.user_id = uid
            task.user_name = await self._lookup_user_name(uid)
        task.content = detail.task_theme
        task.task_description = detail.task_description
        task.start_time = detail.plan_begin_time
        task.end_time = detail.plan_complete_time
        task.work_load = detail.plan_workload
        task.project_id = project_id
        task.project_name = project_name
        task.module_id = detail.module_id
        task.updated_at = _now()

    async def _migrate_task_to_version(
        self, old_detail_id: uuid.UUID, new_detail_id: uuid.UUID
    ) -> None:
        """变更时把任务的 ``ps_plan_node_detail_id`` 从旧版本迁到新版本 (D-001)。

        查 ``ps_plan_node_detail_id == old_detail_id`` 的任务,命中则置为
        ``new_detail_id`` (任务行保留,仅迁移绑定),保证版本链上始终一条任务。
        """
        stmt = select(PlanTask).where(PlanTask.ps_plan_node_detail_id == old_detail_id).limit(1)
        task = (await self._session.execute(stmt)).scalar_one_or_none()
        if task is None:
            return
        task.ps_plan_node_detail_id = new_detail_id
        task.updated_at = _now()

    async def _unlink_task(self, detail_id: uuid.UUID) -> None:
        """删明细时把关联任务 ``ps_plan_node_detail_id`` 置 null (任务保留,D-004)。

        任务行不删 (保留历史/工时/看板记录),仅解除与明细的软绑定。
        """
        stmt = select(PlanTask).where(PlanTask.ps_plan_node_detail_id == detail_id).limit(1)
        task = (await self._session.execute(stmt)).scalar_one_or_none()
        if task is None:
            return
        task.ps_plan_node_detail_id = None
        task.updated_at = _now()


__all__ = ["PlanError", "PlanNotFound", "PlanService"]
