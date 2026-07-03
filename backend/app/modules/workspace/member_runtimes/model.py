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

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class WorkspaceMemberRuntime(BaseModel, table=True):
    """Per-member daemon runtime + local path binding for a workspace."""

    __tablename__ = "workspace_member_runtimes"
    __table_args__ = (
        Index("ix_wmr_workspace", "workspace_id"),
        Index("ix_wmr_runtime", "runtime_id"),
        Index("ix_wmr_daemon", "daemon_id"),
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
    # Change 2026-07-03-daemon-entity-binding task-03 / D-004:
    # 新绑定对象——守护进程实体（取代 runtime_id 作为派发依据）。nullable 便于
    # 过渡：旧 binding 行 daemon_id 留空 → dispatch 报「未绑定守护进程，请重绑」
    # （task-08）。ondelete=RESTRICT：删 daemon_instance 前需先解绑，避免悬空。
    daemon_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_instances.id", ondelete="RESTRICT"),
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
    # Change 2026-07-02-workspace-config-flow task-03 / D-010:
    # Timestamp + spec_version captured the last time this member successfully
    # ran an `init` lease (backend writes them on init_completed; see task-07).
    # Both stay NULL until the first init completes — PUT /my-binding must NOT
    # touch them (only the init-lease complete path does). NULL = uninitialized.
    init_synced_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    init_synced_spec_version: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
