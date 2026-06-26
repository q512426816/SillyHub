"""add agent_run_logs timestamp indexes

Revision ID: 202606271300
Revises: 202606261130

P0 性能优化(2026-06-27-p0-perf-optimization):给 agent_run_logs 补两个读取
高频索引——

* ``ix_agent_run_logs_timestamp``(单列 timestamp):按时间范围查日志的过滤索引。
* ``ix_agent_run_logs_run_timestamp``(run_id, timestamp 联合):「按 run 查日志
  并按时间排序」(WHERE run_id=? ORDER BY timestamp)的最优覆盖索引,避免对
  同一 run 的日志做 filesort。

该表无 started_at 字段(属 agent_runs 表),故不涉及。model.py 的 __table_args__
同步声明,保持代码与迁移一致。downgrade 按反序 drop,可回滚。
"""

from __future__ import annotations

from alembic import op

revision = "202606271300"
down_revision = "202606261130"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_agent_run_logs_timestamp", "agent_run_logs", ["timestamp"])
    op.create_index(
        "ix_agent_run_logs_run_timestamp",
        "agent_run_logs",
        ["run_id", "timestamp"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_run_logs_run_timestamp", table_name="agent_run_logs")
    op.drop_index("ix_agent_run_logs_timestamp", table_name="agent_run_logs")
