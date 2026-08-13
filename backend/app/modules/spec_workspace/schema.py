"""Pydantic DTOs for the spec_workspace module.

author: qinyi
created_at: 2026-05-27
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SpecStrategyLiteral = Literal["platform-managed", "repo-mirrored", "repo-native"]
SyncStatusLiteral = Literal["pending", "clean", "dirty", "conflicted"]


class SpecWorkspaceCreate(BaseModel):
    """Request body for creating a spec workspace.

    ``spec_root`` defaults to ``None`` in the request — the service layer
    generates the platform-managed path when not supplied.
    """

    spec_root: str | None = Field(default=None, max_length=4096)
    strategy: SpecStrategyLiteral = Field(default="platform-managed")
    repo_sillyspec_path: str | None = Field(default=None, max_length=4096)
    profile_version: str = Field(default="0.1.0", max_length=50)


class SpecWorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    spec_root: str
    strategy: str
    repo_sillyspec_path: str | None
    profile_version: str
    sync_status: str
    last_synced_at: datetime | None
    created_at: datetime
    updated_at: datetime


class SpecWorkspaceUpdate(BaseModel):
    """Partial update for spec workspace fields."""

    strategy: SpecStrategyLiteral | None = Field(default=None)
    repo_sillyspec_path: str | None = Field(default=None)
    profile_version: str | None = Field(default=None, max_length=50)


class SyncStatusUpdate(BaseModel):
    """Body for the ``update_sync_status`` endpoint."""

    sync_status: SyncStatusLiteral


class SpecBootstrapRunStartResponse(BaseModel):
    """Response DTO for the async spec-bootstrap launch.

    Returned immediately after creating the AgentRun; the actual execution
    happens in a background task (task-02).
    """

    agent_run_id: uuid.UUID
    stream_url: str
    status: Literal["pending"]
    spec_root: str
    message: str


# ── 增量同步 DTO（change 2026-08-13-platform-managed-file-sync / design §7）─────
#
# 协议：daemon 发 JSON ops（add/update/delete/rename），每文件带 base_version
# （本地基于的服务器版本，乐观锁基准 D-001）。服务器逐 op 比对，过期收集
# server_versions 返 conflict=True（不落盘）；正常返回 new_versions。


class FileOp(BaseModel):
    """One per-file operation in an incremental spec sync.

    ``path`` / ``new_path`` are relative to spec_root. ``content`` is base64
    (add/update use it); rename with unchanged content may omit both ``hash``
    and ``content``. ``base_version`` is the file version the daemon's local
    manifest believes the server is at (0 when unknown → R-07 hash fallback).
    """

    op: Literal["add", "update", "delete", "rename"]
    path: str
    new_path: str | None = Field(default=None)  # rename 用
    hash: str | None = Field(default=None)  # SHA-256 hex
    content: str | None = Field(default=None)  # base64，add/update 用
    base_version: int


class SpecIncrementalSyncRequest(BaseModel):
    """Request body for the incremental sync endpoint (design §7)."""

    ops: list[FileOp]


class SpecIncrementalSyncResponse(BaseModel):
    """Response body for the incremental sync endpoint (design §7).

    On success ``new_versions`` maps each applied path to its new server
    version. On a base_version conflict ``conflict=True`` and
    ``server_versions`` carries the current server versions so the daemon can
    surface the collision (HTTP stays 200; the daemon decides how to prompt).
    """

    ok: bool
    new_versions: dict[str, int]  # path -> 新版本号
    conflict: bool = False
    server_versions: dict[str, int] | None = Field(default=None)  # 冲突时服务器当前版本
