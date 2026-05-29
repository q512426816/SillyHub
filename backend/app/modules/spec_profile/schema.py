"""Pydantic DTOs for the spec_profile module.

author: qinyi
created_at: 2026-05-27
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ConflictTypeLiteral = Literal["gate", "schema", "path", "validation"]
ConflictStatusLiteral = Literal["open", "approved", "rejected", "resolved"]


# ── SpecProfileManifest DTOs ──────────────────────────────────────────────────


class SpecProfileManifestCreate(BaseModel):
    """Request body for creating a spec profile manifest."""

    source_path: str = Field(min_length=1, max_length=4096)
    version: str = Field(min_length=1, max_length=64)
    manifest_json: str | None = Field(default=None)
    is_active: bool = Field(default=True)


class SpecProfileManifestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_path: str
    version: str
    manifest_json: str | None
    is_active: bool
    created_at: datetime


class SpecProfileManifestListResponse(BaseModel):
    items: list[SpecProfileManifestRead]
    total: int


# ── SpecConflict DTOs ─────────────────────────────────────────────────────────


class SpecConflictRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    change_id: uuid.UUID | None
    task_id: uuid.UUID | None
    stage: str
    conflict_type: str
    details_json: str | None
    status: str
    created_at: datetime


class SpecConflictListResponse(BaseModel):
    items: list[SpecConflictRead]
    total: int


class SpecConflictResolve(BaseModel):
    """Request body for resolving a spec conflict."""

    status: ConflictStatusLiteral
    details_json: str | None = Field(default=None)
