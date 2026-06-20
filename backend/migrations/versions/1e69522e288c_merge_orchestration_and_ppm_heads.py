"""merge orchestration and ppm heads

Revision ID: 1e69522e288c
Revises: 202607060900, 202607201000
Create Date: 2026-06-20 23:19:44.345791
"""

from __future__ import annotations

from typing import Sequence

revision: str = "1e69522e288c"
down_revision: str | None = ("202607060900", "202607201000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
