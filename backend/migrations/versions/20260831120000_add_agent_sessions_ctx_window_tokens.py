"""agent_sessions 加 ctx_window_tokens 列（会话级上下文窗口覆盖）

Revision ID: 20260831120000
Revises: 20260829230000
Create Date: 2026-08-31 12:00:00

ql-20260831-002-f683：agent_sessions 加 nullable 整数列 ctx_window_tokens——
会话页上下文环分母的用户覆盖值。NULL = 未覆盖（前端走供应商 one_m → 模型
常量表 → 1M 兜底自动派生链）；非 NULL = 用户显式指定，优先级最高。

- 背景：本地模型/本机默认（未绑平台供应商）会话前端拿不到任何 provider
  记录，窗口分母派生为空（显示"—"）；本地端点协议不暴露窗口大小，无法
  自动读取 → 页面可编辑兜底。
- nullable、无回填（未上线允许零值起步，与 app/modules/agent/model.py 中
  该列注释同源）。
- 不加索引（无该列查询诉求）。
- down_revision 锚定执行时唯一 head 20260829230000（alembic heads 实测）。

downgrade：对称删列。

author: qinyi
created_at: 2026-08-31 12:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260831120000"
down_revision = "20260829230000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_sessions",
        sa.Column("ctx_window_tokens", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_sessions", "ctx_window_tokens")
