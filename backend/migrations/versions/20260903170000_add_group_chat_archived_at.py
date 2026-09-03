"""agent_group_chats 加 archived_at 归档时间戳列（群聊归档/删除）

Revision ID: 20260903170000
Revises: 20260903090000
Create Date: 2026-09-03 17:00:00

2026-09-03-group-chat-archive-delete task-01（FR-01/FR-02，D-01@v1）：
为 agent_group_chats 新增 1 列——

* ``archived_at`` DateTime(timezone=True) NULL：群聊归档时间戳。NULL = 未归档
  （默认群列表可见）；非 NULL = 已归档（默认群列表过滤，「已归档」视图展示，
  可取消归档恢复）。口径对齐 AgentSession.archived_at（design §3.1），与
  deleted_at/ended_at 正交——可归档后删除、可直接删除、可解散后归档。

本迁移只加列不回填（存量行为 NULL=未归档）；不加索引（群列表按成员表 join
过滤量级小，design §3.1 无查询索引诉求）。置位/清除链路在群 service
archive/unarchive（task-02），模型见 app/modules/agent/model.py
``AgentGroupChat``。

down_revision 接执行时唯一 head 20260903090000（alembic heads 实测单 head）。
downgrade 对称删列。结构照 20260903090000_add_machine_sillyspec_status.py 先例。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260903170000"
down_revision = "20260903090000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_group_chats",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_group_chats", "archived_at")
