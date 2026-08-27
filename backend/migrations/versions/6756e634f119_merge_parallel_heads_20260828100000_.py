"""merge parallel heads 20260828100000 20260828120000

Revision ID: 6756e634f119
Revises: 20260828100000, 20260828120000
Create Date: 2026-08-28 06:39:48.466610
"""

from __future__ import annotations

from typing import Sequence

revision: str = "6756e634f119"
down_revision: str | None = ("20260828100000", "20260828120000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
