"""agent run log tool_kind

Revision ID: 20260705_tool_kind
Revises: 202607041800
Create Date: 2026-07-05

为 agent_run_logs 新增结构化 tool_kind 列 + 索引（D-003@v1 方案 B）。
支撑 Phase2 落库打标与 Phase3 两层筛选（tool_kind / parent_tool_use_id）。
None 表示非工具调用日志（user_input / 纯文本 assistant 输出 / stderr），依赖
default=None 兜底，user_input 构造点不改。change 2026-07-05-agent-log-type-tags task-01。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260705_tool_kind"
down_revision = "202607041800"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_run_logs",
        sa.Column("tool_kind", sa.String(length=32), nullable=True),
    )
    op.create_index(
        "ix_agent_run_logs_tool_kind",
        "agent_run_logs",
        ["tool_kind"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_agent_run_logs_tool_kind",
        table_name="agent_run_logs",
    )
    op.drop_column("agent_run_logs", "tool_kind")
