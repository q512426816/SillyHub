"""Auth & RBAC tables.

Schema follows ``references/15-authentication.md`` §2 and
``references/16-rbac.md`` §5. Trimmed to the V1 horizontal slice:

* MFA, ``login_attempts`` and ``audit_events`` are deliberately deferred
  (see task-04a §1). The MFA columns on ``users`` are kept so a future
  migration only needs to drop nullable defaults, not rewrite the table.
* ``user_component_overrides`` is deferred entirely; nothing here references
  ``project_components`` yet, so importing this module stays cheap.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, String, Uuid
from sqlmodel import Field

from app.models.base import BaseModel

UserStatus = Literal["active", "disabled", "deleted"]


class User(BaseModel, table=True):
    """A platform account."""

    __tablename__ = "users"
    __table_args__ = (Index("ux_users_email_active", "email", unique=True),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    email: str = Field(sa_column=Column(String(255), nullable=False))
    password_hash: str = Field(sa_column=Column(String(255), nullable=False))
    display_name: str | None = Field(default=None, sa_column=Column(String(100), nullable=True))
    status: str = Field(default="active", sa_column=Column(String(20), nullable=False))
    is_platform_admin: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )
    # Independent login permission toggle (admin can disable without deleting).
    # Mirrors change 2026-06-16-admin-org-role-center task-02.
    login_enabled: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, default=True),
    )
    # MFA columns reserved for task-Auth-v2; nullable so V1 inserts skip them.
    mfa_secret: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    mfa_enabled: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    last_login_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    deleted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class Session(BaseModel, table=True):
    """A refresh-token-backed session.

    ``refresh_token_hash`` stores bcrypt(refresh_token). The plain refresh
    token is only ever returned to the client once during issuance.
    """

    __tablename__ = "sessions"
    __table_args__ = (Index("ix_sessions_user_revoked", "user_id", "revoked_at"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    refresh_token_hash: str = Field(sa_column=Column(String(255), nullable=False))
    user_agent: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    ip: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    expires_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    revoked_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class Role(BaseModel, table=True):
    """Named bundle of ``Permission`` strings."""

    __tablename__ = "roles"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    key: str = Field(sa_column=Column(String(50), unique=True, nullable=False))
    name: str = Field(sa_column=Column(String(100), nullable=False))
    description: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    is_system: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )
    # Activation toggle for custom roles; system roles always stay active.
    # Mirrors change 2026-06-16-admin-org-role-center task-02.
    is_active: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, default=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class RolePermission(BaseModel, table=True):
    """Composite PK: a permission string attached to a role."""

    __tablename__ = "role_permissions"

    role_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("roles.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    permission: str = Field(
        sa_column=Column(String(100), primary_key=True, nullable=False),
    )


class ApiKey(BaseModel, table=True):
    """A long-lived API key issued by a platform admin.

    The plaintext key is shown to the admin **once** at creation time and
    never persisted. The DB row stores ``bcrypt(plaintext)`` in
    ``key_hash`` plus a non-sensitive ``key_prefix`` (the first 12 chars
    of the plaintext) for display in the admin UI.

    Revocation sets ``revoked_at``; expiry sets ``expires_at``. Both are
    checked at authenticate time. ``last_used_at`` is updated on every
    successful authenticate.
    """

    __tablename__ = "api_keys"
    __table_args__ = (
        Index("ix_api_keys_user_revoked", "user_id", "revoked_at"),
        Index("ix_api_keys_prefix", "key_prefix"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    name: str = Field(sa_column=Column(String(100), nullable=False))
    key_prefix: str = Field(sa_column=Column(String(16), nullable=False))
    key_hash: str = Field(sa_column=Column(String(255), nullable=False))
    last_used_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    expires_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    revoked_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class UserWorkspaceRole(BaseModel, table=True):
    """Bind a User to a Role inside a Workspace.

    Composite PK ``(user_id, workspace_id, role_id)`` lets one user hold
    multiple roles in the same workspace (e.g. developer + reviewer).
    """

    __tablename__ = "user_workspace_roles"
    __table_args__ = (
        Index("ix_uwr_user", "user_id"),
        Index("ix_uwr_workspace", "workspace_id"),
    )

    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    role_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("roles.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    granted_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    granted_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
