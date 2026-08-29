"""notifications：站内通知表（design §8 / D-004@v1 / FR-01）

Revision ID: 20260829220000
Revises: 30f7418b14cf
Create Date: 2026-08-29 22:00:00

Change 2026-08-29-approval-notify-push task-01：建 ``notifications`` 表
（模型：app/modules/notification/model.py ``Notification``）——按接收人
展开行，广播扇出为多行，双 FK workspaces/users ON DELETE CASCADE。

- 无全局唯一约束、dedupe_key 无独立索引：幂等由 NotificationService
  「同 (ref_type, ref_id, type) 且未消解」存在性检查负责（D-009@v2，
  驳回重跑同门再待办需允许再次插入，唯一索引会误拦）。
- 三个普通索引：recipient+read_at+created_at（收件箱/未读数热路径）、
  ref_type+ref_id+type（幂等检查 + resolve_pending）、
  workspace_id+created_at（工作区维度浏览）。

down_revision 接执行时唯一 head 30f7418b14cf（alembic heads 实测单 head）。
downgrade 对称删索引 + 删表。

author: qinyi
created_at: 2026-08-29 22:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260829220000"
down_revision: str | None = "30f7418b14cf"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "recipient_user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.String(length=500), nullable=True),
        sa.Column("link", sa.String(length=300), nullable=True),
        sa.Column("ref_type", sa.String(length=30), nullable=True),
        sa.Column("ref_id", sa.String(length=64), nullable=True),
        sa.Column("dedupe_key", sa.String(length=120), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_notifications_recipient_read_created",
        "notifications",
        ["recipient_user_id", "read_at", "created_at"],
    )
    op.create_index(
        "ix_notifications_ref",
        "notifications",
        ["ref_type", "ref_id", "type"],
    )
    op.create_index(
        "ix_notifications_workspace",
        "notifications",
        ["workspace_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_workspace", table_name="notifications")
    op.drop_index("ix_notifications_ref", table_name="notifications")
    op.drop_index("ix_notifications_recipient_read_created", table_name="notifications")
    op.drop_table("notifications")
