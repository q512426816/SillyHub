"""Remove scan from change flow: migrate current_stage scan→brainstorm.

变更 2026-07-02-decouple-scan-from-change-flow：scan 从变更流程彻底移除，
变更 current_stage 枚举由 6 段收敛为 5 段（brainstorm/plan/execute/verify/archive）。
本 migration 将存量 ``current_stage='scan'`` 的变更迁移到 ``'brainstorm'``（新起点）。

一次性语义迁移，不要求历史兼容（CLAUDE.md 规则 10）。

Revision ID: 202607022300
Revises: 202607021200
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607022300"
down_revision = "202607021200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """变更流程移除 scan：存量 current_stage='scan' → 'brainstorm'。"""
    op.execute(
        sa.text("UPDATE changes SET current_stage = 'brainstorm' WHERE current_stage = 'scan'")
    )


def downgrade() -> None:
    """一次性语义迁移，不回滚。"""
    pass
