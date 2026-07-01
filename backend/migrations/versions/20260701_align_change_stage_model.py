"""Drop changes.human_gate column, set status server_default to 'active'.

Revision ID: 202607011000
Revises: 202606301500
Create Date: 2026-07-01 10:00:00

根据 D-001@v1（Change 模型简化）和 D-005@v1（允许重置），删除 human_gate 列，
并将 status 列 server_default 从 'draft' 改为 'active'。

FR-01: 变更模型对齐 — human_gate 移除 + status 默认 active。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607011000"
down_revision: str | None = "202606301500"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop human_gate column, set status server_default to 'active'.

    D-001@v1: Change 模型简化，移除 human_gate 门控字段。
    D-005@v1: 新变更默认为 active，存量 'draft' 行不回填（允许重置）。
    """
    # D-001@v1: 删除 human_gate 列
    op.drop_column("changes", "human_gate")

    # D-005@v1: status server_default draft → active
    op.alter_column("changes", "status", server_default="active")


def downgrade() -> None:
    """Reverse: restore human_gate column and revert status server_default."""
    # 恢复 human_gate 列（与原 migration 202606240900 定义一致）
    op.add_column(
        "changes",
        sa.Column(
            "human_gate",
            sa.String(length=50),
            nullable=False,
            server_default="none",
        ),
    )

    # 恢复 server_default 为 draft
    op.alter_column("changes", "status", server_default="draft")
