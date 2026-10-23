"""agent_session_queued_messages network_context（排队网络块快照）

Revision ID: 20261023090100
Revises: 20261023090000
Create Date: 2026-10-23

为 agent_session_queued_messages 新增 network_context JSON 列（2026-10-23-
session-network-context task-08 / D-012@v1）：忙轮排队条目存发送时刻的
{user_ip, has_xff}，派发时携存储值实时重算网络环境判定注入（不重放旧文本）。
存量行 NULL=发送时未携带，派发轮无网络段（兼容）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261023090100"
down_revision = "20261023090000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_session_queued_messages",
        sa.Column("network_context", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_session_queued_messages", "network_context")
