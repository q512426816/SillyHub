"""add mcp_tokens, mcp_webhooks tables and agent_runs.read_only column

Revision ID: 20260806140000
Revises: d5d239112387
Create Date: 2026-08-06 14:00:00

Change 2026-08-06-public-mcp-server task-01 / design §8.1 §8.2 §8.4 / D-002 / D-003：
一次性落对外 MCP 的数据地基，三处结构变更（本任务只加结构，不写数据 / 不写业务）：

1. 建 ``mcp_tokens``（design §8.1）—— 第三方接入 token：
   - workspace_id FK workspaces CASCADE（绑 workspace）
   - token_hash String(128) 唯一索引（存 sha256 hex，不存明文，R-06）
   - workspace_id 普通索引（owner 列表查询）
   - scope JSON（read/dispatch/converge 集合）
   - created_by FK users SET NULL、last_used_at / revoked_at nullable 审计/吊销
2. 建 ``mcp_webhooks``（design §8.2）—— worker 终态回调注册：
   - token_id FK mcp_tokens CASCADE（token 删则级联删 webhook）
   - workspace_id FK workspaces CASCADE（冗余便于查询）
   - secret String(128)（HMAC 密钥；加密归 task-11 service 层，本任务只定 String）
   - events JSON、active bool 软停用
3. ``agent_runs`` 加 ``read_only`` 列（design §8.3）—— nullable bool，兼容老 run 行
   （NULL = 非只读，design §9 brownfield 零回归）。物制走 daemon SDK --allowedTools
   单腿，本列只做审计载体。

down_revision 接 ``d5d239112387``（2026-08-06 多 head merge 后单 head，即
``lease_terminating_at`` + ``daemon_started_at`` merge point）。本项目未上线，无需
历史数据回填（CLAUDE.md 规则 11）。dialect 无关 create_table / add_column，让 SQLite
测试与 PostgreSQL 生产对齐（precedent 7c77e09b84e1 / 202606300900）。

author: qinyi
created_at: 2026-08-06 14:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260806140000"
down_revision: str | None = "d5d239112387"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── 1. design §8.1: mcp_tokens 表 ──
    op.create_table(
        "mcp_tokens",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column(
            "scope",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
        sa.Column(
            "created_by",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_mcp_tokens_token_hash",
        "mcp_tokens",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_mcp_tokens_workspace_id",
        "mcp_tokens",
        ["workspace_id"],
    )

    # ── 2. design §8.2: mcp_webhooks 表 ──
    op.create_table(
        "mcp_webhooks",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "token_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("mcp_tokens.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("url", sa.String(length=500), nullable=False),
        sa.Column("secret", sa.String(length=128), nullable=False),
        sa.Column(
            "events",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
        sa.Column(
            "active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_mcp_webhooks_token_id",
        "mcp_webhooks",
        ["token_id"],
    )
    op.create_index(
        "ix_mcp_webhooks_workspace_id",
        "mcp_webhooks",
        ["workspace_id"],
    )

    # ── 3. design §8.3: agent_runs 加 read_only 列（nullable 兼容老行） ──
    op.add_column(
        "agent_runs",
        sa.Column("read_only", sa.Boolean(), nullable=True),
    )


def downgrade() -> None:
    """结构反向回滚（与 upgrade 相反顺序，完全对称可逆）。"""
    # 3. agent_runs 列
    op.drop_column("agent_runs", "read_only")

    # 2. mcp_webhooks 表
    op.drop_index("ix_mcp_webhooks_workspace_id", table_name="mcp_webhooks")
    op.drop_index("ix_mcp_webhooks_token_id", table_name="mcp_webhooks")
    op.drop_table("mcp_webhooks")

    # 1. mcp_tokens 表
    op.drop_index("ix_mcp_tokens_workspace_id", table_name="mcp_tokens")
    op.drop_index("ix_mcp_tokens_token_hash", table_name="mcp_tokens")
    op.drop_table("mcp_tokens")
