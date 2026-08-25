"""add quicklog_session_links table + seed change_session_links

Revision ID: 20260825230000
Revises: 20260825210000
Create Date: 2026-08-25 23:00:00

Change 2026-08-25-session-spec-binding task-01 / design §5.W1.2 / §8 / D-001@v1 /
D-002@v1：建快速修复-会话多对多绑定表 ``quicklog_session_links``（自然键，无 FK
到 quicklog_entries，D-001@v1），并把存量 ``agent_sessions.change_id`` 单 FK
关系一次性播种进 ``change_session_links``（D-002@v1：links 收敛为唯一关联真相，
播种让旧单 FK 数据全部进入 M:N 命中集，§9 兼容策略）。

- ``id`` UUID PK；``workspace_id`` FK→workspaces(id) ON DELETE CASCADE；
  ``ql_id`` varchar(128) 自然键；``session_id`` FK→agent_sessions(id) ON DELETE
  CASCADE；``created_at`` timestamptz server_default now()。
- 唯一约束 ``uq_quicklog_session_link_pair(workspace_id, ql_id, session_id)`` 防同对
  重复行（写入口幂等 upsert 兜底）；索引 ``ix_quicklog_session_link_ql(workspace_id,
  ql_id)`` 供条目→会话列表查询、``ix_quicklog_session_link_session(session_id)``
  供会话侧反查。ORM 见 app/modules/change/model.py QuicklogSessionLink。
- 存量播种 ``INSERT INTO change_session_links ... SELECT gen_random_uuid(),
  change_id, id, now() FROM agent_sessions WHERE change_id IS NOT NULL ON CONFLICT
  (change_id, session_id) DO NOTHING``：幂等可重跑（ON CONFLICT 目标列序与
  ux_change_session_link_pair(change_id, session_id) 唯一索引一致）；gen_random_uuid
  为 PG 函数（测试库走 create_all 不跑 alembic，播种不进测试路径）。
  change_session_links 表结构不动（2026-08-14 D-007）；agent_sessions.change_id
  列保留继续写入（D-002@v1 冻结为冗余提示，不删列）。

downgrade 仅 drop 两索引 + ``quicklog_session_links`` 表；播种进
change_session_links 的行**保留**——该表本就存在，多出的历史行无害（消费侧本就
按 change_id 过滤，design §9 迁移回退）。

down_revision 接 ``20260825210000``（ghost_recovery_stub，execute 实测当前
alembic head 单头，无撞号）。dialect 无关 create_table / create_index 对齐先例
20260814090000（change_session_links 同域建表）。

author: qinyi
created_at: 2026-08-25 23:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260825230000"
down_revision: str | None = "20260825210000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── design §8 / D-001@v1: quicklog_session_links 绑定表 ──
    op.create_table(
        "quicklog_session_links",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ql_id", sa.String(length=128), nullable=False),
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
        sa.UniqueConstraint(
            "workspace_id",
            "ql_id",
            "session_id",
            name="uq_quicklog_session_link_pair",
        ),
    )
    op.create_index(
        "ix_quicklog_session_link_ql",
        "quicklog_session_links",
        ["workspace_id", "ql_id"],
    )
    op.create_index(
        "ix_quicklog_session_link_session",
        "quicklog_session_links",
        ["session_id"],
    )
    # ── design §5.W1.2 / D-002@v1: 存量 change_id 单 FK 播种进 links（幂等重跑） ──
    op.execute(
        "INSERT INTO change_session_links (id, change_id, session_id, created_at) "
        "SELECT gen_random_uuid(), change_id, id, now() "
        "FROM agent_sessions WHERE change_id IS NOT NULL "
        "ON CONFLICT (change_id, session_id) DO NOTHING"
    )


def downgrade() -> None:
    """结构反向回滚（drop 两索引 + 表；播种的 change_session_links 行保留，design §9）。"""
    op.drop_index("ix_quicklog_session_link_session", table_name="quicklog_session_links")
    op.drop_index("ix_quicklog_session_link_ql", table_name="quicklog_session_links")
    op.drop_table("quicklog_session_links")
