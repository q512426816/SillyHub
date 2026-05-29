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
