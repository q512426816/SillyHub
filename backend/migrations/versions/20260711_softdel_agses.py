"""20260711_softdel_agses

Revision ID: 20260711_softdel_agses
Revises: 20260710_rm_path_source
Create Date: 2026-07-12 00:40:00.000000

为 ``agent_sessions`` 新增 ``deleted_at`` 软删除时间戳列与索引
（2026-07-11-unify-runtime-session-dialog / FR-05 / D-003）。

软删除语义：NULL = 行可见；非空 = 用户已删除，list/get 端点过滤隐藏，
行保留供审计，``agent_runs.agent_session_id`` 外键刻意不断（run/log
历史仍可查）。无数据回填——新列默认 NULL，等价于「全部未删除」。

upgrade()：add_column + create_index（顺序：先列后索引）。
downgrade()：drop_index + drop_column（顺序对称反转）。

注：revision id 控制在 ≤32 字符（alembic_version.version_num varchar(32)）。

author: qinyi
created_at: 2026-07-12 00:40:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260711_softdel_agses"
down_revision: str | None = "20260710_rm_path_source"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agent_sessions",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_agent_sessions_deleted_at",
        "agent_sessions",
        ["deleted_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_sessions_deleted_at", table_name="agent_sessions")
    op.drop_column("agent_sessions", "deleted_at")
