"""add platform_sync_tokens table and workspace_id column to platform_change_progress

Revision ID: 20260811150000
Revises: 20260811104500
Create Date: 2026-08-11 15:00:00

Change 2026-08-11-change-progress-projection task-03 / design §8.1 §8.2 / FR-08 /
D-001@v1：进度同步层 workspace 隔离的数据地基，两处结构变更（本任务只加结构，不写
数据 / 不写业务）：

1. 建 ``platform_sync_tokens``（design §8.1）—— workspace 级进度同步鉴权 token：
   - workspace_id FK workspaces CASCADE（绑 workspace）
   - created_by FK users CASCADE **NOT NULL**（authenticate 据此派生非空 User，
     区别 mcp_tokens 的可空 SET NULL，task-01 constraints）
   - token_hash String(255) 唯一索引（存 sha256 hex，不存明文）
   - workspace_id 普通索引（owner 列表查询）
   - name String(100)、scope JSON nullable 预留、last_used_at / revoked_at nullable
2. ``platform_change_progress`` 加 ``workspace_id`` 列 + ``(workspace_id, change_name)``
   复合唯一约束（design §8.2）—— 收件箱按 workspace 隔离同名 change。

down_revision 接 ``20260811104500``（agent_profile_llm_provider，execute 实测当前 head；
plan/TaskCard 写的 ``20260810150000`` 为 plan 时刻旧 head，期间有 agent-profile-bind-llm-provider
等 change 落地致 head 推进，按实际 head 修正）。

**复合唯一用唯一约束而非复合 PK**（task-03 constraints / design §8.2）：唯一约束允许多
NULL，棕地老行 ``workspace_id`` NULL 可保留（投影 join 不命中走 fallback，规则 7 免回填）；
复合 PK 在 PG/SQLite 均不允许 PK 列 NULL，会阻塞老行。ORM 层（task-02 model）仍按
``(workspace_id, change_name)`` 复合 PK 表达目标态语义——运行时 workspace_id 非空时唯一
约束与复合 PK 行为一致，老 NULL 行仅过渡期存在。

本项目未上线，无需历史数据回填（CLAUDE.md 规则 7）。dialect 无关 create_table /
add_column / create_unique_constraint，让 SQLite 测试库与 PostgreSQL 生产对齐
（precedent 20260806140000_add_mcp_tokens_webhooks_run_readonly）。

author: qinyi
created_at: 2026-08-11 15:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260811150000"
down_revision: str | None = "20260811104500"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── 1. design §8.1: platform_sync_tokens 表 ──
    op.create_table(
        "platform_sync_tokens",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("token_hash", sa.String(length=255), nullable=False),
        sa.Column("scope", sa.JSON(), nullable=True),
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
        "ix_platform_sync_tokens_token_hash",
        "platform_sync_tokens",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_platform_sync_tokens_workspace_id",
        "platform_sync_tokens",
        ["workspace_id"],
    )

    # ── 2. design §8.2: platform_change_progress 加 workspace_id 列（nullable 兼容老行） ──
    op.add_column(
        "platform_change_progress",
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    # 复合唯一（非复合 PK）：唯一约束允许多 NULL，棕地老行 workspace_id=NULL 可保留
    # （投影 join 不命中走 fallback，规则 7 免回填）。
    op.create_unique_constraint(
        "uq_platform_change_progress_workspace_change",
        "platform_change_progress",
        ["workspace_id", "change_name"],
    )


def downgrade() -> None:
    """结构反向回滚（与 upgrade 相反顺序，完全对称可逆）。"""
    # 2. platform_change_progress 复合唯一 + workspace_id 列
    op.drop_constraint(
        "uq_platform_change_progress_workspace_change",
        "platform_change_progress",
        type_="unique",
    )
    op.drop_column("platform_change_progress", "workspace_id")

    # 1. platform_sync_tokens 表
    op.drop_index(
        "ix_platform_sync_tokens_workspace_id",
        table_name="platform_sync_tokens",
    )
    op.drop_index(
        "ix_platform_sync_tokens_token_hash",
        table_name="platform_sync_tokens",
    )
    op.drop_table("platform_sync_tokens")
