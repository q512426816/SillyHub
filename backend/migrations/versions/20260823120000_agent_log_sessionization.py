"""agent log sessionization: origin/aggregation_key/title + agent_session_id

Revision ID: 20260823120000
Revises: 20260823100000
Create Date: 2026-08-23 12:00:00

Change 2026-08-23-agent-activity-sessions task-03 / design §3.3.1 / FR-03 /
FR-04：工具上报 agent 日志会话化数据层——

- ``agent_sessions`` 加三列：
  - ``origin`` varchar(16) NOT NULL server_default 'chat'——会话来源，'chat'
    （平台对话会话，存量行为）| 'tool_report'（CLI 工具上报聚合出的本地
    Agent 会话）。server_default 让存量行免回填即得 chat 语义（R-03 无回填）。
  - ``aggregation_key`` varchar(255) NULL——tool_report 会话聚合键文本
    ``"{harness}|{ctx_key}"``（D-001）。加普通索引 ``ix_agent_sessions_ws_agg
    (workspace_id, aggregation_key)`` 供 find-or-create 查找，**非唯一约束**
    （D-006 容错：workspace_id nullable 建不了复合唯一，并发撞键靠
    find-then-insert，极小概率重复行按 last_active_at 取最新、后续上报自然
    收敛到最新行，败者僵尸行不清理）。
  - ``title`` varchar(255) NULL——Grill P1-1：AgentSession 原无 title 列，
    chat 会话由 router 首条 user_input 派生标题，NULL 兼容既有派生路径零回归；
    tool_report 会话由服务端写自动标题（task-04）。
- ``platform_agent_logs`` 加 ``agent_session_id`` Uuid NULL FK→
  agent_sessions(id) ON DELETE SET NULL + 普通索引——会话化归属落点
  （design §3.3.3，归属写入在 task-04）；会话删除不拖日志行（行属 workspace
  留底审计），NULL = 未归属（存量行不回填，R-03）。
- batch_alter_table 兼容 SQLite（测试：ALTER TABLE 加 FK 需 batch 重建表，
    先例 20260811104500）与 PostgreSQL（生产：batch 为 no-op wrapper 直接
    ALTER），dialect 无关（sa.Uuid/sa.String 跨库一致）。
- 无数据回填（CLAUDE.md 规则 11 / design R-03：未上线，存量日志行不迁移
  归属，旧 workspace 级展示随 FR-08 移除）。

down_revision 接 ``20260823100000``（file_description_column，并行变更
2026-08-23-agent-file-upload-mcp 已串链后的当前单头，实测值；不接卡片
初稿的 20260823090000 以免分叉双头）。

author: qinyi
created_at: 2026-08-23 12:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260823120000"
down_revision: str | None = "20260823100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── design §3.3.1 / FR-03: agent_sessions 会话化三列 + 聚合查找索引 ──
    with op.batch_alter_table("agent_sessions", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "origin",
                sa.String(length=16),
                nullable=False,
                server_default=sa.text("'chat'"),
            )
        )
        batch_op.add_column(sa.Column("aggregation_key", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("title", sa.String(length=255), nullable=True))
        batch_op.create_index(
            "ix_agent_sessions_ws_agg",
            ["workspace_id", "aggregation_key"],
            unique=False,
        )

    # ── design §3.3.1 / FR-04: platform_agent_logs 归属列 + FK + 索引 ──
    with op.batch_alter_table("platform_agent_logs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("agent_session_id", sa.Uuid(as_uuid=True), nullable=True))
        batch_op.create_foreign_key(
            "fk_platform_agent_logs_agent_session_id_agent_sessions",
            "agent_sessions",
            ["agent_session_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_platform_agent_logs_agent_session_id",
            ["agent_session_id"],
            unique=False,
        )


def downgrade() -> None:
    """结构反向回滚（与 upgrade 完全对称可逆）。"""
    with op.batch_alter_table("platform_agent_logs", schema=None) as batch_op:
        batch_op.drop_index("ix_platform_agent_logs_agent_session_id")
        batch_op.drop_constraint(
            "fk_platform_agent_logs_agent_session_id_agent_sessions",
            type_="foreignkey",
        )
        batch_op.drop_column("agent_session_id")

    with op.batch_alter_table("agent_sessions", schema=None) as batch_op:
        batch_op.drop_index("ix_agent_sessions_ws_agg")
        batch_op.drop_column("title")
        batch_op.drop_column("aggregation_key")
        batch_op.drop_column("origin")
