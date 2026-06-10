"""Pydantic DTOs for the settings & user management API."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

# ── Platform settings ──────────────────────────────────────────────────


class SettingRead(BaseModel):
    key: str
    value: str
    updated_at: datetime | None = None


class SettingsBulkRead(BaseModel):
    settings: list[SettingRead]


class SettingsUpdateRequest(BaseModel):
    settings: dict[str, str] = Field(min_length=1)


class SettingsUpdateResponse(BaseModel):
    updated: list[str]


# ── User management ────────────────────────────────────────────────────


class UserCreateRequest(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=8)
    display_name: str | None = None
    is_platform_admin: bool = False


class UserUpdateRequest(BaseModel):
    display_name: str | None = None
    is_platform_admin: bool | None = None
    status: str | None = None


class UserQueryParams(BaseModel):
    q: str | None = None
    status: str | None = None
    role: str | None = None
    sort: str = "created_at"
    order: str = "desc"
    limit: int = Field(default=20, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


class UserListResponse(BaseModel):
    items: list[UserRead]
    total: int


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str | None
    status: str
    is_platform_admin: bool
    last_login_at: datetime | None
    created_at: datetime


# ── User detail endpoints ──────────────────────────────────────────────


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
    """用户在某 Workspace 中持有的角色信息。"""

    workspace_name: str
    workspace_slug: str
    role_name: str


class ResetPasswordRequest(BaseModel):
    new_password: str | None = Field(default=None, min_length=8)
    force_change_on_next_login: bool = False


class ResetPasswordResponse(BaseModel):
    plaintext_password: str
