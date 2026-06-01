"""Pydantic schemas for execution coordinator endpoints."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ResumeRequest(BaseModel):
    """Request body for resuming an interrupted run."""

    resume_token: str = Field(..., min_length=1, max_length=64)
    context_fingerprint: str | None = Field(default=None, max_length=64)


class ApproveRequest(BaseModel):
    """Request body for approving a pending run."""

    approval_token: str = Field(..., min_length=1, max_length=64)


class CheckpointResponse(BaseModel):
    """Response body for checkpoint load."""

    version: int
    data: dict | None
    created_at: datetime | None = None


class CheckpointSaveRequest(BaseModel):
    """Request body for saving checkpoint data."""

    data: dict = Field(...)


class CheckpointSaveResponse(BaseModel):
    """Response body after saving a checkpoint."""

    version: int
    created_at: datetime | None = None
