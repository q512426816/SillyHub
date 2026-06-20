"""Mission API schemas (Wave 5, 2026-06-19-multi-agent-orchestration)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MissionCreateRequest(BaseModel):
    objective: str
    change_id: uuid.UUID | None = None
    budget_usd: float | None = None
    constraints: dict | None = None


class MissionWorkerRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str | None = None
    objective: str | None = None
    status: str
    total_cost_usd: float | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class MissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    change_id: uuid.UUID | None
    objective: str
    status: str  # derived via derive_status
    budget_usd: float | None
    cost_so_far: float
    constraints: dict | None
    cancelled_at: datetime | None
    created_at: datetime
    workers: list[MissionWorkerRunResponse]
