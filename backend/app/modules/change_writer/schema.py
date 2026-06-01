"""Pydantic schemas for change writer API."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ChangeCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    description: str = Field(default="", max_length=5000)
    scope: str = Field(default="full", pattern="^(full|quick)$")
    change_type: str | None = Field(default=None, max_length=50)
    affected_components: list[str] = Field(default_factory=list)
    lease_id: uuid.UUID | None = None


class ChangeCreateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    change_key: str
    title: str | None
    status: str
    current_stage: str | None
    path: str
    created_at: datetime


class MarkdownGenerateRequest(BaseModel):
    doc_type: str = Field(..., min_length=1, max_length=30)
    content: str = Field(..., min_length=1)
    lease_id: uuid.UUID | None = None


class MarkdownGenerateResponse(BaseModel):
    doc_type: str
    path: str
    size: int


class BatchGenerateRequest(BaseModel):
    doc_types: list[str] = Field(..., min_length=1)


class BatchGenerateResponse(BaseModel):
    generated: list[str]
