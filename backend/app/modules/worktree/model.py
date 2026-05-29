"""WorktreeLease table.

Tracks isolated git worktree leases for agent execution.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class WorktreeLease(BaseModel, table=True):
    """A leased git worktree for isolated agent execution."""

    __tablename__ = "worktree_leases"

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
    component_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    change_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    task_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    run_id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), nullable=False),
    )
    git_identity_id: uuid.UUID = Field(
        sa_column=Column(Uuid(as_uuid=True), nullable=False),
    )
    path: str = Field(
        sa_column=Column(Text, nullable=False, unique=True),
    )
    branch_name: str = Field(
        max_length=500,
        sa_column=Column(String(500), nullable=False),
    )
    status: str = Field(
        default="locked",
        max_length=20,
        sa_column=Column(String(20), nullable=False, default="locked"),
    )
    locked_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime, nullable=False, default=datetime.utcnow),
    )
    released_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime, nullable=True),
    )
    expires_at: datetime = Field(
        sa_column=Column(DateTime, nullable=False),
    )

    __table_args__ = (
        Index("ix_worktree_active", "task_id", "status"),
        Index("ix_worktree_expires", "status", "expires_at"),
    )
