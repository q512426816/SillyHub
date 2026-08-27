"""agent_runs 加 ctx_tokens 列（上下文环分子落库）

Revision ID: 20260827230000
Revises: 20260826210000
Create Date: 2026-08-27 23:00:00

2026-08-27-session-token-usage-fix task-04（FR-01 / D-002@v1 / design §8）：
agent_runs 加 nullable 整数列 ctx_tokens —— 该 run 期间最近一次 API 调用的
提示词大小（input_tokens + cache_read_tokens + cache_creation_tokens 之和，
daemon 计算后经既有 usage 附带管线透传，task-05 落地写回）。

- nullable、无回填、无换算（NG-04）：历史 run 全 NULL → 前端上下文环
  未知态（D-003），与 app/modules/agent/model.py 中该列注释同源。
- 不加索引（无该列查询诉求）；不动既有 token 列语义（NG-01）。
- down_revision 锚定执行时唯一 head 20260826210000（R-02 开工实测）。

downgrade：对称删列（nullable 新列无数据保留诉求）。

author: qinyi
created_at: 2026-08-27 23:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260827230000"
down_revision = "20260826210000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_runs",
        sa.Column("ctx_tokens", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_runs", "ctx_tokens")
