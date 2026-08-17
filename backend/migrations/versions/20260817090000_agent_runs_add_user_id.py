"""agent_runs add user_id (turn sender)

Revision ID: 20260817090000
Revises: d7a1f5c2b9e4
Create Date: 2026-08-17 09:30:00

ql-20260817-003（守护进程共享 → 同会话多用户发言）：agent_runs 加 user_id
（FK users ON DELETE SET NULL）记录轮次发送者。旧 run 行 NULL=历史无发送者
数据（前端不显示发送行，零回归）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260817090000"
down_revision = "d7a1f5c2b9e4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_runs",
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("agent_runs", "user_id")
