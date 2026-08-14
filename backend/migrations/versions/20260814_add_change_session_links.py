"""add change_session_links table

Revision ID: 20260814090000
Revises: 20260813173000
Create Date: 2026-08-14 09:00:00

Change 2026-08-14-change-center-conversation-driven task-02 / design §8 / D-007：
建变更-会话绑定表 ``change_session_links``。reparse 发现新变更（created）时按
§8 绑定查询（``agent_sessions`` 最近活跃会话，``deleted_at IS NULL`` +
``coalesce(last_active_at, created_at) DESC``）自动写 link 行，让变更详情页
展示/审批注入绑定到具体会话。

- ``id`` UUID PK；``change_id`` FK→changes(id) ON DELETE CASCADE；
  ``session_id`` FK→agent_sessions(id) ON DELETE CASCADE；``created_at`` timestamptz。
- 唯一约束 ``ux_change_session_link_pair(change_id, session_id)`` 防同对重复行
  （一次 reparse 只绑一次；多对多由多行承载）。change 维度普通索引供详情页取最新。

down_revision 接 ``20260813173000``（daemon_change_write_progress，execute 实测当前
alembic head，无多 head）。dialect 无关 create_table / create_index，让 SQLite 测试
库与 PostgreSQL 生产对齐（precedent 20260813160000_create_spec_file_manifest）。

本项目未上线，无需历史数据回填（CLAUDE.md 规则 7）。

author: qinyi
created_at: 2026-08-14 09:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260814090000"
down_revision: str | None = "20260813173000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── design §8 / D-007: change_session_links 表 ──
    op.create_table(
        "change_session_links",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "change_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "session_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ux_change_session_link_pair",
        "change_session_links",
        ["change_id", "session_id"],
        unique=True,
    )
    op.create_index(
        "ix_change_session_link_change",
        "change_session_links",
        ["change_id"],
    )


def downgrade() -> None:
    """结构反向回滚（与 upgrade 相反顺序，完全对称可逆）。"""
    op.drop_index("ix_change_session_link_change", table_name="change_session_links")
    op.drop_index("ux_change_session_link_pair", table_name="change_session_links")
    op.drop_table("change_session_links")
