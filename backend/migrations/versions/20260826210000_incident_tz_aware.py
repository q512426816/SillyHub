"""incidents/postmortems 时间列转 timestamptz（naive → aware 对齐全仓口径）

Revision ID: 20260826210000
Revises: 20260826020000
Create Date: 2026-08-26 21:00:00

ql-20260826-012-2802：incident 域是全仓唯一「DateTime 无 timezone + naive
utcnow 默认值」的例外（其余模块统一 ``DateTime(timezone=True)`` +
``datetime.now(UTC)``），且 service 层一直写 aware 值——asyncpg 写 aware 到
``timestamp without time zone`` 会剥 tz、读回 naive，与 ORM 内存中的 aware
默认值比较即 TypeError/静默偏移。model 侧已同步改口径（见
``app/modules/incident/model.py``）。

本迁移把 incidents 的 ``resolved_at/created_at/updated_at`` 与 postmortems 的
``created_at/updated_at`` 共 5 列 ALTER 为 ``TIMESTAMP WITH TIME ZONE``。
``USING ... AT TIME ZONE 'UTC'`` 把存量 naive 值按 UTC 解释（写入方是
utcnow/now(UTC)，语义正确），不依赖会话 TimeZone。项目确认该表数据可重置，
存量转换仅求平滑不求精确保。

downgrade：对称转回 ``timestamp without time zone``（``AT TIME ZONE 'UTC'``
反向剥 tz），与原 schema 等价。

author: qinyi
created_at: 2026-08-26 21:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260826210000"
down_revision = "20260826020000"
branch_labels = None
depends_on = None

# (table, column, nullable)——与 model.py 的 DateTime(timezone=True) 列一一对应。
_COLUMNS: list[tuple[str, str, bool]] = [
    ("incidents", "resolved_at", True),
    ("incidents", "created_at", False),
    ("incidents", "updated_at", False),
    ("postmortems", "created_at", False),
    ("postmortems", "updated_at", False),
]


def upgrade() -> None:
    for table, column, nullable in _COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=sa.DateTime(),
            type_=sa.DateTime(timezone=True),
            existing_nullable=nullable,
            postgresql_using=f"{column} AT TIME ZONE 'UTC'",
        )


def downgrade() -> None:
    for table, column, nullable in _COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=sa.DateTime(timezone=True),
            type_=sa.DateTime(),
            existing_nullable=nullable,
            postgresql_using=f"{column} AT TIME ZONE 'UTC'",
        )
