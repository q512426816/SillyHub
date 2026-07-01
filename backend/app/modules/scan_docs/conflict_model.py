"""``scan_doc_conflict_history`` table — archived overwritten doc versions.

Change 2026-07-01-collaborative-workspace D-001@V1: when apply_sync file-level
merge overwrites a path with a newer-mtime version (last-write-wins), the old
content + source is archived here for read-only conflict history playback.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Text, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class ScanDocConflictHistory(BaseModel, table=True):
    """Archived overwritten version of a scan document (D-001@V1)."""

    __tablename__ = "scan_doc_conflict_history"
    __table_args__ = (Index("ix_scan_doc_conflict_ws_path", "workspace_id", "path"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    path: str = Field(sa_column=Column(Text, nullable=False))
    old_content: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    # Source ids as plain columns (no FK) — audit records survive deletion.
    old_source_member_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    old_source_runtime_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    old_mtime: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    new_source_member_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    new_mtime: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
