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
            "ix_agent_runs_agent_session_id",
            "agent_session_id",
        ),
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
    provider: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    model: str | None = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
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
    error_code: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )  # e.g. no_online_daemon (task-01)
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
    agent_session_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Points at the interactive AgentSession this run belongs to (D-005@v1,
    # session<->runs 1:N). Distinct from session_id above, which holds the
    # claude resume id (D-001@v1) and is left untouched.
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
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    # ── Multi-agent orchestration (2026-06-19-multi-agent-orchestration, Wave 1) ──
    mission_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_missions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    parent_run_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    role: str | None = Field(
        default=None,
        sa_column=Column(String(30), nullable=True),
    )  # Worker role within a Mission (arch | impl | test | integration | ...)
    objective: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )  # what this Run was delegated to achieve
    attempt: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
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


class AgentSession(BaseModel, table=True):
    """An interactive agent session (D-001@v1) backed by the SDK driver.

    Spans multiple AgentRun turns (D-005@v1 session<->runs 1:N) and is bound
    to a single long-lived DaemonTaskLease with kind="interactive" (D-002@v3).
    The ``agent_session_id`` column stores the SDK-returned session id used for
    resume; it is intentionally distinct from AgentRun.session_id (claude
    resume id, untouched per D-001@v1).
    """

    __tablename__ = "agent_sessions"
    __table_args__ = (
        Index("ix_agent_sessions_user_id", "user_id"),
        Index("ix_agent_sessions_runtime_id", "runtime_id"),
        Index("ix_agent_sessions_status", "status"),
        Index("ix_agent_sessions_lease_id", "lease_id"),
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
    runtime_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_runtimes.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    lease_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_task_leases.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    provider: str = Field(
        sa_column=Column(String(30), nullable=False),
    )
    status: str = Field(
        default="pending",
        sa_column=Column(String(20), nullable=False, default="pending"),
    )  # pending, active, reconnecting, ended, failed
    agent_session_id: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )  # SDK session_id (spike D3); NOT AgentRun.session_id (D-001@v1)
    config: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )  # { manual_approval, model, ... }
    turn_count: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    cwd: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True),
    )  # SessionManager working dir for resume (R-cwd, spike D3)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    last_active_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )  # D-004 idle 30min sweep (sweep logic in task-07)
    ended_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )  # written by service.end_session (task-05)


class AgentMission(BaseModel, table=True):
    """Aggregation root for a multi-agent delegation.

    2026-06-19-multi-agent-orchestration (Wave 1). Status is NOT persisted — it
    is derived from child AgentRuns (see ``agent.mission.derive_status``). Only
    intent metadata is stored; the source of truth remains AgentRun + Lease.
    """

    __tablename__ = "agent_missions"
    __table_args__ = (
        Index("ix_agent_missions_workspace", "workspace_id"),
        Index("ix_agent_missions_change", "change_id"),
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
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    objective: str = Field(sa_column=Column(Text, nullable=False))
    constraints: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )  # { max_workers, read_only_scope, ... }
    budget_tokens: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    budget_usd: float | None = Field(
        default=None,
        sa_column=Column(Float, nullable=True),
    )
    created_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    cancelled_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class AgentRunDependency(BaseModel, table=True):
    """DAG edge between AgentRuns in a Mission (worker ordering dependencies)."""

    __tablename__ = "agent_run_dependencies"
    __table_args__ = (
        Index("ix_agent_run_dep_run", "run_id"),
        Index("ix_agent_run_dep_depends", "depends_on_run_id"),
    )

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
    depends_on_run_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True), ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )


class AgentArtifact(BaseModel, table=True):
    """Structured output from a Worker Run (summary / patch / test_result / evidence).

    Raw logs stay in AgentRunLog; only structured artifacts are fed back to the
    Coordinator (proposal §4 — Coordinator never ingests raw logs).
    """

    __tablename__ = "agent_artifacts"
    __table_args__ = (Index("ix_agent_artifacts_run", "run_id"),)

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
    kind: str = Field(sa_column=Column(String(30), nullable=False))
    # summary | patch | test_result | evidence
    content_ref: str = Field(sa_column=Column(Text, nullable=False))
    # file path (e.g. .sillyspec/docs/arch.md) or inline structured summary
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
