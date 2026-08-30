"""agent_session_queued_messages 加 position 列（排队条目拖拽排序键）

Revision ID: 20260831130000
Revises: 20260831120000
Create Date: 2026-08-31 12:00:00

2026-08-31-session-queue-ux task-01（FR-04 / D-002 / D-010，design §6）：
agent_session_queued_messages 加 position 派发序号列（INT NOT NULL）——
FR-04 拖拽排序的持久化排序键；入队 MAX+1 与派发改 ORDER BY position,
created_at 归 task-02（模型/查询侧），本迁移只动表结构。

三步走（D-010，对齐 202607240900_add_user_username 先例）：
① 加 nullable 列（过渡，回填后再收紧）；
② CTE ROW_NUMBER() OVER (ORDER BY created_at, id) 回填存量行 1..n——
  UPDATE 内联窗口函数非合法 Postgres 语法，必须走 CTE；
③ ALTER COLUMN SET NOT NULL。

- 不加唯一约束/索引（D-002）：并发插入由会话行锁串行（R-01），排序键
  带 created_at 次序兜底，重复不破坏正确性。
- 回填仅按 (created_at, id) 序一次完成，不迁移历史数据语义（NG-04）。
- down_revision 锚定执行时唯一 head 20260831120000（开工实测）。

downgrade：对称回滚（先松 NOT NULL 再删列，与 upgrade 步骤逆序）。

author: qinyi
created_at: 2026-08-31 12:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260831130000"
down_revision = "20260831120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 加 nullable 列（过渡，回填后再收紧 NOT NULL）
    op.add_column(
        "agent_session_queued_messages",
        sa.Column("position", sa.Integer(), nullable=True),
    )

    # 2. 回填存量行：按 (created_at, id) 升序 ROW_NUMBER 记 1..n。
    #    UPDATE 内联窗口函数非合法 Postgres 语法，必须走 CTE（D-010）。
    op.execute(
        """
        WITH ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
          FROM agent_session_queued_messages
        )
        UPDATE agent_session_queued_messages q SET position = r.rn
        FROM ranked r
        WHERE q.id = r.id
        """
    )

    # 3. 收紧 NOT NULL（不加唯一约束/索引——D-002：会话行锁已保证串行）
    op.alter_column(
        "agent_session_queued_messages",
        "position",
        existing_type=sa.Integer(),
        nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "agent_session_queued_messages",
        "position",
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.drop_column("agent_session_queued_messages", "position")
