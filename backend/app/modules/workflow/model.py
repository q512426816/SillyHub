"""ChangeReview and AuditLog tables."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class ChangeReview(BaseModel, table=True):
    """A review verdict on a change."""

    __tablename__ = "change_reviews"
    __table_args__ = (Index("ix_change_reviews_change", "change_id"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    change_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    reviewer_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    verdict: str = Field(sa_column=Column(String(20), nullable=False))  # approve / reject
    comment: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class AuditLog(BaseModel, table=True):
    """Append-only audit trail for all mutating operations."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_workspace_ts", "workspace_id", "timestamp"),
        Index("ix_audit_resource", "resource_type", "resource_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    workspace_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    actor_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    action: str = Field(sa_column=Column(String(100), nullable=False))
    resource_type: str = Field(sa_column=Column(String(50), nullable=False))
    resource_id: uuid.UUID = Field(sa_column=Column(Uuid(as_uuid=True), nullable=False))
    details_json: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


# 审计 action 常量（方案 B 常量集中，D-005）：
# service 代码禁止内联 action 字面量，统一引用此处。
# 出处：2026-08-14-audit-system-completion（task-01）。
# 注意：不设 DELETE 常量——settings 全仓无 delete 端点（Grill C-6）。
AUTH_LOGIN_SUCCESS = "auth.login.success"
AUTH_LOGIN_FAILED = "auth.login.failed"
PLATFORM_SETTING_CREATE = "platform_setting.create"
PLATFORM_SETTING_UPDATE = "platform_setting.update"

# 全零占位 UUID（D-002/D-004 共用单一定义）：
# AuditLog.resource_id 非空但无 FK 约束，无具体资源场景下用此占位（Grill C-5 已核）。
AUDIT_PLACEHOLDER_ID = uuid.UUID(int=0)
