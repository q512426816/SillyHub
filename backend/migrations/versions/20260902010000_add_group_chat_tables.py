"""群聊数据底座：session_kind 列 + 两张群表 + agent_run_logs.metadata 列

Revision ID: 20260902010000
Revises: 20260831150000
Create Date: 2026-09-02 01:00:00

2026-09-01-session-group-chat task-01（FR-01/02/03 / D-007@v1 / D-008@v1 /
D-009@v1，design §3.1-§3.4）单文件迁移：

1. ``agent_sessions.session_kind`` VARCHAR(16) NOT NULL server_default
   'chat'——会话形态：'chat'（默认，存量单聊行为零变更）| 'group'（群时间线
   会话）| 'group_member'（agent 成员影子会话）。server_default 让存量行免
   回填即得 chat 语义（对齐 origin 列先例 20260823120000）；索引
   ``ix_agent_sessions_session_kind`` 供列表过滤（task-02 消费）。
2. ``agent_run_logs.metadata`` JSON NULL——群聊桥接投影行身份
   ``{member_id, member_name, source_log_id}``（design §5.2）；存量行 NULL。
   DB 列名 ``metadata``（SQLAlchemy ``metadata`` 保留名，ORM 属性
   ``metadata_``，daemon/model.py 同款先例）。
3. 新表 ``agent_group_chats``（群，design §3.2）+ ``agent_group_members``
   （成员，design §3.3）——列与 agent/model.py 两模型逐列对齐（防
   autogenerate 漂移）：
   - ``uq_agent_group_chats_session``：群时间线会话 1:1（session_id UNIQUE）；
   - ``uq_agent_group_members_group_display_name``：UNIQUE(group_id,
     display_name)——群内昵称全局唯一（用户与 agent 共用命名空间）；
   - ``uq_agent_group_members_group_user``：部分唯一 (group_id, user_id)
     WHERE user_id IS NOT NULL——user 成员防重复邀请（agent 成员 NULL 行
     不参与约束；uq_agent_missions_session_active 先例，postgresql_where
     供 PG、sqlite_where 供 SQLite 等价 replay）。

新表 NOT NULL 布尔/整型列不设 server_default（默认在 ORM Python 侧，建表
与模型声明逐列一致，20260829010000 先例）；created_at/joined_at 走
sa.func.now()（双方言安全）。无数据回填（新表零存量；约束：存量行为零变更）。

down_revision 接执行时唯一 head 20260831150000（alembic heads 实测单 head）。
downgrade 对称回滚：先删成员表（FK CASCADE 依赖方向）再删群表 → 删两列 +
索引，反序执行。

author: qinyi
created_at: 2026-09-02 01:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260902010000"
down_revision: str | None = "20260831150000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PARTIAL_USER_WHERE = "user_id IS NOT NULL"


def upgrade() -> None:
    # ── 1. agent_sessions.session_kind（design §3.1）──
    op.add_column(
        "agent_sessions",
        sa.Column(
            "session_kind",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'chat'"),
        ),
    )
    op.create_index(
        "ix_agent_sessions_session_kind",
        "agent_sessions",
        ["session_kind"],
        unique=False,
    )

    # ── 2. agent_run_logs.metadata（design §3.4 / §5.2 投影行身份）──
    op.add_column(
        "agent_run_logs",
        sa.Column("metadata", sa.JSON(), nullable=True),
    )

    # ── 3. 群表（design §3.2，模型 agent/model.py AgentGroupChat）──
    op.create_table(
        "agent_group_chats",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "session_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column(
            "created_by",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("agent_cross_mention", sa.Boolean(), nullable=False),
        sa.Column("cross_mention_depth", sa.Integer(), nullable=False),
        sa.Column("context_window", sa.Integer(), nullable=False),
        sa.Column("settings_json", sa.JSON(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("session_id", name="uq_agent_group_chats_session"),
    )
    op.create_index(
        "ix_agent_group_chats_workspace",
        "agent_group_chats",
        ["workspace_id"],
        unique=False,
    )

    # ── 4. 成员表（design §3.3，模型 agent/model.py AgentGroupMember）──
    op.create_table(
        "agent_group_members",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "group_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_group_chats.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("member_type", sa.String(length=8), nullable=False),
        sa.Column("display_name", sa.String(length=40), nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        # ── agent 成员六要素（user 成员全 NULL）──
        sa.Column(
            "runtime_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("daemon_runtimes.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("provider", sa.String(length=20), nullable=True),
        sa.Column(
            "llm_provider_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("llm_providers.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "agent_profile_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_profiles.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("config_snapshot", sa.JSON(), nullable=True),
        sa.Column(
            "shadow_session_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_sessions.id"),
            nullable=True,
        ),
        sa.Column("shadow_status", sa.String(length=16), nullable=False),
        sa.Column(
            "invited_by",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "joined_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "group_id",
            "display_name",
            name="uq_agent_group_members_group_display_name",
        ),
    )
    op.create_index(
        "uq_agent_group_members_group_user",
        "agent_group_members",
        ["group_id", "user_id"],
        unique=True,
        postgresql_where=sa.text(_PARTIAL_USER_WHERE),
        sqlite_where=sa.text(_PARTIAL_USER_WHERE),
    )


def downgrade() -> None:
    # 与 upgrade 对称反序
    op.drop_index("uq_agent_group_members_group_user", table_name="agent_group_members")
    op.drop_table("agent_group_members")
    op.drop_index("ix_agent_group_chats_workspace", table_name="agent_group_chats")
    op.drop_table("agent_group_chats")
    op.drop_column("agent_run_logs", "metadata")
    op.drop_index("ix_agent_sessions_session_kind", table_name="agent_sessions")
    op.drop_column("agent_sessions", "session_kind")
