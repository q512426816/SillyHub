"""create daemon_change_writes table

Revision ID: 202606261130
Revises: 202606251900

task-08 / Phase 3 (D-004@v1): daemon-client change-write 任务队列，daemon 经
lease-polling 轮询消费（GET /pending-change-writes → claim → 本地写 → complete）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606261130"
down_revision = "202606251900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "daemon_change_writes",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "runtime_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("daemon_runtimes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("change_key", sa.String(128), nullable=False),
        sa.Column("files", sa.JSON, nullable=False),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("claim_token", sa.String(128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        # task-09：claim 落点时间，NFR-03 超时 gc（claimed_at < now-60s → failed）
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text, nullable=True),
    )
    # 复合索引支撑 daemon 轮询热路径 WHERE runtime_id=? AND status='pending' (FR-08)
    op.create_index(
        "idx_daemon_change_writes_runtime_status",
        "daemon_change_writes",
        ["runtime_id", "status"],
    )
    op.create_index(
        "idx_daemon_change_writes_workspace_id",
        "daemon_change_writes",
        ["workspace_id"],
    )
    op.create_index(
        "idx_daemon_change_writes_status",
        "daemon_change_writes",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index("idx_daemon_change_writes_status", table_name="daemon_change_writes")
    op.drop_index("idx_daemon_change_writes_workspace_id", table_name="daemon_change_writes")
    op.drop_index("idx_daemon_change_writes_runtime_status", table_name="daemon_change_writes")
    op.drop_table("daemon_change_writes")
