"""``spec_workspaces`` table model.

Each row represents the platform-managed spec space associated with a workspace.
The ``workspace_id`` foreign key ties it 1:1 to ``workspaces``.

Also hosts ``spec_file_manifest`` (change 2026-08-13-platform-managed-file-sync /
D-011) — the server-authoritative per-file manifest backing the incremental
sync protocol. It is intentionally a separate table from ``scan_documents``
(scan_docs reparse never touches it), so file-level versions / soft-delete
``exists`` semantics stay unambiguous.

author: qinyi
created_at: 2026-05-27
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlmodel import Field

from app.models.base import BaseModel

SpecStrategy = Literal["platform-managed", "repo-mirrored", "repo-native"]
SyncStatus = Literal["pending", "clean", "dirty", "conflicted"]


class SpecWorkspace(BaseModel, table=True):
    """Platform-managed spec directory linked to a workspace.

    Strategy determines how spec files are managed:

    - ``platform-managed``: specs live in ``spec_root`` only (default).
    - ``repo-mirrored``: daemon 初始化时从源项目 ``.sillyspec`` 单次同步快照到
      ``spec_root``，之后平台托管（源项目后续变更不自动反映）。
    - ``repo-native``: the repo's own ``.sillyspec`` is the source of truth;
      ``spec_root`` is used as a cache or overlay.
    """

    __tablename__ = "spec_workspaces"
    __table_args__ = (
        Index(
            "ix_spec_workspaces_workspace_id",
            "workspace_id",
            unique=True,
        ),
        Index("ix_spec_workspaces_strategy", "strategy"),
        Index("ix_spec_workspaces_sync_status", "sync_status"),
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
    spec_root: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    strategy: str = Field(
        default="platform-managed",
        sa_column=Column(String(30), nullable=False),
    )
    repo_sillyspec_path: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    profile_version: str = Field(
        default="0.1.0",
        sa_column=Column(String(50), nullable=False),
    )
    # Change 2026-07-02-workspace-config-flow task-09 / D-010:
    # Server-authoritative spec bundle version. Incremented each time the spec
    # tree is rewritten by scan_generate success / apply_sync landing (see
    # service `_write_spec_root`). Daemon compares lease payload
    # `latest_spec_version` against local .sillyspec-platform.json.spec_version
    # to decide whether to pull a fresh bundle. NOT the same as `profile_version`
    # (scan profile format version) — different semantics, kept separate.
    spec_version: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    sync_status: str = Field(
        default="pending",
        sa_column=Column(String(20), nullable=False),
    )
    last_synced_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class SpecFileManifest(BaseModel, table=True):
    """Server-authoritative per-file manifest for incremental spec sync.

    Change 2026-08-13-platform-managed-file-sync / D-011: a dedicated table
    (NOT ``scan_documents``) so the incremental protocol keeps its own
    file-level ``version`` (optimistic-lock baseline) and soft-delete
    ``exists`` semantics. ``scan_docs`` reparse never reads or writes this
    table — it is written only by ``apply_ops`` (the incremental endpoint).

    ``path`` is relative to the workspace ``spec_root``. ``content_hash`` is the
    SHA-256 hex of the file content. ``version`` is bumped +1 on every applied
    op (add/update/delete/rename); daemon sends ``base_version`` and gets a 409
    (conflict) when the server version differs (D-001). ``exists=False`` means
    the file was soft-deleted (moved to the spec-backups area, D-002/D-010).
    """

    __tablename__ = "spec_file_manifest"
    __table_args__ = (
        Index(
            "ux_spec_manifest_ws_path",
            "workspace_id",
            "path",
            unique=True,
        ),
        Index("ix_spec_manifest_version", "version"),
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
    path: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    content_hash: str = Field(
        sa_column=Column(String(64), nullable=False),
    )
    version: int = Field(
        default=1,
        sa_column=Column(Integer, nullable=False),
    )
    exists: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
