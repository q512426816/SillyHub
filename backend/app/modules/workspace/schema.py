"""Pydantic DTOs for the workspace module."""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

WorkspaceStatusLiteral = Literal["pending", "active", "archived", "deleted"]
PathSourceLiteral = Literal["server-local", "daemon-client"]
# spec 同步策略（2026-06-28-daemon-client-spec-sync-strategy，D-001/D-004）。
# daemon-client workspace 创建时用户可选；决定源项目已有 .sillyspec 如何进入平台。
SpecStrategyLiteral = Literal["platform-managed", "repo-mirrored", "repo-native"]

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
    # Optional explicit agent provider override for the scan run; when None
    # the dispatch layer falls through to workspace.default_agent (FR-02,
    # change 2026-06-14-agent-runtime-selection).
    provider: str | None = Field(default=None, max_length=64)
    # Optional per-run model override; when None the dispatch layer falls
    # through to workspace.default_model.
    model: str | None = Field(default=None, max_length=128)
    # path_source / daemon_runtime_id mirror WorkspaceCreate so the scan run
    # can target a daemon-client path (task-08 dispatch consumes these).
    # Added here in task-01 per plan.md execute-consistency convention.
    path_source: PathSourceLiteral = "server-local"
    daemon_runtime_id: uuid.UUID | None = None
    # spec 同步策略（2026-06-28-daemon-client-spec-sync-strategy）。daemon-client
    # scan-generate 首次创建 workspace 时据此落 spec_workspaces.strategy。
    spec_strategy: SpecStrategyLiteral = "platform-managed"

    @field_validator("root_path", mode="before")
    @classmethod
    def _sanitize_root_path(cls, v: str) -> str:
        return _sanitize_path(v)

    @model_validator(mode="after")
    def _validate_daemon_binding(self) -> "ScanGenerateRequest":
        if self.path_source == "daemon-client" and self.daemon_runtime_id is None:
            raise ValueError("daemon_runtime_id is required when path_source='daemon-client'")
        return self


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
    # Workspace-level default agent provider (FR-01/FR-02, change
    # 2026-06-14-agent-runtime-selection). Applied when an explicit provider
    # is not supplied at dispatch time.
    default_agent: str | None = Field(default=None, max_length=64)
    default_model: str | None = Field(default=None, max_length=128)
    tech_stack: list[str] = Field(default_factory=list)
    build_command: str | None = Field(default=None)
    test_command: str | None = Field(default=None)
    source_yaml_path: str | None = Field(default=None)
    # path_source / daemon_runtime_id (FR-01 / D-004@v1,
    # change 2026-06-18-workspace-client-path). server-local default keeps the
    # existing create flow byte-identical.
    path_source: PathSourceLiteral = "server-local"
    # daemon_runtime_id：legacy 全局 daemon 绑定字段（FK daemon_runtimes）。daemon-entity-binding
    # 后退化为 read-only fallback；新链路（创建对话框 / 详情页 switcher）一律走 daemon_id。
    # 仍保留为 optional 兼容 scan-generate 等内部老调用方（仅传 runtime_id 场景）。
    daemon_runtime_id: uuid.UUID | None = None
    # daemon_id：守护进程实体（FK daemon_instances）——2026-07-03-daemon-entity-binding
    # task-10/11 补遗的「添加工作区」对话框 daemon 维度入口。daemon-client create
    # 选此字段；service.create 据此建 workspace_member_runtimes 成员绑定行（D-004）。
    daemon_id: uuid.UUID | None = None
    # spec 同步策略（2026-06-28-daemon-client-spec-sync-strategy，D-001/D-004）。
    # daemon-client workspace 创建时用户可选；service 层据此落 spec_workspaces.strategy。
    # 默认 platform-managed 保持现有行为零回归。
    spec_strategy: SpecStrategyLiteral = "platform-managed"

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

    @model_validator(mode="after")
    def _validate_daemon_binding(self) -> "WorkspaceCreate":
        # daemon-client 路径来源需绑定一个守护进程：daemon_id（新，实体维度）或
        # daemon_runtime_id（legacy fallback）至少一个非空。task-10/11 补遗后 daemon_id 优先。
        if (
            self.path_source == "daemon-client"
            and self.daemon_id is None
            and self.daemon_runtime_id is None
        ):
            raise ValueError(
                "daemon_id (or legacy daemon_runtime_id) is required when "
                "path_source='daemon-client'"
            )
        return self


class WorkspaceUpdate(BaseModel):
    """Request body for ``PATCH /api/workspaces/{workspace_id}``.

    All fields are optional — only those explicitly provided by the caller are
    applied.  Uses ``exclude_unset=True`` at the service layer so omitted fields
    are left untouched.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    display_alias: str | None = Field(default=None, max_length=200)
    slug: str | None = Field(default=None, max_length=100)
    root_path: str | None = Field(default=None, min_length=1, max_length=4096)
    component_key: str | None = Field(default=None, max_length=100)
    type: str | None = Field(default=None, max_length=50)
    role: str | None = Field(default=None, max_length=100)
    repo_url: str | None = Field(default=None)
    default_branch: str | None = Field(default=None, max_length=100)
    # default_agent: omit to keep, null to clear, string to set (exclude_unset).
    default_agent: str | None = Field(default=None, max_length=64)
    # default_model: omit to keep, null to clear, string to set (exclude_unset).
    default_model: str | None = Field(default=None, max_length=128)
    tech_stack: list[str] | None = Field(default=None)
    build_command: str | None = Field(default=None)
    test_command: str | None = Field(default=None)
    source_yaml_path: str | None = Field(default=None)
    status: str | None = Field(default=None)
    # path_source / daemon_runtime_id: path_source None (omitted) skips the
    # daemon-client binding check — service uses exclude_unset=True. Only an
    # explicit 'daemon-client' triggers the required-runtime-id rule.
    path_source: PathSourceLiteral | None = None
    daemon_runtime_id: uuid.UUID | None = None

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

    @model_validator(mode="after")
    def _validate_daemon_binding(self) -> "WorkspaceUpdate":
        if self.path_source is None:
            return self
        if self.path_source == "daemon-client" and self.daemon_runtime_id is None:
            raise ValueError("daemon_runtime_id is required when path_source='daemon-client'")
        return self


class OwnerRead(BaseModel):
    """Nested owner DTO for platform-admin global views (task-05 / D-006@v1)."""

    user_id: uuid.UUID | None = None
    email: str | None = None
    display_name: str | None = None


class WorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    display_alias: str | None = None
    slug: str
    root_path: str
    status: WorkspaceStatusLiteral
    # Component metadata fields
    component_key: str | None
    type: str | None
    role: str | None
    repo_url: str | None
    default_branch: str | None
    default_agent: str | None
    default_model: str | None
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
    path_source: PathSourceLiteral
    daemon_runtime_id: uuid.UUID | None
    owner: OwnerRead | None = None


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


class WorkspaceMemberView(BaseModel):
    user_id: uuid.UUID
    email: str
    display_name: str | None
    role_key: str
    role_name: str
    granted_at: datetime
    is_current_user: bool  # 给前端高亮"你"


class WorkspaceMemberListResponse(BaseModel):
    items: list[WorkspaceMemberView]


class WorkspaceMemberAddRequest(BaseModel):
    user_id: uuid.UUID
    # 宽 str 类型——由 service 层（task-02）的 ROLE_KEY_WHITELIST 校验，
    # 让非法值（如 platform_admin）走业务路径返 400 invalid_role_key，
    # 而不是 Pydantic Literal 路径返 422。见 FR-03 / task-03 §4.2。
    role_key: str


class WorkspaceMemberUpdateRequest(BaseModel):
    role_key: str  # 同上，service 层白名单校验


class UserSearchHit(BaseModel):
    user_id: uuid.UUID
    email: str
    display_name: str | None
    is_member: bool  # 通常为 False（搜索时已排除），保留字段供前端展示


class UserSearchResponse(BaseModel):
    items: list[UserSearchHit]
