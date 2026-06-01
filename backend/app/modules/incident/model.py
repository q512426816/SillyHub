"""Incident and Postmortem models."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, String, Text, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class Incident(BaseModel, table=True):
    __tablename__ = "incidents"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, sa_column=Column(Uuid, primary_key=True))
    workspace_id: uuid.UUID = Field(
        sa_column=Column(Uuid, ForeignKey("workspaces.id"), nullable=False)
    )
    title: str = Field(sa_column=Column(String(500), nullable=False))
    severity: str = Field(default="medium", sa_column=Column(String(20), nullable=False))
    status: str = Field(default="open", sa_column=Column(String(30), nullable=False))
    description: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    root_cause: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    resolution: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    affected_components: list = Field(default=[], sa_column=Column(JSON, nullable=False))
    reporter_id: uuid.UUID = Field(sa_column=Column(Uuid, ForeignKey("users.id"), nullable=False))
    resolved_at: datetime | None = Field(default=None, sa_column=Column(DateTime, nullable=True))
    resolved_by: uuid.UUID | None = Field(
        default=None, sa_column=Column(Uuid, ForeignKey("users.id"), nullable=True)
    )
    release_id: uuid.UUID | None = Field(
        default=None, sa_column=Column(Uuid, ForeignKey("releases.id"), nullable=True)
    )
    created_at: datetime = Field(
        default_factory=datetime.utcnow, sa_column=Column(DateTime, nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow, sa_column=Column(DateTime, nullable=False)
    )

    __table_args__ = (Index("ix_incidents_workspace_status", "workspace_id", "status"),)


class Postmortem(BaseModel, table=True):
    __tablename__ = "postmortems"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, sa_column=Column(Uuid, primary_key=True))
    incident_id: uuid.UUID = Field(
        sa_column=Column(Uuid, ForeignKey("incidents.id"), nullable=False, unique=True)
    )
    timeline: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    impact: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    root_cause_analysis: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    action_items: list = Field(default=[], sa_column=Column(JSON, nullable=False))
    lessons_learned: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    author_id: uuid.UUID = Field(sa_column=Column(Uuid, ForeignKey("users.id"), nullable=False))
    created_at: datetime = Field(
        default_factory=datetime.utcnow, sa_column=Column(DateTime, nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow, sa_column=Column(DateTime, nullable=False)
    )
