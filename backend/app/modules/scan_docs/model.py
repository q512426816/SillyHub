"""``scan_documents`` table.

Stores parsed scan documents from ``.sillyspec/docs/{component_key}/scan/*.md``.
Schema follows ``references/17-db-schema.md`` §2.3.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, String, Text, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class ScanDocument(BaseModel, table=True):
    """A single scan document associated with a workspace."""

    __tablename__ = "scan_documents"
    __table_args__ = (
        Index(
            "ux_scan_docs_workspace_path",
            "workspace_id",
            "path",
            unique=True,
        ),
        Index("ix_scan_docs_workspace", "workspace_id"),
    )

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
    doc_type: str = Field(sa_column=Column(String(100), nullable=False))
    path: str = Field(sa_column=Column(Text, nullable=False))
    title: str | None = Field(default=None, sa_column=Column(String(500), nullable=True))
    exists: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, default=True))
    content: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    last_modified_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
