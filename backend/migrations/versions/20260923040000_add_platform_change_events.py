"""
add platform_change_events table

Revision ID: 20260923040000
Revises: 20260922194500
Create Date: 2026-09-23 04:00:00

Change 2026-09-23-change-events-channel task-01 首建；DDL 已于
2026-09-26-migration-chain-dedupe 重写为与 ORM（PlatformChangeEventORM）完全
一致的结构（ts varchar(64) ISO 串 / severity varchar(16) NOT NULL default
'info' / rule NOT NULL / provisional server_default true / detail text / 无
stage 列）——初版结构（ts timestamptz / severity·rule 可空 / 含 stage）与
平行分支 20260926063000 的同名建表构成迁移链分叉，该变更删分支、重写本文件、
并由矫正迁移 20260926234000 幂等对齐已被初版建表的库。结构与语义详情见
app/modules/platform_sync/model.py PlatformChangeEventORM 与矫正迁移 docstring。

author: qinyi
created_at: 2026-09-23 04:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260923040000"
down_revision: str | None = "20260922194500"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── 建表 DDL 与 ORM（platform_sync/model.py PlatformChangeEventORM）完全
    # 对齐（2026-09-26-migration-chain-dedupe 重写）。历史：本迁移初版（change
    # -events-channel task-01，ts timestamptz / severity·rule 可空 / 含 stage 列）
    # 与 20260926063000（change-events-r18-full，ts varchar(64) ISO 串 / severity·
    # rule NOT NULL / 无 stage）是两个变更各写的同名建表，经 merge 3931ff71bd32
    # 强行归一造成分叉重复——本变更删 063000 与 merge、以 ORM（=063000 语义）为
    # 唯一真相重写本文件；已被旧版 DDL 建表的库（如生产）由后续矫正迁移
    # 20260926234000 幂等对齐，本文件改动不影响任何已应用库（记号在即不再执行）。
    op.create_table(
        "platform_change_events",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("change_name", sa.String(length=255), nullable=False),
        sa.Column("dedup_key", sa.String(length=320), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("rule", sa.String(length=128), nullable=False),
        sa.Column(
            "severity",
            sa.String(length=16),
            nullable=False,
            server_default="info",
        ),
        sa.Column(
            "provisional",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("ts", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "workspace_id",
            "change_name",
            "dedup_key",
            name="uq_platform_change_events_dedup",
        ),
    )
    op.create_index(
        "ix_platform_change_events_ws_change_ts",
        "platform_change_events",
        ["workspace_id", "change_name", "ts"],
    )


def downgrade() -> None:
    """结构反向回滚（与 upgrade 完全对称可逆）。"""
    op.drop_index(
        "ix_platform_change_events_ws_change_ts",
        table_name="platform_change_events",
    )
    op.drop_table("platform_change_events")
