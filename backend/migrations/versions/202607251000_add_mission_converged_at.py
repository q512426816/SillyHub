"""add AgentMission.converged_at guard column (R5)

2026-07-25 Wave C / R5：converge_mission_for_completed_run 重复收敛守卫。
AgentMission 加 converged_at 列，converge 持 mission 行锁期间置位，防止两个
worker 同时 complete 触发重复 collect_completed_artifacts / finalize_*（重复
merge artifact / 重复 GLM 调用计费）。nullable 兼容历史 mission（None = 未收敛）。

Revision ID: 202607251000
Revises: 202607250100
Create Date: 2026-07-25 10:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "202607251000"
down_revision = "202607250100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_missions",
        sa.Column("converged_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_missions", "converged_at")
