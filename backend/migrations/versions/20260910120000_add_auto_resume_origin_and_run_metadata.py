"""daemon 重启自动续跑：队列 origin + run metadata 两列（2026-09-10-auto-resume-interrupted-turn / D-009@v2）

Revision ID: 20260910120000
Revises: 20260909120000
Create Date: 2026-09-10 12:00:00

soft-add 两列（design §1.1，全可空、旧行 NULL=存量语义）：

- ``agent_session_queued_messages.origin`` TEXT NULL——'auto_resume:<源 run
  uuid>' 复合值 = 自动续跑条目（G8 幂等去重 + 派发打标锚）；NULL = 用户排队。
- ``agent_runs.metadata`` JSON NULL——续跑轮落 ``{"auto_resume_of": "<源 run
  id>"}``（链上限计数 + 前端徽标数据源）。ORM 属性名 ``metadata_``（SQLAlchemy
  ``metadata`` 保留属性，照 AgentRunLog model.py:580-583 先例），DB 列名
  ``metadata``。

downgrade 对称 drop 两列。
"""

import sqlalchemy as sa
from alembic import op

revision = "20260910120000"
down_revision = "20260909120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_session_queued_messages",
        sa.Column("origin", sa.Text(), nullable=True),
    )
    op.add_column(
        "agent_runs",
        sa.Column("metadata", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_runs", "metadata")
    op.drop_column("agent_session_queued_messages", "origin")
