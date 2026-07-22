"""problem 子域 Pydantic DTO。

字段对齐源 VO (``ppdmq-module-ppm-biz/.../controller/.../vo``) +
ORM 模型。统一 ``model_config = {"from_attributes": True}``。

设计依据:``design.md`` §7 (DTO 约定) + ``tasks/task-05.md``。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel as PydanticModel
from pydantic import Field, field_validator

# ===========================================================================
# 问题清单 DTO
# ===========================================================================


class ProblemListBase(PydanticModel):
    project_id: uuid.UUID
    project_name: str | None = None
    module_id: uuid.UUID | None = None
    model_name: str | None = None
    pro_desc: str | None = None
    file_urls: list[str] = Field(default_factory=list)
    func_name: str | None = None
    pro_type: str | None = None
    is_urgent: str | None = None
    find_by: str | None = None
    find_time: datetime | None = None
    pro_answer: str | None = None
    work_type: str | None = None
    # 创建人 (编辑/删除权限判断依据; 历史数据 None)
    created_by: uuid.UUID | None = None
    duty_user_id: uuid.UUID | None = None
    duty_user_name: str | None = None
    plan_start_time: datetime | None = None
    plan_end_time: datetime | None = None
    real_end_time: datetime | None = None
    audit_user_id: uuid.UUID | None = None
    audit_user_name: str | None = None
    audit_time: datetime | None = None
    remarks: str | None = None
    is_delay_plan: str | None = None
    work_load: str | None = None


class ProblemListCreate(ProblemListBase):
    pass


class ProblemListUpdate(PydanticModel):
    project_name: str | None = None
    module_id: uuid.UUID | None = None
    model_name: str | None = None
    pro_desc: str | None = None
    file_urls: list[str] | None = None
    func_name: str | None = None
    pro_type: str | None = None
    is_urgent: str | None = None
    find_by: str | None = None
    find_time: datetime | None = None
    pro_answer: str | None = None
    work_type: str | None = None
    duty_user_id: uuid.UUID | None = None
    duty_user_name: str | None = None
    plan_start_time: datetime | None = None
    plan_end_time: datetime | None = None
    # 验证人 (ql-20260722-003: 前端 edit 提交发 audit_user_id; 此前 Update 缺该字段,
    # Pydantic extra=ignore 静默丢弃致验证人无法更新/清空。ProblemListBase/ORM 均有)
    audit_user_id: uuid.UUID | None = None
    remarks: str | None = None
    is_delay_plan: str | None = None
    work_load: str | None = None
    # 处置人 (流程当前处置人，编辑表单可调整)
    now_handle_user: str | None = None
    now_handle_user_name: str | None = None


class ProblemListResp(ProblemListBase):
    id: uuid.UUID
    status: str
    # 展示用有效状态 (3 态简化后恒等于 status；保留字段兼容前端)
    effective_status: str | None = None
    time_spent: float | None = None
    now_node: int | None = None
    now_handle_user: str | None = None
    now_handle_user_name: str | None = None
    handle_info: str | None = None
    check_info: str | None = None
    check_result: str | None = None
    check_time: datetime | None = None
    created_at: datetime
    updated_at: datetime
    spent_time: float = (
        0.0  # 已消耗工时(人天, router 聚合 sum TaskExecute.time_spent by problem_task_id)
    )
    # 操作权限(后端按角色集中判断, 前端只读):
    # can_edit/can_delete = 超管 ‖ 创建人 ‖ 本项目经理 ‖ 责任人(满足其一)
    # 由 router 调 service.compute_can_operate 填充, 非 ORM 映射。
    can_edit: bool = False
    can_delete: bool = False
    # 创建人显示名 (router 按 created_by 反查 display_name 填充, 历史 created_by
    # 为 NULL 时显示 None; 详情页展示创建人用, 非 ORM 映射)
    created_by_name: str | None = None

    model_config = {"from_attributes": True}


# ===========================================================================
# 问题变更 DTO
# ===========================================================================


class ProblemChangeBase(PydanticModel):
    resource_id: uuid.UUID
    project_id: uuid.UUID | None = None
    project_name: str | None = None
    model_name: str | None = None
    pro_desc: str | None = None
    func_name: str | None = None
    pro_type: str | None = None
    is_urgent: str | None = None
    find_by: str | None = None
    find_time: datetime | None = None
    pro_answer: str | None = None
    work_type: str | None = None
    duty_user_id: uuid.UUID | None = None
    duty_user_name: str | None = None
    plan_start_time: datetime | None = None
    plan_end_time: datetime | None = None
    remarks: str | None = None
    change_reason: str | None = None
    work_load: str | None = None
    is_delay_plan: str | None = None


class ProblemChangeCreate(ProblemChangeBase):
    pass


class ProblemChangeUpdate(PydanticModel):
    pro_desc: str | None = None
    pro_type: str | None = None
    is_urgent: str | None = None
    duty_user_id: uuid.UUID | None = None
    duty_user_name: str | None = None
    plan_start_time: datetime | None = None
    plan_end_time: datetime | None = None
    change_reason: str | None = None
    work_load: str | None = None
    is_delay_plan: str | None = None


class ProblemChangeResp(ProblemChangeBase):
    id: uuid.UUID
    status: str
    now_node: int | None = None
    now_handle_user: str | None = None
    now_handle_user_name: str | None = None
    audit_user_id: uuid.UUID | None = None
    audit_user_name: str | None = None
    audit_time: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ===========================================================================
# 流程任务 / 履历 DTO
# ===========================================================================


class ProcessTaskResp(PydanticModel):
    id: uuid.UUID
    # business_id 在 List 表是 uuid,在 Change 表是 varchar (源 Long 残留,
    # migration 202607220900 排除)。统一以 str 暴露给前端,validator 兼容两种输入。
    business_id: str
    node_key: str | None = None
    node_name: str | None = None
    now_handle_user: str | None = None
    now_handle_user_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("business_id", mode="before")
    @classmethod
    def _coerce_business_id(cls, v: object) -> str | None:
        return str(v) if v is not None else None


class ProcessLogResp(PydanticModel):
    id: uuid.UUID
    business_id: str
    node_key: str | None = None
    handle_user_id: uuid.UUID | None = None
    handle_user_name: str | None = None
    handle_date: datetime | None = None
    handle_info: str | None = None
    next_user_id: uuid.UUID | None = None
    next_user_name: str | None = None
    comment: str | None = None
    created_at: datetime

    @field_validator("business_id", mode="before")
    @classmethod
    def _coerce_business_id(cls, v: object) -> str | None:
        return str(v) if v is not None else None

    model_config = {"from_attributes": True}


# ===========================================================================
# 问题清单执行流请求 (3 态，对齐任务计划)
# ===========================================================================


class ProblemStartReq(PydanticModel):
    """start — 启动问题 (新建 → 进行中)，建 in-flight TaskExecute。

    ``actual_start_time`` 可选 (前端跨天拆分补填时传指定日期，默认 now)。
    problem_id 取自路径，execute_user_id 取自登录用户。
    """

    actual_start_time: datetime | None = None


class ProblemExecuteReq(PydanticModel):
    """execute — 收口 in-flight TaskExecute 并推进 3 态状态机。

    - ``action="submit"``   : 回「新建」(可再次 start，重复执行)
    - ``action="complete"`` : 「已完成」(终态)

    ``task_execute_id`` 必填 (start 返回的 in-flight 记录)。跨天校验在 service。
    """

    task_execute_id: uuid.UUID
    action: Literal["submit", "complete"]
    execute_info: str | None = None
    time_spent: float | None = None
    actual_start_time: datetime | None = None
    actual_end_time: datetime | None = None
    execute_user_id: uuid.UUID | None = None


# ===========================================================================
# 变更流流程动作请求 (task-02)
# ===========================================================================


class ChangeNextProcessReq(PydanticModel):
    """变更流 nextProcess — 推进到下一节点 (4 节点链)。"""

    comment: str | None = None


class ChangeRejectProcessReq(PydanticModel):
    """变更流 rejectProcess — 驳回到已作废 (仅审核节点)。"""

    comment: str | None = None


__all__ = [
    "ChangeNextProcessReq",
    "ChangeRejectProcessReq",
    "ProblemChangeBase",
    "ProblemChangeCreate",
    "ProblemChangeResp",
    "ProblemChangeUpdate",
    "ProblemExecuteReq",
    "ProblemListBase",
    "ProblemListCreate",
    "ProblemListResp",
    "ProblemListUpdate",
    "ProblemStartReq",
    "ProcessLogResp",
    "ProcessTaskResp",
]
