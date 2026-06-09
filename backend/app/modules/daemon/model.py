"""DaemonRuntime and DaemonTaskLease SQLModel tables."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Uuid,
    text,
)
from sqlmodel import Field

from app.models.base import BaseModel


class DaemonRuntime(BaseModel, table=True):
    """A registered local daemon runtime (e.g. Claude Code CLI instance)."""

    __tablename__ = "daemon_runtimes"
    __table_args__ = (
        Index("idx_daemon_runtimes_user_id", "user_id"),
        Index("idx_daemon_runtimes_status", "status"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    name: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    provider: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    version: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    os: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    arch: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    status: str | None = Field(
        default="online",
        sa_column=Column(String(20), nullable=True),
    )
    last_heartbeat_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    capabilities: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    metadata_: dict | None = Field(
        default=None,
        sa_column=Column("metadata", JSON, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )


class DaemonTaskLease(BaseModel, table=True):
    """A task lease claimed by a daemon runtime for execution."""

    __tablename__ = "daemon_task_leases"
    __table_args__ = (
        Index("idx_daemon_task_leases_runtime_id", "runtime_id"),
        Index("idx_daemon_task_leases_status", "status"),
        Index("idx_daemon_task_leases_agent_run_id", "agent_run_id"),
        Index(
            "idx_daemon_task_leases_expires_at",
            "lease_expires_at",
            postgresql_where=text("status IN ('claimed', 'pending')"),
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    runtime_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_runtimes.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    agent_run_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    status: str | None = Field(
        default="pending",
        sa_column=Column(String(20), nullable=True),
    )
    claimed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    lease_expires_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    attempt_number: int | None = Field(
        default=1,
        sa_column=Column(Integer, nullable=True, server_default=text("1")),
    )
    metadata_: dict | None = Field(
        default=None,
        sa_column=Column("metadata", JSON, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
