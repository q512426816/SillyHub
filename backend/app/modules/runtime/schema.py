"""Pydantic DTOs for the runtime progress API."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class StageStep(BaseModel):
    """A single step within a stage."""

    name: str
    status: str = "pending"
    started_at: datetime | None = None
    completed_at: datetime | None = None
    output: str | None = None


class StageProgress(BaseModel):
    """Progress for one pipeline stage."""

    status: str = "pending"
    steps: list[StageStep] = Field(default_factory=list)
    started_at: datetime | None = None
    completed_at: datetime | None = None


class RuntimeProgress(BaseModel):
    """Runtime progress DTO (mapped from sillyspec.db)."""

    version: int = 1
    project: str | None = None
    current_stage: str | None = None
    current_change: str | None = None
    stages: dict[str, StageProgress] = Field(default_factory=dict)
    last_active: datetime | None = None


class UserInputEntry(BaseModel):
    """A single user input record parsed from user-inputs.md."""

    timestamp: str
    content: str


class ArtifactEntry(BaseModel):
    """A single artifact file under .runtime/artifacts/."""

    filename: str
    size_bytes: int
    last_modified: str | None = None
