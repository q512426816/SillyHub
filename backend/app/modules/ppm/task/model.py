"""task 子域 ORM 模型 —— 平台级,UUID 主键,无 tenant_id。

三张表对齐源 ``dal/dataobject/task{plan,execute}`` 与 ``workhour`` (D-001@v1):
- ``PlanTask`` ↔ ``ppm_plan_task`` (任务计划,含 kanban_order 看板排序)
- ``TaskExecute`` ↔ ``ppm_task_execute`` (任务执行,executePlan 联动生成)
- ``WorkHour`` ↔ ``ppm_work_hour`` (工时;源 ``TenantBaseDO.tenant_id`` 按 D-008@v1 丢弃)

注:源 ``TaskPlanDO`` 的 fileUrl1..fileUrl9 拆列设计,迁移后合并为单个 JSON
``file_urls`` 字段 (列表),简化前端交互。
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
    Uuid,
)
from sqlmodel import Field

from app.models.base import BaseModel


def _now() -> datetime:
    """统一的 UTC 时间戳工厂。"""
    return datetime.now(UTC)


class PlanTask(BaseModel, table=True):
    """任务计划 (``ppm_plan_task``)。

    一条计划由某 ``user_id`` 在某 ``project_id`` / ``module_id`` 下登记一段
    时间区间的计划工作量;``execute_plan`` 端点会联动在
    :class:`TaskExecute` 中生成/更新执行记录并推进状态机。
    """

    __tablename__ = "ppm_plan_task"
    __table_args__ = (
        Index("ix_ppm_plan_task_user_status", "user_id", "status"),
        Index("ix_ppm_plan_task_project", "project_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # 登记人
    user_id: uuid.UUID = Field(sa_column=Column(Uuid(as_uuid=True), nullable=False))
    user_name: str | None = Field(default=None, sa_column=Column(String(100), nullable=True))
    status: str = Field(
        default="未开始",
        sa_column=Column(String(30), nullable=False, default="未开始"),
    )
    # 月/周/年 维度 (字符串,前端原样传入)
    month: str | None = Field(default=None, sa_column=Column(String(20), nullable=True))
    week: str | None = Field(default=None, sa_column=Column(String(20), nullable=True))
    year: str | None = Field(default=None, sa_column=Column(String(10), nullable=True))
    week_day: str | None = Field(default=None, sa_column=Column(String(50), nullable=True))
    # 计划时间区间
    start_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    end_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    # 项目/模块 (名称以字符串冗余,避免 join)
    project_id: uuid.UUID | None = Field(
        default=None, sa_column=Column(Uuid(as_uuid=True), nullable=True)
    )
    project_name: str | None = Field(default=None, sa_column=Column(String(200), nullable=True))
    module_id: uuid.UUID | None = Field(
        default=None, sa_column=Column(Uuid(as_uuid=True), nullable=True)
    )
    module_name: str | None = Field(default=None, sa_column=Column(String(200), nullable=True))
    # 业务字段
    content: str | None = Field(default=None, sa_column=Column(String(2000), nullable=True))
    work_load: str | None = Field(default=None, sa_column=Column(String(50), nullable=True))
    add_work: str | None = Field(default=None, sa_column=Column(String(50), nullable=True))
    work_partner: str | None = Field(default=None, sa_column=Column(String(200), nullable=True))
    remarks: str | None = Field(default=None, sa_column=Column(String(1000), nullable=True))
    no: int | None = Field(default=None, sa_column=Column(Integer, nullable=True))
    # 里程碑关联
    ps_plan_node_detail_id: uuid.UUID | None = Field(
        default=None, sa_column=Column(Uuid(as_uuid=True), nullable=True)
    )
    # 实际时间
    actual_start_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    actual_end_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    start_remark: str | None = Field(default=None, sa_column=Column(String(500), nullable=True))
    end_remark: str | None = Field(default=None, sa_column=Column(String(500), nullable=True))
    # 耗时 (人天)
    time_spent: float | None = Field(
        default=None,
        sa_column=Column(Numeric(10, 2), nullable=True),
    )
    # 附件组 + 文件 URL 列表 (源 9 列合并为 1 JSON 列)
    plan_attach_group_id: str | None = Field(
        default=None, sa_column=Column(String(100), nullable=True)
    )
    file_urls: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    # 看板排序 (同 user 下任务卡片顺序)
    kanban_order: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0))
    created_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class TaskExecute(BaseModel, table=True):
    """任务执行 (``ppm_task_execute``)。

    由 :class:`PlanTask` 联动生成 (plan_task_id) 或问题任务联动生成
    (problem_task_id)。状态机见模块常量 ``STATUS_*`` (10→20→30→40→90)。
    """

    __tablename__ = "ppm_task_execute"
    __table_args__ = (
        Index("ix_ppm_task_execute_plan", "plan_task_id"),
        Index("ix_ppm_task_execute_problem", "problem_task_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # 关联的计划任务 / 问题任务 (二选一,FK 软关联不加约束避免环)
    plan_task_id: uuid.UUID | None = Field(
        default=None, sa_column=Column(Uuid(as_uuid=True), nullable=True)
    )
    problem_task_id: uuid.UUID | None = Field(
        default=None, sa_column=Column(Uuid(as_uuid=True), nullable=True)
    )
    time_spent: float | None = Field(
        default=None,
        sa_column=Column(Numeric(10, 2), nullable=True),
    )
    actual_start_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    actual_end_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    start_remark: str | None = Field(default=None, sa_column=Column(String(500), nullable=True))
    end_remark: str | None = Field(default=None, sa_column=Column(String(500), nullable=True))
    execute_info: str | None = Field(default=None, sa_column=Column(String(2000), nullable=True))
    attach_group_id: str | None = Field(default=None, sa_column=Column(String(100), nullable=True))
    execute_user_id: uuid.UUID | None = Field(
        default=None, sa_column=Column(Uuid(as_uuid=True), nullable=True)
    )
    # 验证
    check_info: str | None = Field(default=None, sa_column=Column(String(2000), nullable=True))
    check_attach_group_id: str | None = Field(
        default=None, sa_column=Column(String(100), nullable=True)
    )
    check_user_id: uuid.UUID | None = Field(
        default=None, sa_column=Column(Uuid(as_uuid=True), nullable=True)
    )
    check_flag: str | None = Field(default=None, sa_column=Column(String(2), nullable=True))
    current_user_id: uuid.UUID | None = Field(
        default=None, sa_column=Column(Uuid(as_uuid=True), nullable=True)
    )
    # 任务状态 10/20/30/40/90
    status: str = Field(
        default="10",
        sa_column=Column(String(4), nullable=False, default="10"),
    )
    created_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class WorkHour(BaseModel, table=True):
    """工时 (``ppm_work_hour``) —— 平台级,丢弃源 tenant_id (D-008@v1)。

    ``stat-by-user`` / ``stat-by-project`` 端点按 ``user_id`` / ``project_id``
    + 日期范围对 ``hours`` 聚合求和。
    """

    __tablename__ = "ppm_work_hour"
    __table_args__ = (
        Index("ix_ppm_work_hour_user_date", "user_id", "work_date"),
        Index("ix_ppm_work_hour_project", "project_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    project_id: uuid.UUID = Field(sa_column=Column(Uuid(as_uuid=True), nullable=False))
    task_id: uuid.UUID | None = Field(
        default=None, sa_column=Column(Uuid(as_uuid=True), nullable=True)
    )
    user_id: uuid.UUID = Field(sa_column=Column(Uuid(as_uuid=True), nullable=False))
    work_date: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    hours: float = Field(
        sa_column=Column(Numeric(10, 2), nullable=False),
    )
    description: str | None = Field(default=None, sa_column=Column(String(1000), nullable=True))
    # 1-任务工时, 2-项目工时
    type: int = Field(default=1, sa_column=Column(Integer, nullable=False, default=1))
    created_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


__all__ = ["PlanTask", "TaskExecute", "WorkHour"]
