"""merge multi_agent + ppm heads

Revision ID: cd9c3b809d15
Revises: 202607060900, 202607201000
Create Date: 2026-06-20 22:23:05.275780
"""

from __future__ import annotations

from typing import Sequence

revision: str = "cd9c3b809d15"
down_revision: str | None = ("202607060900", "202607201000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
