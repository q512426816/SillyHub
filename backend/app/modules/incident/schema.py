"""Incident and Postmortem schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel as PydanticModel


class IncidentCreate(PydanticModel):
    title: str
    severity: str = "medium"
    description: str | None = None
    affected_components: list[str] = []
    release_id: str | None = None


class IncidentUpdate(PydanticModel):
    status: str | None = None
    severity: str | None = None
    description: str | None = None
    root_cause: str | None = None
    resolution: str | None = None
    resolved_by: str | None = None


class IncidentResponse(PydanticModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str
    severity: str
    status: str
    description: str | None
    root_cause: str | None
    resolution: str | None
    affected_components: list[str]
    reporter_id: uuid.UUID
    resolved_at: datetime | None
    resolved_by: uuid.UUID | None
    release_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PostmortemCreate(PydanticModel):
    timeline: str | None = None
    impact: str | None = None
    root_cause_analysis: str | None = None
    action_items: list[str] = []
    lessons_learned: str | None = None


class PostmortemResponse(PydanticModel):
    id: uuid.UUID
    incident_id: uuid.UUID
    timeline: str | None
    impact: str | None
    root_cause_analysis: str | None
    action_items: list[str]
    lessons_learned: str | None
    author_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
