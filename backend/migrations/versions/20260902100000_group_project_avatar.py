"""群聊 PPM 项目化 + 成员头像（群 PPM 项目化 quick）

Revision ID: 20260902100000
Revises: 20260902010000
Create Date: 2026-09-02 10:00:00

单文件迁移（quick 群 PPM 项目化+成员头像，后端部分）：

1. ``agent_group_chats.project_id`` UUID NULL FK ``ppm_project_maintenance.id``
   ON DELETE SET NULL + 索引 ``ix_agent_group_chats_project``——群挂 PPM 项目
   （建群必填口径在 service 层校验；存量行 NULL = 存量群，成员邀请范围回退
   workspace 口径）。项目删则 SET NULL（群时间线保留，不级联解散）。
2. ``agent_group_members.avatar`` VARCHAR(512) NULL——成员群内头像（文件中心
   上传端点产出的 URL；用户与 agent 成员共用同一列，不落文件本体）。

downgrade 对称回滚（反序：先删列再删索引）。

author: qinyi
created_at: 2026-09-02 10:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260902100000"
down_revision: str | None = "20260902010000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── 1. agent_group_chats.project_id（群挂 PPM 项目）──
    op.add_column(
        "agent_group_chats",
        sa.Column(
            "project_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("ppm_project_maintenance.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_agent_group_chats_project",
        "agent_group_chats",
        ["project_id"],
        unique=False,
    )

    # ── 2. agent_group_members.avatar（群内头像 URL，文件中心产出）──
    op.add_column(
        "agent_group_members",
        sa.Column("avatar", sa.String(length=512), nullable=True),
    )


def downgrade() -> None:
    # 与 upgrade 对称反序
    op.drop_column("agent_group_members", "avatar")
    op.drop_index("ix_agent_group_chats_project", table_name="agent_group_chats")
    op.drop_column("agent_group_chats", "project_id")
