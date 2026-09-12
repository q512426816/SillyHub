"""agent_session_scheduled_messages + origin（自动续跑排期标记）

Revision ID: 20260912110000
Revises: 1d763051eb15
Create Date: 2026-09-12 11:00:00

2026-09-12-chat-turn-auto-recovery FR-4.1（design §8）：
- origin TEXT NULL —— 'auto_resume:<源 run uuid>' = close 钩子 quota 分支排期
  的自动续跑条目；NULL = 用户预约（存量语义不变）。
- soft-add：旧行 NULL=非自动续跑；无索引诉求（会话维度条目数小，幂等/G10 按
  agent_session_id+status 过滤后小集合扫描——与 20260910120000 的
  queued_messages.origin 同论证）。
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260912110000"
down_revision = "1d763051eb15"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_session_scheduled_messages",
        sa.Column("origin", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_session_scheduled_messages", "origin")
