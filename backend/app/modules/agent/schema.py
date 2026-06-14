"""Pydantic schemas for agent endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class AgentRunCreate(BaseModel):
    task_id: uuid.UUID
    lease_id: uuid.UUID
    agent_type: str = Field(default="claude_code", max_length=30)
    profile_version: str | None = None
    idempotency_key: str | None = Field(default=None, max_length=64)
    preferred_backend: str | None = Field(default=None, max_length=20)
    # Explicit agent provider override; when None the dispatch layer falls
    # through to workspace.default_agent (FR-02, change
    # 2026-06-14-agent-runtime-selection).
    provider: str | None = Field(default=None, max_length=64)


class ExecutionContextResponse(BaseModel):
    """daemon 执行所需的完整上下文（GET /agent-runs/{run_id}/execution-context）。

    对应 ``2026-06-14-unified-agent-execution`` task-02 / design §Phase 2。
    ``claude_md`` 由 ``render_bundle_to_claude_md`` 实时渲染（不入 lease.metadata），
    其余字段从活跃 lease.metadata 恢复（task-03 持久化）。
    """

    agent_run_id: str
    claude_md: str = Field(
        ...,
        description="render_bundle_to_claude_md 输出，daemon 写入 {workDir}/.claude/CLAUDE.md",
    )
    prompt: str | None = None
    provider: str | None = None
    resume_session_id: str | None = None
    repo_url: str | None = None
    branch: str | None = None
    allowed_paths: list[str] | None = None
    tool_config: dict | None = None
    session_id: str | None = None


class QuickChatRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    provider: str = Field(default="claude", max_length=30)
    workspace_id: uuid.UUID | None = None


class AgentRunResponse(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID | None
    lease_id: uuid.UUID | None
    agent_type: str
    status: str
    started_at: datetime | None
    finished_at: datetime | None
    exit_code: int | None
    output_redacted: str | None
    spec_strategy: str | None = None
    profile_version: str | None = None
    diff_summary: str | None = None
    change_id: uuid.UUID | None = None
    idempotency_key: str | None = None
    resume_token: str | None = None
    version: int | None = None
    context_fingerprint: str | None = None
    checkpoint_version: int | None = None
    workspace_ids: list[uuid.UUID] = []  # all associated workspaces
    total_cost_usd: float | None = None
    duration_ms: int | None = None
    duration_api_ms: int | None = None
    num_turns: int | None = None
    session_id: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    # Post-scan validation fields
    post_scan_status: str | None = None
    source_commit: str | None = None
    is_resume: bool | None = None
    resumed_from_step: int | None = None
    model_config = {"from_attributes": True}


class AgentRunLogEntry(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID
    timestamp: datetime
    channel: str
    content_redacted: str | None
    model_config = {"from_attributes": True}


class AgentKillResponse(BaseModel):
    id: uuid.UUID
    status: str
    model_config = {"from_attributes": True}


class WorkspaceSpecSummaryDTO(BaseModel):
    """Pydantic DTO for WorkspaceSpecSummary in API responses."""

    workspace_id: uuid.UUID
    name: str
    slug: str
    component_key: str | None = None
    relation_type: str
    direction: str
    spec_root: str | None = None
    doc_summaries: dict[str, str] = Field(default_factory=dict)


class AgentRunInputRequest(BaseModel):
    """Request DTO for submitting user guidance to an AgentRun."""

    content: str = Field(min_length=1, max_length=4000)

    @field_validator("content")
    @classmethod
    def _content_not_blank(cls, value: str) -> str:
        content = value.strip()
        if not content:
            raise ValueError("content must not be blank")
        return content


class AgentRunInputResponse(BaseModel):
    """Response DTO for user input submission."""

    run_id: uuid.UUID
    accepted: bool
