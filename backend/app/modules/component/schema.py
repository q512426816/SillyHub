"""Pydantic DTOs for the component API."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ComponentRead(BaseModel):
    """Single ``project_components`` row exposed via the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    component_key: str
    name: str
    type: str | None = None
    role: str | None = None
    path: str | None = None
    repo_url: str | None = None
    default_branch: str | None = None
    tech_stack: list[str] = Field(default_factory=list)
    build_command: str | None = None
    test_command: str | None = None
    source_yaml_path: str
    status: str
    extra: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class RelationRead(BaseModel):
    """Single ``component_relations`` row exposed via the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    source_component_id: uuid.UUID
    target_component_id: uuid.UUID
    relation_type: str
    description: str | None = None


class ParseIssueRead(BaseModel):
    """User-facing diagnostic surfaced from the parser."""

    code: str
    file: str | None = None
    detail: str
    severity: str


class ComponentList(BaseModel):
    items: list[ComponentRead]
    total: int


class ReparseStats(BaseModel):
    parsed: int = 0
    created: int = 0
    updated: int = 0
    deleted: int = 0
    relations_created: int = 0
    relations_deleted: int = 0


class ReparseResponse(BaseModel):
    """Outcome of ``POST /components/reparse``."""

    workspace_id: uuid.UUID
    stats: ReparseStats
    components: list[ComponentRead]
    relations: list[RelationRead]
    warnings: list[ParseIssueRead] = Field(default_factory=list)
    errors: list[ParseIssueRead] = Field(default_factory=list)


class TopologyNode(BaseModel):
    id: uuid.UUID
    component_key: str
    name: str
    type: str | None
    status: str


class TopologyEdge(BaseModel):
    source: uuid.UUID
    target: uuid.UUID
    relation_type: str
    description: str | None = None


class TopologyResponse(BaseModel):
    workspace_id: uuid.UUID
    nodes: list[TopologyNode]
    edges: list[TopologyEdge]
