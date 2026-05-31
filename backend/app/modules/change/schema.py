"""Pydantic DTOs for the change module."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ChangeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    workspace_ids: list[uuid.UUID] = []
    change_key: str
    title: str | None
    status: str
    location: str
    path: str
    affected_components: list[str]
    change_type: str | None
    owner_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


class ChangeSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    change_key: str
    title: str | None
    status: str
    location: str
    change_type: str | None
    affected_components: list[str]
    owner_id: uuid.UUID | None
    updated_at: datetime
    workspace_ids: list[uuid.UUID] = []


class ChangeList(BaseModel):
    items: list[ChangeSummary]
    total: int


class ChangeDocMatrixEntry(BaseModel):
    doc_type: str
    exists: bool
    path: str | None
    status: str | None
    last_modified_at: datetime | None


class ChangeDocMatrix(BaseModel):
    change_id: uuid.UUID
    documents: list[ChangeDocMatrixEntry]
    prototypes: list[str]
    references: list[str]


class ChangeDocContent(BaseModel):
    doc_type: str
    path: str
    content: str | None
    exists: bool


class ChangeWarning(BaseModel):
    code: str
    detail: str
    change_key: str | None
    doc_type: str | None


class ChangeReparseStats(BaseModel):
    parsed: int = 0
    created: int = 0
    updated: int = 0
    deleted: int = 0


class ChangeReparseResponse(BaseModel):
    workspace_id: uuid.UUID
    stats: ChangeReparseStats
    warnings: list[ChangeWarning] = Field(default_factory=list)


# ── Progress ────────────────────────────────────────────────────────────


class ProgressUpdate(BaseModel):
    currentStage: str
    stages: dict
    lastActive: str


class OkResponse(BaseModel):
    ok: bool = True


# ── Approval ────────────────────────────────────────────────────────────


class ApprovalRead(BaseModel):
    status: str
    reason: str | None = None


class ApproveRequest(BaseModel):
    approved_by: str


class RejectRequest(BaseModel):
    reason: str


# ── Documents sync ─────────────────────────────────────────────────────


class DocumentsSyncRequest(BaseModel):
    """Key is filename, value is file content."""

    model_config = ConfigDict(extra="allow")

    def iter_documents(self) -> list[tuple[str, str]]:
        """Return list of (filename, content) pairs."""
        return [(k, v) for k, v in self.model_extra.items()] if self.model_extra else []


class DocumentsSyncResponse(BaseModel):
    synced: int
