"""Pydantic DTOs for the workspace module."""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

WorkspaceStatusLiteral = Literal["active", "archived", "deleted"]

_SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$")


class WorkspaceStructureDTO(BaseModel):
    has_projects_dir: bool
    has_changes_dir: bool
    has_docs_dir: bool
    has_runtime_dir: bool
    has_local_yaml: bool
    projects_count: int
    active_changes_count: int
    archived_changes_count: int


class ScanRequest(BaseModel):
    root_path: str = Field(min_length=1, max_length=4096)


class ScanResponse(BaseModel):
    root_path: str
    sillyspec_path: str
    is_sillyspec: bool
    structure: WorkspaceStructureDTO
    warnings: list[str] = Field(default_factory=list)


class WorkspaceCreate(BaseModel):
    """Request body for ``POST /api/workspaces``.

    Either ``slug`` is provided explicitly, or the server derives one from
    ``name``. We only validate format here — uniqueness is enforced by the DB.
    """

    name: str = Field(min_length=1, max_length=200)
    slug: str | None = Field(default=None, max_length=100)
    root_path: str = Field(min_length=1, max_length=4096)

    @field_validator("slug")
    @classmethod
    def _validate_slug(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not _SLUG_RE.match(v):
            raise ValueError(
                "slug must be lower-case alphanumeric with hyphens, "
                "starting and ending with an alphanumeric character (1-100 chars)"
            )
        return v


class WorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    root_path: str
    sillyspec_path: str
    status: WorkspaceStatusLiteral
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    last_scanned_at: datetime | None
    deleted_at: datetime | None


class WorkspaceListResponse(BaseModel):
    items: list[WorkspaceRead]
    total: int


def slugify(name: str) -> str:
    """Derive a default slug from a workspace name.

    Lower-case, hyphen-separated, ASCII alphanumerics only. Falls back to
    ``"workspace"`` if the input contains no recognisable characters.
    """
    base = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower()
    base = re.sub(r"-+", "-", base) or "workspace"
    return base[:100]
