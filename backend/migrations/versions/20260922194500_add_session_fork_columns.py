"""add session fork columns

Revision ID: 20260922194500
Revises: 20260920220000
Create Date: 2026-09-22 19:45:00.000000

Change ``2026-09-22-session-fork-continuation`` task-01：会话分叉数据面——
``agent_sessions`` 加 fork 三列 + ``agent_runs`` 加 engine_anchor 锚点列
（列定义与 ``app/modules/agent/model.py`` 一一对应）：

- ``agent_sessions.fork_of_session_id``：fork 溯源自引用 FK（无 ondelete，
  会话软删不硬删，对齐 parent_session_id 先例 / 迁移 20260825210000）。
- ``agent_sessions.fork_at_run_id``：fork 落点 run FK（ondelete SET NULL——
  run 可硬删，锚点退化不挡删）。
- ``agent_sessions.engine_fork_anchor``：源会话轮末 chain-entry 消息 UUID
  文本（仅 claude 档有值）。
- ``agent_runs.engine_anchor``：轮末 chain-entry 消息 UUID 文本（仅 claude 档
  回填，codex/pi 恒 NULL）。
- ``ix_agent_sessions_fork_of``：fork 溯源查询键（按源会话枚举派生 fork）。

四列全 nullable 纯加列、不回填存量数据（零迁移兼容）；downgrade 对称删
（先删索引后删列）。

down_revision 接 ``20260920220000``（写码时 ``alembic heads`` 实测唯一
head），单 head 接续避免多 head 分叉
（migration-chain-fragmentation-pattern）。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260922194500"
down_revision: str | None = "20260920220000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agent_sessions",
        sa.Column(
            "fork_of_session_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_sessions.id"),
            nullable=True,
        ),
    )
    op.add_column(
        "agent_sessions",
        sa.Column(
            "fork_at_run_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "agent_sessions",
        sa.Column("engine_fork_anchor", sa.Text(), nullable=True),
    )
    op.add_column(
        "agent_runs",
        sa.Column("engine_anchor", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_agent_sessions_fork_of",
        "agent_sessions",
        ["fork_of_session_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_sessions_fork_of", table_name="agent_sessions")
    op.drop_column("agent_runs", "engine_anchor")
    op.drop_column("agent_sessions", "engine_fork_anchor")
    op.drop_column("agent_sessions", "fork_at_run_id")
    op.drop_column("agent_sessions", "fork_of_session_id")
