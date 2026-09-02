"""群 agent 成员团队能力开关（group member team quick）

Revision ID: 20260902110000
Revises: 20260902100000
Create Date: 2026-09-02 11:00:00

单文件迁移（群聊 agent 成员团队能力集成，后端部分）：

1. ``agent_group_members.team_enabled`` BOOLEAN NOT NULL server_default
   false——agent 成员团队能力开关（开启后影子会话懒建 lease stage 用
   'orchestrator'，daemon 主控谓词据此注入 dispatch_worker 等 5 工具；
   用户成员行恒 false 不消费）。server_default 供存量行回填（20260716
   has_module / 20260725 shared 同款 sa.false() 先例）；模型侧默认在
   Python default=False（建表口径与既有 Boolean 列一致）。

downgrade 对称回滚（删列）。

author: qinyi
created_at: 2026-09-02 11:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260902110000"
down_revision: str | None = "20260902100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── agent_group_members.team_enabled（团队能力开关，默认关）──
    op.add_column(
        "agent_group_members",
        sa.Column(
            "team_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("agent_group_members", "team_enabled")
