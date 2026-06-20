"""task 子域 Pydantic DTO。

字段命名对齐源 ``vo`` (下划线转 Python 风格),响应模型统一
``model_config = {"from_attributes": True}``。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel as PydanticModel
from pydantic import Field

# ---------------------------------------------------------------------------
# PlanTask
# ---------------------------------------------------------------------------


class PlanTaskCreate(PydanticModel):
    """创建任务计划。"""

    user_id: uuid.UUID
    user_name: str | None = None
    status: str = "未开始"
    month: str | None = None
    week: str | None = None
    year: str | None = None
    week_day: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    project_id: uuid.UUID | None = None
    project_name: str | None = None
    module_id: uuid.UUID | None = None
    module_name: str | None = None
    content: str | None = None
    work_load: str | None = None
    add_work: str | None = None
    work_partner: str | None = None
    remarks: str | None = None
    no: int | None = None
    ps_plan_node_detail_id: uuid.UUID | None = None
    actual_start_time: datetime | None = None
    actual_end_time: datetime | None = None
    start_remark: str | None = None
    end_remark: str | None = None
    time_spent: float | None = None
    plan_attach_group_id: str | None = None
    file_urls: list[str] = Field(default_factory=list)
    kanban_order: int = 0


class PlanTaskUpdate(PydanticModel):
    """更新任务计划 (全字段可选,部分更新)。"""

    user_id: uuid.UUID | None = None
    user_name: str | None = None
    status: str | None = None
    month: str | None = None
    week: str | None = None
    year: str | None = None
    week_day: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    project_id: uuid.UUID | None = None
    project_name: str | None = None
    module_id: uuid.UUID | None = None
    module_name: str | None = None
    content: str | None = None
    work_load: str | None = None
    add_work: str | None = None
    work_partner: str | None = None
    remarks: str | None = None
    no: int | None = None
    ps_plan_node_detail_id: uuid.UUID | None = None
    actual_start_time: datetime | None = None
    actual_end_time: datetime | None = None
    start_remark: str | None = None
    end_remark: str | None = None
    time_spent: float | None = None
    plan_attach_group_id: str | None = None
    file_urls: list[str] | None = None
    kanban_order: int | None = None


class PlanTaskResponse(PydanticModel):
    """任务计划响应。"""

    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None
    status: str
    month: str | None
    week: str | None
    year: str | None
    week_day: str | None
    start_time: datetime | None
    end_time: datetime | None
    project_id: uuid.UUID | None
    project_name: str | None
    module_id: uuid.UUID | None
    module_name: str | None
    content: str | None
    work_load: str | None
    add_work: str | None
    work_partner: str | None
    remarks: str | None
    no: int | None
    ps_plan_node_detail_id: uuid.UUID | None
    actual_start_time: datetime | None
    actual_end_time: datetime | None
    start_remark: str | None
    end_remark: str | None
    time_spent: float | None
    plan_attach_group_id: str | None
    file_urls: list[str]
    kanban_order: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PlanTaskPageReq(PydanticModel):
    """任务计划分页查询参数。"""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=200)
    user_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    status: str | None = None
    month: str | None = None
    year: str | None = None
    order_by: str | None = None
    order: str = "desc"


class ExecutePlanReq(PydanticModel):
    """执行计划请求 (联动生成/更新 TaskExecute)。

    Attributes:
        plan_task_id: 被执行的计划任务 ID。
        submit: 是否标记完成 (True → 状态 90 已完成)。
        task_execute_id: 已存在执行记录 ID 时为更新,否则新建。
        execute_info / time_spent / actual_start_time / actual_end_time:
            本次执行信息。
        execute_user_id: 执行人。
        start_remark / end_remark: 开始/结束备注。
    """

    plan_task_id: uuid.UUID
    submit: bool = False
    task_execute_id: uuid.UUID | None = None
    execute_info: str | None = None
    time_spent: float | None = None
    actual_start_time: datetime | None = None
    actual_end_time: datetime | None = None
    execute_user_id: uuid.UUID | None = None
    start_remark: str | None = None
    end_remark: str | None = None


# ---------------------------------------------------------------------------
# TaskExecute
# ---------------------------------------------------------------------------


class TaskExecuteCreate(PydanticModel):
    """创建任务执行记录。"""

    plan_task_id: uuid.UUID | None = None
    problem_task_id: uuid.UUID | None = None
    time_spent: float | None = None
    actual_start_time: datetime | None = None
    actual_end_time: datetime | None = None
    start_remark: str | None = None
    end_remark: str | None = None
    execute_info: str | None = None
    attach_group_id: str | None = None
    execute_user_id: uuid.UUID | None = None
    check_info: str | None = None
    check_attach_group_id: str | None = None
    check_user_id: uuid.UUID | None = None
    check_flag: str | None = None
    current_user_id: uuid.UUID | None = None
    status: str = "10"


class TaskExecuteUpdate(PydanticModel):
    """更新任务执行记录 (全字段可选)。"""

    plan_task_id: uuid.UUID | None = None
    problem_task_id: uuid.UUID | None = None
    time_spent: float | None = None
    actual_start_time: datetime | None = None
    actual_end_time: datetime | None = None
    start_remark: str | None = None
    end_remark: str | None = None
    execute_info: str | None = None
    attach_group_id: str | None = None
    execute_user_id: uuid.UUID | None = None
    check_info: str | None = None
    check_attach_group_id: str | None = None
    check_user_id: uuid.UUID | None = None
    check_flag: str | None = None
    current_user_id: uuid.UUID | None = None
    status: str | None = None


class TaskExecuteResponse(PydanticModel):
    """任务执行响应。"""

    id: uuid.UUID
    plan_task_id: uuid.UUID | None
    problem_task_id: uuid.UUID | None
    time_spent: float | None
    actual_start_time: datetime | None
    actual_end_time: datetime | None
    start_remark: str | None
    end_remark: str | None
    execute_info: str | None
    attach_group_id: str | None
    execute_user_id: uuid.UUID | None
    check_info: str | None
    check_attach_group_id: str | None
    check_user_id: uuid.UUID | None
    check_flag: str | None
    current_user_id: uuid.UUID | None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TaskExecutePageReq(PydanticModel):
    """任务执行分页查询参数。"""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=200)
    plan_task_id: uuid.UUID | None = None
    status: str | None = None
    execute_user_id: uuid.UUID | None = None
    order_by: str | None = None
    order: str = "desc"


# ---------------------------------------------------------------------------
# WorkHour
# ---------------------------------------------------------------------------


class WorkHourCreate(PydanticModel):
    """创建工时记录。"""

    project_id: uuid.UUID
    task_id: uuid.UUID | None = None
    user_id: uuid.UUID
    work_date: date
    hours: float
    description: str | None = None
    type: int = 1


class WorkHourUpdate(PydanticModel):
    """更新工时记录 (全字段可选)。"""

    project_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    work_date: date | None = None
    hours: float | None = None
    description: str | None = None
    type: int | None = None


class WorkHourResponse(PydanticModel):
    """工时响应。"""

    id: uuid.UUID
    project_id: uuid.UUID
    task_id: uuid.UUID | None
    user_id: uuid.UUID
    work_date: datetime
    hours: float
    description: str | None
    type: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkHourPageReq(PydanticModel):
    """工时分页查询参数。"""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=200)
    user_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    work_date_start: date | None = None
    work_date_end: date | None = None
    type: int | None = None
    order_by: str | None = None
    order: str = "desc"


class WorkHourStatItem(PydanticModel):
    """工时统计单行 (按 user 或 project 聚合)。"""

    key: uuid.UUID
    """聚合维度 ID (user_id 或 project_id)。"""

    total_hours: float
    """聚合工时总和。"""

    count: int
    """聚合记录条数。"""


class WorkHourStatResponse(PydanticModel):
    """工时统计响应。"""

    dimension: str
    """聚合维度名:``user`` / ``project``。"""

    start_date: date | None
    end_date: date | None
    items: list[WorkHourStatItem]
    total_hours: float


__all__ = [
    "ExecutePlanReq",
    "PlanTaskCreate",
    "PlanTaskPageReq",
    "PlanTaskResponse",
    "PlanTaskUpdate",
    "TaskExecuteCreate",
    "TaskExecutePageReq",
    "TaskExecuteResponse",
    "TaskExecuteUpdate",
    "WorkHourCreate",
    "WorkHourPageReq",
    "WorkHourResponse",
    "WorkHourStatItem",
    "WorkHourStatResponse",
    "WorkHourUpdate",
]
