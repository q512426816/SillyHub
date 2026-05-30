"""``changes`` and ``change_documents`` tables.

Schema follows ``references/17-db-schema.md`` §2.4.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy import JSON
from sqlmodel import Field

from app.models.base import BaseModel


class Change(BaseModel, table=True):
    """A change record parsed from ``.sillyspec/changes/{location}/{change_key}/``."""

    __tablename__ = "changes"
    __table_args__ = (
        Index(
            "ux_changes_workspace_key",
            "workspace_id",
            "change_key",
            unique=True,
        ),
        Index("ix_changes_workspace", "workspace_id", "location", "status"),
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
    change_key: str = Field(sa_column=Column(String(200), nullable=False))
    title: str | None = Field(default=None, sa_column=Column(String(500), nullable=True))
    status: str = Field(default="draft", sa_column=Column(String(30), nullable=False, default="draft"))
    location: str = Field(sa_column=Column(String(20), nullable=False))
    path: str = Field(sa_column=Column(Text, nullable=False))
    affected_components: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    change_type: str | None = Field(default=None, sa_column=Column(String(50), nullable=True))
    owner_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    archived_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class ChangeDocument(BaseModel, table=True):
    """A document within a change directory."""

    __tablename__ = "change_documents"
    __table_args__ = (
        Index(
            "ux_change_docs_type_path",
            "change_id",
            "doc_type",
            "path",
            unique=True,
        ),
        Index("ix_change_docs_change", "change_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    change_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    doc_type: str = Field(sa_column=Column(String(30), nullable=False))
    path: str = Field(sa_column=Column(Text, nullable=False))
    exists: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, default=True))
    status: str | None = Field(default=None, sa_column=Column(String(30), nullable=True))
    last_modified_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    word_count: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
