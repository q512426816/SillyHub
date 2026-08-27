"""add ppm_item_session_links table

Revision ID: 20260828100000
Revises: 20260827230000
Create Date: 2026-08-28 10:00:00

Change 2026-08-28-session-ppm-task-binding task-01 / design §5 Phase 1 / §8 /
D-005@v1 / D-004@v2：建 PPM 任务/问题-会话多对多绑定表 ``ppm_item_session_links``
（单表 kind 绑定：``plan_task``=ppm_plan_task / ``problem``=ppm_problem_list）。

- ``id`` UUID PK；``kind`` varchar(20)；``item_id`` Uuid **软关联无 FK**（对齐
  quicklog_session_links 先例 20260825230000——PPM 数据可由同步写入，硬 FK 会拦
  删除）；``session_id`` FK→agent_sessions(id) ON DELETE CASCADE；``workspace_id``
  Uuid 可空（创建时解析的项目第一个关联工作区快照，D-004@v2，无 FK 纯快照值）；
  ``created_at`` timestamptz server_default now()。
- 唯一约束 ``uq_ppm_item_session_link_pair(kind, item_id, session_id)`` 防同对
  重复行（写入口幂等 upsert 兜底）；索引 ``ix_ppm_item_session_link_item(kind,
  item_id)`` 供条目→会话列表查询（GET /api/ppm/item-sessions）。ORM 见
  app/modules/ppm/common/session_binding.py PpmItemSessionLink。
- 不修改 ppm_plan_task/ppm_problem_list/file 表结构（design §8）。

downgrade 仅 drop 索引 + 表（design §9 回退路径：无数据迁移副作用）。
dialect 无关 create_table / create_index 对齐先例 20260825230000。

down_revision 接 ``20260827230000``（写前 ``uv run alembic heads`` 实测单头，
无并行变更撞号，R-01）。

author: qinyi
created_at: 2026-08-28 10:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828100000"
down_revision: str | None = "20260827230000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── design §8 / D-005@v1: ppm_item_session_links 绑定表 ──
    op.create_table(
        "ppm_item_session_links",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        # item_id 软关联 ppm_plan_task/ppm_problem_list，刻意无 FK（design §5 Phase 1）。
        sa.Column("item_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column(
            "session_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # workspace_id 为解析快照（可空），纯值引用不加 FK（D-004@v2）。
        sa.Column("workspace_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "kind",
            "item_id",
            "session_id",
            name="uq_ppm_item_session_link_pair",
        ),
    )
    op.create_index(
        "ix_ppm_item_session_link_item",
        "ppm_item_session_links",
        ["kind", "item_id"],
    )


def downgrade() -> None:
    """结构反向回滚（drop 索引 + 表；无数据迁移副作用，design §9）。"""
    op.drop_index("ix_ppm_item_session_link_item", table_name="ppm_item_session_links")
    op.drop_table("ppm_item_session_links")
