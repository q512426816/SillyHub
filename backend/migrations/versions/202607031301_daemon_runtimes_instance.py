"""daemon_runtimes add daemon_instance_id, drop machine-level columns

Revision ID: 202607031301
Revises: 202607031200

Change 2026-07-03-daemon-entity-binding task-02 (design §4.2 / D-002 / X-004):
- 加 daemon_instance_id（FK CASCADE，过渡 nullable=True，D-007 重置下 task-13
  清空旧 runtime 行后再 NOT NULL）+ idx_daemon_runtimes_instance 索引。
- 移除机器级列 os/arch/allowed_roots/capabilities（已上提到 daemon_instances）
  与 display_alias（X-004：与 daemon_instance.display_alias 语义碰撞，YAGNI 移除）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607031301"
down_revision = "202607031200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 加 daemon_instance_id（nullable=True 过渡：旧 runtime 行无对应 daemon_instance，
    # D-007 重置下 task-13 清空旧数据后再考虑 NOT NULL）。
    op.add_column(
        "daemon_runtimes",
        sa.Column(
            "daemon_instance_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("daemon_instances.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index(
        "idx_daemon_runtimes_instance",
        "daemon_runtimes",
        ["daemon_instance_id"],
    )

    # 移除已上提到 daemon_instances 的机器级列 + display_alias（X-004）。
    op.drop_column("daemon_runtimes", "allowed_roots")
    op.drop_column("daemon_runtimes", "capabilities")
    op.drop_column("daemon_runtimes", "arch")
    op.drop_column("daemon_runtimes", "os")
    op.drop_column("daemon_runtimes", "display_alias")


def downgrade() -> None:
    # 恢复被移除的列（与原 202606270900 / 202606291030 定义对齐）。
    op.add_column(
        "daemon_runtimes",
        sa.Column("display_alias", sa.String(200), nullable=True),
    )
    op.add_column(
        "daemon_runtimes",
        sa.Column("os", sa.String(50), nullable=True),
    )
    op.add_column(
        "daemon_runtimes",
        sa.Column("arch", sa.String(50), nullable=True),
    )
    op.add_column(
        "daemon_runtimes",
        sa.Column("capabilities", sa.JSON, nullable=True),
    )
    op.add_column(
        "daemon_runtimes",
        sa.Column(
            "allowed_roots",
            sa.JSON,
            nullable=False,
            server_default=sa.text("'[\"~/.sillyhub\"]'"),
        ),
    )

    op.drop_index(
        "idx_daemon_runtimes_instance",
        table_name="daemon_runtimes",
    )
    op.drop_column("daemon_runtimes", "daemon_instance_id")
