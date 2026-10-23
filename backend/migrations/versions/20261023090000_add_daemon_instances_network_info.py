"""daemon_instances network_info（机器网络环境快照）

Revision ID: 20261023090000
Revises: 20261022100000
Create Date: 2026-10-23

为 daemon_instances 新增 network_info JSON 列（2026-10-23-session-network-context
task-05 / FR-03 / D-008@v1）：{observed_ip, interfaces}——backend 观测的 daemon
请求来源 IP（判定 ground truth）+ daemon 心跳自报网卡清单（拼访问地址），
供会话每轮注入的【网络环境】段做同网段判定。存量行 NULL=无网络数据，判定
降级不报错（D-002/D-008 兼容策略）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261023090000"
down_revision = "20261022100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daemon_instances",
        sa.Column("network_info", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("daemon_instances", "network_info")
