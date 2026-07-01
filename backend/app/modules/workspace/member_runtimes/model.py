"""``workspace_member_runtimes`` table — per-member daemon+path binding.

Change 2026-07-01-collaborative-workspace (D-002@V1 / D-005@V1): each member
(including the owner) configures their own daemon runtime + local root_path
for a workspace. This table is the single runtime source for dispatch; the
legacy ``workspaces.daemon_runtime_id`` / ``root_path`` / ``path_source``
columns are deprecated to read-only (see task-02 migration).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class WorkspaceMemberRuntime(BaseModel, table=True):
    """Per-member daemon runtime + local path binding for a workspace."""

    __tablename__ = "workspace_member_runtimes"
    __table_args__ = (
        Index("ix_wmr_workspace", "workspace_id"),
        Index("ix_wmr_runtime", "runtime_id"),
    )

    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    runtime_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_runtimes.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    root_path: str = Field(sa_column=Column(String, nullable=False))
    path_source: str = Field(sa_column=Column(String(20), nullable=False))
    synced_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    last_scan_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
