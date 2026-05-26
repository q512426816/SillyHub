"""``workspaces`` table model.

Schema follows ``references/17-db-schema.md`` §2.3. The ``created_by`` foreign
key to ``users`` is intentionally relaxed in V1 — the users table lands with
task-04, after which a follow-up migration will add the FK constraint.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy import Column, DateTime, Index, String, Uuid, text
from sqlmodel import Field

from app.models.base import BaseModel

WorkspaceStatus = Literal["active", "archived", "deleted"]


class Workspace(BaseModel, table=True):
    """A SillySpec-aware workspace registered with the platform.

    Uniqueness on ``root_path`` and ``slug`` is enforced via partial unique
    indexes restricted to ``deleted_at IS NULL``. This lets soft-deleted
    rows keep their original path while a brand-new (or resurrected) active
    workspace can take the same path again. See migration 202605261000.
    """

    __tablename__ = "workspaces"
    __table_args__ = (
        Index("ix_workspaces_status", "status"),
        Index("ix_workspaces_created_by", "created_by"),
        Index(
            "ux_workspaces_root_path_active",
            "root_path",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
            sqlite_where=text("deleted_at IS NULL"),
        ),
        Index(
            "ux_workspaces_slug_active",
            "slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
            sqlite_where=text("deleted_at IS NULL"),
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    name: str = Field(sa_column=Column(String(200), nullable=False))
    slug: str = Field(sa_column=Column(String(100), nullable=False))
    root_path: str = Field(sa_column=Column(String, nullable=False))
    sillyspec_path: str = Field(sa_column=Column(String, nullable=False))
    status: str = Field(default="active", sa_column=Column(String(20), nullable=False))
    created_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.utcnow(),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.utcnow(),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    last_scanned_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    deleted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
