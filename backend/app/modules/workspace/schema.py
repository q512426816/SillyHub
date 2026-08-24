"""Pydantic DTOs for the workspace module."""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.workspace.constants import WorkspaceTypeLiteral

WorkspaceStatusLiteral = Literal["pending", "active", "archived", "deleted"]
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
    # daemon_id：守护进程实体（FK daemon_instances）——daemon-entity-binding 后的稳定
    # 绑定键。task-10/11 补遗对齐 WorkspaceCreate。
    daemon_id: uuid.UUID | None = None
    # spec 同步策略（2026-06-28-daemon-client-spec-sync-strategy）。daemon-client
    # scan-generate 首次创建 workspace 时据此落 spec_workspaces.strategy。
    spec_strategy: SpecStrategyLiteral = "platform-managed"

    @field_validator("root_path", mode="before")
    @classmethod
    def _sanitize_root_path(cls, v: str) -> str:
        return _sanitize_path(v)


class ScanGenerateResponse(BaseModel):
    """Response body for ``POST /api/workspaces/scan-generate``."""

    workspace_id: uuid.UUID
    agent_run_id: uuid.UUID
    session_id: uuid.UUID | None = None


class WorkspaceCreate(BaseModel):
    """Request body for ``POST /api/workspaces``.

    Either ``slug`` is provided explicitly, or the server derives one from
    ``name``. We only validate format here — uniqueness is enforced by the DB.
    """

    name: str = Field(min_length=1, max_length=200)
    slug: str | None = Field(default=None, max_length=100)
    root_path: str = Field(min_length=1, max_length=4096)
    # Component metadata fields
    component_key: str | None = Field(default=None, max_length=100)
    # 工作区类型：8 值受控词表必填（D-002@v1，change 2026-08-18-workspace-role-type）。
    # Literal 校验让非法值在 Pydantic 层 422，并进 OpenAPI enum（前端 gen:types 消费）。
    type: WorkspaceTypeLiteral
    role: str | None = Field(default=None, max_length=100)
    # 工作区用途说明（FR-03）：可空长文本，service.create 透传落 Workspace.description
    # （列由 task-02 migration 添加）。
    description: str | None = Field(default=None, max_length=2000)
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
                "slug 只能使用小写字母、数字和连字符，且以字母或数字开头和结尾（1-100 字符）。"
            )
        return v


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
    # 工作区类型 omit 不改 / null 清空（D-005@v1）；值域 8 值词表，非法值 422。
    type: WorkspaceTypeLiteral | None = None
    role: str | None = Field(default=None, max_length=100)
    # description: omit 不改 / null 清空（与 default_agent 同 exclude_unset 模式）。
    description: str | None = Field(default=None, max_length=2000)
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

    @field_validator("slug")
    @classmethod
    def _validate_slug(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not _SLUG_RE.match(v):
            raise ValueError(
                "slug 只能使用小写字母、数字和连字符，且以字母或数字开头和结尾（1-100 字符）。"
            )
        return v


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
    # 读路径不校验存量（design §9）：存量非空 type 可能是映射不上的历史值，
    # 保持 str | None 原样返回；仅写入与查询参数走 Literal 校验。
    type: str | None
    role: str | None
    # 工作区用途说明（FR-03）：模型列由 task-02 落地；本字段先以 default=None
    # 兜底，列存在后 from_attributes 自动读到真实值。
    description: str | None = None
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
    owner: OwnerRead | None = None
    # 仅创建端点（POST /api/workspaces）在「复用已存在工作区 / 激活 pending /
    # 复活软删」时填写的用户可读提示；新建或列表/详情接口恒 None。
    creation_notice: str | None = None


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


# ── PPM 项目 ↔ 工作区 关联 DTO(change 2026-07-28-ppm-project-link-workspace)──
# 双边对称:工作区侧 POST 带 ppm_project_id,项目侧 POST 带 workspace_id;
# 各自的 Brief 用于对方维度的列表展示。link_service 构造,两 router 复用。


class BindPpmProjectRequest(BaseModel):
    """工作区侧绑定 PPM 项目的请求体(``POST /workspaces/{id}/ppm-projects``)。"""

    ppm_project_id: uuid.UUID


class BindWorkspaceRequest(BaseModel):
    """项目侧绑定工作区的请求体(``POST /ppm/projects/{id}/workspaces``)。"""

    workspace_id: uuid.UUID


class WorkspaceBrief(BaseModel):
    """项目侧查看关联工作区的摘要(展示 name/status/type + role/description 定位信息)。

    FR-08(change 2026-08-18-workspace-role-type)：补 role 与 description，
    项目侧拿到完整定位信息；type 读路径不校验存量(同 WorkspaceRead)。
    """

    workspace_id: uuid.UUID
    name: str
    status: str
    type: str | None = None
    role: str | None = None
    description: str | None = None


class PpmProjectBrief(BaseModel):
    """工作区侧查看关联 PPM 项目的摘要(FR-03 展示 project_name/project_status)。"""

    project_id: uuid.UUID
    project_name: str | None = None
    project_status: str | None = None


# ── 批量探测 DTO（2026-08-24-session-team-mission-context task-10 / FR-03 / D-008@v2）──
# 弹层机器状态统一走后端 POST /api/workspaces/probe（design §5.C）：任一成员
# binding 口径消除本人/他人 binding 展示不一致（UB-2），三字段与 mission_status
# 的 scope_workspaces 完全同源（orchestrator.collect_single_workspace_status +
# host_fs delegate probe_workspace_git_mode）。


class WorkspaceProbeRequest(BaseModel):
    """Request body for ``POST /api/workspaces/probe``。

    ``workspace_ids`` 非空、上限 20（对齐 mission scope 上限口径）；元素为
    UUID——非法格式由 Pydantic 422。查无行（缺失）的 id 由 handler 跳过不报错
    （与 collect_scope_workspace_statuses 无效 id 跳过同语义，fail-safe 不 5xx）。
    """

    workspace_ids: list[uuid.UUID] = Field(min_length=1, max_length=20)


class WorkspaceProbeItem(BaseModel):
    """单工作区探测结果项（``POST /api/workspaces/probe`` 响应元素）。

    - ``git_mode``：三态 ``"git"|"direct"|"unknown"``（实时探测不缓存，R-02；
      RPC 失败/未绑 daemon 归 unknown 不抛）。
    - ``daemon_name``：任一成员 binding daemon 的 ``display_alias or hostname``
      （未绑/daemon 行缺失 → None）。
    - ``daemon_online``：该 binding daemon 的在线态。
    """

    workspace_id: uuid.UUID
    git_mode: Literal["git", "direct", "unknown"]
    daemon_name: str | None = None
    daemon_online: bool
