"""agent_session_queued_messages：会话排队消息表（后端真实排队）

Revision ID: 20260825160000
Revises: 20260825150000
Create Date: 2026-08-25 16:00:00

ql-20260825-011（会话聊天 UX 修复）：忙轮追问不再 409 拒绝，改落
``agent_session_queued_messages`` 排队，run 终态后后台任务按 created_at
顺序自动派发——排队从浏览器内存挪到服务端，刷新页面不丢。

- 单会话 pending 上限 5（服务层 SESSION_QUEUE_MAX_PENDING 守卫，表不加
  约束——failed 条目不计入）。
- ``(agent_session_id, status)`` 复合索引供派发扫描（取队头 pending）与
  列表查询。
- 派发成功即删行；failed 留行供重试/删除。

author: qinyi
created_at: 2026-08-25 16:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260825160000"
down_revision: str | None = "20260825150000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_session_queued_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("agent_session_id", sa.Uuid(), nullable=False),
        sa.Column("sender_user_id", sa.Uuid(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("attachment_ids", sa.JSON(), nullable=True),
        sa.Column("page_context", sa.JSON(), nullable=True),
        sa.Column("agent_profile_id", sa.String(length=64), nullable=True),
        sa.Column("llm_provider_id", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("error_msg", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["agent_session_id"],
            ["agent_sessions.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["sender_user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_agent_session_queued_messages_session_status",
        "agent_session_queued_messages",
        ["agent_session_id", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_agent_session_queued_messages_session_status",
        table_name="agent_session_queued_messages",
    )
    op.drop_table("agent_session_queued_messages")
