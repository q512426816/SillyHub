"""群成员未读位点列（group member last_read_at，群 P2 第二波）

Revision ID: 20260902120000
Revises: 20260902110000
Create Date: 2026-09-02 12:00:00

单文件迁移（群聊 P2 第二波·未读位点，后端部分）：

1. ``agent_group_members.last_read_at`` TIMESTAMPTZ NULL——本成员在该群的
   已读位点（``PUT /group-chats/{gid}/read`` 服务端置 now()；发送消息时顺
   带推进到消息时间戳——自己发的不算未读）。选成员表加列而非独立
   ``agent_group_member_reads`` 轻表：一列、成员维度天然隔离（per-member
   状态本就住在成员行上，settings_json 是群级 per-group 不合适）、迁移
   最简。NULL=从未标记已读（未读数=全量，显示 cap 99+）。

downgrade 对称回滚（删列）。

author: qinyi
created_at: 2026-09-02 12:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260902120000"
down_revision: str | None = "20260902110000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── agent_group_members.last_read_at（未读位点，NULL=从未标记已读）──
    op.add_column(
        "agent_group_members",
        sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_group_members", "last_read_at")
