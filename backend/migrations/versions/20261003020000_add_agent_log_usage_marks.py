"""platform_agent_logs 用量水位表（ctx 接管时点累计快照，差分归属基座）

Revision ID: 20261003020000
Revises: 20261002010000
Create Date: 2026-10-03 02:00:00

Change 2026-10-03-local-usage-segment-attribution task-01（design 接口定义 /
D-001@v1 / D-004@v1）：

1. 建 ``platform_agent_log_usage_marks``——append-only 水位行：每次 agent-logs
   上报在 upsert 行覆盖**前**插入（task-02），记录「ctx（change_key/quick_id
   互斥，双 NULL=无变更上下文片段）接管时点的已落库累计五值」（D-002@v2）。
   消费方：change/usage_service 差分聚合（task-03）——变更 X 的量 =
   Σ max(0, 下一水位 − 本水位)，首水位隐式起点 0（D-004 存量锚定）。
2. 唯一键 (workspace_id, log_path, seq)：seq 为每 entry 单调递增序号（插入取
   MAX+1），排序/聚合/修剪统一用 seq（Grill X4）；log_path 与上报复合键同构
   （不 FK entry id，省 join）。
3. 列域对齐既有表（Grill X6）：change_key String(200) = changes.change_key；
   quick_id String(128) = quicklog_entries.ql_id。
4. 修剪（D-003@v2，task-02 实现）：每 entry 保留窗口约 200 行且**豁免首末**
   ——首水位是隐式起点 0 锚定载体（被删会使基线段转移给新首 ctx，复审 L1）、
   末水位是聚合待消费锚点。

downgrade 对称删表——聚合回落存量整行路径（与改造前一致，design 兼容策略）。

author: qinyi
created_at: 2026-10-03 17:55:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261003020000"
down_revision: str | None = "20261002010000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "platform_agent_log_usage_marks",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("log_path", sa.String(1024), nullable=False),
        # 每 entry 单调递增（插入 MAX+1）；排序/聚合/修剪唯一键（X4 统一 seq）。
        sa.Column("seq", sa.BigInteger(), nullable=False),
        # 互斥 ctx：change_key/quick_id 二选一，双 NULL=无变更上下文片段。
        sa.Column("change_key", sa.String(200), nullable=True),
        sa.Column("quick_id", sa.String(128), nullable=True),
        # 接管时点已落库累计（NULL 快照按 0 语义，落库时归一为 0）。
        sa.Column("mark_invocations", sa.BigInteger(), nullable=False),
        sa.Column("mark_input_tokens", sa.BigInteger(), nullable=False),
        sa.Column("mark_output_tokens", sa.BigInteger(), nullable=False),
        sa.Column("mark_cache_read_tokens", sa.BigInteger(), nullable=False),
        sa.Column("mark_cache_write_tokens", sa.BigInteger(), nullable=False),
        sa.Column(
            "reported_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "workspace_id",
            "log_path",
            "seq",
            name="uq_agent_log_usage_marks_path_seq",
        ),
    )
    op.create_index(
        "ix_agent_log_usage_marks_change_key",
        "platform_agent_log_usage_marks",
        ["change_key"],
    )
    op.create_index(
        "ix_agent_log_usage_marks_quick_id",
        "platform_agent_log_usage_marks",
        ["quick_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_log_usage_marks_quick_id", table_name="platform_agent_log_usage_marks")
    op.drop_index(
        "ix_agent_log_usage_marks_change_key", table_name="platform_agent_log_usage_marks"
    )
    op.drop_table("platform_agent_log_usage_marks")
