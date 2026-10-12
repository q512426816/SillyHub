"""agent_sessions current_change_id（会话当前变更上下文）

Revision ID: 20261012123000
Revises: c515ffd62859
Create Date: 2026-10-12

为 agent_sessions 新增 current_change_id 列（2026-10-12-run-level-change-attribution
task-01 / FR-01）：会话「当前变更上下文」——run_sync 命令解析通道解析出 sillyspec
绑定命令时回写（最后一条生效），inject 建轮时据此给 AgentRun.change_id 打锚，
使一个会话先后执行多个变更时轮级归属可拆分（对齐本地 CLI 水位差分的分段思想）。

与既有 change_id（会话创建时的派发绑定，只读）分列。FK ondelete=SET NULL：
变更删除时上下文清空，新轮回落无锚（经 change_session_links 认领的旧口径）。
存量行恒 NULL（nullable，Postgres 加列不锁表），行为不变。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261012123000"
down_revision = "c515ffd62859"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_sessions",
        sa.Column(
            "current_change_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("changes.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("agent_sessions", "current_change_id")
