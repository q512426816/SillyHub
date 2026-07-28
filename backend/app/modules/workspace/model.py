"""``workspaces`` table model.

Schema follows ``references/17-db-schema.md`` §2.3. The ``created_by`` foreign
key to ``users`` is intentionally relaxed in V1 — the users table lands with
task-04, after which a follow-up migration will add the FK constraint.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, String, Uuid, text
from sqlmodel import Field

from app.models.base import BaseModel

WorkspaceStatus = Literal["pending", "active", "archived", "deleted"]


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
    # task-03 / D-002@v1: 展示别名，独立于扫描/创建用的 name；空值回退 name/slug。
    display_alias: str | None = Field(
        default=None,
        sa_column=Column(String(200), nullable=True),
    )
    slug: str = Field(sa_column=Column(String(100), nullable=False))
    root_path: str = Field(sa_column=Column(String, nullable=False))
    status: str = Field(default="active", sa_column=Column(String(20), nullable=False))

    # Component metadata fields (absorbed from ProjectComponent, ADR-07)
    component_key: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    type: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    role: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    repo_url: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True),
    )
    default_branch: str | None = Field(
        default="main",
        sa_column=Column(String(100), nullable=True),
    )
    # Workspace-level default agent provider (e.g. "claude"/"codex"); applied when
    # an explicit provider is not supplied at dispatch time. See change
    # 2026-06-14-agent-runtime-selection (FR-01/FR-02).
    default_agent: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    default_model: str | None = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    tech_stack: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    build_command: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True),
    )
    test_command: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True),
    )
    source_yaml_path: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True),
    )
    created_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
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


class TaskWorkspace(BaseModel, table=True):
    """M:N association between tasks and workspaces."""

    __tablename__ = "task_workspaces"
    __table_args__ = (Index("ix_task_workspaces_workspace", "workspace_id"),)

    task_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("tasks.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    role: str | None = Field(
        default=None,
        sa_column=Column(String(30), nullable=True),
    )


class PpmProjectWorkspace(BaseModel, table=True):
    """M:N association between PPM projects and workspaces.

    平台级 PPM 项目(:class:`~app.modules.ppm.project.model.PpmProjectMaintenance`)
    与工作区的多对多关联表(change ``2026-07-28-ppm-project-link-workspace`` A 阶段)。
    仿 :class:`TaskWorkspace`:复合主键 ``(ppm_project_id, workspace_id)`` 天然防止
    重复绑定(无需额外唯一索引),双向 ``ON DELETE CASCADE`` 与现有 PPM 强 FK 引用
    (``PpmProjectMember``/``PpmProjectStakeholder``)行为一致。工作区作为关联中枢,
    项目侧与工作区侧两个 router 操作同一张表(双边对称,数据自动一致)。

    不含关联元数据(类型/主次/备注/角色)——YAGNI,B 阶段如需再扩展。
    """

    __tablename__ = "ppm_project_workspace"
    __table_args__ = (Index("ix_ppm_project_workspace_workspace", "workspace_id"),)

    ppm_project_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("ppm_project_maintenance.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )


class AgentRunWorkspace(BaseModel, table=True):
    """M:N association between agent runs and workspaces."""

    __tablename__ = "agent_run_workspaces"
    __table_args__ = (
        Index("ix_agent_run_workspaces_workspace", "workspace_id"),
        # Wave B（性能，2026-07-24 代码健壮性优化）：agent_run_id 维度查询（patch apply /
        # 工作区对话列表 / run→workspace 反查）高频，缺索引全表扫。
        Index("ix_agent_run_workspaces_agent_run_id", "agent_run_id"),
    )

    agent_run_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_runs.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
