"""Pydantic DTOs for git identity."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class GitIdentityCreate(BaseModel):
    provider: str = Field(..., pattern=r"^(github|gitlab|gitea|generic)$")
    credential_type: str = Field(default="pat", pattern=r"^(pat|oauth|ssh_key|app)$")
    git_username: str | None = None
    git_email: str | None = None
    credential: str
    allowed_repositories: list[str] = Field(default_factory=list)
    expires_at: datetime | None = None


class GitIdentityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    provider: str
    git_username: str | None
    git_email: str | None
    credential_type: str
    key_id: str
    allowed_repositories: list[str]
    expires_at: datetime | None
    revoked_at: datetime | None
    last_used_at: datetime | None
    created_at: datetime


class GitIdentityList(BaseModel):
    items: list[GitIdentityRead]
    total: int


class AccessCheckRequest(BaseModel):
    identity_id: uuid.UUID
    repo_url: str


class AccessCheckResult(BaseModel):
    identity_id: uuid.UUID
    repo_url: str
    accessible: bool
    reason: str | None = None
