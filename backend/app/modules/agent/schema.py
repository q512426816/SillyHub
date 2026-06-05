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
