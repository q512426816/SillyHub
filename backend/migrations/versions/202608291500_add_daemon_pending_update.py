"""daemon_instances.pending_update

Revision ID: 20260829150000
Revises: 4766d997cf09
Create Date: 2026-08-29 15:00:00

Change 2026-08-29-daemon-selfupdate-safety task-02（FR-04 / D-004@v1）：
为 daemon_instances 新增 pending_update 列（JSON nullable，NULL=无待升级）。
daemon 忙、推迟自升级期间，心跳携带 {reason, current_version, target_version}，
backend upsert 落库并补 since；升级执行/取消后心跳不再携带 → 置 NULL 清除
（写入/清除逻辑在 task-06 心跳端点，本迁移只加列，模型见
app/modules/daemon/model.py ``DaemonInstance.pending_update``）。

down_revision 接执行时唯一 head 4766d997cf09（alembic heads 实测单 head）。
downgrade 对称删列。结构照 20260805110000_daemon_started_at.py 先例。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260829150000"
down_revision = "4766d997cf09"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daemon_instances",
        sa.Column("pending_update", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("daemon_instances", "pending_update")
