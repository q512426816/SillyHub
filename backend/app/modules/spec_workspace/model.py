"""``spec_workspaces`` table model.

Each row represents the platform-managed spec space associated with a workspace.
The ``workspace_id`` foreign key ties it 1:1 to ``workspaces``.

author: qinyi
created_at: 2026-05-27
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text, Uuid
from sqlmodel import Field

from app.models.base import BaseModel

SpecStrategy = Literal["platform-managed", "repo-mirrored", "repo-native"]
SyncStatus = Literal["pending", "clean", "dirty", "conflicted"]


class SpecWorkspace(BaseModel, table=True):
    """Platform-managed spec directory linked to a workspace.

    Strategy determines how spec files are managed:

    - ``platform-managed``: specs live in ``spec_root`` only (default).
    - ``repo-mirrored``: daemon 初始化时从源项目 ``.sillyspec`` 单次同步快照到
      ``spec_root``，之后平台托管（源项目后续变更不自动反映）。
    - ``repo-native``: the repo's own ``.sillyspec`` is the source of truth;
      ``spec_root`` is used as a cache or overlay.
    """

    __tablename__ = "spec_workspaces"
    __table_args__ = (
        Index(
            "ix_spec_workspaces_workspace_id",
            "workspace_id",
            unique=True,
        ),
        Index("ix_spec_workspaces_strategy", "strategy"),
        Index("ix_spec_workspaces_sync_status", "sync_status"),
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
    spec_root: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    strategy: str = Field(
        default="platform-managed",
        sa_column=Column(String(30), nullable=False),
    )
    repo_sillyspec_path: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    profile_version: str = Field(
        default="0.1.0",
        sa_column=Column(String(50), nullable=False),
    )
    sync_status: str = Field(
        default="pending",
        sa_column=Column(String(20), nullable=False),
    )
    last_synced_at: datetime | None = Field(
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
