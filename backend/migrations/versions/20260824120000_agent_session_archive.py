"""agent session archive: archived_at column + index

Revision ID: 20260824120000
Revises: 20260823120000
Create Date: 2026-08-24 12:00:00

会话归档功能数据层——

- ``agent_sessions`` 加 ``archived_at`` DateTime(timezone=True) NULL：
  NULL = 可见（默认），非 NULL = 已归档（默认列表隐藏，筛选「已归档会话」时展示）。
  无 server_default（存量行 NULL = 可见，零回填）。
- 加普通索引 ``ix_agent_sessions_archived_at`` 供列表过滤查询性能。
- batch_alter_table 兼容 SQLite/PostgreSQL。

down_revision 接 ``20260823120000``（agent_log_sessionization）。

author: qinyi
created_at: 2026-08-24 12:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824120000"
down_revision: str | None = "20260823120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("agent_sessions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_index(
            "ix_agent_sessions_archived_at",
            ["archived_at"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("agent_sessions", schema=None) as batch_op:
        batch_op.drop_index("ix_agent_sessions_archived_at")
        batch_op.drop_column("archived_at")
