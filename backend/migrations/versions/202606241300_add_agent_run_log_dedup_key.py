"""add agent_run_logs.dedup_key + partial unique index

Revision ID: 202606241300
Revises: 202606241001

2026-06-24-daemon-network-resilience task-20（FR-08 / R-12 / D-001@v2）：
agent_run_logs 加 dedup_key 列 + 部分唯一索引（WHERE dedup_key IS NOT NULL），
供 submit_messages INSERT ON CONFLICT DO NOTHING 幂等去重。

注：down_revision 接 202606241001（主链单 head），不接 202607041200（ppm merge
位于主链内部节点，从它分叉会形成幽灵 head）。同时删除坏掉的空 merge
202606281200（引用从未存在的幽灵 revision 202606281000，是 alembic KeyError 根因）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606241300"
down_revision = "202606241001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_run_logs",
        sa.Column("dedup_key", sa.String(length=200), nullable=True),
    )
    # 部分唯一索引：仅 dedup_key 非空时约束。dialect=sqlite 也支持 partial index
    # （SQLite 3.8+），用 op.create_index + postgresql_where 仅 PG 生效；此处用
    # 通用 Index 语法，bind dialect 在 PG 下附加 WHERE（task-21 service 层 ON CONFLICT
    # 配合）。为兼容双 dialect，直接用 op.create_index 的 postgresql_where 参数
    # （SQLite Alembic 会忽略该 kw，去重靠 service 层兜底，见 backend-test-sqlite-vs-pg）。
    op.create_index(
        "ux_agent_run_logs_dedup",
        "agent_run_logs",
        ["run_id", "dedup_key"],
        unique=True,
        postgresql_where=sa.text("dedup_key IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ux_agent_run_logs_dedup", table_name="agent_run_logs")
    op.drop_column("agent_run_logs", "dedup_key")
