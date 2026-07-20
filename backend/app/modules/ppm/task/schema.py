"""task 子域 Pydantic DTO。

字段命名对齐源 ``vo`` (下划线转 Python 风格),响应模型统一
``model_config = {"from_attributes": True}``。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel as PydanticModel
from pydantic import Field, model_validator

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
    task_description: str | None = None
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
    task_description: str | None = None
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
    task_description: str | None
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
    spent_time: float = 0.0  # 已消耗工时(人天, router 聚合 sum TaskExecute.time_spent)

    model_config = {"from_attributes": True}


class PlanTaskPageReq(PydanticModel):
    """任务计划分页查询参数。"""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=200)
    # UUID 字段容错为 str,service 层 try-parse (前端可能传 "-" / 空串占位)
    user_id: str | uuid.UUID | None = None
    project_id: str | uuid.UUID | None = None
    module_id: str | uuid.UUID | None = None
    # 状态多值(可多选,status=10&status=20 编码);空表示不过滤
    status: list[str] | None = None
    month: str | None = None
    year: str | None = None
    # 计划起止区间(闭区间,按 start_time 过滤)
    start_time: datetime | None = None
    end_time: datetime | None = None
    # 配合人员模糊匹配(work_partner)
    work_partner: str | None = None
    order_by: str | None = None
    order: str = "desc"


class ExecutePlanReq(PydanticModel):
    """执行计划请求 (联动生成/更新 TaskExecute)。

    Attributes:
        plan_task_id: 被执行的计划任务 ID。
        action: 执行动作 "submit"(保存本次+任务回未开始,可再次填报) / "complete"(保存本次+任务已完成)。
        task_execute_id: start 端点返回的 in-flight 执行记录 ID(execute 时必填,收口哪条)。
        execute_info / time_spent / actual_start_time / actual_end_time:
            本次执行信息。
        execute_user_id: 执行人。
        start_remark / end_remark: 开始/结束备注。
    """

    plan_task_id: uuid.UUID
    # D-003: 删 submit bool 改 action 枚举(不反向兼容:旧 submit=True=完成 vs 新 action="submit"=重置未开始,语义相反)
    action: Literal["submit", "complete"]
    # start 端点返回的 in-flight 执行记录 id(execute 时必填)
    task_execute_id: uuid.UUID
    execute_info: str | None = None
    time_spent: float | None = None
    actual_start_time: datetime | None = None
    actual_end_time: datetime | None = None
    execute_user_id: uuid.UUID | None = None
    start_remark: str | None = None
    end_remark: str | None = None


class StartReq(PydanticModel):
    """启动任务请求(未开始→进行中,创建 in-flight TaskExecute 记 actual_start_time)。

    D-002: 多次填报每次"启动"产生一条 TaskExecute。返回的 id 用于 execute 的 task_execute_id。
    actual_start_time 可选(跨天拆分补填时传指定日期,默认 now)。
    """

    plan_task_id: uuid.UUID
    execute_user_id: uuid.UUID | None = None
    actual_start_time: datetime | None = None


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

    @model_validator(mode="after")
    def _no_crossday_create(self) -> "TaskExecuteCreate":
        """D-004 跨天校验(看板 CRUD 路径): actual 起止均非空时必须同日。"""
        if (
            self.actual_start_time is not None
            and self.actual_end_time is not None
            and self.actual_start_time.date() != self.actual_end_time.date()
        ):
            raise ValueError("执行起止时间不可跨天，请拆成每天单独填报")
        return self


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

    @model_validator(mode="after")
    def _no_crossday_update(self) -> "TaskExecuteUpdate":
        """D-004 跨天校验(看板 CRUD 路径): actual 起止均非空时必须同日。"""
        if (
            self.actual_start_time is not None
            and self.actual_end_time is not None
            and self.actual_start_time.date() != self.actual_end_time.date()
        ):
            raise ValueError("执行起止时间不可跨天，请拆成每天单独填报")
        return self


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


class PlanTaskBrief(PydanticModel):
    """计划任务摘要(供 TaskExecute 关联展示任务名/项目)。"""

    id: uuid.UUID
    content: str | None = None
    project_id: uuid.UUID | None = None
    project_name: str | None = None

    model_config = {"from_attributes": True}


class TaskExecuteWithPlanResponse(TaskExecuteResponse):
    """任务执行 + 关联计划任务(看板「实际」tab 展示任务名/项目)。"""

    plan_task: PlanTaskBrief | None = None


class TaskExecutePageReq(PydanticModel):
    """任务执行分页查询参数。"""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=200)
    # UUID 字段容错为 str,service 层 try-parse (前端可能传 "-" / 空串占位)
    plan_task_id: str | uuid.UUID | None = None
    problem_task_id: str | uuid.UUID | None = None
    status: str | None = None
    execute_user_id: str | uuid.UUID | None = None
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
    # UUID 字段容错为 str,service 层 try-parse (前端可能传 "-" / 空串占位)
    user_id: str | uuid.UUID | None = None
    project_id: str | uuid.UUID | None = None
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
