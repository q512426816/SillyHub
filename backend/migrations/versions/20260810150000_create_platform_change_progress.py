"""create platform_change_progress table

Revision ID: 20260810150000
Revises: 202608091100

SillySpec 进度同步层聚合存储（change ``2026-08-10-sillyhub-platform-sync`` task-02）。
存客户端 serializeForSync 裸六表 JSON（``latest_progress``）+ base_ts 字典序比对基准
（``last_pushed_at`` = 客户端 ``X-SillySpec-Pushed-At`` 原值）+ 推送者（``last_pusher``）。
对齐跨仓契约 ``sillyhub-progress-sync-contract.md`` §3/§4.2 + design §8.1。

dialect 无关 ``op.create_table``：SQLite 测试与 PostgreSQL 生产对齐（design §8.2）。
``latest_progress`` 用 ``sa.JSON()`` 非 JSONB（SQLite 兼容，Grill X-009）。
本项目未上线，无需历史数据回填（CLAUDE.md 规则 11）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260810150000"
down_revision = "202608091100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_change_progress",
        sa.Column("change_name", sa.String(), primary_key=True, nullable=False),
        sa.Column("latest_progress", sa.JSON(), nullable=True),
        sa.Column("last_pushed_at", sa.String(64), nullable=True),
        sa.Column("last_pusher", sa.String(255), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("platform_change_progress")
