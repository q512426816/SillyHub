"""runtime allowed_roots per-runtime

Revision ID: 20260706_rt_ar
Revises: 20260706_merge_heads
Create Date: 2026-07-06T11:40:00

2026-07-06-allowed-roots-per-runtime task-01：DaemonRuntime 加回 allowed_roots 列
（per-runtime 持久化），copy daemon_instances.allowed_roots → 所有现存 runtime
（继承机器级 default）。CC/Hermes 互不影响。
"""

import sqlalchemy as sa
from alembic import op

revision = "20260706_rt_ar"
down_revision = "20260706_merge_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("daemon_runtimes", sa.Column("allowed_roots", sa.JSON(), nullable=True))
    # copy 当前 instance 值到所有 runtime（继承机器级 default）
    op.execute(
        """
        UPDATE daemon_runtimes r
        SET allowed_roots = (
            SELECT allowed_roots FROM daemon_instances i WHERE i.id = r.daemon_instance_id
        )
        """
    )


def downgrade() -> None:
    op.drop_column("daemon_runtimes", "allowed_roots")
