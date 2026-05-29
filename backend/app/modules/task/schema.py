"""Pydantic DTOs for the task module."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TaskSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    change_id: uuid.UUID
    task_key: str
    title: str | None = None
    status: str
    phase: str | None = None
    priority: str | None = None
    owner_key: str | None = None
    estimated_hours: float | None = None
    affected_components: list[str] = []
    depends_on: list[str] = []
    blocks: list[str] = []
    created_at: datetime
    updated_at: datetime
    workspace_ids: list[uuid.UUID] = []


class TaskRead(TaskSummary):
    allowed_paths: list[str] = []
    path: str | None = None
    content: str | None = None


class TaskList(BaseModel):
    items: list[TaskSummary]
    total: int


class TaskBoardColumn(BaseModel):
    status: str
    count: int
    items: list[TaskSummary]


class TaskBoard(BaseModel):
    columns: list[TaskBoardColumn]


class TaskParseWarning(BaseModel):
    code: str
    detail: str
    task_key: str | None = None


class TaskReparseStats(BaseModel):
    parsed: int = 0
    created: int = 0
    updated: int = 0
    deleted: int = 0


class TaskReparseResponse(BaseModel):
    workspace_id: uuid.UUID
    change_id: uuid.UUID
    stats: TaskReparseStats
    warnings: list[TaskParseWarning] = []
