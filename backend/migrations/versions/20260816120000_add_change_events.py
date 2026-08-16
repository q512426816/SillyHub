"""add change_events table

Revision ID: 20260816120000
Revises: d7a1f5c2b9e4
Create Date: 2026-08-16 12:00:00

Change 2026-08-16-change-owner-from-token task-01 / design §5 Phase 1.1 / §7 / D-002@v1：
建变更通用事件表 ``change_events``。通用 ``event_type`` + ``detail`` JSON 扩展模型，
首个消费方是 owner_change 责任人变更留痕（``_sync_change_owner`` 写
``event_type='owner_change'``、``detail={from_user_id, to_user_id}``，task-02），
后续时间线合成（Phase 2.2）按 ``(change_id, created_at)`` 取事件流。

- ``id`` UUID PK；``workspace_id`` FK→workspaces(id) ON DELETE CASCADE（隔离）；
  ``change_id`` FK→changes(id) ON DELETE CASCADE；``event_type`` varchar(50)；
  ``detail`` JSON；``created_by`` UUID nullable（语义引用触发者=token 用户，无外键）；
  ``created_at`` timestamptz server_default now()。
- ``detail`` 用 ``sa.JSON()`` 非 JSONB（SQLite 测试库兼容，先例 20260810150000 Grill
  X-009；语义即 design §7 JSONB 透传 dict）。
- 两普通索引：``ix_change_events_change_created(change_id, created_at)`` 时间线合成
  查询 + ``ix_change_events_workspace(workspace_id)``；**无唯一约束**——幂等靠
  owner_id 现值复查（task-02 口径），事件流是追加型。
- 字段名与 design §7 逐字一致；ORM 见 app/modules/change/model.py ChangeEventORM。

down_revision 接 ``d7a1f5c2b9e4``（merge_platform_progress_and_session_config，
execute 实测当前 alembic head 单头，无撞号）。dialect 无关 create_table /
create_index，让 SQLite 测试库与 PostgreSQL 生产对齐（precedent 20260814_add_change_session_links）。

本项目未上线，无需历史数据回填（CLAUDE.md 规则 7）。

author: qinyi
created_at: 2026-08-16 12:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260816120000"
down_revision: str | None = "d7a1f5c2b9e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── design §7 / D-002@v1: change_events 通用事件表 ──
    op.create_table(
        "change_events",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "change_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_change_events_change_created",
        "change_events",
        ["change_id", "created_at"],
    )
    op.create_index(
        "ix_change_events_workspace",
        "change_events",
        ["workspace_id"],
    )


def downgrade() -> None:
    """结构反向回滚（与 upgrade 相反顺序，完全对称可逆）。"""
    op.drop_index("ix_change_events_workspace", table_name="change_events")
    op.drop_index("ix_change_events_change_created", table_name="change_events")
    op.drop_table("change_events")
