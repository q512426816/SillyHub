"""problem 问题清单子域 ORM 模型 — 6 张表。

平台级 (无 workspace_id, D-001@v1)。源 DO 见
``ppdmq-module-ppm-biz/.../dal/dataobject/``:
``ProblemListDO`` / ``ProblemChangeDO`` / ``ProcessTaskDO`` /
``ProcessLogDO`` (+ 变更对应的 ``ChangeProcessTaskDO`` /
``ChangeProcessLogDO``)。

字段对齐源 DO (Java 驼峰 → Python snake_case);源 Long/String 混用
主键 → 本表统一 UUID 主键;源 userId/projectId String → 本表保留
字符串语义 (运行时绑定,源 ID 不迁移)。附件统一 ``file_urls`` JSON
数组 (D-007@v1,弃源 fileUrl1-9 九个字段)。

关键约定 (task-05.md + design.md §8):
- ``ppm_problem_list.status`` 取值 1-7 (见 fsm.ProblemStatus)
- ``now_node`` 流程当前节点 (10/20/30/40,见 fsm.ProblemNode)
- ``ppm_problem_change.resource_id`` 关联源 ``ppm_problem_list.id``

设计依据:``tasks/task-05.md`` + ``design.md`` §8。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Uuid,
)
from sqlmodel import Field

from app.models.base import BaseModel


def _now() -> datetime:
    """统一时间戳工厂 (带 UTC tz)。"""
    return datetime.now(UTC)


# ===========================================================================
# 问题清单主表 (ppm_problem_list)
# ===========================================================================


class PpmProblemList(BaseModel, table=True):
    """问题清单主表。

    对照源 ``ProblemListDO``。``status`` 驱动 4 节点审批流状态机
    (见 ``problem.fsm``)。``now_node`` / ``now_handle_user`` /
    ``now_handle_user_name`` 记录流程当前位置与待处理人。
    """

    __tablename__ = "ppm_problem_list"
    __table_args__ = (
        Index("ix_ppm_problem_list_project", "project_id"),
        Index("ix_ppm_problem_list_status", "status"),
        Index("ix_ppm_problem_list_now_node", "now_node"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # 源 Long projectId → 保留字符串语义 (运行时绑定,源 ID 不迁移)
    project_id: str = Field(sa_column=Column(String(64), nullable=False))
    project_name: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    module_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    model_name: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    pro_desc: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    # 附件 URL 列表 (D-007@v1,弃源 fileUrl1-9 九字段)
    file_urls: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    func_name: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    # 问题类型:bug / change / 其他 (源 TYPE_BUG / TYPE_CHANGE)
    pro_type: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    is_urgent: str | None = Field(default=None, sa_column=Column(String(8), nullable=True))
    find_by: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    find_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    pro_answer: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    work_type: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    duty_user_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    duty_user_name: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    plan_start_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    plan_end_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    real_end_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    # 验证人 (源 auditUserId/Name/Time)
    audit_user_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    audit_user_name: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    audit_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    remarks: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    # 状态 1-7 (见 fsm.ProblemStatus):1 已保存 / 2 审核中 / 3 处置中 /
    # 4 已关闭 / 5 已作废 / 6 待验证 / 7 变更中 (内存态)
    status: str = Field(
        default="1",
        sa_column=Column(String(8), nullable=False, default="1"),
    )
    is_delay_plan: str | None = Field(default=None, sa_column=Column(String(8), nullable=True))
    work_load: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    # 实际消耗 (源 BigDecimal timeSpent)
    time_spent: float | None = Field(default=None, sa_column=Column(Numeric(10, 2), nullable=True))
    # 流程——当前所处节点 (10/20/30/40,见 fsm.ProblemNode)
    now_node: int | None = Field(default=None, sa_column=Column(Integer, nullable=True))
    # 流程——当前处置人 (逗号分隔多用户)
    now_handle_user: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    now_handle_user_name: str | None = Field(
        default=None, sa_column=Column(String(255), nullable=True)
    )
    # 处置情况 (责任人 doneTask 时追加)
    handle_info: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    # 验证情况 + 验证结果 (closeTask)
    check_info: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    # 验证是否通过:1 通过 / 其他 打回
    check_result: str | None = Field(default=None, sa_column=Column(String(8), nullable=True))
    check_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    created_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )


# ── 非持久化:列表展示用的有效状态 (内存态) ──────────────────
# 有未关闭变更时,service 在 list_problems 中用 object.__setattr__ 把
# ``_effective_status`` 置为 "7" 变更中,但 ``status`` 持久化字段不变。
# property 不参与 ORM 映射。
def _problem_effective_status(self: PpmProblemList) -> str:
    """展示用有效状态:有覆盖则取它,否则取持久化 status。"""
    return getattr(self, "_effective_status", None) or self.status


PpmProblemList.effective_status = property(  # type: ignore[attr-defined]
    _problem_effective_status
)
# ===========================================================================


class PpmProblemChange(BaseModel, table=True):
    """问题变更主表 — 关联源问题清单发起变更。

    对照源 ``ProblemChangeDO``。``resource_id`` 指向源
    ``ppm_problem_list.id`` (字符串化)。变更本身也有独立的审批流
    (审核中 1 / 已完成 2 / 已作废 3,源 ProblemChangeDO 常量)。
    """

    __tablename__ = "ppm_problem_change"
    __table_args__ = (
        Index("ix_ppm_problem_change_resource", "resource_id"),
        Index("ix_ppm_problem_change_status", "status"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # 关联源问题清单 ID (字符串化,源 problem_list.id)
    resource_id: str = Field(sa_column=Column(String(64), nullable=False))
    project_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    project_name: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    model_name: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    pro_desc: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    func_name: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    pro_type: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    is_urgent: str | None = Field(default=None, sa_column=Column(String(8), nullable=True))
    find_by: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    find_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    pro_answer: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    work_type: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    duty_user_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    duty_user_name: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    plan_start_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    plan_end_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    audit_user_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    audit_user_name: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    audit_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    remarks: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    change_reason: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    # 变更状态:1 审核中 / 2 已完成 / 3 已作废 (源 ProblemChangeDO 常量)
    status: str = Field(
        default="1",
        sa_column=Column(String(8), nullable=False, default="1"),
    )
    work_load: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    is_delay_plan: str | None = Field(default=None, sa_column=Column(String(8), nullable=True))
    now_node: int | None = Field(default=None, sa_column=Column(Integer, nullable=True))
    now_handle_user: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    now_handle_user_name: str | None = Field(
        default=None, sa_column=Column(String(255), nullable=True)
    )
    created_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )


# ===========================================================================
# 流程任务表 (在办) — 问题清单 / 变更 各一套
# ===========================================================================


class PpmProblemListProcessTask(BaseModel, table=True):
    """问题清单流程任务 (在办) — 当前待处理节点的任务。

    对照源 ``ProcessTaskDO`` (``ppm_problem_list_process_task``)。
    每次 nextProcess 删旧插新。
    """

    __tablename__ = "ppm_problem_list_process_task"
    __table_args__ = (Index("ix_ppm_problem_list_proc_task_biz", "business_id", "node_key"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # 关联单据表 ID (源 problem_list.id 字符串化)
    business_id: str = Field(sa_column=Column(String(64), nullable=False))
    # 节点信息 (10/20/30/40)
    node_key: str | None = Field(default=None, sa_column=Column(String(32), nullable=True))
    node_name: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    now_handle_user: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    now_handle_user_name: str | None = Field(
        default=None, sa_column=Column(String(255), nullable=True)
    )
    created_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )


class PpmProblemChangeProcessTask(BaseModel, table=True):
    """问题变更流程任务 (在办) — 变更审批流的在办任务。

    对照源 ``ChangeProcessTaskDO`` (``ppm_problem_change_process_task``)。
    结构与 ``PpmProblemListProcessTask`` 一致,business_id 关联变更 ID。
    """

    __tablename__ = "ppm_problem_change_process_task"
    __table_args__ = (Index("ix_ppm_problem_change_proc_task_biz", "business_id", "node_key"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    business_id: str = Field(sa_column=Column(String(64), nullable=False))
    node_key: str | None = Field(default=None, sa_column=Column(String(32), nullable=True))
    node_name: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    now_handle_user: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    now_handle_user_name: str | None = Field(
        default=None, sa_column=Column(String(255), nullable=True)
    )
    created_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )


# ===========================================================================
# 流程履历表 — 问题清单 / 变更 各一套
# ===========================================================================


class PpmProblemListProcessLog(BaseModel, table=True):
    """问题清单流程履历 — 每次状态流转插入一行。

    对照源 ``ProcessLogDO`` (``ppm_problem_list_process_log``)。
    ``business_id`` 关联 problem_list.id (字符串化)。
    """

    __tablename__ = "ppm_problem_list_process_log"
    __table_args__ = (Index("ix_ppm_problem_list_proc_log_biz", "business_id", "node_key"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    business_id: str = Field(sa_column=Column(String(64), nullable=False))
    node_key: str | None = Field(default=None, sa_column=Column(String(32), nullable=True))
    handle_user_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    handle_user_name: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    handle_date: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    handle_info: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    next_user_id: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    next_user_name: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    # 审批/驳回意见
    comment: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )


class PpmProblemChangeProcessLog(BaseModel, table=True):
    """问题变更流程履历 — 变更审批流每次流转插入一行。

    对照源 ``ChangeProcessLogDO`` (``ppm_problem_change_process_log``)。
    结构与 ``PpmProblemListProcessLog`` 一致,business_id 关联变更 ID。
    """

    __tablename__ = "ppm_problem_change_process_log"
    __table_args__ = (Index("ix_ppm_problem_change_proc_log_biz", "business_id", "node_key"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    business_id: str = Field(sa_column=Column(String(64), nullable=False))
    node_key: str | None = Field(default=None, sa_column=Column(String(32), nullable=True))
    handle_user_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    handle_user_name: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    handle_date: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    handle_info: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    next_user_id: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    next_user_name: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    comment: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )


__all__ = [
    "PpmProblemChange",
    "PpmProblemChangeProcessLog",
    "PpmProblemChangeProcessTask",
    "PpmProblemList",
    "PpmProblemListProcessLog",
    "PpmProblemListProcessTask",
]
