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


class GitOperationForbidden(BaseModel):
    detail: str
