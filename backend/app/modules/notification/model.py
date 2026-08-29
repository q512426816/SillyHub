"""Notification SQLModel table（design §8 / D-004@v1 按接收人展开行）."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class Notification(BaseModel, table=True):
    """站内通知一行 = 一个接收人的一条通知（广播扇出为多行）.

    幂等不靠约束：无全局唯一约束、dedupe_key 无独立索引——
    「未消解存在性检查」由 NotificationService 负责（D-009@v2，
    驳回重跑同门再待办需要允许再次插入，唯一索引会误拦）。
    """

    __tablename__ = "notifications"
    __table_args__ = (
        Index(
            "ix_notifications_recipient_read_created",
            "recipient_user_id",
            "read_at",
            "created_at",
        ),
        Index("ix_notifications_ref", "ref_type", "ref_id", "type"),
        Index("ix_notifications_workspace", "workspace_id", "created_at"),
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
    recipient_user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    # §7.1 四类：approval_pending / approval_result / permission_request / permission_timeout。
    type: str = Field(sa_column=Column(String(40), nullable=False))
    title: str = Field(sa_column=Column(String(200), nullable=False))
    body: str | None = Field(
        default=None,
        sa_column=Column(String(500), nullable=True),
    )
    # 前端相对路由跳转路径。
    link: str | None = Field(
        default=None,
        sa_column=Column(String(300), nullable=True),
    )
    # "change" | "session_permission" | "session_dialog"
    ref_type: str | None = Field(
        default=None,
        sa_column=Column(String(30), nullable=True),
    )
    # change_id / session_id（str 存储统一类型）
    ref_id: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    # 幂等/审计键（如 "{change_id}:{review_kind}"），不参与存在性检查。
    dedupe_key: str | None = Field(
        default=None,
        sa_column=Column(String(120), nullable=True),
    )
    # NULL = 未读（无默认值约束，插入侧不传即 NULL）。
    read_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
