"""``tasks`` table.

Schema follows ``references/17-db-schema.md`` §2.4 with extensions per task-06.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, Float, ForeignKey, Index, String, Text, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class Task(BaseModel, table=True):
    """A task parsed from ``changes/{location}/{change_key}/tasks/task-xx.md``."""

    __tablename__ = "tasks"
    __table_args__ = (
        Index("ux_tasks_change_key", "change_id", "task_key", unique=True),
        Index("ix_tasks_workspace", "workspace_id", "status"),
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
    change_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    task_key: str = Field(sa_column=Column(String(200), nullable=False))
    title: str | None = Field(default=None, sa_column=Column(String(500), nullable=True))
    status: str = Field(default="draft", sa_column=Column(String(30), nullable=False, default="draft"))
    phase: str | None = Field(default=None, sa_column=Column(String(20), nullable=True))
    priority: str | None = Field(default=None, sa_column=Column(String(10), nullable=True))
    owner_key: str | None = Field(default=None, sa_column=Column(String(100), nullable=True))
    estimated_hours: float | None = Field(default=None, sa_column=Column(Float, nullable=True))
    affected_components: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    allowed_paths: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    depends_on: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    blocks: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    path: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    content: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(
        default_factory=lambda: datetime.utcnow(),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.utcnow(),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
