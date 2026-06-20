"""plan 子域 ORM 模型 — 7 张表。

平台级 (无 workspace_id)。源 DO 见
``ppdmq-module-ppm-biz/.../dal/dataobject/``:
``PlanNodeDO`` / ``PlanNodeDetailDO`` / ``PlanNodeModuleDO`` /
``ProjectPlanDO`` / ``PsPlanNodeDO`` / ``PsPlanNodeDetailDO`` /
``PsPlanNodeDetailProcessDO``。

关键简化 (design.md §8 + D-002@v1)：
- 弃 silly ``ps_plan_node_detail_node`` / ``_variable`` 两表 → 单表
  ``PsPlanNodeDetail`` + ``parent_id`` 版本链 + ``status`` 状态机驱动。
- 源 DO 的 ``preId`` (上一版本 ID) 映射为本表的 ``parent_id``；
  变更时新建一条 ``parent_id`` 指向原版本、旧版本 ``status='archived'``。
- 源系统以字符串作主键/外键 (Long/String 混用),本表沿用字符串外键
  (``plan_node_id`` / ``ps_project_plan_id`` 等) 以保持与源语义一致；
  自身主键统一 UUID。

设计依据：``tasks/task-04.md`` + ``design.md`` §8。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlmodel import Field

from app.models.base import BaseModel


def _now() -> datetime:
    return datetime.now(UTC)


# ===========================================================================
# 模板簇 (3 张表)
# ===========================================================================


class PlanNode(BaseModel, table=True):
    """计划节点模板 — 总体阶段 × 项目类型下的一个节点。

    对照源 ``PlanNodeDO``：overallStage / projectType / no。
    """

    __tablename__ = "ppm_plan_node"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # 总体阶段 (源 String)
    overall_stage: str = Field(sa_column=Column(String(64), nullable=False))
    # 项目类型 (源 String)
    project_type: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    # 序号 (源 Integer)
    no: int | None = Field(default=None, sa_column=Column(Integer, nullable=True))
    created_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )


class PlanNodeDetail(BaseModel, table=True):
    """模板明细 — 某节点下的一条详细任务模板。

    对照源 ``PlanNodeDetailDO``。
    """

    __tablename__ = "ppm_plan_node_detail"
    __table_args__ = (Index("ix_ppm_plan_node_detail_node", "plan_node_id", "no"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # 源 String 外键 → 本表保留字符串 (源 ID 不迁移,运行时生成)
    plan_node_id: str = Field(sa_column=Column(String(64), nullable=False))
    detailed_stage: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    no: str | None = Field(default=None, sa_column=Column(String(32), nullable=True))
    task_theme: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    task_description: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    requirements: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    role_name: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    achievement: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    overall_stage: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    created_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )


class PlanNodeModule(BaseModel, table=True):
    """模块 — 模板明细下的执行模块(含计划工时/周期/责任人)。

    对照源 ``PlanNodeModuleDO``。
    """

    __tablename__ = "ppm_plan_node_module"
    __table_args__ = (Index("ix_ppm_plan_node_module_node", "plan_node_id"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    plan_node_id: str = Field(sa_column=Column(String(64), nullable=False))
    module_name: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    plan_workload: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    plan_begin_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    plan_complete_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    # 责任人 ID (源 Long,保留字符串语义)
    duty_user_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    created_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )


# ===========================================================================
# ps 计划簇 (4 张表)
# ===========================================================================


class PsProjectPlan(BaseModel, table=True):
    """项目计划 — 一个项目的整体策划主表。

    对照源 ``ProjectPlanDO`` (``ppm_ps_project_plan``)。
    源大量金额/人天字段为 String,本表保留字符串以对齐源录入语义
    (源前端直接传字符串,不做数值校验)。
    """

    __tablename__ = "ppm_ps_project_plan"
    __table_args__ = (
        Index("ix_ppm_ps_project_plan_project", "project_id"),
        Index("ix_ppm_ps_project_plan_status", "status"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    project_id: str = Field(sa_column=Column(String(64), nullable=False))
    project_name: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    project_manager_id: str | None = Field(
        default=None, sa_column=Column(String(64), nullable=True)
    )
    project_manager_name: str | None = Field(
        default=None, sa_column=Column(String(128), nullable=True)
    )
    project_start_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    project_plan_end_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    contract_sign_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    contract_name: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    contract_amount: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    profit_margin: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    profit_amount: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    module: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    budget_amount: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    budget_person_days: str | None = Field(
        default=None, sa_column=Column(String(64), nullable=True)
    )
    actual_consumption_person_days: str | None = Field(
        default=None, sa_column=Column(String(64), nullable=True)
    )
    remaining_available_person_days: str | None = Field(
        default=None, sa_column=Column(String(64), nullable=True)
    )
    # 计划状态 (源 String,通常: draft/approving/done 等)
    status: str = Field(
        default="draft",
        sa_column=Column(String(32), nullable=False, default="draft"),
    )
    adjustment_person_days: str | None = Field(
        default=None, sa_column=Column(String(64), nullable=True)
    )
    total_cost: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    labor_cost: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    remaining_cost: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    cost_adjustment: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    company_name: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    create_name: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    created_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )


class PsPlanNode(BaseModel, table=True):
    """里程碑 — 项目计划下的一个阶段节点(总体阶段 × 序号)。

    对照源 ``PsPlanNodeDO``。
    """

    __tablename__ = "ppm_ps_plan_node"
    __table_args__ = (Index("ix_ppm_ps_plan_node_plan", "ps_project_plan_id"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    overall_stage: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    no: str | None = Field(default=None, sa_column=Column(String(32), nullable=True))
    ps_project_plan_id: str = Field(sa_column=Column(String(64), nullable=False))
    # 里程碑状态 (源 String)
    status: str = Field(
        default="draft",
        sa_column=Column(String(32), nullable=False, default="draft"),
    )
    task_theme: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    plan_workload: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    plan_begin_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    plan_complete_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    duty_user_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    created_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )


class PsPlanNodeDetail(BaseModel, table=True):
    """里程碑明细 — 核心简化表 (D-002@v1)。

    对照源 ``PsPlanNodeDetailDO``。弃 silly 的 ``_node``/``_variable``
    两表,本表承载明细全部字段 + 状态机 + 版本链：

    - ``status`` 驱动状态机 (见 ``plan.fsm``):draft / review / approve /
      done / rejected / archived。
    - ``parent_id`` 版本链 (源 ``preId``):变更时新建一条,
      ``parent_id`` 指向原版本,原版本 ``status='archived'``。
    - 附件统一 ``file_urls`` (JSON 数组) + ``attach_group_id`` 字符串
      (design.md §8 附件统一约定)。
    """

    __tablename__ = "ppm_ps_plan_node_detail"
    __table_args__ = (
        Index("ix_ppm_ps_plan_node_detail_node", "plan_node_id"),
        Index("ix_ppm_ps_plan_node_detail_status", "status"),
        Index("ix_ppm_ps_plan_node_detail_parent", "parent_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # 所属里程碑 (源 String,本表保留字符串外键语义)
    plan_node_id: str = Field(sa_column=Column(String(64), nullable=False))
    detailed_stage: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    task_theme: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    task_description: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    requirements: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    role_name: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    achievement: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    overall_stage: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    plan_workload: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    plan_begin_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    plan_complete_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    actual_begin_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    actual_complete_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    no: str | None = Field(default=None, sa_column=Column(String(32), nullable=True))
    execute_user_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    module_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    # 附件组 ID (源 attachGroupId 字符串约定)
    attach_group_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    # 附件 URL 列表 (design.md §8 附件统一约定,弃源 9 个 fileUrl 字段)
    file_urls: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    # ── 状态机驱动字段 ──
    status: str = Field(
        default="draft",
        sa_column=Column(String(32), nullable=False, default="draft"),
    )
    # ── 版本链 (源 preId,变更时指向原版本) ──
    parent_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True), ForeignKey("ppm_ps_plan_node_detail.id"), nullable=True
        ),
    )
    # ── 审计/审批人员 (源 auditUserId/approveUserId 等) ──
    audit_user_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    audit_user_name: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    approve_user_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    approve_user_name: str | None = Field(
        default=None, sa_column=Column(String(128), nullable=True)
    )
    change_reason: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )


class PsPlanNodeDetailProcess(BaseModel, table=True):
    """里程碑明细流程履历 — 每次状态流转插入一行。

    对照源 ``PsPlanNodeDetailProcessDO``。``business_id`` 指向
    ``PsPlanNodeDetail.id`` (字符串化),``business_type`` 区分来源
    (如 "ps_plan_node_detail")。
    """

    __tablename__ = "ppm_ps_plan_node_detail_process"
    __table_args__ = (Index("ix_ppm_ps_plan_node_detail_proc_biz", "business_id", "business_type"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    business_id: str = Field(sa_column=Column(String(64), nullable=False))
    business_type: str = Field(sa_column=Column(String(64), nullable=False))
    node_key: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    handle_user_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    handle_user_name: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    handle_date: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    handle_info: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    next_user_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    next_user_name: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    created_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )


__all__ = [
    "PlanNode",
    "PlanNodeDetail",
    "PlanNodeModule",
    "PsPlanNode",
    "PsPlanNodeDetail",
    "PsPlanNodeDetailProcess",
    "PsProjectPlan",
]
