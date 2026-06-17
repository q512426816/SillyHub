"""Pydantic DTOs for the platform-settings API.

User-related schemas were moved to :mod:`app.modules.admin.schema`
(change ``2026-06-16-admin-org-role-center`` task-06). They are
re-exported here so historical imports keep working.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

# ── Platform settings (still owned here) ───────────────────────────────


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


# ── User schemas — re-exported from admin.schema (task-06) ─────────────


from app.modules.admin.schema import (  # noqa: E402
    AuditLogRead,
    OrganizationBrief,
    ResetPasswordRequest,
    ResetPasswordResponse,
    RevokeAllResponse,
    RoleBrief,
    UserCreateRequest,
    UserListResponse,
    UserQueryParams,
    UserRead,
    UserSessionRead,
    UserUpdateRequest,
    UserWorkspaceRead,
)

__all__ = [
    "AuditLogRead",
    "OrganizationBrief",
    "ResetPasswordRequest",
    "ResetPasswordResponse",
    "RevokeAllResponse",
    "RoleBrief",
    "SettingRead",
    "SettingsBulkRead",
    "SettingsUpdateRequest",
    "SettingsUpdateResponse",
    "UserCreateRequest",
    "UserListResponse",
    "UserQueryParams",
    "UserRead",
    "UserSessionRead",
    "UserUpdateRequest",
    "UserWorkspaceRead",
]
