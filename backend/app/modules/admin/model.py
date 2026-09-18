"""Admin ORM models.

Tables land across two tasks of change ``2026-06-16-admin-org-role-center``:

- task-05 → ``Organization`` / ``UserOrganization`` / ``UserRole`` (this file)
- task-06 → no new tables (users service reuses :mod:`app.modules.auth.model.User`)

The underlying tables were already created by the migration in
``202606161200_create_admin_org_role.py`` (task-01). This module only
exposes the ORM handles so services and routers can issue typed queries.

``UserRole`` lives here (not in :mod:`app.modules.auth.model`) because
its semantics are platform-level admin — workspace-scoped bindings
stay in :class:`~app.modules.auth.model.UserWorkspaceRole`.

``MenuOverride`` (table ``menu_overrides``) landed later via task-02 of
change ``2026-09-18-web-menu-management``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Uuid,
)
from sqlmodel import Field

from app.models.base import BaseModel


class Organization(BaseModel, table=True):
    """Hierarchical org tree (self-referencing via ``parent_id``)."""

    __tablename__ = "organizations"
    __table_args__ = (
        Index("ix_organizations_parent_id", "parent_id"),
        Index("ix_organizations_status", "status"),
        CheckConstraint(
            "status IN ('active', 'disabled')",
            name="ck_organizations_status",
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    name: str = Field(sa_column=Column(String(100), nullable=False))
    code: str = Field(sa_column=Column(String(50), unique=True, nullable=False))
    description: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    parent_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("organizations.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    status: str = Field(
        default="active",
        sa_column=Column(String(16), nullable=False, default="active"),
    )
    sort_order: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class UserOrganization(BaseModel, table=True):
    """M2M between users and organizations (direct membership)."""

    __tablename__ = "user_organizations"
    __table_args__ = (Index("ix_user_organizations_org", "organization_id"),)

    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    organization_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("organizations.id", ondelete="RESTRICT"),
            primary_key=True,
            nullable=False,
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class UserRole(BaseModel, table=True):
    """Platform-level M2M between users and roles.

    Workspace-agnostic counterpart to
    :class:`~app.modules.auth.model.UserWorkspaceRole`. Consumed by
    :func:`app.modules.auth.rbac.collect_permissions_platform` so the
    admin center can grant roles outside any workspace context.
    """

    __tablename__ = "user_roles"
    __table_args__ = (Index("ix_user_roles_role", "role_id"),)

    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    role_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("roles.id", ondelete="RESTRICT"),
            primary_key=True,
            nullable=False,
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class MenuOverride(BaseModel, table=True):
    """菜单显示覆盖（全局生效，无 role/user 维度，D-002@v1）。

    ``menu_key`` 对齐前端 ``MenuPermissionGroup.menuKey``；后端不校验其
    是否存在于前端注册表，任意稳定字符串可存（R-01 孤儿容忍）。可空列
    一律表示「未覆盖，使用代码默认」。
    """

    __tablename__ = "menu_overrides"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    menu_key: str = Field(
        sa_column=Column(String(64), unique=True, nullable=False),
    )
    # 显示名覆盖：NULL = 使用代码默认名（列名 label_override，对外 schema 字段名为 label）
    label_override: str | None = Field(
        default=None, sa_column=Column(String(30), nullable=True),
    )
    # 组内排序覆盖：NULL = 组内声明序
    sort_order: int | None = Field(
        default=None, sa_column=Column(Integer, nullable=True),
    )
    # 全局隐藏（对含平台管理员的所有用户生效；menu_key="menus" 的豁免在前端合并层）
    hidden: bool = Field(
        default=False, sa_column=Column(Boolean, nullable=False, default=False),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


__all__ = ["MenuOverride", "Organization", "UserOrganization", "UserRole"]
