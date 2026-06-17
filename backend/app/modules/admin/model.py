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
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
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


__all__ = ["Organization", "UserOrganization", "UserRole"]
