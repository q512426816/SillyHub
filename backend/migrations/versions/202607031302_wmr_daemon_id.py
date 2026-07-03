"""workspace_member_runtimes add daemon_id column

Revision ID: 202607031302
Revises: 202607031301

Change 2026-07-03-daemon-entity-binding task-03 (design §4.3 / D-004):
per-member 绑定表加 daemon_id（FK RESTRICT nullable）+ ix_wmr_daemon 索引。
runtime_id 列保留（旧数据快照，PUT /my-binding 不再写，写入逻辑属 task-09）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607031302"
down_revision = "202607031301"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace_member_runtimes",
        sa.Column(
            "daemon_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("daemon_instances.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_wmr_daemon",
        "workspace_member_runtimes",
        ["daemon_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_wmr_daemon", table_name="workspace_member_runtimes")
    op.drop_column("workspace_member_runtimes", "daemon_id")
