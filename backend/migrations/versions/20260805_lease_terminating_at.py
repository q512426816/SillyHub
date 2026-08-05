"""DaemonTaskLease add terminating_at column

Phase 4 轻量终态确认观测点（design §5 Phase4 / D-007 / R-05）：
``daemon_task_leases`` 加 ``terminating_at`` nullable 列。``cancel_lease``
发出取消信号后写入、daemon 回传终态后清空，为 sweeper 提供"已标 cancelled、
等 daemon 回传确认"间隙的观测窗口。

铁律（D-007，方案 C）：
- **不改 ``lease.status`` 状态机取值集合**，仅加时间戳。
- 全新列 nullable=True、默认 NULL，现有 lease 不受影响（§9 兼容策略）。
- PPM 不依赖此表，零回归。

``down_revision`` 接 ``20260802_agent_profile``（当前 head，``alembic heads``
实测单 head）。本任务只加列；写入/清理/sweeper 逻辑在 task-11。

Revision ID: 20260805_lease_terminating_at
Revises: 20260802_agent_profile
Create Date: 2026-08-05
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260805_lease_terminating_at"
down_revision: str | None = "20260802_agent_profile"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # DateTime(timezone=True) 与 model.py 终态时间戳（claimed_at/lease_expires_at）
    # 同风格，避免 autogenerate 漂移。
    op.add_column(
        "daemon_task_leases",
        sa.Column("terminating_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("daemon_task_leases", "terminating_at")
