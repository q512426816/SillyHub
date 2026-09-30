"""add platform_agent_logs reported machine columns

Revision ID: 20260930110000
Revises: 20260928140000
Create Date: 2026-09-30 11:10:00.000000

2026-09-30-tool-report-activation-wrong-machine task-01（design 数据模型 /
FR-01 / D-001@v1）：platform_agent_logs 加上报机器身份两列——
``reported_machine_id``（上报方持久 machineId，daemon 心跳同源 ~/.sillyhub/
machine-id，CLI v2 起携带；NULL=老协议）与 ``reported_machine_name``（上报方
hostname，takeover 四级匹配②级匹配 daemon_runtimes.name）。均 nullable、无
唯一约束（hostname 允许多条上报）、存量行不回填。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260930110000"
down_revision: str | None = "20260928140000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "platform_agent_logs",
        sa.Column("reported_machine_id", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "platform_agent_logs",
        sa.Column("reported_machine_name", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("platform_agent_logs", "reported_machine_name")
    op.drop_column("platform_agent_logs", "reported_machine_id")
