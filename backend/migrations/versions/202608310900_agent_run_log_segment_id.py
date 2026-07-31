"""add agent_run_logs.segment_id column

2026-07-30-daemon-heartbeat-dedup-fix task-14 / FR-02 / D-002@v1：流式 partial 去重
segment_id 列。daemon partial flush 的半截行（metadata.segmentId + isPartial）落库时
写 segment_id；complete 行 NULL。override 信号（``[ASSISTANT_OVERRIDE]`` /
``[THINKING_OVERRIDE]``）跨 submit_messages 调用到达时，backend 按 segment_id DELETE
已 commit 的 partial（task-08 expunge 只撤单调用内 pending，跨调用已落库的 partial
删不掉——本列让 override 能定位并删除）。

Revision ID: 202608310900
Revises: 202607301000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202608310900"
down_revision = "202607301000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_run_logs",
        sa.Column("segment_id", sa.String(length=200), nullable=True),
    )
    op.create_index(
        "ix_agent_run_logs_segment_id",
        "agent_run_logs",
        ["segment_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_run_logs_segment_id", table_name="agent_run_logs")
    op.drop_column("agent_run_logs", "segment_id")
