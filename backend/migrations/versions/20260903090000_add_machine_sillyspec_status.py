"""daemon_instances 加 sillyspec_status JSON 列（sillyspec 全局进度总览快照）

Revision ID: 20260903090000
Revises: 20260902120000
Create Date: 2026-09-03 09:00:00

2026-09-02-changes-overview-card task-01（FR-05 / Grill B1）：
为 daemon_instances 新增 1 列——

* ``sillyspec_status`` JSON NULL：daemon 周期采集的 ``progress show --json``
  envelope 摘要快照（ok/errors_count/warnings_count/generated_at/active_changes/
  healthy_count/ghost_count/conflict_count/conflict_types/changes[]/
  pending_conflicts[]；null=总览不可用，sillyspec 未安装或版本过低）。

落库语义（Grill B1 修订 None=清除，与 sillyspec_update 权威注释一致——
app/modules/daemon/model.py / router.py 心跳 DTO 段）：心跳载荷该键为 null 即置
NULL 清除；daemon 侧采集瞬态失败保留上次快照上报、不清除（三态降级矩阵见
design §5）。本迁移只加列不回填（存量行为 NULL），写入/清除在心跳 handler，
模型见 app/modules/daemon/model.py ``DaemonInstance``。

down_revision 接执行时唯一 head 20260902120000（alembic heads 实测单 head）。
downgrade 对称删列。结构照 20260831150000_add_daemon_sillyspec_fields.py 先例。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260903090000"
down_revision = "20260902120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daemon_instances",
        sa.Column("sillyspec_status", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("daemon_instances", "sillyspec_status")
