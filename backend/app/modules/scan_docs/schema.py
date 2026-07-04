"""Pydantic DTOs for the scan docs API."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ScanDocRead(BaseModel):
    """Single scan document returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    doc_type: str
    path: str
    title: str | None = None
    exists: bool = True
    content: str | None = None
    last_modified_at: datetime | None = None
    # 来源跟踪（model 已有列，from_attributes 自动映射）。
    source_member_id: uuid.UUID | None = None
    source_synced_at: datetime | None = None
    source_mtime: datetime | None = None
    content_hash: str | None = None
    # 该路径历史冲突条数（router/service 注入，非 model 列）。
    conflict_count: int = 0


class ScanDocSummary(BaseModel):
    """Lightweight entry for list views (no content)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    doc_type: str
    path: str
    title: str | None = None
    exists: bool = True
    last_modified_at: datetime | None = None
    # 来源跟踪（model 已有列，from_attributes 自动映射）。
    source_member_id: uuid.UUID | None = None
    source_synced_at: datetime | None = None
    source_mtime: datetime | None = None
    content_hash: str | None = None
    # 该路径历史冲突条数（router/service 注入，非 model 列）。
    conflict_count: int = 0


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


class ScanDocConflictRead(BaseModel):
    """单条扫描文档路径的历史冲突归档记录（D-001@V1 last-write-wins 覆盖快照）。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    old_content: str | None = None
    old_source_member_id: uuid.UUID | None = None
    old_source_runtime_id: uuid.UUID | None = None
    old_mtime: datetime | None = None
    new_source_member_id: uuid.UUID | None = None
    new_mtime: datetime | None = None
    created_at: datetime
