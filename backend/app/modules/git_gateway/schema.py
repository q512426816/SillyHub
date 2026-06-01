"""Pydantic schemas for git gateway API."""

from __future__ import annotations

import datetime
import uuid

from pydantic import BaseModel, ConfigDict, Field


class GitOperationRequest(BaseModel):
    operation: str = Field(..., min_length=1, max_length=50)
    args: list[str] = Field(default_factory=list, max_length=20)


class GitOperationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    operation: str
    result_code: int
    redacted_output: str | None = None
    timestamp: datetime.datetime


class GitOperationLogItem(BaseModel):
    """Single audit log entry returned by the list endpoint."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    lease_id: uuid.UUID
    user_id: uuid.UUID
    operation: str
    args_json: str | None = None
    result_code: int
    redacted_output: str | None = None
    timestamp: datetime.datetime


class GitOperationListResponse(BaseModel):
    """Paginated list of git operation audit logs."""

    items: list[GitOperationLogItem]
    total: int
    page: int
    page_size: int


class RetryPolicy(BaseModel):
    """Retry configuration for git operations.

    max_retries: maximum number of retries (0 = no retry). Default 3.
    base_delay: base delay in seconds for exponential backoff. Default 1.0.
    """

    max_retries: int = Field(default=3, ge=0, le=10)
    base_delay: float = Field(default=1.0, ge=0.1, le=60.0)


class GitOperationForbidden(BaseModel):
    detail: str
