"""add subagent log columns (parent_tool_use_id/subagent_type/depth)

Revision ID: 202606281237
Revises: 202606271300

2026-06-28-daemon-subagent-transcript task-06 / D-004@v1 / R-01：给 agent_run_logs
加三个子代理归属列 + parent_tool_use_id 索引，让主 agent 调 Task/Agent tool 派生
的子代理活动在日志中可标注归属与层级深度。

* ``parent_tool_use_id`` VARCHAR(200) NULL：子代理消息指向的父 tool_use id；
  主 agent 行为 NULL（向后兼容，FR-09）。
* ``subagent_type`` VARCHAR(100) NULL：子代理类型（如 general-purpose/Explore）。
* ``depth`` INTEGER NULL：层级深度，主 agent=0/NULL，子=父+1（daemon 维护，D-007@v1）。
* ``ix_agent_run_logs_parent``：parent_tool_use_id 单列索引，方案 B 列式承载的
  核心优势——支持按子代理聚合查询（design §8）。

agent_run_logs 表无 metadata 列（service.py 注释明示），故归属用独立列而非
JSON 注入（方案 B）。model.py AgentRunLog + schema AgentRunLogEntry 同步声明
（task-07）。downgrade 按反序 drop 列+索引，可回滚。down_revision 接 execute
时真实 head 202606271300（alembic heads 确认单一 head，R-01）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606281237"
down_revision = "202606271300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_run_logs",
        sa.Column("parent_tool_use_id", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "agent_run_logs",
        sa.Column("subagent_type", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "agent_run_logs",
        sa.Column("depth", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_agent_run_logs_parent",
        "agent_run_logs",
        ["parent_tool_use_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_run_logs_parent", table_name="agent_run_logs")
    op.drop_column("agent_run_logs", "depth")
    op.drop_column("agent_run_logs", "subagent_type")
    op.drop_column("agent_run_logs", "parent_tool_use_id")
