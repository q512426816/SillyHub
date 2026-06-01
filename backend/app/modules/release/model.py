"""Release and ReleaseApproval tables."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, String, Text, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class Release(BaseModel, table=True):
    """A release bundles one or more changes for deployment."""

    __tablename__ = "releases"
    __table_args__ = (Index("ix_releases_workspace_status", "workspace_id", "status"),)

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
    version: str = Field(sa_column=Column(String(50), nullable=False))
    title: str | None = Field(default=None, sa_column=Column(String(500), nullable=True))
    status: str = Field(
        default="draft",
        sa_column=Column(String(30), nullable=False, default="draft"),
    )
    target_environment: str = Field(
        default="staging",
        sa_column=Column(String(30), nullable=False, default="staging"),
    )
    change_ids: list[uuid.UUID] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    deploy_policy: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    pre_check_result: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    post_check_result: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    deploy_output: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    creator_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    deployed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    rolled_back_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.utcnow(),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.utcnow(),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class ReleaseApproval(BaseModel, table=True):
    """An approval vote on a release."""

    __tablename__ = "release_approvals"
    __table_args__ = (
        Index(
            "ux_release_approvals_release_user",
            "release_id",
            "approver_id",
            unique=True,
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    release_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("releases.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    approver_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    verdict: str = Field(sa_column=Column(String(20), nullable=False))
    comment: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(
        default_factory=lambda: datetime.utcnow(),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
