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
    plan_node_id: str
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
    plan_node_id: str
    module_name: str | None = None
    plan_workload: str | None = None
    plan_begin_time: datetime | None = None
    plan_complete_time: datetime | None = None
    duty_user_id: str | None = None


class PlanNodeModuleCreate(PlanNodeModuleBase):
    pass


class PlanNodeModuleUpdate(PydanticModel):
    module_name: str | None = None
    plan_workload: str | None = None
    plan_begin_time: datetime | None = None
    plan_complete_time: datetime | None = None
    duty_user_id: str | None = None


class PlanNodeModuleResp(PlanNodeModuleBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ===========================================================================
# ps 计划簇 DTO
# ===========================================================================


class PsProjectPlanBase(PydanticModel):
    project_id: str
    project_name: str | None = None
    project_manager_id: str | None = None
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
    project_manager_id: str | None = None
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


class PsProjectPlanResp(PsProjectPlanBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PsPlanNodeBase(PydanticModel):
    overall_stage: str | None = None
    no: str | None = None
    ps_project_plan_id: str
    status: str = "draft"
    task_theme: str | None = None
    plan_workload: str | None = None
    plan_begin_time: datetime | None = None
    plan_complete_time: datetime | None = None
    duty_user_id: str | None = None


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
    duty_user_id: str | None = None


class PsPlanNodeResp(PsPlanNodeBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PsPlanNodeDetailBase(PydanticModel):
    plan_node_id: str
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
    execute_user_id: str | None = None
    module_id: str | None = None
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
    execute_user_id: str | None = None
    module_id: str | None = None
    attach_group_id: str | None = None
    file_urls: list[str] | None = None


class PsPlanNodeDetailResp(PsPlanNodeDetailBase):
    id: uuid.UUID
    status: str
    parent_id: uuid.UUID | None = None
    audit_user_id: str | None = None
    audit_user_name: str | None = None
    approve_user_id: str | None = None
    approve_user_name: str | None = None
    change_reason: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PsPlanNodeDetailProcessResp(PydanticModel):
    id: uuid.UUID
    business_id: str
    business_type: str
    node_key: str | None = None
    handle_user_id: str | None = None
    handle_user_name: str | None = None
    handle_date: datetime | None = None
    handle_info: str | None = None
    next_user_id: str | None = None
    next_user_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ===========================================================================
# 流程端点 DTO
# ===========================================================================


class ProcessActionReq(PydanticModel):
    """流程动作请求 — save(下一步)/reject(驳回) 通用载体。"""

    handle_info: str | None = None
    next_user_id: str | None = None
    next_user_name: str | None = None


class ChangeProcessReq(PydanticModel):
    """变更请求 — 复制当前版本为草稿新版本,旧版本归档。"""

    change_reason: str | None = None
    # 可选覆盖部分字段 (不传则从原版本复制)
    overrides: dict[str, object] = Field(default_factory=dict)


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
    "ProcessActionReq",
    "PsPlanNodeBase",
    "PsPlanNodeCreate",
    "PsPlanNodeDetailBase",
    "PsPlanNodeDetailCreate",
    "PsPlanNodeDetailProcessResp",
    "PsPlanNodeDetailResp",
    "PsPlanNodeDetailUpdate",
    "PsPlanNodeResp",
    "PsPlanNodeUpdate",
    "PsProjectPlanBase",
    "PsProjectPlanCreate",
    "PsProjectPlanResp",
    "PsProjectPlanUpdate",
]
