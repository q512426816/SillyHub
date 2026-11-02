"""group member model + thinking_level columns

2026-11-02-group-member-footer-config：群 agent 成员六要素补两维——

- ``model``：成员级具体模型名覆盖（如 "deepseek-v4.1-flash"），影子会话首
  run AgentRun.model 直传；NULL=未指定，维持 llm_provider 主模型兜底
  （列口径对齐 AgentRun.model String(128)）。
- ``thinking_level``：思考等级七档词表值（off/minimal/low/medium/high/xhigh/
  max，同源镜像见 daemon/session/service/thinking_level.py），影子会话
  lease metadata.thinking_level 透传；NULL=引擎默认档位（String(16) 容
  "minimal" 最长档）。

存量成员行两列 NULL = 派发行为与现状逐字节一致（零回归兜底）。

Revision ID: 20261102140000
Revises: 20261030180000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261102140000"
down_revision = "20261030180000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_group_members",
        sa.Column("model", sa.String(128), nullable=True),
    )
    op.add_column(
        "agent_group_members",
        sa.Column("thinking_level", sa.String(16), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_group_members", "thinking_level")
    op.drop_column("agent_group_members", "model")
