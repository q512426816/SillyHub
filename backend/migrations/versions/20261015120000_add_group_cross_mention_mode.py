"""add agent_group_chats.cross_mention_mode

Revision ID: 20261015120000
Revises: 20261014110000
Create Date: 2026-10-15 12:40:00.000000

Change 2026-10-15-group-cross-mention-visibility task-01 / FR-01 / D-001@v1：
群聚合根新增互@协作可见性模式列 ``cross_mention_mode``（'private'|'public'，
server_default 'private'）+ CHECK 约束。

- **存量群零变化（D-002@v1）**：server_default 'private' 与私聊化现状语义
  等价，存量行免回填即得升级前行为；无数据回填脚本。
- **枚举收口（D-001@v1）**：CHECK 两值约束，非法值 DB 层拒绝；ORM 侧同款
  CheckConstraint（model.py）双轨。
- **downgrade 直删列**：项目未上线、数据可清空（CLAUDE.md 规则 11），无
  回退保留需求；SQLite 走 batch_alter_table（DROP COLUMN 兼容老 SQLite）。
- 不 import app.*（迁移须可在无应用代码时生成 SQL，先例
  20261014110000 同款注释）。

down_revision 接 ``20261014110000``（alembic heads 实测当前单 head），
单 head 接续避免多 head 分叉。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261015120000"
down_revision: str | None = "20261014110000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CHECK_NAME = "ck_agent_group_chats_cross_mention_mode"


def upgrade() -> None:
    op.add_column(
        "agent_group_chats",
        sa.Column(
            "cross_mention_mode",
            sa.String(16),
            nullable=False,
            server_default="private",
        ),
    )
    # SQLite 不支持裸 ALTER ADD CONSTRAINT（No support for ALTER of
    # constraints）——CHECK 走 batch 模式 copy-and-move（与 downgrade 对称）。
    with op.batch_alter_table("agent_group_chats") as batch:
        batch.create_check_constraint(
            CHECK_NAME,
            "cross_mention_mode IN ('private', 'public')",
        )


def downgrade() -> None:
    # SQLite 不支持裸 DROP CONSTRAINT——batch 模式重建表去掉 CHECK 后删列。
    with op.batch_alter_table("agent_group_chats") as batch:
        batch.drop_constraint(CHECK_NAME, type_="check")
    op.drop_column("agent_group_chats", "cross_mention_mode")
