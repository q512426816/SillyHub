"""``project_components`` and ``component_relations`` tables.

Schema follows ``references/17-db-schema.md`` §2.3 plus one local extension:
an ``extra JSONB`` column captures unknown YAML keys (task-03 §3.5).

The FK from ``project_components.workspace_id`` to ``workspaces.id`` is declared
at the SQL level via the migration; the SQLModel class keeps it as a plain
UUID column to avoid forcing import order between feature modules.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, String, Uuid
from sqlmodel import Field

from app.models.base import BaseModel

ComponentStatus = Literal["active", "path_missing"]


class ProjectComponent(BaseModel, table=True):
    """A single ``projects/*.yaml`` entry parsed into the DB."""

    __tablename__ = "project_components"
    __table_args__ = (
        Index(
            "ux_components_workspace_key",
            "workspace_id",
            "component_key",
            unique=True,
        ),
        Index("ix_components_workspace", "workspace_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    component_key: str = Field(sa_column=Column(String(100), nullable=False))
    name: str = Field(sa_column=Column(String(200), nullable=False))
    type: str | None = Field(default=None, sa_column=Column(String(50), nullable=True))
    role: str | None = Field(default=None, sa_column=Column(String(100), nullable=True))
    path: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    repo_url: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    default_branch: str | None = Field(
        default="main",
        sa_column=Column(String(100), nullable=True),
    )
    tech_stack: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    build_command: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    test_command: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    source_yaml_path: str = Field(sa_column=Column(String, nullable=False))
    status: str = Field(default="active", sa_column=Column(String(20), nullable=False))
    extra: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False, default=dict),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.utcnow(),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.utcnow(),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class ComponentRelation(BaseModel, table=True):
    """Directed relation between two components within the same workspace."""

    __tablename__ = "component_relations"
    __table_args__ = (
        Index(
            "ux_relations_triplet",
            "source_component_id",
            "target_component_id",
            "relation_type",
            unique=True,
        ),
        Index("ix_relations_workspace", "workspace_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    source_component_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("project_components.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    target_component_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("project_components.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    relation_type: str = Field(sa_column=Column(String(50), nullable=False))
    description: str | None = Field(default=None, sa_column=Column(String, nullable=True))
