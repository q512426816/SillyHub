"""Pydantic DTOs for the scan docs API."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ScanDocRead(BaseModel):
    """Single scan document returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    component_id: uuid.UUID
    doc_type: str
    path: str
    title: str | None = None
    exists: bool = True
    content: str | None = None
    last_modified_at: datetime | None = None


class ScanDocSummary(BaseModel):
    """Lightweight entry for list views (no content)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    component_id: uuid.UUID
    doc_type: str
    path: str
    title: str | None = None
    exists: bool = True
    last_modified_at: datetime | None = None


class ScanDocList(BaseModel):
    items: list[ScanDocSummary]
    total: int


class ScanDocWarning(BaseModel):
    code: str
    detail: str
    component_key: str | None = None
    doc_type: str | None = None


class ScanDocReparseStats(BaseModel):
    parsed: int = 0
    created: int = 0
    updated: int = 0
    deleted: int = 0


class ScanDocReparseResponse(BaseModel):
    """Outcome of ``POST /scan-docs/reparse``."""

    workspace_id: uuid.UUID
    stats: ScanDocReparseStats
    warnings: list[ScanDocWarning] = Field(default_factory=list)
