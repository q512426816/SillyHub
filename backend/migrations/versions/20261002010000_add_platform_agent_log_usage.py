"""platform_agent_logs 用量快照五列（四维 token + 解析时间）

Revision ID: 20261002010000
Revises: 20260930110000
Create Date: 2026-10-02 01:00:00

Change 2026-10-02-change-center-token-usage task-01（design 数据模型 / FR-01）：

1. ``platform_agent_logs`` 加 5 列用量快照：四维 token（usage_input_tokens /
   usage_output_tokens / usage_cache_read_tokens / usage_cache_write_tokens，
   BigInteger）+ usage_parsed_at（DateTime UTC）。producer = usage_ingest 摄取
   任务（task-02，daemon 解析日志 totalUsage 覆盖写）；consumer = change/
   usage_service 聚合本地段（task-03，按 agent_session_id 会话锚点 SUM）。
2. 全部 nullable、无 server_default：NULL = 未摄取 / 解析不支持（存量行不
   回填，design 非目标——聚合侧 ``usage_parsed_at IS NOT NULL`` 过滤自然跳过，
   显示与改造前一致）。

down_revision 接执行时唯一 head 20260930110000（alembic heads 实测单 head，
无分叉）。downgrade 对称删五列，删后聚合本地段空结果与改造前完全一致。

author: qinyi
created_at: 2026-10-02 23:25:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261002010000"
down_revision: str | None = "20260930110000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 列与 platform_sync/model.py AgentSessionLogORM 逐列对齐（防 autogenerate 漂移）。
    op.add_column(
        "platform_agent_logs",
        sa.Column("usage_input_tokens", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "platform_agent_logs",
        sa.Column("usage_output_tokens", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "platform_agent_logs",
        sa.Column("usage_cache_read_tokens", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "platform_agent_logs",
        sa.Column("usage_cache_write_tokens", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "platform_agent_logs",
        sa.Column("usage_parsed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("platform_agent_logs", "usage_parsed_at")
    op.drop_column("platform_agent_logs", "usage_cache_write_tokens")
    op.drop_column("platform_agent_logs", "usage_cache_read_tokens")
    op.drop_column("platform_agent_logs", "usage_output_tokens")
    op.drop_column("platform_agent_logs", "usage_input_tokens")
