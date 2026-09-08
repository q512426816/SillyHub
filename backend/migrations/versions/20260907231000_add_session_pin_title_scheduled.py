"""会话置顶列与定时消息表（session pin / scheduled send）

Revision ID: 20260907231000
Revises: 20260907141041
Create Date: 2026-09-07 23:10:00

2026-09-07-session-pin-rename-scheduled-send task-01（design §数据模型 /
FR-01 / FR-04 / FR-07 / D-001@v1 / D-002@v1）：

1. ``agent_sessions`` 加 ``pinned_at`` 可空列 + 独立索引
   ``ix_agent_sessions_pinned_at``——会话置顶时间戳，NULL = 未置顶
   （存量行零回归：排序谓词 pinned_at IS NULL 恒真，序不变）；列形态照
   ``archived_at``（DateTime(timezone=True) nullable）。
2. 建表 ``agent_session_scheduled_messages``——会话定时消息（到点 sweeper
   派发，sweeper 归 task-03）：``ix_agent_ssm_session_status_dispatch``
   复合索引供到期捞取扫描（status='pending' AND dispatch_at <= now）；两个
   FK（agent_sessions.id / users.id）均 ON DELETE CASCADE——会话软删
   （deleted_at）不触发级联，余留定时条目由 sweep 复核置 failed 自动收敛
   （design §数据模型）。列与 ``AgentSessionScheduledMessage`` 模型逐列
   对齐（防 autogenerate 漂移）。

纯 DDL 不回填数据（FR-07）。down_revision 接执行时唯一 head 20260907141041
（agent_liveness_states，alembic heads 实测单 head，防并行撞 head）。
downgrade 对称反序：drop 复合索引 → drop 表 → drop pinned_at 索引 → drop 列。

author: qinyi
created_at: 2026-09-07 23:10:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260907231000"
down_revision: str | None = "20260907141041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1) agent_sessions.pinned_at 可空列 + 索引（纯加列不回填，FR-07）。
    op.add_column(
        "agent_sessions",
        sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_agent_sessions_pinned_at",
        "agent_sessions",
        ["pinned_at"],
        unique=False,
    )
    # 2) 定时消息表（列序/类型与 AgentSessionScheduledMessage 模型逐列对齐）。
    op.create_table(
        "agent_session_scheduled_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("agent_session_id", sa.Uuid(), nullable=False),
        sa.Column("sender_user_id", sa.Uuid(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("attachment_ids", sa.JSON(), nullable=True),
        sa.Column("agent_profile_id", sa.String(length=64), nullable=True),
        sa.Column("llm_provider_id", sa.String(length=64), nullable=True),
        sa.Column("dispatch_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["agent_session_id"],
            ["agent_sessions.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["sender_user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_agent_ssm_session_status_dispatch",
        "agent_session_scheduled_messages",
        ["agent_session_id", "status", "dispatch_at"],
        unique=False,
    )


def downgrade() -> None:
    # 与 upgrade 对称反序：先拆新表（索引→表），再撤 pinned_at（索引→列）。
    op.drop_index(
        "ix_agent_ssm_session_status_dispatch",
        table_name="agent_session_scheduled_messages",
    )
    op.drop_table("agent_session_scheduled_messages")
    op.drop_index("ix_agent_sessions_pinned_at", table_name="agent_sessions")
    op.drop_column("agent_sessions", "pinned_at")
