"""add platform_change_events table

Revision ID: 20260926063000
Revises: 20260922194500
Create Date: 2026-09-26 06:30:00

Change 2026-09-26-change-events-r18-full task-01 / design 数据模型 / D-002 / D-004：
建 sillyspec watcher 推送的变更旁路观测事件表 ``platform_change_events``（append-only，
恒 provisional，零业务判定红线 D-004——无流程外键、无状态机联动）。

- 表名带 platform_sync 前缀避撞既有 ``change_events``（owner 变更事件表
  20260816120000，语义不同）。
- ``id`` UUID PK；``workspace_id`` FK→workspaces(id) ON DELETE CASCADE（shpsync_
  token 派生唯一写通道，NOT NULL）；``change_name`` varchar(255)；``dedup_key``
  varchar(320)（事件 id 优先，>300 字符取 sha256 hex；回退 ts+'|'+rule，D-002）；
  ``kind`` varchar(64)；``rule`` varchar(128)；``severity`` varchar(16) 缺省 info；
  ``provisional`` boolean 缺省 true；``detail`` text nullable；``ts`` varchar(64)
  （ISO 8601 UTC 字符串原值，字典序=时间序，同 platform_change_progress 先例 R-04）；
  ``created_at`` timestamptz server_default now()（落库审计）。
- ``UNIQUE (workspace_id, change_name, dedup_key)``：watcher 重推幂等去重键
  （D-002；UniqueConstraint 而非复合 PK，SQLite/PostgreSQL 对齐先例 20260810150000）。
- 普通索引 ``ix_platform_change_events_ws_change_ts (workspace_id, change_name, ts)``：
  GET 正序增量查询路径。
- ``detail`` 用 sa.Text（非 JSON——观测详情是纯文本，无需结构化查询）。
- dialect 无关 create_table（SQLite 测试库/PostgreSQL 生产对齐）。
- 本项目未上线，无需历史数据回填。

ORM 见 app/modules/platform_sync/model.py PlatformChangeEventORM。

author: qinyi
created_at: 2026-09-26 06:30:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260926063000"
down_revision: str | None = "20260922194500"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── design 数据模型 / D-002 / D-004: 变更旁路观测事件表（append-only）──
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
        sa.Column("severity", sa.String(length=16), nullable=False, server_default="info"),
        sa.Column("provisional", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("ts", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
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
    op.drop_index("ix_platform_change_events_ws_change_ts", table_name="platform_change_events")
    op.drop_table("platform_change_events")
