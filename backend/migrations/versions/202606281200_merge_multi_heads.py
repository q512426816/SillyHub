"""merge multi heads

合并 alembic 多 head 分支(历史多人开发 migration 未正确串链导致 8 个 head)。
本 revision 纯合并,不做 schema 变化。

Revision ID: 202606281200
"""

from __future__ import annotations

revision = "202606281200"
down_revision = (
    "202605301700",
    "202606100900",
    "202606120900",
    "202606161200",
    "202606241000",
    "202606281000",
    "202607060900",
    "202607200900",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
