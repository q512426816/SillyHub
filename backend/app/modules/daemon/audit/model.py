"""PolicyAuditLog SQLModel table — daemon filesystem-policy audit trail (D-006@v1)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    Uuid,
    text,
)
from sqlmodel import Field

from app.models.base import BaseModel


class PolicyAuditLog(BaseModel, table=True):
    """ALLOW/DENY audit record for daemon filesystem-policy decisions (D-006).

    daemon 侧 PolicyEngine 对每次 canWrite/canCreate/canDelete/canRename
    （D-008：canRead 不记）落一条审计；批量回传 backend 后落入此表，
    供前端「写行为审计」页按 workspace/runtime/decision/provider/tool/path
    分页检索。daemon TS 的 AuditEvent 字段与本表一一对应。

    Note:
        id / runtime_id / workspace_id 一律用 Uuid，与 DaemonRuntime /
        DaemonTaskLease / SessionDialogRequest 现有风格保持一致
        （DaemonRuntime.id 为 Uuid 主键，FK 类型必须对齐才能真实建立外键）。
    """

    __tablename__ = "policy_audit_log"
    __table_args__ = (
        # 复合索引：daemon 审计页热路径 WHERE runtime_id=? ORDER BY created_at DESC
        Index(
            "idx_policy_audit_log_runtime_created",
            "runtime_id",
            text("created_at DESC"),
        ),
        Index("idx_policy_audit_log_decision", "decision"),
        Index("idx_policy_audit_log_workspace_id", "workspace_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # FK 到 daemon_runtimes.id（Uuid 主键，ondelete=CASCADE 随 runtime 物理删）
    runtime_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_runtimes.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    # 从 runtime 反查写入，便于按 workspace 维度筛审计（design §7.4）。
    workspace_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    # "ALLOW" | "DENY"（自由字符串列，免后续加值迁移，与 lease.status 同风格）
    decision: str = Field(
        sa_column=Column(String(16), nullable=False),
    )
    # "claude" | "codex" | ...（审计来源 runtime provider）
    provider: str = Field(
        sa_column=Column(String(50), nullable=False),
    )
    tool: str = Field(
        sa_column=Column(String(128), nullable=False),
    )
    path: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    reason: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
