"""agent_run_model_usage 用量明细表（run × 模型四维 + 调用次数）

Revision ID: 20260829010000
Revises: 6756e634f119
Create Date: 2026-08-29 01:00:00

Change 2026-08-29-usage-by-provider-model task-01（FR-01-1 / design §1.1）：

1. 建 ``agent_run_model_usage`` 表（模型：app/modules/agent/model.py
   AgentRunModelUsage）——run × 模型维度的 token 用量明细行：四维 token
   （input/output/cache_read/cache_creation）+ api_requests 调用次数。run
   终态时由 daemon 上报 modelUsage upsert 落库（task-03/04），统计侧按
   model GROUP BY 聚合「按供应商/模型」用量（task-05）。
2. UNIQUE(run_id, model)（uq_agent_run_model_usage_run_model）——同 run 同
   模型至多一行（终态覆盖语义），约束本身充当 run_id 前导列查询索引；
   FK ON DELETE CASCADE 随 run 删除级联清理，无孤儿行。

down_revision 接执行时唯一 head 6756e634f119（alembic heads 实测单 head），
单 head 接续不分叉。新表无存量回填（老 run 归「未记录」桶，design §1.2）；
default 0/1 落在 ORM Python 侧，建表不设 server_default，与模型声明逐列一致。

downgrade 对称删表。

author: qinyi
created_at: 2026-08-29 01:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260829010000"
down_revision: str | None = "6756e634f119"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 列与 agent/model.py AgentRunModelUsage 逐列对齐（防 autogenerate 漂移）。
    op.create_table(
        "agent_run_model_usage",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "run_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("model", sa.String(128), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("cache_read_tokens", sa.Integer(), nullable=False),
        sa.Column("cache_creation_tokens", sa.Integer(), nullable=False),
        sa.Column("api_requests", sa.Integer(), nullable=False),
        sa.UniqueConstraint(
            "run_id",
            "model",
            name="uq_agent_run_model_usage_run_model",
        ),
    )


def downgrade() -> None:
    op.drop_table("agent_run_model_usage")
