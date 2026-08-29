"""daemon_control_commands：控制指令可靠投递表（A2 / D-004@v1 / D-006@v1）

Revision ID: 20260829120000
Revises: 6756e634f119
Create Date: 2026-08-29 12:00:00

Change 2026-08-29-daemon-platform-resilience task-01（FR-01 / design A2）：
建 ``daemon_control_commands`` 表（模型：app/modules/daemon/model.py
``DaemonControlCommand``，参考 DaemonChangeWrite 先例）——控制指令落库
pending 待发，WS 推送成功标 delivered，daemon 补拉仅取 pending（delivered
不重发，D-006 零重复执行优先），消费 ack，超时/超龄行由 GC 收敛。

- ``(runtime_id, status, created_at)`` 复合索引覆盖补拉热路径
  ``WHERE runtime_id=? AND status='pending' ORDER BY created_at``
  （照 idx_daemon_task_leases_runtime_status_created 先例）。
- expires_at 按 kind 由服务层计算（inject 10min / permission_response
  6min / 其余 30min），表只存结果。

down_revision 接执行时唯一 head 6756e634f119（alembic heads 实测单 head），
单 head 接续不分叉。downgrade 对称删索引 + 删表。

author: qinyi
created_at: 2026-08-29 12:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260829120000"
down_revision: str | None = "6756e634f119"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "daemon_control_commands",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "runtime_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("daemon_runtimes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ack_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "idx_daemon_control_commands_runtime_status_created",
        "daemon_control_commands",
        ["runtime_id", "status", "created_at"],
        unique=False,
    )
    op.create_index(
        "idx_daemon_control_commands_status",
        "daemon_control_commands",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_daemon_control_commands_status",
        table_name="daemon_control_commands",
    )
    op.drop_index(
        "idx_daemon_control_commands_runtime_status_created",
        table_name="daemon_control_commands",
    )
    op.drop_table("daemon_control_commands")
