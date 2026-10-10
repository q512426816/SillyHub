"""关联仓数据模型（task-01，D-006/D-007）。

三表：
- ``workspace_linked_repos``：工作区级共享登记（名称/仓库地址/描述/约定相对路径）。
  无关联类型枚举（D-006 用户否决）；``(workspace_id, name)`` 唯一。
- ``workspace_linked_repo_paths``：成员级本机路径（D-007——同一关联仓在不同成员电脑
  位置不同，每用户各存一份）。``(linked_repo_id, user_id)`` 唯一。
- ``workspace_linked_repo_sync_states``：daemon 双落盘状态回环（唯一落库通道=REST
  回报端点，design 分层要点 4）。``(linked_repo_id, machine_id, layer)`` 唯一。

级联：两子表 FK 均 ondelete=CASCADE，随共享登记行删除一并清理（proposal 成功标准 5）。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import Column, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.types import DateTime, Uuid
from sqlmodel import Field

from app.models.base import BaseModel

SyncLayer = Literal["projects_yaml", "repos_registry"]
SyncStatus = Literal["ok", "skipped", "failed"]


class WorkspaceLinkedRepo(BaseModel, table=True):
    """工作区关联仓共享登记行（管理员维护，团队共享）。"""

    __tablename__ = "workspace_linked_repos"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="ux_linked_repos_ws_name"),
        Index("ix_linked_repos_workspace", "workspace_id"),
    )

    id: UUID = Field(
        default_factory=uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    workspace_id: UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    # 对齐 sillyspec workspace add 的子项目名规则（^[A-Za-z0-9_.\-]+$，作 yaml 文件名）。
    name: str = Field(sa_column=Column(String(100), nullable=False))
    repo_url: str | None = Field(default=None, sa_column=Column(String(500), nullable=True))
    description: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    # 团队约定的相对工作区根路径（如 ../platform-specs）；可空=该仓只落 repos: 层。
    rel_path: str | None = Field(default=None, sa_column=Column(String(500), nullable=True))
    created_by: UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class WorkspaceLinkedRepoPath(BaseModel, table=True):
    """成员级本机路径行（每用户各配各的，D-007）。"""

    __tablename__ = "workspace_linked_repo_paths"
    __table_args__ = (
        UniqueConstraint("linked_repo_id", "user_id", name="ux_linked_repo_paths_repo_user"),
        Index("ix_linked_repo_paths_user", "user_id"),
    )

    id: UUID = Field(
        default_factory=uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    linked_repo_id: UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspace_linked_repos.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    user_id: UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    # 该成员机器上关联仓根目录的绝对路径（register-repo 落盘入参，仅提示用途不校验）。
    root_path: str = Field(sa_column=Column(String, nullable=False))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class WorkspaceLinkedRepoSyncState(BaseModel, table=True):
    """daemon 双落盘状态（REST 回报端点 upsert；machine_id 即 daemon_instance_id）。"""

    __tablename__ = "workspace_linked_repo_sync_states"
    __table_args__ = (
        UniqueConstraint("linked_repo_id", "machine_id", "layer", name="ux_linked_repo_sync_rml"),
        Index("ix_linked_repo_sync_repo", "linked_repo_id"),
    )

    id: UUID = Field(
        default_factory=uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    linked_repo_id: UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspace_linked_repos.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    # daemon_instances.id（daemon 上报的 daemon_local_id，对齐 machines.py {instance_id}）。
    machine_id: UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_instances.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    layer: str = Field(sa_column=Column(String(32), nullable=False))
    status: str = Field(sa_column=Column(String(16), nullable=False))
    detail: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    synced_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
