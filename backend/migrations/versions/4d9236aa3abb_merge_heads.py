"""merge heads

Revision ID: 4d9236aa3abb
Revises: 202605301700, 202606150900
Create Date: 2026-05-30 23:58:28.263627
"""

from __future__ import annotations

from typing import Sequence

revision: str = "4d9236aa3abb"
down_revision: str | None = ("202605301700", "202606150900")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
