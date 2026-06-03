"""Pydantic DTOs for the workspace module."""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

WorkspaceStatusLiteral = Literal["active", "archived", "deleted"]

_SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$")

# Unicode bidirectional / invisible characters commonly copied from Windows
# Explorer address bar (U+200E-200F, U+202A-202E, U+2066-2069, U+FEFF).
_INVISIBLE_RE = re.compile(r"[‎‏‪‫‬‭‮⁦⁧⁨⁩﻿]")


def _sanitize_path(v: str) -> str:
    return _INVISIBLE_RE.sub("", v).strip()


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

    @field_validator("root_path", mode="before")
    @classmethod
    def _sanitize_root_path(cls, v: str) -> str:
        return _sanitize_path(v)


class ScanResponse(BaseModel):
    root_path: str
    is_sillyspec: bool
    sillyspec_path: str | None = None
    structure: WorkspaceStructureDTO
    warnings: list[str] = Field(default_factory=list)


class ScanGenerateRequest(BaseModel):
    """Request body for ``POST /api/workspaces/scan-generate``."""

    root_path: str = Field(min_length=1, max_length=4096)

    @field_validator("root_path", mode="before")
    @classmethod
    def _sanitize_root_path(cls, v: str) -> str:
        return _sanitize_path(v)


class ScanGenerateResponse(BaseModel):
    """Response body for ``POST /api/workspaces/scan-generate``."""

    workspace_id: uuid.UUID
    agent_run_id: uuid.UUID


class WorkspaceCreate(BaseModel):
    """Request body for ``POST /api/workspaces``.

    Either ``slug`` is provided explicitly, or the server derives one from
    ``name``. We only validate format here — uniqueness is enforced by the DB.
    """

    name: str = Field(min_length=1, max_length=200)
    slug: str | None = Field(default=None, max_length=100)
    root_path: str = Field(min_length=1, max_length=4096)
    # Component metadata fields (all optional, for parsed workspaces)
    component_key: str | None = Field(default=None, max_length=100)
    type: str | None = Field(default=None, max_length=50)
    role: str | None = Field(default=None, max_length=100)
    repo_url: str | None = Field(default=None)
    default_branch: str | None = Field(default="main", max_length=100)
    tech_stack: list[str] = Field(default_factory=list)
    build_command: str | None = Field(default=None)
    test_command: str | None = Field(default=None)
    source_yaml_path: str | None = Field(default=None)

    @field_validator("root_path", mode="before")
    @classmethod
    def _sanitize_root_path(cls, v: str) -> str:
        return _sanitize_path(v)

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


class WorkspaceUpdate(BaseModel):
    """Request body for ``PATCH /api/workspaces/{workspace_id}``.

    All fields are optional — only those explicitly provided by the caller are
    applied.  Uses ``exclude_unset=True`` at the service layer so omitted fields
    are left untouched.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(default=None, max_length=100)
    root_path: str | None = Field(default=None, min_length=1, max_length=4096)
    component_key: str | None = Field(default=None, max_length=100)
    type: str | None = Field(default=None, max_length=50)
    role: str | None = Field(default=None, max_length=100)
    repo_url: str | None = Field(default=None)
    default_branch: str | None = Field(default=None, max_length=100)
    tech_stack: list[str] | None = Field(default=None)
    build_command: str | None = Field(default=None)
    test_command: str | None = Field(default=None)
    source_yaml_path: str | None = Field(default=None)
    status: str | None = Field(default=None)

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
    status: WorkspaceStatusLiteral
    # Component metadata fields
    component_key: str | None
    type: str | None
    role: str | None
    repo_url: str | None
    default_branch: str | None
    tech_stack: list[str]
    build_command: str | None
    test_command: str | None
    source_yaml_path: str | None
    # Original fields
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    last_scanned_at: datetime | None
    deleted_at: datetime | None


class WorkspaceListResponse(BaseModel):
    items: list[WorkspaceRead]
    total: int


class WorkspaceRelationCreate(BaseModel):
    target_id: uuid.UUID
    relation_type: str = Field(min_length=1, max_length=50)
    description: str | None = Field(default=None)


class WorkspaceRelationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_id: uuid.UUID
    target_id: uuid.UUID
    relation_type: str
    description: str | None
    created_at: datetime


def slugify(name: str) -> str:
    """Derive a default slug from a workspace name.

    Lower-case, hyphen-separated, ASCII alphanumerics only. Falls back to
    ``"workspace"`` if the input contains no recognisable characters.
    """
    base = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower()
    base = re.sub(r"-+", "-", base) or "workspace"
    return base[:100]
