"""Admin Pydantic schemas.

Request/response models for the admin router. Role DTOs landed in
task-04 (change ``2026-06-16-admin-org-role-center``); Organization
DTOs land in task-05; User DTOs land in task-06.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.modules.auth.permissions import Permission

# ── Role DTOs (task-04) ──────────────────────────────────────────────────────


class RoleCreateRequest(BaseModel):
    """Body of ``POST /api/admin/roles``.

    ``permission_keys`` uses the :class:`Permission` enum directly so
    FastAPI returns 422 for unknown strings without service-layer
    plumbing.
    """

    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    permission_keys: list[Permission] = Field(default_factory=list)
    is_active: bool = True


class RoleUpdateRequest(BaseModel):
    """Body of ``PATCH /api/admin/roles/{role_id}``.

    All fields optional — service treats ``permission_keys=None`` as
    "leave alone" and ``permission_keys=[]`` as "clear all".
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    permission_keys: list[Permission] | None = None
    is_active: bool | None = None


class RoleRead(BaseModel):
    """Single role row + its permissions + aggregated user_count."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    key: str
    name: str
    description: str | None
    is_system: bool
    is_active: bool
    permissions: list[str]
    user_count: int
    created_at: datetime
    updated_at: datetime


class RoleListResponse(BaseModel):
    """Paginated role list envelope."""

    items: list[RoleRead]
    total: int
    page: int
    size: int


class RoleUserRead(BaseModel):
    """User row attached to a role (either platform-level or workspace-scoped)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str | None
    is_platform_admin: bool
    status: str
    login_enabled: bool
    binding_type: Literal["platform", "workspace"]
    workspace_id: uuid.UUID | None = None
    workspace_name: str | None = None


class RoleUserListResponse(BaseModel):
    """Response of ``GET /api/admin/roles/{role_id}/users``."""

    items: list[RoleUserRead]
    total: int


# ── Organization DTOs (task-05) ──────────────────────────────────────────────


class OrganizationCreateRequest(BaseModel):
    """Body of ``POST /api/admin/organizations``.

    ``code`` follows the same ``^[a-z][a-z0-9_]*$`` convention as role
    keys for URL-safety. ``parent_id`` is optional — a missing parent
    makes the org a root.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    description: str | None = Field(default=None, max_length=500)
    parent_id: uuid.UUID | None = None
    sort_order: int = 0


class OrganizationUpdateRequest(BaseModel):
    """Body of ``PATCH /api/admin/organizations/{org_id}``.

    All fields optional. Service validates ``parent_id`` changes for
    self-loops and descendant cycles.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    code: str | None = Field(
        default=None, min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_]*$"
    )
    description: str | None = Field(default=None, max_length=500)
    parent_id: uuid.UUID | None = None
    sort_order: int | None = None


class OrganizationRead(BaseModel):
    """Single org + aggregate counts.

    ``member_count`` / ``children_count`` are filled by the service via
    a single GROUP BY query (no N+1). ``subtree_member_count`` covers
    the current org plus every descendant (distinct user_id).
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    code: str
    description: str | None
    parent_id: uuid.UUID | None
    status: Literal["active", "disabled"]
    sort_order: int
    member_count: int
    children_count: int
    # 当前 + 所有下级 distinct 成员数（D-003@v1：同一用户在子树多组织只计 1，service 注入）
    subtree_member_count: int
    created_at: datetime
    updated_at: datetime


class OrganizationDetail(OrganizationRead):
    """Extended payload for ``GET /{org_id}`` — embeds direct children."""

    children: list[OrganizationRead] = []


# ── User DTOs (task-06) ──────────────────────────────────────────────────────


class OrganizationBrief(BaseModel):
    """UserRead.organizations item — UI display fields only."""

    id: uuid.UUID
    name: str
    code: str


class RoleBrief(BaseModel):
    """UserRead.roles item — UI display fields only."""

    id: uuid.UUID
    key: str
    name: str


class UserCreateRequest(BaseModel):
    """Body of ``POST /api/admin/users`` (and forwarded ``/api/users``).

    ``password`` 可选：不传时由 ``UserService.create_user`` 落库为固定默认初始密码
    （``DEFAULT_INITIAL_PASSWORD``），管理员无需在新建表单中输入密码。显式传入时
    仍按 ``min_length=8`` 校验。
    """

    model_config = ConfigDict(extra="forbid")

    email: str | None = None
    password: str | None = Field(default=None, min_length=8)
    username: str = Field(min_length=3)
    display_name: str | None = None
    is_platform_admin: bool = False
    login_enabled: bool = True
    organization_ids: list[uuid.UUID] = Field(default_factory=list)
    role_ids: list[uuid.UUID] = Field(default_factory=list)


class UserUpdateRequest(BaseModel):
    """Body of ``PATCH /api/admin/users/{user_id}``.

    ``organization_ids`` / ``role_ids`` follow rewrite semantics:
    ``None`` → leave alone, ``[]`` → clear, ``[a, b]`` → replace.

    ``username`` / ``email`` 全 Optional（PATCH 语义）：
    缺省/``None`` → 不改；提供非空值 → service 层做唯一校验后更新。
    """

    model_config = ConfigDict(extra="forbid")

    username: str | None = None
    email: str | None = None
    display_name: str | None = None
    is_platform_admin: bool | None = None
    status: str | None = None
    login_enabled: bool | None = None
    organization_ids: list[uuid.UUID] | None = None
    role_ids: list[uuid.UUID] | None = None


class UserRead(BaseModel):
    """User row + login flag. Org/role lists are injected by the router."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str | None
    username: str | None
    display_name: str | None
    status: str
    is_platform_admin: bool
    login_enabled: bool
    last_login_at: datetime | None
    created_at: datetime
    organizations: list[OrganizationBrief] = Field(default_factory=list)
    roles: list[RoleBrief] = Field(default_factory=list)


class UserListResponse(BaseModel):
    items: list[UserRead]
    total: int


class UserQueryParams(BaseModel):
    q: str | None = None
    status: str | None = None
    role: str | None = None
    sort: str = "created_at"
    order: str = "desc"
    limit: int = Field(default=20, ge=1, le=200)
    offset: int = Field(default=0, ge=0)
    # 组织维度过滤：None/缺省 = 不过滤（全部用户）；非空时仅当 include_children=True 含下级组织
    organization_id: uuid.UUID | None = None
    # 是否含下级组织（D-001@v1 默认 True：当前 + 下级；False = 仅当前组织）
    include_children: bool = True


class UserSessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_agent: str | None
    ip: str | None
    created_at: datetime


class RevokeAllResponse(BaseModel):
    revoked_count: int


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    actor_id: uuid.UUID | None
    action: str
    resource_type: str
    resource_id: uuid.UUID
    details_json: str | None
    timestamp: datetime


class UserWorkspaceRead(BaseModel):
    workspace_name: str
    workspace_slug: str
    role_name: str


class ResetPasswordRequest(BaseModel):
    new_password: str | None = Field(default=None, min_length=8)
    force_change_on_next_login: bool = False


class ResetPasswordResponse(BaseModel):
    plaintext_password: str


__all__ = [
    "AuditLogRead",
    "OrganizationBrief",
    "OrganizationCreateRequest",
    "OrganizationDetail",
    "OrganizationRead",
    "OrganizationUpdateRequest",
    "ResetPasswordRequest",
    "ResetPasswordResponse",
    "RevokeAllResponse",
    "RoleBrief",
    "RoleCreateRequest",
    "RoleListResponse",
    "RoleRead",
    "RoleUpdateRequest",
    "RoleUserListResponse",
    "RoleUserRead",
    "UserCreateRequest",
    "UserListResponse",
    "UserQueryParams",
    "UserRead",
    "UserSessionRead",
    "UserUpdateRequest",
    "UserWorkspaceRead",
]
