"""agent_group_chats consensus columns + agent_group_consensus_tasks

Revision ID: 20260910120000
Revises: 5e295549e20f
Create Date: 2026-09-11 22:30:00

2026-09-10-group-agent-direct-chat task-01（design §5.2 / D-002@v1 / D-008@v1）：
群聊汇总收口模式持久层。

1. ``agent_group_chats`` 加两列（照 agent_cross_mention 顶层列先例）：
   - ``consensus_mode`` BOOL NOT NULL server_default false——存量群默认关，
     发送侧零行为变化（D-002 零回归底线）；
   - ``consensus_timeout_seconds`` INT NOT NULL server_default 600——范围
     60~3600 由 schema 层校验，DB 不设 CHECK（对齐 cross_mention_depth 先例）。
2. 新表 ``agent_group_consensus_tasks``（汇总任务状态机唯一状态源，D-008）：
   group_id FK CASCADE / carrier_run_id FK agent_runs CASCADE + UNIQUE（防同
   消息重复建任务）/ coordinator_member_id FK agent_group_members CASCADE /
   status VARCHAR(16) NOT NULL（open|closing|closed|timeout|aborted，应用层
   控制，不设 server_default——对齐 skill_sources 先例防 autogenerate 漂移）/
   members JSON NOT NULL（被咨询成员明细快照）/ deadline_at TIMESTAMPTZ
   NOT NULL / created_by FK users CASCADE / created_at now() server_default /
   converged_at NULL。
3. 索引：ix_agct_group(group_id)、ix_agct_status_deadline(status,
   deadline_at)（sweeper 扫描谓词）、uq_agct_carrier_run(carrier_run_id)
   （unique=True 内联约束）。

无数据回填（新表零存量；两列 server_default 覆盖存量行）。downgrade 对称
回落：先删表（连带索引/约束随表删），再删两列。

author: qinyi
created_at: 2026-09-11 22:30:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260910130000"
down_revision = "5e295549e20f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_group_chats",
        sa.Column(
            "consensus_mode",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "agent_group_chats",
        sa.Column(
            "consensus_timeout_seconds",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("600"),
        ),
    )
    op.create_table(
        "agent_group_consensus_tasks",
        sa.Column(
            "id",
            sa.Uuid(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "group_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_group_chats.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "carrier_run_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_runs.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "coordinator_member_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_group_members.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("members", sa.JSON(), nullable=False),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_by",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("converged_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_agct_group",
        "agent_group_consensus_tasks",
        ["group_id"],
    )
    op.create_index(
        "ix_agct_status_deadline",
        "agent_group_consensus_tasks",
        ["status", "deadline_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_agct_status_deadline", table_name="agent_group_consensus_tasks")
    op.drop_index("ix_agct_group", table_name="agent_group_consensus_tasks")
    op.drop_table("agent_group_consensus_tasks")
    op.drop_column("agent_group_chats", "consensus_timeout_seconds")
    op.drop_column("agent_group_chats", "consensus_mode")
