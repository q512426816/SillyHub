"""merge parallel heads 20261011020000 20261011160000

Revision ID: c515ffd62859
Revises: 20261011020000, 20261011160000
Create Date: 2026-10-11 19:13:27.412706
"""

from __future__ import annotations

from typing import Sequence

revision: str = "c515ffd62859"
down_revision: str | None = ("20261011020000", "20261011160000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
