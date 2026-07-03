"""create daemon_instances table

Revision ID: 202607031200
Revises: 202607022300

Change 2026-07-03-daemon-entity-binding task-01 (design §4.1 / D-001):
建 daemon_instances 实体表，承载守护进程稳定身份（id = daemon 上报的
daemon_local_id）+ 机器级字段。daemon_runtimes 在 task-02 退化为从属。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607031200"
down_revision = "202607022300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "daemon_instances",
        # daemon 上报的 daemon_local_id 作主键，后端不自生成。
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("hostname", sa.String(255), nullable=False),
        sa.Column("display_alias", sa.String(200), nullable=True),
        sa.Column("server_url", sa.String(255), nullable=False),
        sa.Column("os", sa.String(50), nullable=True),
        sa.Column("arch", sa.String(50), nullable=True),
        sa.Column("version", sa.String(50), nullable=True),
        sa.Column(
            "allowed_roots",
            sa.JSON,
            nullable=False,
            server_default=sa.text("'[\"~/.sillyhub\"]'"),
        ),
        sa.Column("capabilities", sa.JSON, nullable=True),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'online'"),
        ),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_daemon_instances_user_server",
        "daemon_instances",
        ["user_id", "server_url", "hostname"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_daemon_instances_user_server",
        table_name="daemon_instances",
    )
    op.drop_table("daemon_instances")
