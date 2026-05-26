"""Pydantic DTOs for the auth API."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class LoginRequest(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=1)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class TokenPair(BaseModel):
    """Issued on login + refresh."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    access_expires_in: int  # seconds
    refresh_expires_in: int  # seconds


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str | None
    status: str
    is_platform_admin: bool
    last_login_at: datetime | None
    created_at: datetime


class WorkspaceRoleAssignment(BaseModel):
    workspace_id: uuid.UUID
    role_key: str
    role_name: str


class MeResponse(BaseModel):
    user: UserRead
    workspaces: list[WorkspaceRoleAssignment]
