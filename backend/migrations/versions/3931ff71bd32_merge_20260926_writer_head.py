"""merge 20260926 writer head

Revision ID: 3931ff71bd32
Revises: 20260923090000, 20260926083000
Create Date: 2026-09-26 08:29:59.673758
"""

from __future__ import annotations

from typing import Sequence

revision: str = "3931ff71bd32"
down_revision: str | None = ("20260923090000", "20260926083000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
