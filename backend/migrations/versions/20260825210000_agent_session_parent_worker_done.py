"""agent_sessions 加会话树两列（parent_session_id / worker_done_at）

Revision ID: 20260825210000
Revises: 20260825160000
Create Date: 2026-08-25 21:00:00

2026-08-25-team-subsession-governance task-01（design §5.A / D-001@v1 /
D-002@v1）：团队分身子会话化地基——分身以子会话形态挂载到主控会话，
完成信号从「run 终态」迁到显式 worker_done 标记。

1. ``parent_session_id`` uuid NULL 自引用 FK → ``agent_sessions.id``——
   分身子会话挂载点（团队场景父 = 主控会话）；NULL = 非分身会话。索引
   ``ix_agent_sessions_parent`` 供 mission_worker_sessions 一层枚举与
   resolve_mission_for_session 归属解析（P1 树深 2 只查一层，P2 递归
   派发时再放开递归 CTE + 树深上限）。FK 命名对齐 20260822090000 的
   ``fk_agent_missions_session_id`` 惯例，无 ondelete（会话软删不硬删，
   同 agent_missions.session_id 先例）。
2. ``worker_done_at`` timestamptz NULL——分身显式完成信号落点（受限 MCP
   worker_done 工具置位）；可重复置位（追问重开工后再完成，取最新时间）；
   非分身会话恒 NULL。

存量行处理：两列均 nullable 不回填——存量 mission 不迁子会话形态
（design §3 非目标），双判据兼容由后续任务负责。

downgrade：对称 drop 索引 → FK → 两列。

author: qinyi
created_at: 2026-08-25 21:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260825210000"
down_revision: str | None = "20260825160000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. 会话树父指针：分身子会话挂载主控会话；NULL = 非分身（存量零回归）
    op.add_column(
        "agent_sessions",
        sa.Column("parent_session_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_agent_sessions_parent_session_id",
        "agent_sessions",
        "agent_sessions",
        ["parent_session_id"],
        ["id"],
    )
    # 2. 分身完成信号：worker_done 置位；可重复置位取最新；非分身恒 NULL
    op.add_column(
        "agent_sessions",
        sa.Column("worker_done_at", sa.DateTime(timezone=True), nullable=True),
    )
    # 3. 父指针索引：mission_worker_sessions 按根查直接子会话的查询键
    op.create_index(
        "ix_agent_sessions_parent",
        "agent_sessions",
        ["parent_session_id"],
    )


def downgrade() -> None:
    # 与 upgrade 对称反序
    op.drop_index("ix_agent_sessions_parent", table_name="agent_sessions")
    op.drop_column("agent_sessions", "worker_done_at")
    op.drop_constraint("fk_agent_sessions_parent_session_id", "agent_sessions", type_="foreignkey")
    op.drop_column("agent_sessions", "parent_session_id")
