"""Health/version response models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

DependencyStatus = Literal["ok", "down"]
OverallStatus = Literal["ok", "degraded"]


class HealthResponse(BaseModel):
    status: OverallStatus = Field(description="`ok` when every dependency reports `ok`.")
    db: DependencyStatus
    redis: DependencyStatus
    version: str
    commit_sha: str
    server_time: datetime
    environment: str


class VersionResponse(BaseModel):
    version: str
    commit_sha: str
    environment: str
