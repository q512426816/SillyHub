"""agent_missions add session_id column + active-mission partial unique index

Revision ID: 20260822090000
Revises: 20260821130000
Create Date: 2026-08-22 09:00:00

Change 2026-08-22-team-session-unify task-01（design §5 Phase1 / §8 / D-006@v1）：
1. agent_missions 加 session_id（uuid FK agent_sessions.id，NOT NULL，普通索引
   ix_agent_missions_session_id）——mission 绑定发起会话；
2. 活跃态部分唯一索引 uq_agent_missions_session_active（WHERE converged_at IS
   NULL AND cancelled_at IS NULL）——一个会话同时至多一个未收敛未取消的 mission
   （R-07 单活跃约束 / Grill NEW-3 并发守卫，懒建 SELECT...FOR UPDATE 的数据库
   侧兜底）。

存量行处理：不做数据迁移回填（项目未上线，允许清库重建，CLAUDE.md 规则 11 /
design §3 非目标、§9 回退路径）——NOT NULL 列加到非空 agent_missions 表需先
清库再 upgrade。类型说明：design §8 伪 SQL 写 VARCHAR(36)，实际落地 sa.Uuid()
——agent_sessions.id 即 Uuid（PG uuid 类型），VARCHAR 列 FK 引用 uuid 列在 PG
无法建约束。

postgresql_where 供 PG；sqlite_where 供 SQLite 等价 replay / 测试侧同语义。

downgrade：对称 drop 唯一索引 → 普通索引 → FK → 列。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260822090000"
down_revision: str | None = "20260821130000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PARTIAL_WHERE = "converged_at IS NULL AND cancelled_at IS NULL"


def upgrade() -> None:
    # 1. session_id 列：mission 绑定发起会话（NOT NULL，存量清库重建无回填）
    op.add_column(
        "agent_missions",
        sa.Column("session_id", sa.Uuid(), nullable=False),
    )
    op.create_foreign_key(
        "fk_agent_missions_session_id",
        "agent_missions",
        "agent_sessions",
        ["session_id"],
        ["id"],
    )

    # 2. 普通索引：按会话查 mission 列表（GET /daemon/sessions/{id}/team-missions）
    op.create_index(
        "ix_agent_missions_session_id",
        "agent_missions",
        ["session_id"],
    )

    # 3. 活跃态部分唯一索引：一个会话至多一个未收敛未取消 mission（R-07）
    op.create_index(
        "uq_agent_missions_session_active",
        "agent_missions",
        ["session_id"],
        unique=True,
        postgresql_where=sa.text(_PARTIAL_WHERE),
        sqlite_where=sa.text(_PARTIAL_WHERE),
    )


def downgrade() -> None:
    # 与 upgrade 对称反序
    op.drop_index("uq_agent_missions_session_active", table_name="agent_missions")
    op.drop_index("ix_agent_missions_session_id", table_name="agent_missions")
    op.drop_constraint("fk_agent_missions_session_id", "agent_missions", type_="foreignkey")
    op.drop_column("agent_missions", "session_id")
