"""daemon_instances 加 sillyspec 三列（本机 sillyspec 工具版本 + 升级状态快照）

Revision ID: 20260831150000
Revises: 20260831130000
Create Date: 2026-08-31 15:00:00

2026-08-31-machine-sillyspec-version task-02（FR-05 / D-002@v1）：
为 daemon_instances 新增 3 列——

* ``sillyspec_version`` VARCHAR(50) NULL：本机 sillyspec 版本（null=未安装或未知）；
* ``sillyspec_latest_version`` VARCHAR(50) NULL：daemon 探测到的 npm 最新版（null=未知）；
* ``sillyspec_update`` JSON NULL：升级状态机快照
  ``{state, trigger, from_version, to_version, error, since}``（null=无进行中/近期升级）。

落库语义（D-002@v1 双通道，写入/清除逻辑在 RuntimeService register/heartbeat，
本迁移只加列，模型见 app/modules/daemon/model.py ``DaemonInstance``）：
register 无条件直写（含 null）/ 心跳对 version/latest 仅非 None 覆盖、
sillyspec_update 心跳无该键即置 NULL（pending_update 同款）。

down_revision 接执行时唯一 head 20260831130000（alembic heads 实测单 head）。
downgrade 对称删列。结构照 202608291500_add_daemon_pending_update.py 先例。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260831150000"
down_revision = "20260831130000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daemon_instances",
        sa.Column("sillyspec_version", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "daemon_instances",
        sa.Column("sillyspec_latest_version", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "daemon_instances",
        sa.Column("sillyspec_update", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("daemon_instances", "sillyspec_update")
    op.drop_column("daemon_instances", "sillyspec_latest_version")
    op.drop_column("daemon_instances", "sillyspec_version")
