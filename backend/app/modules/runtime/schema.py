"""Pydantic DTOs for the runtime progress API."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


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
    """Full runtime progress.json payload."""

    model_config = ConfigDict(populate_by_name=True)

    version: int = Field(default=1, alias="_version")
    project: str | None = None
    current_stage: str | None = Field(default=None, alias="currentStage")
    current_change: str | None = Field(default=None, alias="currentChange")
    stages: dict[str, StageProgress] = Field(default_factory=dict)
    last_active: datetime | None = Field(default=None, alias="lastActive")


class UserInputEntry(BaseModel):
    """A single user input record parsed from user-inputs.md."""

    timestamp: str
    content: str


class ArtifactEntry(BaseModel):
    """A single artifact file under .runtime/artifacts/."""

    filename: str
    size_bytes: int
    last_modified: str | None = None
