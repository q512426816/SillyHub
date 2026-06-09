"""SQLModel tables for spec_profile manifests and conflicts.

author: qinyi
created_at: 2026-05-27

Tables
------
- ``spec_profile_manifests``: stores imported SillySpec profile manifests
  including stages, documents, gates and agent contracts.
- ``spec_conflicts``: records conflicts detected between platform requirements
  and the active spec profile (gate, schema, path, validation).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, String, Text, Uuid, text
from sqlmodel import Field

from app.models.base import BaseModel

ConflictTypeLiteral = Literal["gate", "schema", "path", "validation"]
ConflictStatusLiteral = Literal["open", "approved", "rejected", "resolved"]


class SpecProfileManifest(BaseModel, table=True):
    """An imported SillySpec profile manifest.

    The ``manifest_json`` column holds the full manifest blob (stages,
    documents, gates, agent contracts) as serialised JSON. Only one manifest
    should be ``is_active=True`` at a time -- uniqueness is enforced at the
    service layer.
    """

    __tablename__ = "spec_profile_manifests"
    __table_args__ = (Index("ix_spec_profile_manifests_is_active", "is_active"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    source_path: str = Field(
        sa_column=Column(Text, nullable=False, comment="Profile source path on disk"),
    )
    version: str = Field(
        sa_column=Column(String(64), nullable=False, comment="SillySpec / profile version"),
    )
    manifest_json: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True, comment="Full manifest JSON blob"),
    )
    is_active: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, server_default=text("TRUE")),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class SpecConflict(BaseModel, table=True):
    """A conflict detected between platform requirements and the spec profile.

    Conflicts are scoped to a workspace and optionally to a specific change or
    task. The ``details_json`` blob carries machine-readable conflict details
    that can be rendered in the UI or consumed by automated resolution.
    """

    __tablename__ = "spec_conflicts"
    __table_args__ = (
        Index("ix_spec_conflicts_workspace_id", "workspace_id"),
        Index("ix_spec_conflicts_status", "status"),
        Index("ix_spec_conflicts_stage", "stage"),
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
    change_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    task_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    stage: str = Field(
        sa_column=Column(String(64), nullable=False, comment="Conflict stage"),
    )
    conflict_type: str = Field(
        sa_column=Column(String(32), nullable=False, comment="gate / schema / path / validation"),
    )
    details_json: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True, comment="Conflict details JSON"),
    )
    status: str = Field(
        default="open",
        sa_column=Column(String(20), nullable=False, server_default=text("'open'")),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
