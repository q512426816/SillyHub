"""add changes.description (proposal motivation excerpt)

Revision ID: 20260928140000
Revises: 20260926234000
Create Date: 2026-09-28 14:00:00.000000

2026-09-28-change-list-description：变更中心列表辨识只能靠 change_key（title
自 proposal 模板 H1 归一化后回退 key 派生名）。新增 ``changes.description``
可空列，存 proposal.md 动机段提取的一行描述（reparse 与 documents 推送
两写路径同源回填；提取规则见 ``title_norm.extract_description``）。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260928140000"
down_revision: str | None = "20260926234000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "changes",
        sa.Column("description", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("changes", "description")
