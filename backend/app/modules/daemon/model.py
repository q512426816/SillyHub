"""DaemonRuntime and DaemonTaskLease SQLModel tables."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    text,
)
from sqlmodel import Field

from app.models.base import BaseModel


class DaemonInstance(BaseModel, table=True):
    """A physical daemon process with a stable identity (design §4.1 / D-001).

    身份由 daemon 上报的本地 uuid 承载（``id`` = daemon 侧 ``daemon_local_id``，
    后端不自生成）。一行 = 一个用户在一台机器上、连某一个后端的守护进程。
    多 provider 由子表 :class:`DaemonRuntime` 承载，本表只管机器级字段。
    """

    __tablename__ = "daemon_instances"
    __table_args__ = (
        Index("ix_daemon_instances_user_server", "user_id", "server_url", "hostname"),
    )

    # daemon 上报的 daemon_local_id 作主键，后端不自生成（无 default_factory）。
    id: uuid.UUID = Field(
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    hostname: str = Field(sa_column=Column(String(255), nullable=False))
    # admin 自定义机器别名（从旧 runtime.display_alias 提升到此，design §4.1）。
    display_alias: str | None = Field(
        default=None,
        sa_column=Column(String(200), nullable=True),
    )
    server_url: str = Field(sa_column=Column(String(255), nullable=False))
    os: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    arch: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    version: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    # daemon 构建标识（git short SHA，release 注入；dev="dev"）。
    # 2026-07-04-daemon-version-management D-003：用于精确版本比对与升级判断
    # （区别于 version 的语义版本；self-update preflight 按 build_id 比对）。
    build_id: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    # 机器级沙箱（从旧 runtime.allowed_roots 提升到此，design §4.1 / §4.2）。
    allowed_roots: list[str] = Field(
        default_factory=lambda: ["~/.sillyhub"],
        sa_column=Column(JSON, nullable=False, server_default=text("'[\"~/.sillyhub\"]'")),
    )
    capabilities: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    status: str = Field(
        default="online",
        sa_column=Column(
            String(20),
            nullable=False,
            server_default=text("'online'"),
        ),
    )
    last_heartbeat_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )


class DaemonRuntime(BaseModel, table=True):
    """A registered local daemon runtime (e.g. Claude Code CLI instance).

    Change 2026-07-03-daemon-entity-binding (design §4.2 / D-002): 退化为
    :class:`DaemonInstance` 的从属清单——一行 = 某个 daemon 实体下的一种
    provider。机器级字段（os/arch/allowed_roots/capabilities/display_alias）
    已上提到 daemon_instances，本表只保留 provider 维度信息。
    """

    __tablename__ = "daemon_runtimes"
    __table_args__ = (
        Index("idx_daemon_runtimes_user_id", "user_id"),
        Index("idx_daemon_runtimes_status", "status"),
        Index("idx_daemon_runtimes_instance", "daemon_instance_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # 所属守护进程实体（design §4.2 / D-002）。迁移期 nullable=True 过渡
    # （D-007 重置：旧 runtime 行无对应 daemon_instance，task-13 清空后再 NOT NULL）。
    daemon_instance_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_instances.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    name: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    provider: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    version: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    status: str | None = Field(
        default="online",
        sa_column=Column(String(20), nullable=True),
    )
    last_heartbeat_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    metadata_: dict | None = Field(
        default=None,
        sa_column=Column("metadata", JSON, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )


class SessionDialogRequest(BaseModel, table=True):
    """Persisted AskUserQuestion-style dialog request (dialog extension).

    Ordinary canUseTool approvals stay ephemeral (in-memory ``_permission_timers``
    + 5min timeout). AskUserQuestion-style requests, in contrast, may wait
    indefinitely for a human answer and must survive frontend refresh — hence
    this table. One row per ``request_id``; lifecycle::

        pending   → row written by handle_permission_request (dialog_kind set)
        answered  → respond_permission recorded the user's ``answer``
        cancelled → session ended / run aborted before the user replied

    ``dialog_payload`` mirrors ``PermissionRequestPayload.dialog_payload``
    (the full question+options blob, JSON); ``answer`` mirrors
    ``PermissionResponsePayload.dialog_result``.
    """

    __tablename__ = "session_dialog_requests"
    __table_args__ = (
        Index("idx_session_dialog_requests_session_id", "session_id"),
        Index("idx_session_dialog_requests_run_id", "run_id"),
        Index("idx_session_dialog_requests_status", "status"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    session_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    run_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    # Daemon-generated; unique per session so a replay/bug can't fork a dialog.
    request_id: str = Field(
        sa_column=Column(String(128), nullable=False, unique=True),
    )
    tool_name: str = Field(
        sa_column=Column(String(128), nullable=False),
    )
    dialog_kind: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    dialog_payload: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    status: str = Field(
        default="pending",
        sa_column=Column(
            String(20),
            nullable=False,
            server_default=text("pending"),
        ),
    )
    answer: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    answered_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    answered_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class DaemonTaskLease(BaseModel, table=True):
    """A task lease claimed by a daemon runtime for execution."""

    __tablename__ = "daemon_task_leases"
    __table_args__ = (
        Index("idx_daemon_task_leases_runtime_id", "runtime_id"),
        Index("idx_daemon_task_leases_status", "status"),
        Index("idx_daemon_task_leases_agent_run_id", "agent_run_id"),
        Index(
            "idx_daemon_task_leases_expires_at",
            "lease_expires_at",
            postgresql_where=text("status IN ('claimed', 'pending')"),
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    runtime_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_runtimes.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    agent_run_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    kind: str = Field(
        default="batch",
        sa_column=Column(
            String(20),
            nullable=False,
            server_default=text("batch"),
        ),
    )
    # batch: existing batch path via TaskRunner (FR-09, zero change)
    # interactive: long-lived SDK driver session (D-002@v3)
    # String(20) covers all values incl. reconnecting (task-10 / design §8.1);
    # no schema migration needed — status is a free-form string column.
    # Values: pending, claimed, completed, expired, cancelled (lease lifecycle).
    status: str | None = Field(
        default="pending",
        sa_column=Column(String(20), nullable=True),
    )
    claimed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    lease_expires_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    attempt_number: int | None = Field(
        default=1,
        sa_column=Column(Integer, nullable=True, server_default=text("1")),
    )
    metadata_: dict | None = Field(
        default=None,
        sa_column=Column("metadata", JSON, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )


class DaemonChangeWrite(BaseModel, table=True):
    """A change-write task queued for a daemon runtime to execute (D-004@v1).

    daemon-client workspace 的 change 代写任务队列：daemon 经 lease-polling 轮询
    (GET /runtimes/{rid}/pending-change-writes → claim → 本地写 changes/<key>/ →
    complete 回执)，**不启动 agent**（与 DaemonTaskLease 的 agent-run 语义区分，
    故独立新表而非复用 lease.kind）。
    """

    __tablename__ = "daemon_change_writes"
    __table_args__ = (
        # 复合索引：daemon 轮询热路径 WHERE runtime_id=? AND status='pending' (FR-08)
        Index("idx_daemon_change_writes_runtime_status", "runtime_id", "status"),
        Index("idx_daemon_change_writes_workspace_id", "workspace_id"),
        Index("idx_daemon_change_writes_status", "status"),
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
    runtime_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_runtimes.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    change_key: str = Field(
        sa_column=Column(String(128), nullable=False),
    )
    # 任务类型：create=proxy_create_change 创建新变更（MASTER/proposal/request），
    # edit=变更详情文件树手动编辑现有文件（2026-07-02-change-detail-file-tree-editor）。
    # daemon 侧 runChangeWrite 不区分（通用写 files），kind 仅 backend 用于 pending
    # 列表过滤（避免 edit 查询误纳 create 行）。
    kind: str = Field(
        default="create",
        sa_column=Column(
            String(20),
            nullable=False,
            server_default=text("'create'"),
        ),
    )
    # [{path, content}, ...]，path 相对 changes/<key>/（与 changes.key 对齐）
    files: list = Field(
        sa_column=Column(JSON, nullable=False),
    )
    # pending / claimed / done / failed — free-form string column（与 lease.status
    # 同风格，免后续加值迁移）
    status: str = Field(
        default="pending",
        sa_column=Column(
            String(20),
            nullable=False,
            server_default=text("pending"),
        ),
    )
    claim_token: str | None = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    # claim 落点时间，供 NFR-03 超时 gc（claimed_at < now-60s → failed）。
    # task-08 建表时遗漏，task-09 端点依赖此列（claim 置值 + gc 读取）。
    claimed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    completed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    error: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
