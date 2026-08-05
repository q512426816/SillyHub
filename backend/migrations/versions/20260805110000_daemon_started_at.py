"""daemon instance started_at

Revision ID: 20260805110000
Revises: 20260802_agent_profile
Create Date: 2026-08-05

为 daemon_instances 新增 started_at 列（daemon 进程启动时间，FR-02 / D-002@v1）。
daemon 上报自身进程启动时刻，用于精确计算 uptime 与诊断长时间运行漂移。
旧 daemon 不上报则为 NULL（nullable，Postgres 加列不锁表）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260805110000"
down_revision = "20260802_agent_profile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daemon_instances",
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("daemon_instances", "started_at")
