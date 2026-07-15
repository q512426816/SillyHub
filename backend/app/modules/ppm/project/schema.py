"""pm 项目管理子域 DTO (Pydantic v2)。

每表 4 件套:``XxxCreate`` / ``XxxUpdate`` (update 全字段 Optional) /
``XxxResp`` (from_attributes) / ``XxxPageReq`` (分页 + 子域搜索字段)。

设计依据:``design.md`` §7,task-03.md。字段名对齐 model 蛇形,与源 VO
语义一致。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel as PydanticModel
from pydantic import ConfigDict, Field

# ---------------------------------------------------------------------------
# 项目维护 ppm_project_maintenance
# ---------------------------------------------------------------------------


class ProjectMaintenanceCreate(PydanticModel):
    """创建项目维护。``project_code`` 必填且唯一。"""

    create_name: str | None = None
    company_name: str | None = None
    project_name: str | None = None
    project_code: str
    project_status: str | None = None
    project_type: str | None = None
    project_effective_start_time: datetime | None = None
    project_effective_end_time: datetime | None = None
    project_maintenance_end_time: datetime | None = None


class ProjectMaintenanceUpdate(PydanticModel):
    """更新项目维护 (全字段可选)。``project_code`` 不允许在此修改。"""

    create_name: str | None = None
    company_name: str | None = None
    project_name: str | None = None
    project_status: str | None = None
    project_type: str | None = None
    project_effective_start_time: datetime | None = None
    project_effective_end_time: datetime | None = None
    project_maintenance_end_time: datetime | None = None


class ProjectMaintenanceResp(PydanticModel):
    """项目维护响应。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    create_name: str | None
    company_name: str | None
    project_name: str | None
    project_code: str
    project_status: str | None
    project_type: str | None
    project_effective_start_time: datetime | None
    project_effective_end_time: datetime | None
    project_maintenance_end_time: datetime | None
    created_by: uuid.UUID | None
    updated_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class ProjectMaintenancePageReq(PydanticModel):
    """项目维护分页搜索请求。

    支持按 ``project_name``/``project_code``/``project_status``/``project_type``
    模糊/精确过滤。``page`` 1-based,``order_by`` 排序字段。
    """

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=200)
    order_by: str | None = Field(default=None)
    order: str = Field(default="desc")

    project_name: str | None = None
    project_code: str | None = None
    project_status: str | None = None
    project_type: str | None = None


class ProjectSimpleItem(PydanticModel):
    """项目下拉项 ({id, name})。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_name: str | None


# ---------------------------------------------------------------------------
# 客户维护 ppm_customer_maintenance
# ---------------------------------------------------------------------------


class CustomerMaintenanceCreate(PydanticModel):
    create_name: str | None = None
    company_name: str | None = None
    contact: str | None = None
    phone_no: str | None = None
    dept_name: str | None = None
    level: str | None = None


class CustomerMaintenanceUpdate(PydanticModel):
    create_name: str | None = None
    company_name: str | None = None
    contact: str | None = None
    phone_no: str | None = None
    dept_name: str | None = None
    level: str | None = None


class CustomerMaintenanceResp(PydanticModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    create_name: str | None
    company_name: str | None
    contact: str | None
    phone_no: str | None
    dept_name: str | None
    level: str | None
    created_by: uuid.UUID | None
    updated_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class CustomerMaintenancePageReq(PydanticModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=200)
    order_by: str | None = Field(default=None)
    order: str = Field(default="desc")

    company_name: str | None = None
    contact: str | None = None
    level: str | None = None


# ---------------------------------------------------------------------------
# 项目成员 ppm_project_member
# ---------------------------------------------------------------------------


class ProjectMemberCreate(PydanticModel):
    """创建项目成员。``pm_project_id``/``user_id`` 必填。"""

    create_name: str | None = None
    pm_project_id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None = None
    depart_id: str | None = None
    phone: str | None = None
    role_id: str | None = None
    role_name: str | None = None
    depart_name: str | None = None


class ProjectMemberUpdate(PydanticModel):
    create_name: str | None = None
    user_name: str | None = None
    depart_id: str | None = None
    phone: str | None = None
    role_id: str | None = None
    role_name: str | None = None
    depart_name: str | None = None


class ProjectMemberResp(PydanticModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    create_name: str | None
    pm_project_id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None
    depart_id: str | None
    phone: str | None
    role_id: str | None
    role_name: str | None
    depart_name: str | None
    # 登录账号:由 service LEFT JOIN users 带出 (design §7.3),无对应用户则 None。
    # 可选默认 None,现有消费方(projects 抽屉等)向后兼容。
    username: str | None = None
    created_by: uuid.UUID | None
    updated_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class ProjectMemberPageReq(PydanticModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=200)
    order_by: str | None = Field(default=None)
    order: str = Field(default="desc")

    # 容错:str | None,非法值(如前端 "-" 占位)在 service 层被规整为 None
    # (不强校验 uuid 类型,避免 FastAPI 422 直接拒绝请求)。
    pm_project_id: str | uuid.UUID | None = None
    user_id: str | uuid.UUID | None = None
    role_name: str | None = None


# ---------------------------------------------------------------------------
# 项目成员聚合 (派生,非表实体) —— design §7.1
# ---------------------------------------------------------------------------


class ProjectMemberSummaryItem(PydanticModel):
    """项目成员聚合行 (派生,非表实体)。

    ``owner_name`` 由 service 推算:该项目 ``role_name ilike '%项目经理%'`` 的成员
    取 ``created_at`` 最早;无则 None。``member_count`` 派生自该项目成员行数。
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_name: str | None
    project_code: str
    project_status: str | None
    project_type: str | None
    company_name: str | None
    owner_name: str | None
    member_count: int
    updated_at: datetime


class ProjectMemberSummaryPageReq(PydanticModel):
    """项目成员聚合分页请求。

    分页四件 (沿用 ProjectMemberPageReq 的 Field 约束) + 6 维筛选。
    owner_name/member_keyword/role_name 在 service 层用 EXISTS 子查询匹配。
    """

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=200)
    order_by: str | None = Field(default=None)
    order: str = Field(default="desc")

    project_name: str | None = None
    project_status: str | None = None
    project_type: str | None = None
    owner_name: str | None = None
    member_keyword: str | None = None
    role_name: str | None = None


# ---------------------------------------------------------------------------
# 项目干系人 ppm_project_stakeholder
# ---------------------------------------------------------------------------


class ProjectStakeholderCreate(PydanticModel):
    create_name: str | None = None
    stakeholder: str | None = None
    stakeholder_role: str | None = None
    phone: str | None = None
    pm_project_id: uuid.UUID


class ProjectStakeholderUpdate(PydanticModel):
    create_name: str | None = None
    stakeholder: str | None = None
    stakeholder_role: str | None = None
    phone: str | None = None


class ProjectStakeholderResp(PydanticModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    stakeholder: str | None
    stakeholder_role: str | None
    phone: str | None
    pm_project_id: uuid.UUID
    create_name: str | None
    created_by: uuid.UUID | None
    updated_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class ProjectStakeholderPageReq(PydanticModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=200)
    order_by: str | None = Field(default=None)
    order: str = Field(default="desc")

    # 容错:同 ProjectMemberPageReq。
    pm_project_id: str | uuid.UUID | None = None
    stakeholder: str | None = None
    stakeholder_role: str | None = None


__all__ = [
    "CustomerMaintenanceCreate",
    "CustomerMaintenancePageReq",
    "CustomerMaintenanceResp",
    "CustomerMaintenanceUpdate",
    "ProjectMaintenanceCreate",
    "ProjectMaintenancePageReq",
    "ProjectMaintenanceResp",
    "ProjectMaintenanceUpdate",
    "ProjectMemberCreate",
    "ProjectMemberPageReq",
    "ProjectMemberResp",
    "ProjectMemberSummaryItem",
    "ProjectMemberSummaryPageReq",
    "ProjectMemberUpdate",
    "ProjectSimpleItem",
    "ProjectStakeholderCreate",
    "ProjectStakeholderPageReq",
    "ProjectStakeholderResp",
    "ProjectStakeholderUpdate",
]
