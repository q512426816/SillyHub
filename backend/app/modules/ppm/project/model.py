"""pm 项目管理子域 4 张表 SQLModel 定义。

对齐源 DO (字段名转蛇形,Java 驼峰 → Python snake_case):
- ProjectMaintenanceDO  → PpmProjectMaintenance
- CustomerMaintenanceDO → PpmCustomerMaintenance
- ProjectMemberDO       → PpmProjectMember
- ProjectStakeholderDO  → PpmProjectStakeholder

关键约定:
- 主键 UUID (继承自项目约定,源端 Long 自增被替换);
- 源 BaseDO 的 createName 字段保留为业务可读名 ``create_name`` (audit 由
  ``created_by``/``updated_by`` 体现,见下);
- ``pm_project_id`` / ``user_id`` 在源端是 String,本项目升级为 UUID + FK;
- 平台级:无 ``workspace_id`` (D-001@v1)。

设计依据:``design.md`` §8,task-03.md。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    String,
    Uuid,
)
from sqlmodel import Field

from app.models.base import BaseModel


def _now() -> datetime:
    """统一时间戳工厂 (带 UTC tz)。"""
    return datetime.now(UTC)


class PpmProjectMaintenance(BaseModel, table=True):
    """项目维护 —— ppm 项目管理的核心实体。

    源:``ProjectMaintenanceDO``。本表是 member/stakeholder 的父表
    (两者通过 ``pm_project_id`` FK 指回本表)。
    """

    __tablename__ = "ppm_project_maintenance"
    __table_args__ = (
        Index(
            "ix_ppm_project_maintenance_status",
            "project_status",
        ),
        Index(
            "ux_ppm_project_maintenance_code",
            "project_code",
            unique=True,
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # 源 createName —— 创建人姓名 (业务可读,与 audit created_by 分离)
    create_name: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    company_name: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    project_name: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    project_code: str = Field(
        sa_column=Column(String(100), nullable=False),
    )
    project_status: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    project_type: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    project_effective_start_time: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    project_effective_end_time: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    project_maintenance_end_time: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    # audit —— 操作人 UUID (平台级,无 workspace,沿用项目 audit 约定)
    created_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    updated_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class PpmCustomerMaintenance(BaseModel, table=True):
    """客户维护 —— 独立实体 (源无 FK 指向 project)。"""

    __tablename__ = "ppm_customer_maintenance"
    __table_args__ = (Index("ix_ppm_customer_maintenance_level", "level"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    create_name: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    company_name: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    contact: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    phone_no: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    dept_name: str | None = Field(
        default=None,
        sa_column=Column(String(150), nullable=True),
    )
    level: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    created_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    updated_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class PpmProjectMember(BaseModel, table=True):
    """项目成员 —— 挂在项目下,关联系统用户。

    源 ``userId`` (String) 升级为 UUID FK→``users.id``。
    ``role_id``/``role_name`` 是 ppm 项目角色字符串字段 (D-004@v1),
    不复用 auth.Role:典型值如 开发 / 项目经理 / 部门经理 / 成员。
    """

    __tablename__ = "ppm_project_member"
    __table_args__ = (
        Index(
            "ix_ppm_project_member_project",
            "pm_project_id",
        ),
        Index(
            "ux_ppm_project_member_project_user",
            "pm_project_id",
            "user_id",
            unique=True,
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    create_name: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    pm_project_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("ppm_project_maintenance.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    user_name: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    depart_id: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    phone: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    # ppm 项目角色字符串 (D-004@v1):开发 / 项目经理 / 部门经理 / 成员 …
    role_id: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    role_name: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    depart_name: str | None = Field(
        default=None,
        sa_column=Column(String(150), nullable=True),
    )
    created_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    updated_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class PpmProjectStakeholder(BaseModel, table=True):
    """项目干系人 —— 挂在项目下,与 member 并列。

    源:``ProjectStakeholderDO``。
    """

    __tablename__ = "ppm_project_stakeholder"
    __table_args__ = (
        Index(
            "ix_ppm_project_stakeholder_project",
            "pm_project_id",
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    stakeholder: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    stakeholder_role: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    phone: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    pm_project_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("ppm_project_maintenance.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    create_name: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    created_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    updated_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


__all__ = [
    "PpmCustomerMaintenance",
    "PpmProjectMaintenance",
    "PpmProjectMember",
    "PpmProjectStakeholder",
]
