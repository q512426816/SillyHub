"""agent_sessions 加会话树深度列 tree_depth

Revision ID: 20260826020000
Revises: 20260825230000
Create Date: 2026-08-26 02:00:00

2026-08-26-team-subsession-recursion task-01（design §5.A / D-001@v1 /
D-003@v2）：团队分身递归开闸 P2 深度治理地基——会话树深度落库，给派发门
O(1) 深度读（task-02 消费）与治理口径含孙层的分身全集。

1. ``tree_depth`` int NOT NULL server_default '0'——会话树深度：主控/普通
   会话 0、分身 1、孙 2；派发时 ``parent.tree_depth + 1`` 落库（分身派发
   路径显式传，daemon create 路径不传落默认 0）。索引
   ``ix_agent_sessions_tree_depth`` 供按深度过滤的查询键（model
   ``__table_args__`` 同步声明，防 autogenerate 漂移）。
2. **全表回填（Grill B1 硬要求）**：``UPDATE agent_sessions SET tree_depth =
   CASE WHEN parent_session_id IS NULL THEN 0 ELSE 1 END``——存量主控/普通
   会话 = 0（parent NULL）、存量分身 = 1（P1 造的子会话行 parent 非空）。
   NOT NULL 保证迁移后无 NULL 读值，不写任何「NULL 按 1 计」运行时兜底规则。

downgrade：对称 drop 索引 → drop 列（回填不逆写，downgrade 后重 upgrade 会按
同一 CASE 规则重算，幂等）。

author: qinyi
created_at: 2026-08-26 02:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260826020000"
down_revision: str | None = "20260825230000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. 深度列：NOT NULL + server_default 0——存量行免重建即得 0，随后回填修正
    op.add_column(
        "agent_sessions",
        sa.Column("tree_depth", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    # 2. 全表 CASE 回填：parent NULL→0（主控/普通）、非空→1（存量分身）——Grill B1
    op.execute(
        "UPDATE agent_sessions SET tree_depth = CASE WHEN parent_session_id IS NULL THEN 0 ELSE 1 END"
    )
    # 3. 深度索引（回填后建，索引一次成型）
    op.create_index(
        "ix_agent_sessions_tree_depth",
        "agent_sessions",
        ["tree_depth"],
    )


def downgrade() -> None:
    # 与 upgrade 对称反序
    op.drop_index("ix_agent_sessions_tree_depth", table_name="agent_sessions")
    op.drop_column("agent_sessions", "tree_depth")
