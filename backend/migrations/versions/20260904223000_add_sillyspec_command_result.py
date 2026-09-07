"""daemon_instances 加 sillyspec_command_result JSON 列（sillyspec 命令结果槽）

Revision ID: 20260904223000
Revises: 20260903170000
Create Date: 2026-09-04 22:30:00

2026-09-04-conflict-resolve-entry task-03（FR-05 / D-004@v1）：
为 daemon_instances 新增 1 列——

* ``sillyspec_command_result`` JSON NULL：daemon 侧 sillyspec 命令执行器
  （resolve / ghost_cleanup）的最新结果槽（action/change/strategy/state/
  exit_code/error/executed_at，latest-wins 只留最新一条 R-07；null=终态展示
  窗口已过期或 register 恒清）。

落库语义两态（D-004@v1，X-04 修订）：心跳载荷该键为对象即整包直写，键不
出现即置 NULL 清除（daemon 终态窗口 10min 过期后停发该键，无需也不得发送
显式 null——无「保持旧值」三态分支）；register 恒清（结果槽在内存，进程重启
即失）。本迁移只加列不回填（存量行为 NULL），写入/清除在心跳 handler，模型见
app/modules/daemon/model.py ``DaemonInstance``。

down_revision 接执行时唯一 head 20260903170000（alembic heads 实测单 head）。
downgrade 对称删列。结构照 20260903090000_add_machine_sillyspec_status.py 先例。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260904223000"
down_revision = "20260903170000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daemon_instances",
        sa.Column("sillyspec_command_result", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("daemon_instances", "sillyspec_command_result")
