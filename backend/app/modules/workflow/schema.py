"""Pydantic schemas for workflow endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

# ── Transition ──────────────────────────────────────────────────────────────


class TransitionRequest(BaseModel):
    target: str = Field(..., min_length=1, max_length=30)


class TransitionResponse(BaseModel):
    id: uuid.UUID
    status: str
    previous_status: str
    model_config = {"from_attributes": True}


# ── Review ──────────────────────────────────────────────────────────────────


class ReviewSubmitRequest(BaseModel):
    verdict: str = Field(..., pattern=r"^(approve|reject)$")
    comment: str | None = None


class ReviewResponse(BaseModel):
    id: uuid.UUID
    change_id: uuid.UUID
    reviewer_id: uuid.UUID
    verdict: str
    comment: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Audit ───────────────────────────────────────────────────────────────────


class AuditLogEntry(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID | None
    actor_id: uuid.UUID | None
    action: str
    resource_type: str
    resource_id: uuid.UUID
    details_json: str | None
    timestamp: datetime
    model_config = {"from_attributes": True}


# ── Task transition ─────────────────────────────────────────────────────────


class TaskTransitionRequest(BaseModel):
    target: str = Field(..., min_length=1, max_length=30)


class TaskTransitionResponse(BaseModel):
    id: uuid.UUID
    status: str
    previous_status: str
    model_config = {"from_attributes": True}
