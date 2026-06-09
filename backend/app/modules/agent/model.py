"""AgentRun and AgentRunLog tables."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    text,
)
from sqlmodel import Field

from app.models.base import BaseModel


class AgentRun(BaseModel, table=True):
    """Tracks a single agent execution within a task lease."""

    __tablename__ = "agent_runs"
    __table_args__ = (
        Index("ix_agent_runs_task", "task_id"),
        Index("ix_agent_runs_lease", "lease_id"),
        Index("ix_agent_runs_change_id", "change_id"),
        Index(
            "ix_agent_runs_idempotency_key",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
        Index(
            "ix_agent_runs_resume_token",
            "resume_token",
            postgresql_where=text("resume_token IS NOT NULL"),
        ),
        Index(
            "ix_agent_runs_context_fingerprint",
            "context_fingerprint",
            postgresql_where=text("context_fingerprint IS NOT NULL"),
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    task_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    lease_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("worktree_leases.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    agent_type: str = Field(sa_column=Column(String(30), nullable=False))  # claude_code, etc.
    status: str = Field(
        default="pending",
        sa_column=Column(String(20), nullable=False, default="pending"),
    )  # pending, running, completed, failed, killed
    started_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    finished_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    exit_code: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    output_redacted: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    spec_strategy: str | None = Field(
        default=None,
        sa_column=Column(String(30), nullable=True),
    )
    profile_version: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    diff_summary: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    # ── Execution Coordinator fields ──
    idempotency_key: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    resume_token: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    checkpoint_version: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    version: int = Field(
        default=1,
        sa_column=Column(Integer, nullable=False, default=1),
    )
    approval_token: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    context_fingerprint: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    checkpoint_data: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    max_retries: int = Field(
        default=3,
        sa_column=Column(Integer, nullable=False, default=3),
    )
    retry_count: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    tool_policy_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("tool_policies.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    change_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    # ── Usage / cost tracking fields ──
    total_cost_usd: float | None = Field(
        default=None,
        sa_column=Column(Float, nullable=True),
    )
    duration_ms: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    duration_api_ms: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    num_turns: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    session_id: str | None = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    conversation_events: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    input_tokens: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    output_tokens: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    # ── Post-scan validation fields ──
    post_scan_status: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )  # success, failed_post_check, completed_with_warnings
    source_commit: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    is_resume: bool | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )  # Stored as 0/1 in DB
    resumed_from_step: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )


class AgentRunLog(BaseModel, table=True):
    """Individual log lines from an agent run."""

    __tablename__ = "agent_run_logs"
    __table_args__ = (Index("ix_agent_run_logs_run", "run_id"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    run_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    channel: str = Field(
        sa_column=Column(String(20), nullable=False),
    )  # stdout, stderr, tool_call
    content_redacted: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
