"""plan 子域 Pydantic DTO。

字段对齐源 VO (``ppdmq-module-ppm-biz/.../controller/.../vo``) +
ORM 模型。统一 ``model_config = {"from_attributes": True}``。

设计依据：``design.md`` §7 (DTO 约定) + ``tasks/task-04.md``。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel as PydanticModel
from pydantic import Field

# ===========================================================================
# 通用分页请求
# ===========================================================================


class PageQuery(PydanticModel):
    """分页 + 排序查询基类 (1-based)。"""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=200)
    order_by: str | None = None
    order: str = Field(default="desc")


# ===========================================================================
# 模板簇 DTO
# ===========================================================================


class PlanNodeBase(PydanticModel):
    overall_stage: str
    project_type: str | None = None
    no: int | None = None


class PlanNodeCreate(PlanNodeBase):
    pass


class PlanNodeUpdate(PydanticModel):
    overall_stage: str | None = None
    project_type: str | None = None
    no: int | None = None


class PlanNodeResp(PlanNodeBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PlanNodeDetailBase(PydanticModel):
    # ALTER 迁移 (commit 2e9e76b) 把源残留 Long ID 降级为 NULL,
    # 故放宽为 Optional 以兼容历史数据 (D-fix@plan500)。
    plan_node_id: uuid.UUID | None = None
    detailed_stage: str | None = None
    no: str | None = None
    task_theme: str | None = None
    task_description: str | None = None
    requirements: str | None = None
    role_name: str | None = None
    achievement: str | None = None
    overall_stage: str | None = None


class PlanNodeDetailCreate(PlanNodeDetailBase):
    pass


class PlanNodeDetailUpdate(PydanticModel):
    detailed_stage: str | None = None
    no: str | None = None
    task_theme: str | None = None
    task_description: str | None = None
    requirements: str | None = None
    role_name: str | None = None
    achievement: str | None = None
    overall_stage: str | None = None


class PlanNodeDetailResp(PlanNodeDetailBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PlanNodeModuleBase(PydanticModel):
    # 同上 (D-fix@plan500)
    plan_node_id: uuid.UUID | None = None
    module_name: str | None = None
    plan_workload: str | None = None
    plan_begin_time: datetime | None = None
    plan_complete_time: datetime | None = None
    duty_user_id: uuid.UUID | None = None


class PlanNodeModuleCreate(PlanNodeModuleBase):
    pass


class PlanNodeModuleUpdate(PydanticModel):
    module_name: str | None = None
    plan_workload: str | None = None
    plan_begin_time: datetime | None = None
    plan_complete_time: datetime | None = None
    duty_user_id: uuid.UUID | None = None


class PlanNodeModuleResp(PlanNodeModuleBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ===========================================================================
# ps 计划簇 DTO
# ===========================================================================


class PsProjectPlanBase(PydanticModel):
    # 同上 (D-fix@plan500)
    project_id: uuid.UUID | None = None
    project_name: str | None = None
    project_manager_id: uuid.UUID | None = None
    project_manager_name: str | None = None
    project_start_time: datetime | None = None
    project_plan_end_time: datetime | None = None
    contract_sign_time: datetime | None = None
    contract_name: str | None = None
    contract_amount: str | None = None
    profit_margin: str | None = None
    profit_amount: str | None = None
    module: str | None = None
    budget_amount: str | None = None
    budget_person_days: str | None = None
    actual_consumption_person_days: str | None = None
    remaining_available_person_days: str | None = None
    status: str = "draft"
    adjustment_person_days: str | None = None
    total_cost: str | None = None
    labor_cost: str | None = None
    remaining_cost: str | None = None
    cost_adjustment: str | None = None
    company_name: str | None = None
    create_name: str | None = None


class PsProjectPlanCreate(PsProjectPlanBase):
    pass


class PsProjectPlanUpdate(PydanticModel):
    project_name: str | None = None
    project_manager_id: uuid.UUID | None = None
    project_manager_name: str | None = None
    project_start_time: datetime | None = None
    project_plan_end_time: datetime | None = None
    contract_sign_time: datetime | None = None
    contract_name: str | None = None
    contract_amount: str | None = None
    profit_margin: str | None = None
    profit_amount: str | None = None
    module: str | None = None
    budget_amount: str | None = None
    budget_person_days: str | None = None
    actual_consumption_person_days: str | None = None
    remaining_available_person_days: str | None = None
    status: str | None = None
    adjustment_person_days: str | None = None
    total_cost: str | None = None
    labor_cost: str | None = None
    remaining_cost: str | None = None
    cost_adjustment: str | None = None
    company_name: str | None = None
    create_name: str | None = None


class PsProjectPlanListReq(PageQuery):
    """项目计划列表查询请求 (PageQuery + 过滤)。

    字符串字段 (project_name/contract_name/company_name) 走 ilike 模糊匹配;
    时间字段 (contract_sign_time/project_start_time/project_plan_end_time)
    各有 _start/_end 闭区间过滤;全部可选,缺省不过滤。
    对齐前端 /ppm/project-plans 顶部搜索表单。

    补 ``offset`` property 以兼容 common.crud.apply_pagination(原本只在
    dataclass PageReq 上定义,Pydantic PageQuery 没有)。
    """

    project_name: str | None = None
    contract_name: str | None = None
    company_name: str | None = None
    contract_sign_time_start: datetime | None = None
    contract_sign_time_end: datetime | None = None
    project_start_time_start: datetime | None = None
    project_start_time_end: datetime | None = None
    project_plan_end_time_start: datetime | None = None
    project_plan_end_time_end: datetime | None = None

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


class PsProjectPlanResp(PsProjectPlanBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PsPlanNodeBase(PydanticModel):
    overall_stage: str | None = None
    no: str | None = None
    ps_project_plan_id: uuid.UUID
    status: str = "draft"
    task_theme: str | None = None
    plan_workload: str | None = None
    plan_begin_time: datetime | None = None
    plan_complete_time: datetime | None = None
    duty_user_id: uuid.UUID | None = None


class PsPlanNodeCreate(PsPlanNodeBase):
    pass


class PsPlanNodeUpdate(PydanticModel):
    overall_stage: str | None = None
    no: str | None = None
    status: str | None = None
    task_theme: str | None = None
    plan_workload: str | None = None
    plan_begin_time: datetime | None = None
    plan_complete_time: datetime | None = None
    duty_user_id: uuid.UUID | None = None


class PsPlanNodeResp(PsPlanNodeBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PsPlanNodeDetailBase(PydanticModel):
    # 同上 (D-fix@plan500)
    plan_node_id: uuid.UUID | None = None
    detailed_stage: str | None = None
    task_theme: str | None = None
    task_description: str | None = None
    requirements: str | None = None
    role_name: str | None = None
    achievement: str | None = None
    overall_stage: str | None = None
    plan_workload: str | None = None
    plan_begin_time: datetime | None = None
    plan_complete_time: datetime | None = None
    actual_begin_time: datetime | None = None
    actual_complete_time: datetime | None = None
    no: str | None = None
    execute_user_id: uuid.UUID | None = None
    module_id: uuid.UUID | None = None
    attach_group_id: str | None = None
    file_urls: list[str] = Field(default_factory=list)


class PsPlanNodeDetailCreate(PsPlanNodeDetailBase):
    pass


class PsPlanNodeDetailUpdate(PydanticModel):
    detailed_stage: str | None = None
    task_theme: str | None = None
    task_description: str | None = None
    requirements: str | None = None
    role_name: str | None = None
    achievement: str | None = None
    overall_stage: str | None = None
    plan_workload: str | None = None
    plan_begin_time: datetime | None = None
    plan_complete_time: datetime | None = None
    actual_begin_time: datetime | None = None
    actual_complete_time: datetime | None = None
    no: str | None = None
    execute_user_id: uuid.UUID | None = None
    module_id: uuid.UUID | None = None
    attach_group_id: str | None = None
    file_urls: list[str] | None = None


class PsPlanNodeDetailResp(PsPlanNodeDetailBase):
    id: uuid.UUID
    status: str
    parent_id: uuid.UUID | None = None
    audit_user_id: uuid.UUID | None = None
    audit_user_name: str | None = None
    approve_user_id: uuid.UUID | None = None
    approve_user_name: str | None = None
    change_reason: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ===========================================================================
# 三联表 (task-03) — 4 层嵌套 + 成本派生
# 层级:PsProjectPlan → PsPlanNode → PsPlanNodeDetail → PlanTask
# PlanTask 经 ps_plan_node_detail_id 软关联到 detail (无 FK 约束)。
# 派生 remaining_* 由 service 层计算注入,不落库 (D-014@v1)。
# ===========================================================================


class PlanTaskSimple(PydanticModel):
    """三联表叶子节点 — 任务精简视图。

    仅暴露三联表展示所需字段 (id / 内容 / 状态 / 工时 / 负责人 / 时间区间),
    其余 PlanTask 字段 (month/week/kanban_order 等) 不进三联表。
    """

    id: uuid.UUID
    content: str | None = None
    status: str | None = None
    work_load: str | None = None
    time_spent: float | None = None
    user_name: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None

    model_config = {"from_attributes": True}


class PsPlanNodeDetailWithTasks(PsPlanNodeDetailResp):
    """ps 里程碑明细 + 其下挂载的任务列表 (三联表第 3 层 + 叶子)。"""

    tasks: list[PlanTaskSimple] = Field(default_factory=list)


class PsPlanNodeWithDetail(PsPlanNodeResp):
    """ps 里程碑节点 + 其下挂载的明细 (含任务) (三联表第 2 层)。"""

    details: list[PsPlanNodeDetailWithTasks] = Field(default_factory=list)


class ProjectPlanThreeLevelResp(PsProjectPlanResp):
    """项目计划三联表响应 (顶层)。

    - ``remaining_available_person_days`` / ``remaining_cost``:
      service 层根据 budget/actual 派生计算 (D-014@v1),覆盖父类同名字段
      (源 model 为 String 落库值,此处返回计算后的派生字符串)。
    - ``nodes``:三联表第 2 层起,逐层嵌套明细与任务。
    """

    remaining_available_person_days: str | None = None
    remaining_cost: str | None = None
    nodes: list[PsPlanNodeWithDetail] = Field(default_factory=list)


class PsPlanNodeDetailProcessResp(PydanticModel):
    id: uuid.UUID
    business_id: uuid.UUID
    business_type: str
    node_key: str | None = None
    handle_user_id: uuid.UUID | None = None
    handle_user_name: str | None = None
    handle_date: datetime | None = None
    handle_info: str | None = None
    next_user_id: uuid.UUID | None = None
    next_user_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ===========================================================================
# 流程端点 DTO
# ===========================================================================


class ProcessActionReq(PydanticModel):
    """流程动作请求 — save(下一步)/reject(驳回) 通用载体。"""

    handle_info: str | None = None
    next_user_id: uuid.UUID | None = None
    next_user_name: str | None = None


class ChangeProcessReq(PydanticModel):
    """变更请求 — 复制当前版本为草稿新版本,旧版本归档。"""

    change_reason: str | None = None
    # 可选覆盖部分字段 (不传则从原版本复制)
    overrides: dict[str, object] = Field(default_factory=dict)


class SubmitDetailReq(PydanticModel):
    """submitDetail — 提交明细 detail JSON,白名单字段 merge 落库。

    白名单见 ``PlanService.submit_detail`` 的 ``_SUBMIT_DETAIL_FIELDS``。
    未知键忽略,不报错 (边界 6)。
    """

    detail: dict[str, object] = Field(default_factory=dict)


__all__ = [
    "ChangeProcessReq",
    "PageQuery",
    "PlanNodeBase",
    "PlanNodeCreate",
    "PlanNodeDetailBase",
    "PlanNodeDetailCreate",
    "PlanNodeDetailResp",
    "PlanNodeDetailUpdate",
    "PlanNodeModuleBase",
    "PlanNodeModuleCreate",
    "PlanNodeModuleResp",
    "PlanNodeModuleUpdate",
    "PlanNodeResp",
    "PlanNodeUpdate",
    "PlanTaskSimple",
    "ProcessActionReq",
    "ProjectPlanThreeLevelResp",
    "PsPlanNodeBase",
    "PsPlanNodeCreate",
    "PsPlanNodeDetailBase",
    "PsPlanNodeDetailCreate",
    "PsPlanNodeDetailProcessResp",
    "PsPlanNodeDetailResp",
    "PsPlanNodeDetailUpdate",
    "PsPlanNodeDetailWithTasks",
    "PsPlanNodeResp",
    "PsPlanNodeUpdate",
    "PsPlanNodeWithDetail",
    "PsProjectPlanBase",
    "PsProjectPlanCreate",
    "PsProjectPlanListReq",
    "PsProjectPlanResp",
    "PsProjectPlanUpdate",
    "SubmitDetailReq",
]
