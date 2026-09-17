"""add queued message model snapshot + session pending thinking level

Revision ID: 20260917160000
Revises: 20260917104400
Create Date: 2026-09-17 16:00:00.000000

ql-20260917-008（会话执行中允许直接切换供应商/模型/思考等级/智能体档案，
下一轮生效）：

- ``agent_session_queued_messages.model``：排队行的切模型快照（task-11 会话级
  选模型的排队快照缺口——此前忙轮切模型入队后 model 维度丢失，派发重放静默
  无效）。存量行 NULL = 发送时未携带，语义不变。
- ``agent_sessions.pending_thinking_level``：忙轮暂存的思考档位（覆盖式，「最后
  一次为准」）——用户运行中切档不再 409；run 终态钩子（close_run_steps）经
  RPC 应用到 daemon 后清列。存量行 NULL = 无暂存，语义不变。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "20260917160000"
down_revision: str = "20260917104400"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_session_queued_messages",
        sa.Column("model", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "agent_sessions",
        sa.Column("pending_thinking_level", sa.String(length=16), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_sessions", "pending_thinking_level")
    op.drop_column("agent_session_queued_messages", "model")
