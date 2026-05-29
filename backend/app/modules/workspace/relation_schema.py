"""Pydantic DTOs for workspace relation CRUD and topology queries."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RelationTypeLiteral = Literal[
    "depends_on",
    "consumes_api_from",
    "tests",
    "publishes_to",
    "documents",
]

VALID_RELATION_TYPES: list[str] = [
    "depends_on",
    "consumes_api_from",
    "tests",
    "publishes_to",
    "documents",
]


class RelationCreate(BaseModel):
    """Request body for POST /api/workspaces/{id}/relations."""

    target_id: uuid.UUID
    relation_type: RelationTypeLiteral
    description: str | None = None


class RelationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_id: uuid.UUID
    target_id: uuid.UUID
    relation_type: str
    description: str | None
    created_at: datetime


class RelationListResponse(BaseModel):
    outgoing: list[RelationRead]  # source = this workspace
    incoming: list[RelationRead]  # target = this workspace


class TopologyNode(BaseModel):
    """A workspace node in the topology graph."""

    id: uuid.UUID
    name: str
    slug: str
    component_key: str | None


class TopologyEdge(BaseModel):
    """A directed edge in the topology graph."""

    id: uuid.UUID
    source_id: uuid.UUID
    target_id: uuid.UUID
    relation_type: str
    description: str | None


class TopologyResponse(BaseModel):
    """Full topology graph response."""

    nodes: list[TopologyNode]
    edges: list[TopologyEdge]
