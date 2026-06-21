"""problem 子域 Pydantic DTO。

字段对齐源 VO (``ppdmq-module-ppm-biz/.../controller/.../vo``) +
ORM 模型。统一 ``model_config = {"from_attributes": True}``。

设计依据:``design.md`` §7 (DTO 约定) + ``tasks/task-05.md``。
"""

from __future__ import annotations

import uuid
from datetime import datetime

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
    # 新建时是否立即提交 (submit=true 则创建后自动进 Node20 审核中)
    submit: bool = False


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
    remarks: str | None = None
    is_delay_plan: str | None = None
    work_load: str | None = None


class ProblemListResp(ProblemListBase):
    id: uuid.UUID
    status: str
    # 展示用有效状态 (内存态:有未关闭变更时为 7 变更中,否则同 status)
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
# 流程动作请求
# ===========================================================================


class NextProcessReq(PydanticModel):
    """nextProcess — 推进到下一节点。"""

    comment: str | None = None


class RejectProcessReq(PydanticModel):
    """rejectProcess — 驳回到已作废。"""

    comment: str | None = None


class DoneTaskReq(PydanticModel):
    """doneTask — 责任人完成处置。

    ``completed=true`` 推进到待验证;``false`` 仅追加处置情况 (仍处置中)。
    """

    handle_info: str | None = None
    time_spent: float | None = None
    completed: bool = True


class CloseTaskReq(PydanticModel):
    """closeTask — 验证人验证关闭。

    ``check_result == "1"`` 通过→已关闭;否则打回责任人→处置中。
    """

    check_info: str | None = None
    check_result: str = "1"


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
    "CloseTaskReq",
    "DoneTaskReq",
    "NextProcessReq",
    "ProblemChangeBase",
    "ProblemChangeCreate",
    "ProblemChangeResp",
    "ProblemChangeUpdate",
    "ProblemListBase",
    "ProblemListCreate",
    "ProblemListResp",
    "ProblemListUpdate",
    "ProcessLogResp",
    "ProcessTaskResp",
    "RejectProcessReq",
]
