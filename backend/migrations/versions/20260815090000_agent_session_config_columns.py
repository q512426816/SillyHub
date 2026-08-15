"""agent_sessions config columns + agent_runs llm_provider_id

Revision ID: 20260815090000
Revises: 20260813173000
Create Date: 2026-08-15 09:55:00

2026-08-14-sessions-portal task-01（FR-04 / FR-07 / D-008@v1 / D-011@v1）：
会话独立持有配置。agent_sessions 加 agent_profile_id / llm_provider_id /
config_snapshot 三列；agent_runs 加 llm_provider_id（轮次供应商快照，与既有
agent_profile_snapshot 共同构成 D-008 轮次快照）。

- 四列均 nullable、无回填：旧数据全 NULL = 现状行为（R-01 零回归）。
- FK 均 ON DELETE SET NULL：档案/供应商删除后会话与 run 历史保留。
- config_snapshot 为 JSON 摘要（profile_name/provider_name/model/engine/
  machine_name/agent_name），供会话列表 chips 直显（Grill C-12）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260815090000"
down_revision = "20260813173000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_sessions",
        sa.Column(
            "agent_profile_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_profiles.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "agent_sessions",
        sa.Column(
            "llm_provider_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("llm_providers.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "agent_sessions",
        sa.Column("config_snapshot", sa.JSON(), nullable=True),
    )
    op.add_column(
        "agent_runs",
        sa.Column(
            "llm_provider_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("llm_providers.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("agent_runs", "llm_provider_id")
    op.drop_column("agent_sessions", "config_snapshot")
    op.drop_column("agent_sessions", "llm_provider_id")
    op.drop_column("agent_sessions", "agent_profile_id")
