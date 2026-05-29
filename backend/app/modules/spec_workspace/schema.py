"""Pydantic DTOs for the spec_workspace module.

author: qinyi
created_at: 2026-05-27
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SpecStrategyLiteral = Literal["platform-managed", "repo-mirrored", "repo-native"]
SyncStatusLiteral = Literal["clean", "dirty", "conflicted"]


class SpecWorkspaceCreate(BaseModel):
    """Request body for creating a spec workspace.

    ``spec_root`` defaults to ``None`` in the request — the service layer
    generates the platform-managed path when not supplied.
    """

    spec_root: str | None = Field(default=None, max_length=4096)
    strategy: SpecStrategyLiteral = Field(default="platform-managed")
    repo_sillyspec_path: str | None = Field(default=None, max_length=4096)
    profile_version: str = Field(default="0.1.0", max_length=50)


class SpecWorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    spec_root: str
    strategy: str
    repo_sillyspec_path: str | None
    profile_version: str
    sync_status: str
    last_synced_at: datetime | None
    created_at: datetime
    updated_at: datetime


class SpecWorkspaceUpdate(BaseModel):
    """Partial update for spec workspace fields."""

    strategy: SpecStrategyLiteral | None = Field(default=None)
    repo_sillyspec_path: str | None = Field(default=None)
    profile_version: str | None = Field(default=None, max_length=50)


class SyncStatusUpdate(BaseModel):
    """Body for the ``update_sync_status`` endpoint."""

    sync_status: SyncStatusLiteral
