"""Pydantic schemas for worktree lease API."""

from __future__ import annotations

import datetime
import uuid

from pydantic import BaseModel, ConfigDict, Field


class WorktreeAcquireRequest(BaseModel):
    component_id: uuid.UUID
    change_id: uuid.UUID
    task_id: uuid.UUID
    git_identity_id: uuid.UUID
    ttl_seconds: int = Field(default=3600, ge=60, le=86400)


class WorktreeLeaseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    component_id: uuid.UUID
    change_id: uuid.UUID
    task_id: uuid.UUID
    user_id: uuid.UUID
    run_id: uuid.UUID
    git_identity_id: uuid.UUID
    path: str
    branch_name: str
    status: str
    locked_at: datetime.datetime
    released_at: datetime.datetime | None = None
    expires_at: datetime.datetime


class WorktreeLeaseList(BaseModel):
    items: list[WorktreeLeaseRead]
    total: int


class WorktreeExtendRequest(BaseModel):
    additional_seconds: int = Field(..., ge=60, le=86400)
