"""add quicklog_entries table

Revision ID: 20260817010000
Revises: 20260816120000
Create Date: 2026-08-17 01:00:00

Change 2026-08-16-change-center-quick-tab task-01 / design §5.1 / D-003 / D-004：
建 CLI 推送的 quicklog 条目表 ``quicklog_entries``，承载 D-003 双链路的推送落点
（CLI allocate/complete 后 best-effort POST 结构化 JSON）。

- ``id`` UUID PK；``workspace_id`` FK→workspaces(id) ON DELETE CASCADE（隔离，
  只由 shpsync_ token 派生，payload 不含 workspace 字段）；``ql_id`` varchar(128)；
  ``payload`` JSON（裸存推送原文，派生字段查询时算，D-005）；``created_at`` /
  ``updated_at`` timestamptz server_default now()。
- ``(workspace_id, ql_id)`` 复合唯一约束支撑幂等 upsert（D-004：CLI 重跑 ``--done``
  整条覆盖，不重复行）——与 platform_change_progress 同款 UniqueConstraint 而非
  复合 PK（SQLite/PostgreSQL 对齐，先例 20260810150000）。
- ``payload`` 用 ``sa.JSON()`` 非 JSONB（SQLite 测试库兼容，先例 20260810150000
  Grill X-009 / 20260816120000 同口径）。
- 无额外普通索引：查询路径是 (workspace_id, ql_id) 唯一约束命中 + 按 timestamp 排序
  在 payload JSON 上（单 workspace 条目量级小，排序内存完成；有量级需要再补）。
- ORM 见 app/modules/platform_sync/model.py QuicklogEntryORM。

down_revision 接 ``20260816120000``（add_change_events，execute 实测当前 alembic head
单头，无撞号）。dialect 无关 create_table，让 SQLite 测试库与 PostgreSQL 生产对齐。

本项目未上线，无需历史数据回填（CLAUDE.md 规则 7 / design §9）。

author: qinyi
created_at: 2026-08-17 01:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260817010000"
down_revision: str | None = "20260816120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── design §5.1 / D-003 / D-004: quicklog_entries 推送条目表 ──
    op.create_table(
        "quicklog_entries",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ql_id", sa.String(length=128), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
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
        sa.UniqueConstraint(
            "workspace_id",
            "ql_id",
            name="uq_quicklog_entries_workspace_ql",
        ),
    )


def downgrade() -> None:
    """结构反向回滚（与 upgrade 完全对称可逆）。"""
    op.drop_table("quicklog_entries")
