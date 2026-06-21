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

import uuid
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.ppm.common.crud import (
    Page,
    PageReq,
    apply_pagination,
    apply_sort,
    count_total,
)
from app.modules.ppm.common.fsm import StateMachine
from app.modules.ppm.plan.fsm import (
    PROCESS_BUSINESS_TYPE,
    TRANSITIONS,
    PlanNodeDetailStatus,
)
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
    PlanTaskSimple,
    ProjectPlanThreeLevelResp,
    PsPlanNodeDetailWithTasks,
    PsPlanNodeWithDetail,
)
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
        obj = self._model(id=uuid.uuid4(), **data)  # type: ignore[call-arg]
        obj = self._set_created_updated(obj)
        self._session.add(obj)
        await self._session.commit()
        await self._session.refresh(obj)
        return obj

    async def update(self, item_id: uuid.UUID, data: dict[str, Any]) -> T:
        obj = await self.get(item_id)
        for k, v in data.items():
            if v is not None:
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
            req.order,  # type: ignore[arg-type]
        )
        stmt = apply_pagination(stmt, req)
        rows = (await self._session.execute(stmt)).scalars().all()
        return Page[Any].build(items=list(rows), total=total, req=req)

    # ---------- audit touch ----------
    def _set_created_updated(self, obj: T) -> T:
        now = _now()
        if hasattr(obj, "created_at"):
            obj.created_at = now  # type: ignore[attr-defined]
        if hasattr(obj, "updated_at"):
            obj.updated_at = now  # type: ignore[attr-defined]
        return obj

    def _touch_updated(self, obj: T) -> T:
        if hasattr(obj, "updated_at"):
            obj.updated_at = _now()  # type: ignore[attr-defined]
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
        PlanNodeDetailStatus.DRAFT: PlanNodeDetailStatus.REVIEW,
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
        return await _Crud(self._session, PlanNode).update(item_id, data)

    async def delete_plan_node(self, item_id: uuid.UUID) -> None:
        await _Crud(self._session, PlanNode).delete(item_id)

    # ---------- 模板明细 (子表,按 plan_node_id 列表) ----------
    async def list_plan_node_details_by_node(self, plan_node_id: str) -> list[PlanNodeDetail]:
        stmt = (
            select(PlanNodeDetail)
            .where(PlanNodeDetail.plan_node_id == self._safe_uuid(plan_node_id))
            .order_by(PlanNodeDetail.no)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def create_plan_node_detail(self, data: dict[str, Any]) -> PlanNodeDetail:
        return await _Crud(self._session, PlanNodeDetail).create(data)

    async def update_plan_node_detail(
        self, item_id: uuid.UUID, data: dict[str, Any]
    ) -> PlanNodeDetail:
        return await _Crud(self._session, PlanNodeDetail).update(item_id, data)

    async def delete_plan_node_detail(self, item_id: uuid.UUID) -> None:
        await _Crud(self._session, PlanNodeDetail).delete(item_id)

    # ---------- 模块 (子表,按 plan_node_id 列表) ----------
    async def list_modules_by_node(self, plan_node_id: str) -> list[PlanNodeModule]:
        stmt = (
            select(PlanNodeModule)
            .where(PlanNodeModule.plan_node_id == self._safe_uuid(plan_node_id))
            .order_by(PlanNodeModule.created_at)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def create_module(self, data: dict[str, Any]) -> PlanNodeModule:
        return await _Crud(self._session, PlanNodeModule).create(data)

    async def update_module(self, item_id: uuid.UUID, data: dict[str, Any]) -> PlanNodeModule:
        return await _Crud(self._session, PlanNodeModule).update(item_id, data)

    async def delete_module(self, item_id: uuid.UUID) -> None:
        await _Crud(self._session, PlanNodeModule).delete(item_id)

    # ---------- ps 项目计划 CRUD ----------
    async def list_ps_project_plans(self, req: PageReq) -> Page[PsProjectPlan]:
        return await _Crud(self._session, PsProjectPlan).list_paged(
            req=req, allowed_sort={"created_at", "project_name", "status"}
        )

    async def create_ps_project_plan(self, data: dict[str, Any]) -> PsProjectPlan:
        return await _Crud(self._session, PsProjectPlan).create(data)

    async def get_ps_project_plan(self, item_id: uuid.UUID) -> PsProjectPlan:
        return await _Crud(self._session, PsProjectPlan).get(item_id)

    async def update_ps_project_plan(
        self, item_id: uuid.UUID, data: dict[str, Any]
    ) -> PsProjectPlan:
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

    async def create_detail(self, data: dict[str, Any]) -> PsPlanNodeDetail:
        data.setdefault("status", PlanNodeDetailStatus.DRAFT.value)
        return await _Crud(self._session, PsPlanNodeDetail).create(data)

    async def update_detail(self, item_id: uuid.UUID, data: dict[str, Any]) -> PsPlanNodeDetail:
        return await _Crud(self._session, PsPlanNodeDetail).update(item_id, data)

    async def delete_detail(self, item_id: uuid.UUID) -> None:
        await _Crud(self._session, PsPlanNodeDetail).delete(item_id)

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
    async def get_project_plan_three_level(self, plan_id: uuid.UUID) -> ProjectPlanThreeLevelResp:
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


__all__ = ["PlanError", "PlanNotFound", "PlanService"]
